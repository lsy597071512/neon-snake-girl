"""Detect pifu08_2 undress loop windows (handle mid-clip rewrap).

Writes tex/juese/pifu/chongzao02/_trim_qa/loop_windows.json
with {stem: {off_frame, end_frame_inclusive, ...}}.
Manual overrides win when auto is uncertain.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

QA = Path(__file__).resolve().parents[1] / "tex" / "juese" / "pifu" / "chongzao02" / "_trim_qa"
FPS = 24.0

# Visual QA overrides: inclusive start / exclusive end (ffmpeg end_frame)
# Built from contact sheets + key frames.
MANUAL: dict[str, tuple[int, int]] = {
    # stays undressed to end
    "SR01_2": (144, 175),
    "SR01_3": (96, 124),
    "SR02_1": (120, 175),
    "SR03_1": (96, 175),
    # undress then rewrap — keep only mid undressed plateau
    "SR04_1": (96, 118),
    "SR05_1": (72, 118),
    # SSR01 undresses then pulls towel back ~f144
    "SSR01_1": (96, 132),
    "SSR02_1": (96, 175),
    "SSR03_1": (96, 175),
    "SSR04_1": (118, 175),
    "SSR05_1": (120, 175),
    "UR03_1": (133, 175),
    "UR04_1": (96, 175),
}


def chest_metrics(im: Image.Image) -> tuple[float, float]:
    a = np.asarray(im.convert("RGBA"), dtype=np.float32)
    rgb, alpha = a[..., :3], a[..., 3]
    h, w = alpha.shape
    y0, y1 = int(h * 0.28), int(h * 0.52)
    x0, x1 = int(w * 0.22), int(w * 0.78)
    band = alpha[y0:y1, x0:x1] > 16
    pix = rgb[y0:y1, x0:x1][band]
    if len(pix) == 0:
        return 0.0, 0.0
    lum = pix.mean(axis=1)
    sat = pix.max(axis=1) - pix.min(axis=1)
    r, g, b = pix[:, 0], pix[:, 1], pix[:, 2]
    white = float(((lum > 185) & (sat < 55)).mean())
    skin = float(
        (
            (lum > 90)
            & (lum < 210)
            & (sat < 80)
            & (r > g - 10)
            & (r > b)
            & (g > b - 20)
            & ~((lum > 185) & (sat < 55))
        ).mean()
    )
    return skin, white


def main() -> int:
    report = []
    for stem, (off, end_ex) in MANUAL.items():
        frame_dir = QA / stem / "frames"
        frames = sorted(frame_dir.glob("f_*.png"))
        if not frames:
            print("MISSING frames", stem)
            continue
        last = len(frames)
        end_ex = min(end_ex, last)
        off = max(0, min(off, end_ex - 12))
        # export loop endpoints for visual confirm
        out = QA / stem
        for fi in sorted({off, min(last - 1, end_ex - 1), last - 1}):
            Image.open(frames[fi]).save(out / f"loop_f{fi:04d}.png")
        info = {
            "stem": stem,
            "towel_off_frame": off,
            "towel_off_s": round(off / FPS, 3),
            "loop_end_frame_exclusive": end_ex,
            "loop_end_s": round(end_ex / FPS, 3),
            "loop_duration_s": round((end_ex - off) / FPS, 3),
            "source_frame_count": last,
            "manual": True,
        }
        report.append(info)
        print(
            f"{stem}: loop {info['towel_off_s']}s..{info['loop_end_s']}s "
            f"({info['loop_duration_s']}s) f{off}..{end_ex}",
            flush=True,
        )
    out_json = QA / "loop_windows.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
