"""Chroma-key #00b140 green screen → straight-alpha transparent PNG.

Preserves subject; soft matte + edge despill. Reads opaque RGB from
`luoti_daiji/_opaque_bak/` and writes RGBA into `luoti_daiji/*_luoti_daiji.png`.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = Path(r"D:\neon-snake-girl\neon-snake-girl\tex\juese\pifu\chongzao\luoti_daiji")
BAK = SRC / "_opaque_bak"
KEY = np.array([0.0, 177.0, 64.0], dtype=np.float32)


def process(rgb: np.ndarray) -> np.ndarray:
    img = rgb.astype(np.float32)
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    dist = np.linalg.norm(img - KEY, axis=2)
    dom = g - np.maximum(r, b)

    d0, d1 = 26.0, 68.0
    by_dist = 1.0 - np.clip((dist - d0) / (d1 - d0), 0.0, 1.0)
    by_dom = np.clip((dom - 8.0) / 42.0, 0.0, 1.0)
    screen = np.clip(by_dist * by_dom, 0.0, 1.0)
    screen = np.where((dist < 32.0) & (dom > 20.0), 1.0, screen)
    screen = np.where(screen < 0.06, 0.0, screen)
    sb = ndimage.binary_opening(screen > 0.5, iterations=1)
    screen = np.maximum(screen * 0.85, sb.astype(np.float32) * screen)
    alpha = np.clip(1.0 - screen, 0.0, 1.0)
    alpha = np.where(alpha < 0.025, 0.0, alpha)
    alpha = np.where(alpha > 0.98, 1.0, alpha)

    trans = alpha < 0.12
    edge_band = ndimage.binary_dilation(trans, iterations=4) & (alpha > 0.02)
    rb = 0.5 * (r + b)
    excess = np.clip(g - rb - 2.0, 0.0, 255.0)
    w = np.zeros_like(alpha)
    w[edge_band] = np.clip(0.55 + excess[edge_band] / 60.0, 0.55, 1.0)
    interior_spill = (alpha > 0.5) & (dom > 25.0) & (dist < 110.0)
    w[interior_spill] = np.maximum(w[interior_spill], 0.65)
    g2 = g - excess * w
    r2 = r + w * 0.2 * np.clip(rb - r, -30, 30)
    b2 = b + w * 0.2 * np.clip(rb - b, -30, 30)

    kill = (alpha < 0.35) & (dom > 18.0) & (dist < 90.0)
    alpha = np.where(kill, 0.0, alpha)

    out = np.stack([r2, g2, b2], axis=2)
    edge2 = ndimage.binary_dilation(alpha < 0.15, iterations=3) & (alpha > 0.02)
    excess2 = np.clip(out[:, :, 1] - 0.5 * (out[:, :, 0] + out[:, :, 2]) - 1.0, 0, 255)
    out[:, :, 1] = np.where(edge2, out[:, :, 1] - excess2 * 0.9, out[:, :, 1])
    out = out * alpha[..., None]
    return np.clip(np.dstack([out, alpha * 255.0]), 0, 255).astype(np.uint8)


def main() -> None:
    files = sorted(BAK.glob("*_luoti_daiji.png"))
    if not files:
        raise SystemExit(f"no backups in {BAK}")
    for bp in files:
        rgba = process(np.asarray(Image.open(bp).convert("RGB")))
        dest = SRC / bp.name
        Image.fromarray(rgba, "RGBA").save(dest, "PNG", optimize=True)
        print("wrote", dest.name, dest.stat().st_size)


if __name__ == "__main__":
    main()
