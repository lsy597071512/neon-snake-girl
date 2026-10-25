"""Improve towel-off detection for pifu08_2 using CHEST white-fabric ratio.

Waist cloth often remains after 「脱巾」; mid-body wrap score stays high.
Chest band (y~0.28–0.50) better marks「上身浴巾已脱」.
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
CHEST_OFF_THRESH = 0.06
STABLE_N = 5
MIN_OFF_S = 2.0
MIN_LOOP_S = 1.5


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


def chest_score(im: Image.Image) -> float:
    # Upper torso / breast band — towel wrap covers this early, gone after undress
    return white_fabric_ratio(im, 0.28, 0.50, 0.22, 0.78)


def find_chest_off(scores: list[float], *, min_off_frame: int) -> int:
    n = len(scores)
    for i in range(max(0, min_off_frame), n - STABLE_N):
        if all(s < CHEST_OFF_THRESH for s in scores[i : i + STABLE_N]):
            return i
    # Fallback: largest drop then stay relatively low
    best_i = max(min_off_frame, n // 3)
    best_drop = -1.0
    for i in range(max(1, min_off_frame), n - STABLE_N):
        prev = max(scores[max(0, i - 8) : i]) if i > 0 else scores[0]
        after = float(np.mean(scores[i : i + STABLE_N]))
        drop = prev - after
        if drop > best_drop and after < 0.18:
            best_drop = drop
            best_i = i
    return best_i


def analyze_from_existing_frames(stem: str) -> dict:
    frame_dir = QA / stem / "frames"
    frames = sorted(frame_dir.glob("f_*.png"))
    if not frames:
        raise FileNotFoundError(frame_dir)
    scores = [chest_score(Image.open(fp)) for fp in frames]
    last = len(frames) - 1
    min_off = int(round(MIN_OFF_S * FPS))
    off = find_chest_off(scores, min_off_frame=min_off)
    min_loop = int(round(MIN_LOOP_S * FPS))
    if last - off < min_loop:
        off = max(0, last - min_loop)
    # Export review around off
    out = QA / stem
    for fi in sorted({0, max(0, off - 8), off, min(last, off + 8), last}):
        Image.open(frames[fi]).save(out / f"chest_f{fi:04d}.png")
    return {
        "stem": stem,
        "frame_count": len(frames),
        "duration_s": round(len(frames) / FPS, 3),
        "towel_off_frame": off,
        "towel_off_s": round(off / FPS, 3),
        "loop_end_frame": last,
        "loop_end_s": round(last / FPS, 3),
        "loop_duration_s": round((last - off) / FPS, 3),
        "chest_at_off": round(scores[off], 3),
        "chest_at_end": round(scores[last], 3),
        "chest_every_12": [{"f": i, "s": round(t, 3)} for i, t in enumerate(scores) if i % 12 == 0],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--stem", default="")
    args = ap.parse_args()
    stems = []
    if args.stem:
        stems = [args.stem]
    else:
        stems = sorted(p.name for p in QA.iterdir() if p.is_dir() and (p / "frames").is_dir())
    report = []
    for stem in stems:
        info = analyze_from_existing_frames(stem)
        report.append(info)
        print(
            f"{stem}: off={info['towel_off_s']}s f{info['towel_off_frame']} "
            f"loop={info['loop_duration_s']}s chest={info['chest_at_off']}",
            flush=True,
        )
    out = QA / "chest_off_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
