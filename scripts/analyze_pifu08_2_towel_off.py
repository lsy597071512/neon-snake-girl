"""Detect towel-fully-off moment in pifu08_2 (共浴交互02) webms.

Scans mid-body white-fabric ratio; towel_off = first frame where wrap score
drops and stays low through the end. Writes QA frames + report for trim.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

FF = imageio_ffmpeg.get_ffmpeg_exe()
ROOT = Path(__file__).resolve().parents[1]
CHONGZAO02 = ROOT / "tex" / "juese" / "pifu" / "chongzao02"
QA = CHONGZAO02 / "_trim_qa"
FPS = 24.0

# Heuristic: wrap band white fabric; off when score stays below this
WRAP_OFF_THRESH = 0.08
# Require N consecutive low frames before declaring off
STABLE_N = 6
# Don't cut earlier than this (still mid-undress for most H3 clips)
MIN_OFF_S = 1.5
# Keep at least this many seconds for the loop
MIN_LOOP_S = 1.2


def white_fabric_ratio(im: Image.Image, y0f: float, y1f: float, x0f: float, x1f: float) -> float:
    a = np.asarray(im.convert("RGBA"), dtype=np.float32)
    rgb, alpha = a[..., :3], a[..., 3]
    vis = alpha > 16
    h, w = alpha.shape
    y0, y1 = int(h * y0f), int(h * y1f)
    x0, x1 = int(w * x0f), int(w * x1f)
    band = vis[y0:y1, x0:x1]
    pix = rgb[y0:y1, x0:x1][band]
    if len(pix) == 0:
        return 0.0
    lum = pix.mean(axis=1)
    sat = pix.max(axis=1) - pix.min(axis=1)
    white = (lum > 185) & (sat < 55)
    return float(white.mean())


def towel_scores(im: Image.Image) -> tuple[float, float]:
    wrap = white_fabric_ratio(im, 0.36, 0.64, 0.18, 0.82)
    hip = white_fabric_ratio(im, 0.56, 0.78, 0.22, 0.78)
    return wrap, hip


def dump_frames(src: Path, out_dir: Path, *, step: int = 1) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("f_*.png"):
        old.unlink()
    # Full frame dump then subsample if step>1
    subprocess.run(
        [FF, "-y", "-c:v", "libvpx-vp9", "-i", str(src), "-vsync", "0", str(out_dir / "f_%04d.png")],
        check=True,
        capture_output=True,
    )
    frames = sorted(out_dir.glob("f_*.png"))
    if step <= 1:
        return frames
    keep = set(range(0, len(frames), step)) | {len(frames) - 1}
    for i, fp in enumerate(frames):
        if i not in keep:
            fp.unlink(missing_ok=True)
    return sorted(out_dir.glob("f_*.png"))


def find_towel_off(wrap_scores: list[float], *, min_off_frame: int) -> int:
    n = len(wrap_scores)
    if n == 0:
        return 0
    # Prefer earliest frame where next STABLE_N frames are all below thresh
    for i in range(max(0, min_off_frame), n - STABLE_N):
        window = wrap_scores[i : i + STABLE_N]
        if all(s < WRAP_OFF_THRESH for s in window):
            return i
    # Fallback: minimum wrap in last third
    start = max(min_off_frame, int(n * 0.45))
    if start >= n:
        start = max(0, n // 2)
    best = start
    best_s = wrap_scores[start]
    for i in range(start, n):
        if wrap_scores[i] < best_s:
            best_s = wrap_scores[i]
            best = i
    return best


def analyze(src: Path, stem: str | None = None) -> dict:
    if stem is None:
        stem = src.stem.replace("_pifu08_2", "")
    out_dir = QA / stem / "frames"
    frames = dump_frames(src, out_dir, step=1)
    # Map file index: f_0001.png is frame 0
    pairs = [towel_scores(Image.open(fp)) for fp in frames]
    wrap_scores = [p[0] for p in pairs]
    hip_scores = [p[1] for p in pairs]
    last = len(frames) - 1
    min_off = int(round(MIN_OFF_S * FPS))
    off = find_towel_off(wrap_scores, min_off_frame=min_off)
    # Ensure enough loop length
    min_loop_frames = int(round(MIN_LOOP_S * FPS))
    if last - off < min_loop_frames:
        off = max(0, last - min_loop_frames)
    # Contact sheet of key frames around off
    sheet_dir = QA / stem
    sheet_dir.mkdir(parents=True, exist_ok=True)
    picks = sorted(
        {
            0,
            max(0, off - 12),
            max(0, off - 4),
            off,
            min(last, off + 4),
            min(last, off + 12),
            last,
        }
    )
    for fi in picks:
        if 0 <= fi < len(frames):
            Image.open(frames[fi]).save(sheet_dir / f"pick_f{fi:04d}.png")

    return {
        "stem": stem,
        "src": str(src),
        "frame_count": len(frames),
        "duration_s": round(len(frames) / FPS, 3),
        "towel_off_frame": off,
        "towel_off_s": round(off / FPS, 3),
        "loop_end_frame": last,
        "loop_end_s": round(last / FPS, 3),
        "loop_duration_s": round((last - off) / FPS, 3),
        "wrap_at_off": round(wrap_scores[off], 3) if wrap_scores else None,
        "wrap_at_end": round(wrap_scores[last], 3) if wrap_scores else None,
        "wrap_scores_every_12": [
            {"f": i, "s": round(t, 3)} for i, t in enumerate(wrap_scores) if i % 12 == 0
        ],
        "hip_around_off": [
            round(s, 3) for s in hip_scores[max(0, off - 4) : min(len(hip_scores), off + 8)]
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    files = sorted(CHONGZAO02.glob("*_pifu08_2.webm"))
    # exclude accidental loop outputs
    files = [p for p in files if not p.stem.endswith("_loop")]
    if args.stem:
        files = [p for p in files if p.stem.startswith(args.stem)]
    elif not args.all:
        ap.error("pass --all or --stem")

    report = []
    for src in files:
        stem = src.stem.replace("_pifu08_2", "")
        print(f"=== analyze {stem} ===", flush=True)
        info = analyze(src, stem=stem)
        report.append(info)
        print(
            f"  off={info['towel_off_s']}s (f{info['towel_off_frame']}) "
            f"loop={info['loop_duration_s']}s wrap_off={info['wrap_at_off']}",
            flush=True,
        )
    out = QA / "towel_off_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
