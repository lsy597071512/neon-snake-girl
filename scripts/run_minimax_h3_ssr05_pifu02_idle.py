"""MiniMax H3: SSR05_1_pifu02 greenscreen idle, vertical 5s, fixed camera, loop-consistent ends."""
from __future__ import annotations

import json
import time
import urllib.request
import uuid

HOST = "http://127.0.0.1:8188"
INPUT_NAME = "SSR05_1_pifu02_greenscreen.png"
OUT_PREFIX = "video/SSR05_1_pifu02_idle_gs_max"
WIDTH, HEIGHT = 768, 1344  # H3 native vertical
LENGTH = 124  # ~5.17s @ 24fps
STEPS = 30
SEED = 2026081420

PROMPT = """Professional film-set chroma key idle plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution look.

FRAMING: character already fills almost the entire vertical frame — keep this MAXIMUM screen occupancy. Do not shrink the subject, do not add empty headroom/footroom, do not pull camera back. Subject stays large and centered as in the first frame.

LOCKED to first frame identity and wardrobe: orange high ponytail girl in white satin slip nightwear with black lace trim and black chest bow, oversized white open coat with dark trim off shoulders, white mechanical thigh-high boots with red soles (right boot hazard stripe). Exact same character design throughout.

CAMERA: completely locked tripod, no pan, no tilt, no zoom, no push-in, no pull-out, no drift. Framing identical from start to end.

ACTION (natural idle only, 5 seconds):
- Soft breathing and tiny weight shift (stay large in frame)
- Gentle breeze physics on long orange ponytail, coat hems, and satin fabric
- Natural blinking (normal human blink rate)
- Expression arc: starts calm/slightly serious, shifts into a sexy tsundere pouty-proud look with subtle eye/mouth acting, then settles back toward a composed serious face matching the start for loop continuity
- First frame and last frame must match pose and expression closely for seamless looping

Do NOT change costume, hair color, boot design, or background. Keep pure flat #00b140 green everywhere behind the subject, no floor, no shadow catcher, no vignette.

Audio: very soft quiet room tone only, no speech, no music.
"""


def api(path: str, data=None):
    if data is not None:
        req = urllib.request.Request(
            f"{HOST}{path}",
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
    else:
        req = urllib.request.Request(f"{HOST}{path}")
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)


def build_prompt() -> dict:
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
            "inputs": {"model": ["6", 0], "shift_video": 12.0, "shift_audio": 3.0},
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
                "last_frame": ["114", 0],  # same plate for end-frame consistency / loop
            },
        },
        "15": {"class_type": "RandomNoise", "inputs": {"noise_seed": SEED}},
        "17": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
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
            "inputs": {"model": ["200", 0], "conditioning": ["104", 0]},
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
            "inputs": {"samples": ["14", 0], "vae": ["11", 0]},
        },
        "23": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["14", 0], "vae": ["24", 0]},
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
    prompt = build_prompt()
    print("queue SSR05_1_pifu02 greenscreen idle", WIDTH, HEIGHT, LENGTH, STEPS, flush=True)
    res = api("/prompt", {"prompt": prompt, "client_id": str(uuid.uuid4())})
    prompt_id = res["prompt_id"]
    print("prompt_id", prompt_id, flush=True)

    while True:
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print("ERROR", json.dumps(status, ensure_ascii=False)[:3000], flush=True)
                return 1
            if status.get("completed") or entry.get("outputs"):
                print("done", flush=True)
                print(json.dumps(entry.get("outputs", {}), ensure_ascii=False)[:2000], flush=True)
                return 0
        q = api("/queue")
        print(
            "queue running",
            len(q.get("queue_running", [])),
            "pending",
            len(q.get("queue_pending", [])),
            flush=True,
        )
        time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
