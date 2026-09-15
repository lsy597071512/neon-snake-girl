"""Detect post-towel segment in pifu03 intimate webms (lossless trim prep)."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

FF = imageio_ffmpeg.get_ffmpeg_exe()
CHONGZAO = Path(__file__).resolve().parents[1] / "tex" / "juese" / "pifu" / "chongzao"
QA = CHONGZAO / "_trim_qa"
FPS = 24.0
# MiniMax H3 chongzao batch prompt: towel fully off from ~3.5s to end.
PROMPT_TOWEL_OFF_S = 3.5


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
    """Return (wrap towel mid-body, hip towel remnant) white ratios."""
    wrap = white_fabric_ratio(im, 0.38, 0.62, 0.22, 0.78)
    hip = white_fabric_ratio(im, 0.58, 0.74, 0.25, 0.75)
    return wrap, hip


def dump_frames(src: Path, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("f_*.png"):
        old.unlink()
    subprocess.run(
        [FF, "-y", "-i", str(src), "-vsync", "0", str(out_dir / "f_%04d.png")],
        check=True,
        capture_output=True,
    )
    return sorted(out_dir.glob("f_*.png"))


def analyze(src: Path, stem: str | None = None) -> dict:
    if stem is None:
        stem = src.stem.replace("_pifu03_full", "").replace("_pifu03", "")
    out_dir = QA / stem / "frames"
    frames = dump_frames(src, out_dir)
    pairs = [towel_scores(Image.open(fp)) for fp in frames]
    wrap_scores = [p[0] for p in pairs]
    hip_scores = [p[1] for p in pairs]
    last = len(frames) - 1
    off = int(PROMPT_TOWEL_OFF_S * FPS)
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
        "wrap_scores_head": [round(s, 3) for s in wrap_scores[:8]],
        "hip_scores_around_off": [round(s, 3) for s in hip_scores[max(0, off - 6) : off + 8]],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="SR01_2")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    if args.all:
        stems = sorted(p.stem.replace("_pifu03", "") for p in CHONGZAO.glob("*_pifu03.webm"))
    else:
        stems = [args.stem]
    report = []
    for stem in stems:
        src = CHONGZAO / f"{stem}_pifu03.webm"
        if not src.is_file():
            print("MISSING", src)
            continue
        info = analyze(src)
        report.append(info)
        print(json.dumps(info, ensure_ascii=False, indent=2))
    out = QA / "towel_off_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
