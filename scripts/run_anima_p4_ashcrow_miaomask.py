"""Masked P4 fill on identity-locked plate using miaomiaoHarem + ashcrow LoRA.

Only chest/crotch/hand zones denoise; face/legs/robot body stay from locked Anima plate.
"""
from __future__ import annotations

import argparse
import json
import time
import uuid
from pathlib import Path

import numpy as np
import urllib.request
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp" / "cmd_discipline_p4_lllite"
COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")
GEN = (864, 1536)
GREEN = (0, 177, 64)
LORA = "ashcrow_sr012_anima16.safetensors"
TRIGGER = "ashcrow_sr012"

POS = f"""best quality, score_9, score_7, sensitive, very aesthetic, ultra detailed, fair skin, masterpiece, anime screencap,
{TRIGGER}, Ashcrow Mio exact identity, ash-gold high ponytail, white wing hair clips, ice-blue open eyes,
white lace discipline bodysuit, white cyber legs mid-thigh gold joints,
chroma key pure green #00b140,
small scrap robot stands between her thighs at pelvis, dome head twin red eyes fully visible,
P4: robot BOTH three-finger hands reach UP pinching nipples through lace,
main mechanical pipe vagina through lace crotch, thinner tube anus, oil leak,
girl arms at sides NOT holding robot, trembling, biting lip, shame blush,
2d anime cel shading matching official skin"""

NEG = (
    "worst quality, score_1, score_2, blurry, tentacles, holding robot, hugging robot, "
    "clasped hands, merged body, fused robot, redesign face, black background, "
    "photorealistic, watermark, grey blob, censor bar"
)


def api(path, data=None):
    if data is None:
        req = urllib.request.Request(f"{COMFY}{path}")
    else:
        req = urllib.request.Request(
            f"{COMFY}{path}",
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
        )
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())


def wait(pid, timeout=2400):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = api(f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status") or {}
            if st.get("status_str") == "error":
                raise RuntimeError(str(st.get("messages")))
            if h[pid].get("outputs") or st.get("completed") or st.get("status_str") == "success":
                return h[pid]
        time.sleep(1.5)
    raise TimeoutError(pid)


def fit(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    a[a.max(axis=2) < 22] = GREEN
    im = Image.fromarray(a.astype(np.uint8))
    tw, th = GEN
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", GEN, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def prep_base(locked: Image.Image) -> tuple[Image.Image, Image.Image]:
    """Lace-fill girl hands; keep robot intact. Build interaction mask."""
    w, h = GEN
    base = fit(locked)
    ca = np.asarray(base).astype(np.float32)
    sample = ca[int(h * 0.30) : int(h * 0.36), int(w * 0.40) : int(w * 0.60)]
    fill = sample.reshape(-1, 3).mean(axis=0)
    for y0, y1, x0, x1 in [
        (int(h * 0.36), int(h * 0.49), int(w * 0.26), int(w * 0.46)),
        (int(h * 0.36), int(h * 0.49), int(w * 0.54), int(w * 0.74)),
    ]:
        yy, xx = np.mgrid[y0:y1, x0:x1]
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        ry, rx = max((y1 - y0) / 2, 1), max((x1 - x0) / 2, 1)
        soft = np.clip(1.0 - (((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2), 0, 1)[..., None]
        ca[y0:y1, x0:x1] = ca[y0:y1, x0:x1] * (1 - soft) + fill * soft
    base = Image.fromarray(np.clip(ca, 0, 255).astype(np.uint8))

    mm = Image.new("L", GEN, 0)
    d = ImageDraw.Draw(mm)
    # nipple / reaching hands band
    d.ellipse([int(w * 0.32), int(h * 0.33), int(w * 0.68), int(h * 0.44)], fill=255)
    # side corridors from robot shoulders up (outside head)
    d.polygon(
        [
            (int(w * 0.34), int(h * 0.52)),
            (int(w * 0.22), int(h * 0.42)),
            (int(w * 0.34), int(h * 0.36)),
            (int(w * 0.42), int(h * 0.44)),
        ],
        fill=210,
    )
    d.polygon(
        [
            (int(w * 0.66), int(h * 0.52)),
            (int(w * 0.78), int(h * 0.42)),
            (int(w * 0.66), int(h * 0.36)),
            (int(w * 0.58), int(h * 0.44)),
        ],
        fill=210,
    )
    # girl hand erase
    d.ellipse([int(w * 0.26), int(h * 0.36), int(w * 0.46), int(h * 0.49)], fill=200)
    d.ellipse([int(w * 0.54), int(h * 0.36), int(w * 0.74), int(h * 0.49)], fill=200)
    # short dual-pipe contact ABOVE robot visor
    d.ellipse([int(w * 0.42), int(h * 0.45), int(w * 0.58), int(h * 0.52)], fill=240)
    # protect face
    d.ellipse([int(w * 0.16), 0, int(w * 0.84), int(h * 0.32)], fill=0)
    # protect robot head/eyes/torso core
    d.ellipse([int(w * 0.36), int(h * 0.50), int(w * 0.64), int(h * 0.72)], fill=0)
    mm = mm.filter(ImageFilter.GaussianBlur(4))
    mask = Image.merge("RGB", (mm, mm, mm))
    return base, mask


def wf(base_name, mask_name, seed, denoise, prefix):
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "miaomiaoHarem_anima16.safetensors", "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "miaomiaoHarem_anima16_txt.safetensors",
                "type": "stable_diffusion",
                "device": "default",
            },
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "4": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": ["1", 0], "lora_name": LORA, "strength_model": 1.0},
        },
        "5": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["4", 0], "shift": 3.0}},
        "10": {"class_type": "LoadImage", "inputs": {"image": base_name}},
        "11": {"class_type": "LoadImage", "inputs": {"image": mask_name}},
        "12": {"class_type": "ImageToMask", "inputs": {"image": ["11", 0], "channel": "red"}},
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}},
        "14": {
            "class_type": "SetLatentNoiseMask",
            "inputs": {"samples": ["13", 0], "mask": ["12", 0]},
        },
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": POS}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["5", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["14", 0],
                "seed": seed,
                "steps": 32,
                "cfg": 4.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": denoise,
            },
        },
        "15": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}},
        "16": {
            "class_type": "SaveImage",
            "inputs": {"images": ["15", 0], "filename_prefix": prefix},
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=str(WORK / "SR01_2_P4-A_idleface_d42_s98601.png"))
    ap.add_argument("--seeds", type=int, nargs="*", default=[98801, 98817])
    ap.add_argument("--denoise", type=float, nargs="*", default=[0.45, 0.58])
    args = ap.parse_args()

    api("/system_stats")
    WORK.mkdir(parents=True, exist_ok=True)
    base, mask = prep_base(Image.open(args.base))
    base.save(WORK / "prep_base_miaomask.png")
    mask.save(WORK / "prep_mask_miaomask.png")
    bname = "ashcrow_p4_miaomask_base.png"
    mname = "ashcrow_p4_miaomask_mask.png"
    base.save(COMFY_IN / bname)
    mask.save(COMFY_IN / mname)

    for den in args.denoise:
        for seed in args.seeds:
            tag = f"d{int(den * 100)}_s{seed}"
            print(f"\n=== MIAOMASK {tag} ===", flush=True)
            t0 = time.time()
            prefix = f"ashcrow_p4_miaomask_{tag}"
            pid = api(
                "/prompt",
                {"prompt": wf(bname, mname, seed, den, prefix), "client_id": str(uuid.uuid4())},
            )["prompt_id"]
            print(f"  queued {pid}", flush=True)
            wait(pid)
            cands = [p for p in COMFY_OUT.glob(f"{prefix}_*.png") if p.stat().st_mtime >= t0 - 2]
            if not cands:
                raise RuntimeError(f"no out {prefix}")
            out = max(cands, key=lambda p: p.stat().st_mtime)
            dest = WORK / f"SR01_2_P4-A_miaomask_{tag}.png"
            Image.open(out).convert("RGB").save(dest)
            print(f"  saved {dest}", flush=True)
    print("ALL DONE miaomask", flush=True)


if __name__ == "__main__":
    main()
