"""Build open-eye Ashcrow P4 plate: green bg, tentacle mask, robot at pelvis."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / "tmp" / "cmd_discipline_p4_qa"
WORK = ROOT / "tmp" / "cmd_discipline_p4_lllite"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
GREEN = np.array([0, 177, 64], dtype=np.float32)
GEN = (864, 1536)


def punch(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    a[a.max(axis=2) < 22] = GREEN
    return Image.fromarray(a.astype(np.uint8))


def fit(im: Image.Image, size=GEN) -> Image.Image:
    im = punch(im)
    tw, th = size
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, tuple(int(x) for x in GREEN))
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def zhujue_front() -> Image.Image:
    zh = Image.open(ROOT / "tex" / "zhujue.png").convert("RGB")
    w, h = zh.size
    front = zh.crop((0, 0, int(w * 0.34), h))
    a = np.asarray(front).astype(np.float32)
    white = (a.min(axis=2) > 230) & ((a.max(axis=2) - a.min(axis=2)) < 18)
    a[white] = GREEN
    front = Image.fromarray(a.astype(np.uint8))
    dist = np.linalg.norm(np.asarray(front).astype(np.float32) - GREEN, axis=2)
    ys, xs = np.where(dist > 28)
    return front.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    COMFY_IN.mkdir(parents=True, exist_ok=True)

    src = QA / "frames_SR01_2_tiaojiao_1_t10.png"
    ctrl_id = fit(Image.open(src))
    a = np.asarray(ctrl_id).astype(np.float32)
    dist_g = np.linalg.norm(a - GREEN, axis=2)
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    tent = (dist_g > 40) & (lum < 95) & (sat < 55) & (a[:, :, 1] < 120)

    mm = Image.fromarray((tent.astype(np.uint8) * 255), "L")
    d = ImageDraw.Draw(mm)
    w, h = GEN
    d.ellipse([int(w * 0.30), int(h * 0.32), int(w * 0.70), int(h * 0.50)], fill=255)
    d.ellipse([int(w * 0.28), int(h * 0.50), int(w * 0.72), int(h * 0.78)], fill=255)
    d.ellipse([int(w * 0.18), int(h * 0.00), int(w * 0.82), int(h * 0.34)], fill=0)
    d.rectangle([0, int(h * 0.88), w, h], fill=0)
    mm = mm.filter(ImageFilter.GaussianBlur(12))

    front = zhujue_front()
    base = ctrl_id.copy()
    robot = front.copy()
    robot.thumbnail((int(w * 0.32), int(h * 0.32)), Image.Resampling.LANCZOS)
    ra = np.asarray(robot).astype(np.float32)
    rd = np.linalg.norm(ra - GREEN, axis=2)
    rm = Image.fromarray((rd > 28).astype(np.uint8) * 255, "L").filter(ImageFilter.GaussianBlur(1.0))
    rx = (w - robot.size[0]) // 2
    ry = int(h * 0.50)
    base.paste(robot, (rx, ry), rm)
    draw = ImageDraw.Draw(base)
    cx = w // 2
    draw.ellipse([cx - 14, int(h * 0.56), cx + 14, int(h * 0.72)], fill=(110, 110, 120))
    draw.ellipse([cx + 16, int(h * 0.58), cx + 28, int(h * 0.74)], fill=(70, 70, 80))

    ctrl_cmd = fit(front)
    mask_rgb = Image.merge("RGB", (mm, mm, mm))

    for name, im in (
        ("prep_ctrl_id.png", ctrl_id),
        ("prep_base.png", base),
        ("prep_mask.png", mask_rgb),
        ("prep_ctrl_cmd.png", ctrl_cmd),
    ):
        im.save(WORK / name)
        im.save(COMFY_IN / f"ashcrow_p4_lllite_{name.replace('prep_', '')}")

    print("tentacle_px", int(tent.sum()), "mask_mean", float(np.asarray(mm).mean()))
    print("saved", WORK)


if __name__ == "__main__":
    main()
