"""
MiniMax H3 local GPU: ashcrow homeland idle 5s vertical.
Requires ComfyUI at http://127.0.0.1:8188
"""
from __future__ import annotations

import json
import time
import urllib.request
import uuid
from pathlib import Path

HOST = "http://127.0.0.1:8188"
INPUT_NAME = "ashcrow_homeland_idle_first.png"
OUT_PREFIX = "video/ashcrow_homeland_idle"
# H3 native vertical quality canvas (32-aligned, within 768*1344 cap)
WIDTH, HEIGHT = 768, 1344
# 5s @ 24fps -> 124 frames (17k+5 grid)
LENGTH = 124
STEPS = 30  # above template 20 for higher quality
SEED = 20260814

PROMPT = """Premium anime mecha character idle loop. Stay locked to the first frame identity and homeland scrap-base desert scene.

The same ash-blonde ponytail mecha girl with cyan Z shoulder mark and blue-cell rifle stands in front of the rusty homeland fortress. Soft idle only: gentle breathing, slight weight shift, ponytail and back ribbons sway in desert wind, cyan Z logo and rifle energy cells pulse faintly, distant red flag flutters, fine sand drifts across the ground, warm dusty golden-hour light stays consistent. Subtle slow camera drift only, no cuts, no teleport, no redesign of face/armor/weapon.

Audio: soft desert wind, distant metallic creaks from the scrap base, quiet ambient hum, no speech, no music vocals.
"""


def api(path: str, data=None, method=None):
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(
            f"{HOST}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method=method or "POST",
        )
    else:
        req = urllib.request.Request(f"{HOST}{path}")
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)


def build_prompt() -> dict:
    # Follow official MiniMax H3 I2V subgraph pattern
    return {
        "6": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
                "weight_dtype": "default",
            },
        },
        "13": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                "type": "minimax",
                "device": "default",
            },
        },
        "11": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"},
        },
        "24": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"},
        },
        "114": {
            "class_type": "LoadImage",
            "inputs": {"image": INPUT_NAME},
        },
        "200": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {
                "model": ["6", 0],
                "shift_video": 12.0,
                "shift_audio": 3.0,
            },
        },
        "104": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["13", 0],
                "vae": ["11", 0],
                "prompt": PROMPT,
                "width": WIDTH,
                "height": HEIGHT,
                "length": LENGTH,
                "first_frame": ["114", 0],
            },
        },
        "15": {
            "class_type": "RandomNoise",
            "inputs": {"noise_seed": SEED},
        },
        "17": {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": "res_multistep"},
        },
        "9": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": ["200", 0],
                "scheduler": "simple",
                "steps": STEPS,
                "denoise": 1.0,
            },
        },
        "16": {
            "class_type": "BasicGuider",
            "inputs": {
                "model": ["200", 0],
                "conditioning": ["104", 0],
            },
        },
        "14": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["15", 0],
                "guider": ["16", 0],
                "sampler": ["17", 0],
                "sigmas": ["9", 0],
                "latent_image": ["104", 1],
            },
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["14", 0],
                "vae": ["11", 0],
            },
        },
        "23": {
            "class_type": "VAEDecodeAudio",
            "inputs": {
                "samples": ["14", 0],
                "vae": ["24", 0],
            },
        },
        "91": {
            "class_type": "CreateVideo",
            "inputs": {
                "images": ["10", 0],
                "fps": 24.0,
                "audio": ["23", 0],
                "bit_depth": 8,
            },
        },
        "92": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["91", 0],
                "filename_prefix": OUT_PREFIX,
                "format": "auto",
                "codec": "auto",
            },
        },
    }


def main():
    client_id = str(uuid.uuid4())
    prompt = build_prompt()
    print("queueing MiniMax H3 I2V...", WIDTH, HEIGHT, "length", LENGTH, "steps", STEPS)
    res = api("/prompt", {"prompt": prompt, "client_id": client_id})
    prompt_id = res["prompt_id"]
    print("prompt_id", prompt_id)

    while True:
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("completed") or entry.get("outputs"):
                if status.get("status_str") == "error":
                    print("ERROR", json.dumps(status, ensure_ascii=False)[:2000])
                    return 1
                print("done")
                outputs = entry.get("outputs", {})
                print(json.dumps(outputs, ensure_ascii=False)[:2000])
                return 0
            if status.get("status_str") == "error":
                print("ERROR", json.dumps(status, ensure_ascii=False)[:2000])
                return 1
        # queue remaining
        try:
            q = api("/queue")
            print("queue running", len(q.get("queue_running", [])), "pending", len(q.get("queue_pending", [])))
        except Exception:
            pass
        time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
