"""Build green-screen refs for Ashcrow commander P4."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "tmp" / "cmd_discipline_p4_qa"
GREEN = (0, 177, 64)


def punch_dark_to_green(im: Image.Image, thr: int = 18) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    dark = a.max(axis=2) < thr
    a[dark] = GREEN
    return Image.fromarray(a.astype(np.uint8))


def main() -> None:
    QA.mkdir(parents=True, exist_ok=True)

    src = QA / "frames_SR01_2_tiaojiao_1_t10.png"
    punch_dark_to_green(Image.open(src)).save(QA / "ref_body_openeye_green.png")

    off = Image.open(ROOT / "tex" / "juese" / "SR01_2.png").convert("RGBA")
    arr = np.asarray(off)
    rgb = arr[:, :, :3].astype(np.float32)
    white = (rgb.min(axis=2) > 240) & ((rgb.max(axis=2) - rgb.min(axis=2)) < 12)
    alpha = arr[:, :, 3].copy()
    alpha[white] = 0
    off2 = Image.fromarray(np.dstack([arr[:, :, :3], alpha]))
    bg = Image.new("RGBA", off2.size, (*GREEN, 255))
    bg.paste(off2, mask=off2.split()[-1])
    bg.convert("RGB").save(QA / "ref_official_green.png")

    zh = Image.open(ROOT / "tex" / "zhujue.png").convert("RGB")
    w, h = zh.size
    front = zh.crop((0, 0, int(w * 0.34), h))
    a = np.asarray(front).astype(np.float32)
    white = (a.min(axis=2) > 230) & ((a.max(axis=2) - a.min(axis=2)) < 18)
    a[white] = np.array(GREEN, dtype=np.float32)
    front = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(np.asarray(front).astype(np.float32) - g, axis=2)
    ys, xs = np.where(dist > 28)
    front = front.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    pad = Image.new("RGB", (front.size[0] + 40, front.size[1] + 40), GREEN)
    pad.paste(front, (20, 20))
    pad.save(QA / "ref_zhujue_front_green.png")

    for n in (
        "ref_body_openeye_green.png",
        "ref_official_green.png",
        "ref_zhujue_front_green.png",
    ):
        print(n, Image.open(QA / n).size)


if __name__ == "__main__":
    main()
