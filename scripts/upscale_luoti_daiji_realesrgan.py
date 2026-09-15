"""Sharpen luoti_daiji folder with RealESRGAN anime (local ComfyUI weights).

Strategy:
  - *_luoti_daiji.png: rebuild from native _qa 768 frame → ESRGAN 4x → alpha cover-fit 1440x2560
  - other 768 plates (_qa / srcframe / first_h3): ESRGAN 2x → 1536x2688
Backups: _pre_upscale_bak/
"""
from __future__ import annotations

import re
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from spandrel import ModelLoader

COMFY = Path(r"E:\MiniMaxH3\ComfyUI")
sys.path.insert(0, str(COMFY))
import comfy.utils  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "tex" / "juese" / "pifu" / "chongzao" / "luoti_daiji"
BAK = DIR / "_pre_upscale_bak"
QA = DIR / "_qa"
MODEL = COMFY / "models" / "upscale_models" / "RealESRGAN_x4plus_anime_6B.pth"
OW, OH = 1440, 2560
TILE = 384
OVERLAP = 32


def load_model():
    desc = ModelLoader().load_from_file(str(MODEL)).eval()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    desc.to(device)
    if device.type == "cuda" and desc.supports_half:
        desc.half()
    return desc, device


@torch.inference_mode()
def upscale_rgb_nchw(model, rgb01: torch.Tensor, device: torch.device) -> torch.Tensor:
    use_half = device.type == "cuda" and getattr(model, "supports_half", False)
    dtype = torch.float16 if use_half else torch.float32
    img = rgb01.to(device=device, dtype=dtype)
    tile = TILE
    while True:
        try:
            out = comfy.utils.tiled_scale(
                img,
                lambda a: model(a.float() if not use_half else a),
                tile_x=tile,
                tile_y=tile,
                overlap=OVERLAP,
                upscale_amount=model.scale,
                output_device=torch.device("cpu"),
            )
            break
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            tile //= 2
            if tile < 128:
                raise
    return torch.clamp(out.float(), 0, 1)


def enhance_rgba(model, device, im: Image.Image, outscale: float) -> Image.Image:
    rgba = np.asarray(im.convert("RGBA"))
    rgb = rgba[:, :, :3].astype(np.float32)
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    gray = 128.0
    a = alpha[..., None]
    comp = rgb * a + gray * (1.0 - a)
    t = torch.from_numpy(comp).permute(2, 0, 1).unsqueeze(0) / 255.0
    up = upscale_rgb_nchw(model, t, device)
    th = max(1, int(round(rgba.shape[0] * outscale)))
    tw = max(1, int(round(rgba.shape[1] * outscale)))
    if up.shape[-2] != th or up.shape[-1] != tw:
        up = F.interpolate(up, size=(th, tw), mode="bicubic", align_corners=False)
        up = torch.clamp(up, 0, 1)
    rgb_up = (up[0].permute(1, 2, 0).numpy() * 255.0).round().astype(np.uint8)
    alpha_up = np.array(
        Image.fromarray((alpha * 255).astype(np.uint8), mode="L").resize((tw, th), Image.Resampling.LANCZOS)
    )
    rgb_up = (rgb_up.astype(np.float32) * (alpha_up.astype(np.float32) / 255.0)[..., None]).round().astype(np.uint8)
    return Image.fromarray(np.dstack([rgb_up, alpha_up]), "RGBA")


def cover_fit_rgba(im: Image.Image, ow: int = OW, oh: int = OH) -> Image.Image:
    arr = np.asarray(im.convert("RGBA"))
    mask = arr[:, :, 3] > 24
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return im.resize((ow, oh), Image.Resampling.LANCZOS)
    pad = 2
    l = max(0, int(xs.min()) - pad)
    t = max(0, int(ys.min()) - pad)
    r = min(im.width, int(xs.max()) + 1 + pad)
    b = min(im.height, int(ys.max()) + 1 + pad)
    crop = im.crop((l, t, r, b))
    scale = max(ow / crop.width, oh / crop.height)
    cw = max(1, int(crop.width * scale + 0.5))
    ch = max(1, int(crop.height * scale + 0.5))
    char = crop.resize((cw, ch), Image.Resampling.LANCZOS)
    left = (cw - ow) // 2
    top = (ch - oh) // 2
    if ch > oh:
        top = min(max(0, int(ch * 0.08)), ch - oh)
    return char.crop((left, top, left + ow, top + oh))


def find_qa_frame(stem: str) -> Path | None:
    d = QA / stem
    if not d.is_dir():
        return None
    frames = sorted(d.glob("*.png"))
    return frames[-1] if frames else None


def should_skip(path: Path) -> bool:
    parts = set(path.parts)
    if "_pre_upscale_bak" in parts or "_opaque_bak" in parts or "_qa_preview" in parts:
        return True
    if path.name.startswith("_qa_edge"):
        return True
    return False


def backup(src: Path) -> Path:
    rel = src.relative_to(DIR)
    bak = BAK / rel
    bak.parent.mkdir(parents=True, exist_ok=True)
    if not bak.exists():
        shutil.copy2(src, bak)
    return bak


def process_daiji(model, device, dest: Path) -> None:
    stem = dest.name.replace("_luoti_daiji.png", "")
    backup(dest)
    qa = find_qa_frame(stem)
    if qa is None:
        # fallback: enhance soft plate
        src_im = Image.open(BAK / dest.name)
        out = enhance_rgba(model, device, src_im, 2.0).resize((OW, OH), Image.Resampling.LANCZOS)
        note = "fallback_from_soft"
    else:
        backup(qa)
        src_im = Image.open(qa)
        up = enhance_rgba(model, device, src_im, 4.0)
        out = cover_fit_rgba(up, OW, OH)
        note = f"from {qa.relative_to(DIR)} 4x→cover"
    out.save(dest, "PNG", optimize=True)
    print(f"  daiji {dest.name}: {note} → {out.size}", flush=True)


def process_other(model, device, src: Path) -> None:
    bak = backup(src)
    im = Image.open(bak)
    # already large? skip if long edge >= 2500
    if max(im.size) >= 2500:
        print(f"  skip large {src.relative_to(DIR)} {im.size}", flush=True)
        return
    out = enhance_rgba(model, device, im, 2.0)
    out.save(src, "PNG", optimize=True)
    print(f"  other {src.relative_to(DIR)}: {im.size} → {out.size}", flush=True)


def main() -> None:
    assert MODEL.exists(), MODEL
    BAK.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in DIR.rglob("*.png") if not should_skip(p))
    daiji = [p for p in files if re.fullmatch(r".+_luoti_daiji\.png", p.name)]
    others = [p for p in files if p not in daiji]
    print(f"daiji={len(daiji)} others={len(others)} model={MODEL.name}", flush=True)
    model, device = load_model()
    print(f"device={device} scale={model.scale}", flush=True)

    t_all = time.time()
    for i, p in enumerate(daiji, 1):
        t0 = time.time()
        print(f"[{i}/{len(daiji)}] {p.name}", flush=True)
        process_daiji(model, device, p)
        print(f"  time {time.time()-t0:.1f}s", flush=True)

    for i, p in enumerate(others, 1):
        t0 = time.time()
        print(f"[other {i}/{len(others)}] {p.relative_to(DIR)}", flush=True)
        process_other(model, device, p)
        print(f"  time {time.time()-t0:.1f}s", flush=True)

    print(f"DONE in {time.time()-t_all:.1f}s", flush=True)


if __name__ == "__main__":
    main()
