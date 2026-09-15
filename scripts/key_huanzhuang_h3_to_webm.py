"""Convert huanzhuang H3 greenscreen MP4 → transparent VP9 WebM (game ship).

Uses project greenscreen encoder (libvpx-vp9 + yuva420p), same as pifu04/pifu05 H3 batches.

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/key_huanzhuang_h3_to_webm.py
  ... --stem SR01_2 --force
  ... --stem SSR03_1,UR04_1 --force --mode green_dom
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from chroma_key_gs_video_webm import FFMPEG, gs_mp4_to_webm, verify_has_alpha  # noqa: E402

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "huanzhuang" / "_h3_out"
SHIP_DIR = ROOT / "tex" / "juese" / "pifu" / "huanzhuang"
QA_DIR = SHIP_DIR / "_webm_qa"

# 默认：只抠纯绿幕 #00b140（避免吃进角色/道具）
KEY_HEX = "0x00B140"
HUANZHUANG_SAFE_VF = (
    f"colorkey={KEY_HEX}:0.16:0.04,format=rgba,"
    "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
    "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
    "format=yuva420p"
)


def auto_dual_key_vf(src_mp4: Path) -> str:
    with tempfile.TemporaryDirectory() as td:
        png = Path(td) / "f.png"
        subprocess.run(
            [FFMPEG, "-y", "-ss", "0.4", "-i", str(src_mp4), "-frames:v", "1", "-update", "1", str(png)],
            check=True,
            capture_output=True,
        )
        rgb = np.asarray(Image.open(png).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    cs = max(12, min(h, w) // 20)
    patches = [
        rgb[:cs, :cs],
        rgb[:cs, -cs:],
        rgb[-cs:, :cs],
        rgb[-cs:, -cs:],
        rgb[h // 2 - cs : h // 2 + cs, :cs],
        rgb[-cs * 3 : -cs, :cs],
        rgb[-cs * 3 : -cs, -cs:],
    ]
    greens = []
    for p in patches:
        if p.size == 0:
            continue
        m = p.reshape(-1, 3).mean(0)
        if m[1] > m[0] + 12 and m[1] > m[2] + 8 and m[1] > 55:
            greens.append(m)
    if not greens:
        greens = [rgb[:cs, :cs].reshape(-1, 3).mean(0)]
    arr = np.stack(greens)
    k1 = tuple(int(round(x)) for x in np.median(arr, axis=0))
    k2 = tuple(int(round(x)) for x in arr[int(np.argmin(arr[:, 1]))])
    h1 = f"0x{k1[0]:02X}{k1[1]:02X}{k1[2]:02X}"
    h2 = f"0x{k2[0]:02X}{k2[1]:02X}{k2[2]:02X}"
    return (
        f"colorkey={h1}:0.24:0.07,colorkey={h2}:0.22:0.07,format=rgba,"
        "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
        "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
        "format=yuva420p"
    )


def green_dom_alpha(rgb: np.ndarray) -> np.ndarray:
    """只抠「绿色占优」的幕布像素，保留衣柜白木/角色/布料。"""
    rgb_f = rgb.astype(np.float32)
    r, g, b = rgb_f[:, :, 0], rgb_f[:, :, 1], rgb_f[:, :, 2]
    sat = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    hard = ((g > r + 18) & (g > b + 14) & (g > 55) & (sat > 22)).astype(np.float32)
    soft = ((g > r + 10) & (g > b + 8) & (g > 48) & (sat > 14)).astype(np.float32)
    alpha = 1.0 - np.clip(hard + (soft - hard) * 0.6, 0, 1)
    keep = (sat < 16) | ((np.maximum(r, b) > g - 8) & (sat < 36) & (g < 170))
    alpha = np.where(keep, np.maximum(alpha, 0.94), alpha)
    from scipy import ndimage  # type: ignore

    bg = (alpha < 0.35).astype(np.uint8)
    bg = ndimage.binary_dilation(bg, iterations=2)
    alpha = np.where(bg, np.minimum(alpha, 0.04), alpha)
    return (np.clip(alpha, 0, 1) * 255).astype(np.uint8)


def encode_green_dom_webm(src_mp4: Path, dest_webm: Path, *, fps: float = 24.0, crf: int = 28) -> Path:
    dest_webm.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tdir = Path(td)
        raw_dir = tdir / "raw"
        keyed_dir = tdir / "keyed"
        raw_dir.mkdir()
        keyed_dir.mkdir()
        subprocess.run(
            [FFMPEG, "-y", "-i", str(src_mp4), "-vsync", "0", str(raw_dir / "f_%05d.png")],
            check=True,
            capture_output=True,
        )
        frames = sorted(raw_dir.glob("f_*.png"))
        if not frames:
            raise RuntimeError(f"no frames from {src_mp4}")
        for i, fp in enumerate(frames):
            rgb = np.asarray(Image.open(fp).convert("RGB"))
            a = green_dom_alpha(rgb)
            rgba = np.dstack([rgb, a])
            m = a[:, :, None].astype(np.float32) / 255.0
            rgba[:, :, :3] = (rgb.astype(np.float32) * m).astype(np.uint8)
            Image.fromarray(rgba, "RGBA").save(keyed_dir / f"k_{i + 1:05d}.png")
        tmp = dest_webm.with_suffix(".tmp.webm")
        subprocess.run(
            [
                FFMPEG,
                "-y",
                "-framerate",
                str(fps),
                "-i",
                str(keyed_dir / "k_%05d.png"),
                "-c:v",
                "libvpx-vp9",
                "-pix_fmt",
                "yuva420p",
                "-auto-alt-ref",
                "0",
                "-crf",
                str(crf),
                "-b:v",
                "0",
                "-an",
                str(tmp),
            ],
            check=True,
            capture_output=True,
        )
        tmp.replace(dest_webm)
    return dest_webm


STEM_NAME = {
    "SR01_2": "苍羽·澪",
    "SR01_3": "苍斩·凛",
    "SR02_1": "白楯·芹奈",
    "SR03_1": "银绯·玲",
    "SR04_1": "焰甲·朱里",
    "SR05_1": "黄狐·萤",
    "SSR01_1": "夜爪·黑织",
    "SSR02_1": "翠翼·铃",
    "SSR03_1": "冰华·雫",
    "SSR04_1": "绯尾·椿",
    "SSR05_1": "橙铠·琥珀",
    "UR03_1": "光轮·天音",
    "UR04_1": "橙兔·美羽",
}

DEFAULT_GREEN_DOM = {"SSR03_1", "UR04_1"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--crf", type=int, default=28)
    ap.add_argument(
        "--mode",
        default="auto",
        choices=["auto", "safe", "dual", "green_dom"],
        help="auto: SSR03/UR04 use green_dom; others safe #00b140",
    )
    args = ap.parse_args()

    stems = list(STEM_NAME.keys()) if args.stem == "all" else [
        s.strip() for s in args.stem.split(",") if s.strip()
    ]
    QA_DIR.mkdir(parents=True, exist_ok=True)
    SHIP_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    for stem in stems:
        name = STEM_NAME.get(stem, stem)
        src = SRC_DIR / f"{stem}_huanzhuang_gs_h3.mp4"
        out = SHIP_DIR / f"{stem}_huanzhuang.webm"
        row = {"stem": stem, "name": name, "ok": False, "src": str(src), "out": str(out)}
        if not src.exists():
            row["error"] = "missing mp4"
            print(f"[MISS] {stem} {name}: {src.name}", flush=True)
            results.append(row)
            continue
        if out.exists() and out.stat().st_size > 50_000 and not args.force:
            print(f"[SKIP] {stem} {name} webm exists", flush=True)
            row["ok"] = True
            row["skipped"] = True
            results.append(row)
            continue

        mode = args.mode
        if mode == "auto":
            mode = "green_dom" if stem in DEFAULT_GREEN_DOM else "safe"

        print(f"=== {stem} {name} ({src.stat().st_size // 1024} KB) mode={mode} ===", flush=True)
        try:
            if mode == "green_dom":
                encode_green_dom_webm(src, out, fps=24.0, crf=args.crf)
            elif mode == "dual":
                gs_mp4_to_webm(src, out, fps=24.0, crf=args.crf, vf=auto_dual_key_vf(src))
            else:
                gs_mp4_to_webm(src, out, fps=24.0, crf=args.crf, vf=HUANZHUANG_SAFE_VF)
            ok_a, det_a = verify_has_alpha(out, min_zero_pct=3.0)
            row["alpha"] = det_a
            row["mode"] = mode
            if not ok_a:
                print(f"  WARN alpha {det_a}", flush=True)
            prev = QA_DIR / f"{stem}_preview.png"
            subprocess.run(
                [
                    FFMPEG,
                    "-y",
                    "-c:v",
                    "libvpx-vp9",
                    "-ss",
                    "2.0",
                    "-i",
                    str(out),
                    "-frames:v",
                    "1",
                    "-update",
                    "1",
                    str(prev),
                ],
                check=False,
                capture_output=True,
            )
            row["ok"] = True
            row["bytes"] = out.stat().st_size
            print(f"  OK -> {out.name} ({row['bytes'] // 1024} KB) {det_a}", flush=True)
        except Exception as e:
            row["error"] = str(e)
            print(f"  FAIL {e}", flush=True)
        results.append(row)

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
        "results": results,
    }
    (QA_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("SUMMARY", json.dumps({"ok": summary["ok"], "fail": summary["fail"]}, ensure_ascii=False), flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    sys.exit(main())
