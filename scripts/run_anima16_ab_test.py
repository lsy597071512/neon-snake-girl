"""anima16 对照实验：定位"网上 vs 本机"画质差距的来源。

A: 纯 txt2img，无 LoRA（复刻网上示例的跑法）
B: txt2img + ashcrow 角色 LoRA @1.05（本机 i2i 在用的 LoRA）
其余参数完全一致（官方推荐档：euler/normal/30步/cfg4.5/shift3.0/832x1216）
"""
from __future__ import annotations

import json
import time
import uuid
import urllib.request
from pathlib import Path

COMFY = "http://127.0.0.1:8188"
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")
W, H = 832, 1216

POS_BASE = (
    "best quality, score_7, score_9, sensitive, very aesthetic, ultra detailed, fair skin, high contrast, "
    "1girl, solo, long hair, indoors, looking at viewer, upper body, soft lighting, detailed face"
)
NEG = (
    "worst quality, low quality, score_1, score_2, score_3, artist name, shiny skin, blurry, "
    "deformed hands, extra fingers, watermark, text"
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


def wf(use_lora: bool, seed: int):
    g = {
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
        "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": POS_BASE}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
        "8": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": W, "height": H, "batch_size": 1},
        },
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["5" if use_lora else "1", 0],
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
            "inputs": {
                "images": ["12", 0],
                "filename_prefix": "ab_test_A_notlora" if not use_lora else "ab_test_B_lora",
            },
        },
    }
    if use_lora:
        g["5"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": ["1", 0], "lora_name": "ashcrow_sr012_anima16.safetensors", "strength_model": 1.05},
        }
    return g


def main():
    api("/system_stats")
    for name, use_lora, seed in [
        ("A_notlora", False, 42),
        ("B_lora105", True, 42),
    ]:
        print(f"\n=== {name} ===", flush=True)
        t0 = time.time()
        pid = api("/prompt", {"prompt": wf(use_lora, seed), "client_id": str(uuid.uuid4())})["prompt_id"]
        wait(pid)
        print(f"  done in {time.time()-t0:.0f}s", flush=True)
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
