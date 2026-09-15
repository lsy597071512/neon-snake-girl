"""Paint opaque thin black catsuit onto approved tiaojiao pose stills (keep pose/ropes/cyber).

Example:
  python scripts/paint_tiaojiao_black_suit.py \\
    --src tex/juese/pifu/tiaojiao/_bak_nude_no_mesh/SR01_2_tiaojiao_pose_1.png \\
    --out tex/juese/pifu/tiaojiao/SR01_2_tiaojiao_pose_1.png
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

GREEN = np.array([0, 177, 64], dtype=np.float32)


def paint_opaque_black_suit(src: Path, dest: Path, *, aggressive_torso: bool = False) -> Path:
    rgb0 = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    h, w = rgb0.shape[:2]
    rgb = rgb0
    lum = rgb.mean(2)
    dist = np.linalg.norm(rgb - GREEN, axis=2)
    subj = dist >= 42
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    mx, mn = rgb.max(2), rgb.min(2)
    sat = (mx - mn) / np.maximum(mx, 1.0)
    yy = np.arange(h)[:, None]
    xx = np.arange(w)[None, :]

    ys, xs = np.where(subj)
    if len(xs) < 80:
        raise RuntimeError(f"empty subject: {src}")
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    hb, wb = max(1, y1 - y0 + 1), max(1, x1 - x0 + 1)
    cx = (x0 + x1) / 2.0
    neck = y0 + int(0.16 * hb)
    mid_thigh = y0 + int(0.62 * hb)

    face_img = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(face_img)
    draw.ellipse(
        [int(cx - 0.22 * wb), y0, int(cx + 0.22 * wb), y0 + int(0.22 * hb)],
        fill=255,
    )
    face = (np.asarray(face_img) > 0) & subj
    hair = subj & (yy < neck) & (lum > 150) & (sat < 0.38) & ~face

    cyber = (
        subj
        & (lum > 155)
        & (sat < 0.20)
        & (b > 145)
        & ~face
        & (np.abs(r - g) < 18)
        & (np.abs(g - b) < 22)
        & ((r - b) < 12)
        & ((yy > y0 + int(0.48 * hb)) | (np.abs(xx - cx) > 0.24 * wb))
    )
    gold = (r > 160) & (g > 105) & (b < 105) & (r > g)
    ropes = subj & (lum < 50) & (sat < 0.45) & ~face

    warm = (r > g - 15) & (r > b - 5) & ((r - b) > 5) & (lum > 45) & (lum < 250)
    cool_pale = (lum > 100) & (lum < 240) & (sat < 0.42) & (r > 100) & (b > 100)
    pale_cloth = (
        (lum > 145)
        & (sat < 0.25)
        & (b > 125)
        & (np.abs(xx - cx) < 0.38 * wb)
        & (yy < mid_thigh)
    )
    flesh = (
        subj
        & ~face
        & ~hair
        & ~cyber
        & ~gold
        & ~ropes
        & (yy >= neck - 8)
        & (warm | cool_pale | pale_cloth)
    )
    if aggressive_torso:
        torso = (
            subj
            & (yy >= neck)
            & (yy <= mid_thigh)
            & (np.abs(xx - cx) < 0.38 * wb)
            & ~face
            & ~cyber
            & ~ropes
        )
        flesh = flesh | torso

    u8 = (flesh.astype(np.uint8) * 255)
    flesh = (
        np.asarray(
            Image.fromarray(u8, "L").filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3))
        )
        > 127
    )
    flesh = flesh & subj & ~face & ~cyber & ~hair & (yy >= neck - 4)

    alpha = flesh.astype(np.float32)
    aimg = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(
        ImageFilter.GaussianBlur(radius=1.0)
    )
    alpha = np.asarray(aimg).astype(np.float32) / 255.0
    alpha = np.where(face | cyber | hair | ~subj, 0.0, alpha)

    base = np.zeros_like(rgb)
    base[:] = (14, 14, 18)
    shade = np.clip(0.30 + 0.72 * (lum / 255.0), 0.22, 1.25)[..., None]
    suit = np.clip(base * shade + np.array([2.0, 3.0, 5.0]) * np.clip(shade - 0.4, 0, 1), 0, 255)
    out = rgb * (1.0 - alpha[..., None]) + suit * alpha[..., None]

    ol = out.mean(2)
    need = (
        subj
        & ~face
        & ~cyber
        & ~hair
        & ~ropes
        & (yy >= neck)
        & (yy <= mid_thigh + 20)
        & (ol > 70)
    )
    if aggressive_torso:
        need = need | (
            subj
            & (yy >= neck)
            & (yy <= mid_thigh + 10)
            & (np.abs(xx - cx) < 0.38 * wb)
            & ~face
            & ~cyber
            & ~ropes
            & (ol > 55)
        )
    need = (
        np.asarray(Image.fromarray((need.astype(np.uint8) * 255), "L").filter(ImageFilter.MaxFilter(5)))
        > 127
    )
    need = need & subj & ~face & ~cyber & ~ropes
    shade2 = np.clip(0.30 + 0.72 * (ol / 255.0), 0.22, 1.25)[..., None]
    suit2 = np.clip(base * shade2 + np.array([2.0, 3.0, 5.0]) * np.clip(shade2 - 0.4, 0, 1), 0, 255)
    out = np.where(need[..., None], suit2, out)

    out = np.where(ropes[..., None], rgb0, out)
    out = np.where(face[..., None], rgb0, out)
    out = np.where(hair[..., None], rgb0, out)
    out = np.where(cyber[..., None], rgb0, out)

    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
    print(f"SHIP {dest} ({dest.stat().st_size // 1024} KB)", flush=True)
    return dest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--aggressive-torso", action="store_true")
    args = ap.parse_args()
    paint_opaque_black_suit(Path(args.src), Path(args.out), aggressive_torso=args.aggressive_torso)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
