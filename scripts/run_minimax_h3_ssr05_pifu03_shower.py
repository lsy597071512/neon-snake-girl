"""MiniMax H3: SSR05_1_pifu03 shower greenscreen, vertical ~6s, fixed camera, max occupancy."""
from __future__ import annotations

import json
import time
import urllib.request
import uuid

HOST = "http://127.0.0.1:8188"
INPUT_NAME = "SSR05_1_pifu03_greenscreen.png"
OUT_PREFIX = "video/SSR05_1_pifu03_shower_gs"
WIDTH, HEIGHT = 768, 1344
# 6s @ 24fps -> 144, snap up to 17k+5 grid => 158 (~6.58s)
LENGTH = 158
STEPS = 20
SEED = 2026081421

PROMPT = """Professional film-set chroma key action plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution look.

FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, no pull-out, no added headroom.

LOCKED identity from first frame: orange twin-tail anime girl with amber eyes, teal forehead accessory, white textured bath towel, white glossy mechanical thigh-high boots with red/blue accents, silver arm band, holding a modern silver shower head with hose.

CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. Framing identical throughout.

ACTION timeline (~6 seconds), natural continuous motion:
[0.0-1.5s] She raises the shower head slightly and turns the water ON; clear water spray starts from the shower head.
[1.5-3.5s] She loosens and removes the white bath towel with her free hand (set towel aside / drop out of primary hold), beginning to bathe under the spray; keep tasteful game-style bathing, steam and water droplets, same character proportions and mechanical boots remain on.
[3.5-6.5s] Continues showering with natural idle bathing motion under running water; soft body sway and hair wet by mist; sexy tsundere-serious expression acting with normal blinking (proud / slightly shy / focused), orange twin-tails move with water and light breeze.

Keep pure flat #00b140 green everywhere behind the subject: no bathroom set, no floor, no tiles, no shadow catcher, no vignette. Do not change hair color, face design, or boot design.

Audio: shower water spray and soft room tone only, no speech, no music.
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
    print("queue SSR05_1_pifu03 shower", WIDTH, HEIGHT, LENGTH, STEPS, flush=True)
    res = api("/prompt", {"prompt": prompt, "client_id": str(uuid.uuid4())})
    prompt_id = res["prompt_id"]
    print("prompt_id", prompt_id, flush=True)
    t0 = time.time()
    while True:
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print("ERROR", json.dumps(status, ensure_ascii=False)[:4000], flush=True)
                return 1
            if status.get("completed") or entry.get("outputs"):
                print(f"done in {time.time()-t0:.1f}s", flush=True)
                print(json.dumps(entry.get("outputs", {}), ensure_ascii=False)[:2000], flush=True)
                return 0
        q = api("/queue")
        print(
            f"t={time.time()-t0:.0f}s running={len(q.get('queue_running',[]))} pending={len(q.get('queue_pending',[]))}",
            flush=True,
        )
        time.sleep(5)


if __name__ == "__main__":
    raise SystemExit(main())
