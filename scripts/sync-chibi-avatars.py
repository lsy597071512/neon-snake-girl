"""
将 tex/juese/avatars 下的卡通全身图同步为游戏用头像：
  {characterId} (2).png 或 {characterId}_chibi.png → {characterId}.png @ 128×128

按角色 id 严格映射（与 src/data/characters.ts 一致），不改 AI Prompt。
用法：python scripts/sync-chibi-avatars.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "tex" / "juese" / "avatars"
IDS = [
    "ashcrow",
    "heartforge",
    "mirror",
    "neoncoil",
    "prismrift",
    "wireguard",
    "frostline",
    "pulse",
    "dustblade",
    "ironrain",
    "skyshard",
    "stellar",
    "outercore",
]
SIZE = 128


def find_source(cid: str) -> Path | None:
    for name in (f"{cid} (2).png", f"{cid}_chibi.png", f"{cid}-chibi.png"):
        p = ROOT / name
        if p.exists():
            return p
    return None


def nonwhite_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    rgb = np.asarray(im.convert("RGB"))
    mask = (rgb[:, :, 0] < 245) | (rgb[:, :, 1] < 245) | (rgb[:, :, 2] < 245)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return 0, 0, im.width, im.height
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def to_avatar(src: Path, dst: Path) -> None:
    im = Image.open(src).convert("RGBA")
    base = Image.new("RGBA", im.size, (255, 255, 255, 255))
    base.alpha_composite(im)
    x0, y0, x1, y1 = nonwhite_bbox(base)
    bw, bh = x1 - x0, y1 - y0
    side = int(min(bw, max(bh * 0.52, bw * 0.72)))
    side = max(side, min(bw, bh) // 2)
    pad_top = int(bh * 0.02)
    left = x0 + (bw - side) // 2
    top = max(0, y0 - pad_top)
    left = max(0, min(left, im.width - side))
    top = max(0, min(top, im.height - side))
    crop = base.crop((left, top, left + side, top + side))
    out = crop.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    rgb = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    rgb.paste(out, mask=out.split()[3])
    rgb.save(dst, format="PNG", optimize=True, compress_level=9)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for cid in IDS:
        src = find_source(cid)
        if not src:
            raise SystemExit(f"missing source for {cid}")
        dst = ROOT / f"{cid}.png"
        to_avatar(src, dst)
        print(f"OK {dst.name} from {src.name} ({dst.stat().st_size // 1024}KB)")
        if src.name != dst.name:
            src.unlink()
            print(f"  removed {src.name}")
    print("done", len(IDS))


if __name__ == "__main__":
    main()
