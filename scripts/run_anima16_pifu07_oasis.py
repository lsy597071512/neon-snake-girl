"""pifu07「绿洲度假」皮肤：anima16 + ashcrow LoRA 图生图（高质量管线）。

用法：python scripts/run_anima16_pifu07_oasis.py
产物：tmp/pifu07_oasis/SR01_2_pifu07_oasis_d{den}_s{seed}.png
"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

import numpy as np
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp" / "pifu07_oasis"
COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")
GEN = (864, 1536)
GREEN = (0, 177, 64)

LORA = "ashcrow_sr012_anima16.safetensors"
TRIGGER = "ashcrow_sr012"

POS = f"""best quality, score_7, score_9, sensitive, very aesthetic, ultra detailed, fair skin, high contrast,
{TRIGGER}, Ashcrow Mio exact identity, ash-gold high ponytail, white wing hair clips, ice-blue eyes,
keep original character identity and composition, full body standing,
oasis resort outfit: black micro bikini with gold ring hardware and ultra-thin straps,
sheer black chiffon sarong low on hips, one strap slipped off bare shoulder, gold chain belt,
wet skin with water droplets, looking back over shoulder, fingers in hair, languid teasing expression, blush,
white cyber prosthetic legs with gold joints,
chroma key pure green #00b140 background"""

NEG = (
    "worst quality, low quality, score_1, score_2, score_3, artist name, shiny skin, blurry, "
    "deformed hands, extra fingers, watermark, text, "
    "nude, topless, exposed nipples, exposed genitals, winter coat, parka, puffer jacket"
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
    with urllib.request.urlopen(req, timeout=900) as r:
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


def punch(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    a[a.max(axis=2) < 22] = np.array(GREEN, dtype=np.float32)
    return Image.fromarray(a.astype(np.uint8))


def fit(im: Image.Image) -> Image.Image:
    im = punch(im)
    tw, th = GEN
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", GEN, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def wf(base_name: str, seed: int, denoise: float):
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
            "inputs": {"model": ["1", 0], "lora_name": LORA, "strength_model": 1.05},
        },
        "5": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["4", 0], "shift": 3.0}},
        "10": {"class_type": "LoadImage", "inputs": {"image": base_name}},
        "11": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": POS}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["5", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["11", 0],
                "seed": seed,
                "steps": 32,
                "cfg": 4.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": denoise,
            },
        },
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}},
        "20": {
            "class_type": "UpscaleModelLoader",
            "inputs": {"model_name": "RealESRGAN_x4plus_anime_6B.pth"},
        },
        "21": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["20", 0], "image": ["12", 0]}},
        "22": {"class_type": "ImageScale", "inputs": {"image": ["21", 0], "upscale_method": "lanczos", "width": 1440, "height": 2560, "crop": "disabled"}},
        "13": {
            "class_type": "SaveImage",
            "inputs": {"images": ["22", 0], "filename_prefix": f"pifu07_oasis_d{int(denoise*100)}_s{seed}"},
        },
    }


def main():
    api("/system_stats")
    WORK.mkdir(parents=True, exist_ok=True)
    src = ROOT / "tex" / "juese" / "SR01_2.png"
    plate = fit(Image.open(src).convert("RGB"))
    plate.save(WORK / "prep_base.png")
    name = "ashcrow_pifu07_base.png"
    plate.save(COMFY_IN / name)

    for den in (0.45,):
        for seed in (771103, 771129, 771147):
            tag = f"d{int(den*100)}_s{seed}"
            print(f"\n=== pifu07 oasis {tag} ===", flush=True)
            t0 = time.time()
            pid = api("/prompt", {"prompt": wf(name, seed, den), "client_id": str(uuid.uuid4())})["prompt_id"]
            wait(pid)
            cands = [p for p in COMFY_OUT.glob(f"pifu07_oasis_{tag}_*.png") if p.stat().st_mtime >= t0 - 2]
            if not cands:
                cands = sorted(COMFY_OUT.glob("pifu07_oasis_*.png"), key=lambda p: p.stat().st_mtime)[-1:]
            out = max(cands, key=lambda p: p.stat().st_mtime)
            dest = WORK / f"SR01_2_pifu07_oasis_{tag}.png"
            Image.open(out).convert("RGB").save(dest)
            print(f"  saved {dest}", flush=True)
    print("ALL DONE pifu07 oasis", flush=True)


if __name__ == "__main__":
    main()
