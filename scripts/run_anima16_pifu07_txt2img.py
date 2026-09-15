"""anima16 终极配方验证：纯 txt2img + 角色 LoRA + 皮肤 prompt + 绿幕背景。

对比结论：i2i 用低清底图会产生泥糊伪影；txt2img 才是模型的原生出图模式。
"""
from __future__ import annotations

import json
import time
import uuid
import urllib.request
from pathlib import Path

COMFY = "http://127.0.0.1:8188"
W, H = 832, 1216

POS = (
    "best quality, score_7, score_9, sensitive, very aesthetic, ultra detailed, fair skin, high contrast, "
    "ashcrow_sr012, ash-gold high ponytail, white wing hair clips, ice-blue eyes, "
    "1girl, solo, black micro bikini with gold ring hardware, ultra-thin bikini straps, "
    "sheer black chiffon sarong wrapped low on hips, gold chain belt, "
    "wet skin with water droplets, looking back over shoulder, fingers in hair, full body, standing, "
    "flat solid green background, chroma key green background, simple background"
)
NEG = (
    "worst quality, low quality, score_1, score_2, score_3, artist name, shiny skin, blurry, "
    "deformed hands, extra fingers, watermark, text, "
    "nude, topless, exposed nipples, "
    "dark background, black background, striped background, bars, gradient background, "
    "photorealistic, 3d render, muddy texture, oil painting"
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


def wait(pid, timeout=1200):
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


def wf(seed: int, lora_strength: float):
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
            "inputs": {"model": ["1", 0], "lora_name": "ashcrow_sr012_anima16.safetensors", "strength_model": lora_strength},
        },
        "5": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["4", 0], "shift": 3.0}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": POS}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
        "8": {"class_type": "EmptyLatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["5", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["8", 0],
                "seed": seed,
                "steps": 30,
                "cfg": 4.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
            },
        },
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}},
        "13": {
            "class_type": "SaveImage",
            "inputs": {"images": ["12", 0], "filename_prefix": f"pifu07_txt2img_s{seed}"},
        },
    }


def main():
    api("/system_stats")
    for seed in (771103, 771129):
        print(f"\n=== txt2img seed={seed} ===", flush=True)
        t0 = time.time()
        pid = api("/prompt", {"prompt": wf(seed, 0.9), "client_id": str(uuid.uuid4())})["prompt_id"]
        wait(pid)
        print(f"  done in {time.time()-t0:.0f}s", flush=True)
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
