# -*- coding: utf-8 -*-
"""给 webm 视频里暴露的部位打码（马赛克/模糊）。

流程：解码成 PNG 帧 → NudeDetector 逐帧检测 → 时域平滑（把相邻帧的框并起来，
避免逐帧闪烁）→ 打码 → 重新编码 webm。原文件不动，输出到独立目录。

用法：
  python -u scripts/censor_webm.py --input <webm或目录> [选项]

常用：
  # 先干跑看命中哪些帧，不写文件
  python -u scripts/censor_webm.py --input tex/juese/pifu/dandu/SR01_2_dandu.webm --dry-run
  # 打马赛克，输出到 tmp/censored/
  python -u scripts/censor_webm.py --input tex/juese/pifu/dandu --out tmp/censored --mode mosaic
  # 高斯模糊、更保守（只打明确暴露的）
  python -u scripts/censor_webm.py --input <f> --mode blur --classes exposed --score 0.35
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"

# 只针对"确实裸露"的标签；COVERED_* 是穿着状态，不打码
DEFAULT_CLASSES = [
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "BUTTOCKS_EXPOSED",
    "ANUS_EXPOSED",
    "FEMALE_BREAST_EXPOSED_LARGE",
]
COVERED_MARK = "_COVERED"


def probe(webm: Path) -> tuple[float, str, bool]:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v",
         "-show_entries", "stream=pix_fmt,r_frame_rate",
         "-show_entries", "format=duration", "-of", "json", str(webm)],
        check=True, capture_output=True, text=True,
    )
    d = json.loads(out.stdout)
    st = d["streams"][0]
    fps_s = st.get("r_frame_rate", "24/1")
    num, den = (int(x) for x in fps_s.split("/"))
    fps = num / den if den else 24.0
    dur = float(d.get("format", {}).get("duration", 0.0))
    has_alpha = "a" in st.get("pix_fmt", "")
    return fps, dur, has_alpha


def extract_frames(webm: Path, frame_dir: Path, has_alpha: bool) -> list[Path]:
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [FFMPEG, "-y", "-i", str(webm),
         str(frame_dir / "f_%05d.png")],
        check=True, capture_output=True,
    )
    if has_alpha:
        # 保留 alpha：从原始 webm 直接解 RGBA
        for p in sorted(frame_dir.glob("f_*.png")):
            im = Image.open(p)
            if im.mode != "RGBA":
                im.convert("RGBA").save(p)
    return sorted(frame_dir.glob("f_*.png"))


def detections_for(frames: list[Path], classes: list[str], score: float) -> list[list[tuple[int, int, int, int]]]:
    from nudenet import NudeDetector

    det = NudeDetector()
    want = set(classes)
    per_frame: list[list[tuple[int, int, int, int]]] = []
    for i, fp in enumerate(frames):
        raw = det.detect(str(fp))
        boxes: list[tuple[int, int, int, int]] = []
        for r in raw:
            cls = r["class"]
            if cls not in want:
                continue
            if r.get("score", 0.0) < score:
                continue
            x, y, w, h = r["box"]
            boxes.append((int(x), int(y), int(x) + int(w), int(y) + int(h)))
        per_frame.append(merge_boxes(boxes))
        if (i + 1) % 24 == 0:
            print(f"  detect {i+1}/{len(frames)}", flush=True)
    return per_frame


def merge_boxes(boxes: list[tuple[int, int, int, int]], gap: int = 12) -> list[tuple[int, int, int, int]]:
    """把重叠/靠近的框合并，避免一块区域被切成多个小码块。"""
    if not boxes:
        return []
    boxes = sorted(boxes)
    merged: list[list[int]] = [list(boxes[0])]
    for x1, y1, x2, y2 in boxes[1:]:
        ax1, ay1, ax2, ay2 = merged[-1]
        if x1 <= ax2 + gap and y1 <= ay2 + gap and x2 >= ax1 - gap and y2 >= ay1 - gap:
            merged[-1] = [min(ax1, x1), min(ay1, y1), max(ax2, x2), max(ay2, y2)]
        else:
            merged.append([x1, y1, x2, y2])
    return [tuple(b) for b in merged]


def smooth_temporal(per_frame: list[list[tuple[int, int, int, int]]], hold: int = 12) -> list[list[tuple[int, int, int, int]]]:
    """命中帧的框向前后各 hold 帧内持久化，消除逐帧闪烁/漏检。"""
    n = len(per_frame)
    out: list[list[tuple[int, int, int, int]]] = [[] for _ in range(n)]
    for i in range(n):
        for j in range(max(0, i - hold), min(n, i + hold + 1)):
            out[i].extend(per_frame[j])
    return [merge_boxes(f) for f in out]


def pixelate(im: Image.Image, box: tuple[int, int, int, int], blocks: int = 8) -> None:
    x1, y1, x2, y2 = box
    x1 = max(0, x1); y1 = max(0, y1)
    x2 = min(im.width, x2); y2 = min(im.height, y2)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return
    region = im.crop((x1, y1, x2, y2))
    w = max(1, (x2 - x1) // blocks)
    h = max(1, (y2 - y1) // blocks)
    small = region.resize((w, h), Image.BILINEAR).resize((x2 - x1, y2 - y1), Image.NEAREST)
    im.paste(small, (x1, y1))


def blur_box(im: Image.Image, box: tuple[int, int, int, int], radius: float = 14.0) -> None:
    from PIL import ImageFilter
    x1, y1, x2, y2 = box
    x1 = max(0, x1); y1 = max(0, y1)
    x2 = min(im.width, x2); y2 = min(im.height, y2)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return
    region = im.crop((x1, y1, x2, y2)).filter(ImageFilter.GaussianBlur(radius))
    im.paste(region, (x1, y1))


def apply_censor(frame_paths: list[Path], boxes_per_frame: list[list[tuple[int, int, int, int]]], mode: str, pad: int, blocks: int) -> int:
    hits = 0
    for fp, boxes in zip(frame_paths, boxes_per_frame):
        if not boxes:
            continue
        has_alpha = fp.with_name(fp.name).exists()
        im = Image.open(fp)
        alpha = im.getchannel("A") if im.mode == "RGBA" else None
        rgb = im.convert("RGB")
        for b in boxes:
            x1, y1, x2, y2 = b
            b = (x1 - pad, y1 - pad, x2 + pad, y2 + pad)
            hits += 1
            if mode == "mosaic":
                pixelate(rgb, b, blocks)
            else:
                blur_box(rgb, b)
        if alpha is not None:
            rgb = rgb.convert("RGBA")
            rgb.putalpha(alpha)
        rgb.save(fp)
    return hits


def encode_frames(frame_dir: Path, out_webm: Path, fps: float, has_alpha: bool, crf: int) -> None:
    out_webm.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_webm.with_suffix(".tmp.webm")
    cmd = [
        FFMPEG, "-y", "-framerate", str(fps), "-i", str(frame_dir / "f_%05d.png"),
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p" if has_alpha else "yuv420p",
        "-auto-alt-ref", "0", "-crf", str(crf), "-b:v", "0", "-row-mt", "1", "-an", str(tmp),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    tmp.replace(out_webm)


def censor_one(webm: Path, out: Path, args) -> None:
    print(f"\n=== {webm} ===", flush=True)
    fps, dur, has_alpha = probe(webm)
    with tempfile.TemporaryDirectory() as td:
        fdir = Path(td) / "f"
        frames = extract_frames(webm, fdir, has_alpha)
        print(f"  {len(frames)} frames, fps={fps:.2f} dur={dur:.1f}s alpha={has_alpha}", flush=True)
        per_frame = detections_for(frames, args.classes, args.score)
        boxes = smooth_temporal(per_frame, hold=args.hold)
        n_hit = sum(1 for b in boxes if b)
        if args.dry_run:
            print(f"  DRY-RUN: {n_hit}/{len(frames)} frames would be censored", flush=True)
            for i in range(0, len(frames), max(1, len(frames) // 6)):
                print(f"    f{i+1}: {boxes[i]}", flush=True)
            return
        hits = apply_censor(frames, boxes, args.mode, args.pad, args.blocks)
        print(f"  censored {n_hit} frames / {hits} regions", flush=True)
        encode_frames(fdir, out, fps, has_alpha, args.crf)
        print(f"  OUT {out} ({out.stat().st_size // 1024} KB)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="Censor exposed regions in webm")
    ap.add_argument("--input", required=True, help="webm file or directory (recursive)")
    ap.add_argument("--out", default="tmp/censored", help="output dir (mirrors input names)")
    ap.add_argument("--mode", choices=["mosaic", "blur"], default="mosaic")
    ap.add_argument("--blocks", type=int, default=6, help="马赛克格数(越小块越大越保险, 4~8)")
    ap.add_argument("--classes", choices=["exposed", "all"], default="exposed")
    ap.add_argument("--score", type=float, default=0.30)
    ap.add_argument("--pad", type=int, default=14, help="expand box by N px")
    ap.add_argument("--hold", type=int, default=12, help="temporal hold frames around hits")
    ap.add_argument("--crf", type=int, default=20)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="overwrite existing outputs")
    args = ap.parse_args()
    args.classes = DEFAULT_CLASSES

    src = Path(args.input)
    out_root = Path(args.out)
    if src.is_file():
        files = [src]
    else:
        files = sorted(src.rglob("*.webm"))
    print(f"queue: {len(files)} webm", flush=True)
    done = 0
    for f in files:
        target = out_root / f.relative_to(src.parent if src.is_file() else src)
        if target.exists() and not args.force:
            print(f"SKIP exists {target}", flush=True)
            continue
        censor_one(f, target, args)
        done += 1
    print(f"\nDONE {done}/{len(files)}", flush=True)


if __name__ == "__main__":
    main()
