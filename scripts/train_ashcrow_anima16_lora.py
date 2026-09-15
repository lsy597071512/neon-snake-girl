"""
在 miaomiaoHarem anima16 上用 ComfyUI TrainLoraNode 训练 ashcrow_sr012 LoRA，
训完后用 LoRA 出 P4-A 测试图到桌面。

依赖：先跑 prepare_ashcrow_lora_dataset.py
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
import uuid
from pathlib import Path

import urllib.request

COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")
COMFY_LORA = Path(r"E:\MiniMaxH3\ComfyUI\models\loras")
DS_FOLDER = "ashcrow_sr012_train"
DESKTOP = Path.home() / "Desktop"

UNET = "miaomiaoHarem_anima16.safetensors"
CLIP = "miaomiaoHarem_anima16_txt.safetensors"
CLIP_TYPE = "stable_diffusion"
VAE = "qwen_image_vae.safetensors"
TRIGGER = "ashcrow_sr012"

POS_P4 = f"""best quality, score_9, score_7, sensitive, very aesthetic, ultra detailed, fair skin, high contrast, masterpiece, anime screencap,
{TRIGGER}, character Ashcrow Mio exact identity, short messy silver-lavender hair, ice-blue eyes, pale skin, cybernetic right leg,
white tight discipline catsuit, full-body vertical 9:16, chroma key pure green #00b140,
small scrap robot commander much shorter than girl fully visible between her thighs,
P4 fill: main mechanical pipe inserted vagina through crotch slit, thin tube in anus, both robot hands pinching nipples through catsuit,
oil hydraulic fluid leak on both, trembling thighs, arched spine, 2d anime cel shading"""

NEG = (
    "worst quality, low quality, score_1, score_2, score_3, artist name, shiny skin, blurry, "
    "deformed hands, extra fingers, watermark, text, wrong face, different hair color, "
    "tentacles, photorealistic, cropped feet, missing robot"
)


def api(path: str, data: dict | None = None):
    if data is None:
        req = urllib.request.Request(f"{COMFY}{path}")
    else:
        body = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{COMFY}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
        )
    with urllib.request.urlopen(req, timeout=7200) as r:
        return json.loads(r.read().decode())


def wait(pid: str, timeout=7200):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = api(f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status") or {}
            if st.get("status_str") == "error":
                msgs = st.get("messages")
                raise RuntimeError(str(msgs))
            # SaveLoRA 等节点可能 outputs={}，以 completed/success 为准
            if st.get("completed") or st.get("status_str") == "success" or h[pid].get("outputs"):
                return h[pid]
        time.sleep(2)
    raise TimeoutError(pid)


def ensure_folder_visible() -> str:
    ds = COMFY_IN / DS_FOLDER
    if not ds.exists() or not any(ds.glob("*.png")):
        raise FileNotFoundError(f"dataset missing: {ds}")
    info = api("/object_info/LoadImageTextDataSetFromFolder")
    opts = info["LoadImageTextDataSetFromFolder"]["input"]["required"]["folder"][1]["options"]
    print("dataset folder options:", opts, flush=True)
    if DS_FOLDER not in opts:
        # Comfy caches folder list; try refresh by free memory / restart hint
        raise RuntimeError(
            f"ComfyUI 未看到文件夹 {DS_FOLDER}（当前 {opts}）。请重启 ComfyUI 后再跑本脚本。"
        )
    return DS_FOLDER


def wf_train(steps: int, rank: int, lr: float, seed: int) -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": UNET, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": CLIP, "type": CLIP_TYPE, "device": "default"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["1", 0], "shift": 3.0},
        },
        "5": {
            "class_type": "LoadImageTextDataSetFromFolder",
            "inputs": {"folder": DS_FOLDER},
        },
        "6": {
            "class_type": "MakeTrainingDataset",
            "inputs": {
                "images": ["5", 0],
                "vae": ["3", 0],
                "clip": ["2", 0],
                "texts": ["5", 1],
            },
        },
        "7": {
            "class_type": "TrainLoraNode",
            "inputs": {
                "model": ["4", 0],
                "latents": ["6", 0],
                "positive": ["6", 1],
                "batch_size": 1,
                "grad_accumulation_steps": 1,
                "steps": steps,
                "learning_rate": lr,
                "rank": rank,
                "optimizer": "AdamW",
                "loss_function": "MSE",
                "seed": seed,
                "training_dtype": "bf16",
                "lora_dtype": "bf16",
                "quantized_backward": False,
                "algorithm": "LoRA",
                "gradient_checkpointing": True,
                "checkpoint_depth": 1,
                "offloading": False,
                "existing_lora": "[None]",
                "bucket_mode": False,
                "bypass_mode": False,
            },
        },
        "8": {
            "class_type": "SaveLoRA",
            "inputs": {
                "lora": ["7", 0],
                "prefix": "loras/ashcrow_sr012_anima16",
                "steps": ["7", 2],
            },
        },
        "9": {
            "class_type": "LossGraphNode"
            if False
            else "SaveLoRA",  # placeholder replaced below
            "inputs": {
                "lora": ["7", 0],
                "prefix": "loras/ashcrow_sr012_anima16_bak",
                "steps": ["7", 2],
            },
        },
    }


def wf_train_clean(steps: int, rank: int, lr: float, seed: int) -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": UNET, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": CLIP, "type": CLIP_TYPE, "device": "default"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["1", 0], "shift": 3.0},
        },
        "5": {
            "class_type": "LoadImageTextDataSetFromFolder",
            "inputs": {"folder": DS_FOLDER},
        },
        "6": {
            "class_type": "MakeTrainingDataset",
            "inputs": {
                "images": ["5", 0],
                "vae": ["3", 0],
                "clip": ["2", 0],
                "texts": ["5", 1],
            },
        },
        "7": {
            "class_type": "TrainLoraNode",
            "inputs": {
                "model": ["4", 0],
                "latents": ["6", 0],
                "positive": ["6", 1],
                "batch_size": 1,
                "grad_accumulation_steps": 1,
                "steps": steps,
                "learning_rate": lr,
                "rank": rank,
                "optimizer": "AdamW",
                "loss_function": "MSE",
                "seed": seed,
                "training_dtype": "bf16",
                "lora_dtype": "bf16",
                "quantized_backward": False,
                "algorithm": "LoRA",
                "gradient_checkpointing": True,
                "checkpoint_depth": 1,
                "offloading": False,
                "existing_lora": "[None]",
                "bucket_mode": False,
                "bypass_mode": False,
            },
        },
        "8": {
            "class_type": "SaveLoRA",
            "inputs": {
                "lora": ["7", 0],
                "prefix": "loras/ashcrow_sr012_anima16",
                "steps": steps,
            },
        },
    }


def find_latest_lora() -> Path:
    cands = sorted(
        COMFY_OUT.glob("**/ashcrow_sr012_anima16*.safetensors"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not cands:
        cands = sorted(
            Path(r"E:\MiniMaxH3\ComfyUI").rglob("ashcrow_sr012_anima16*.safetensors"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    if not cands:
        raise FileNotFoundError("trained lora not found")
    return cands[0]


def install_lora(src: Path) -> str:
    COMFY_LORA.mkdir(parents=True, exist_ok=True)
    dest = COMFY_LORA / "ashcrow_sr012_anima16.safetensors"
    shutil.copy2(src, dest)
    desk = DESKTOP / "ashcrow_sr012_anima16.safetensors"
    shutil.copy2(src, desk)
    print(f"LoRA installed: {dest}", flush=True)
    print(f"LoRA desktop: {desk}", flush=True)
    return dest.name


def wf_gen(lora_name: str, seed: int) -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": UNET, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": CLIP, "type": CLIP_TYPE, "device": "default"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": lora_name,
                "strength_model": 1.0,
            },
        },
        "5": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["4", 0], "shift": 3.0},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": POS_P4},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": NEG},
        },
        "8": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 864, "height": 1536, "batch_size": 1},
        },
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
        "10": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["9", 0], "vae": ["3", 0]},
        },
        "11": {
            "class_type": "SaveImage",
            "inputs": {
                "images": ["10", 0],
                "filename_prefix": "cmd_p4_ashcrow_lora",
            },
        },
    }


def copy_gen_to_desktop(history: dict, tag: str) -> Path:
    outs = []
    for node_out in (history.get("outputs") or {}).values():
        for img in node_out.get("images") or []:
            src = COMFY_OUT / img.get("subfolder", "") / img["filename"]
            if not src.exists():
                src = COMFY_OUT / img["filename"]
            if src.exists():
                outs.append(src)
    if not outs:
        cands = sorted(
            COMFY_OUT.glob("cmd_p4_ashcrow_lora*.png"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        outs = cands[:1]
    if not outs:
        raise FileNotFoundError("no gen output")
    src = outs[0]
    dest = DESKTOP / f"SR01_2_P4-A_lora_{tag}.png"
    shutil.copy2(src, dest)
    print(f"DESKTOP {dest}", flush=True)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=1200)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=0.0002)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--skip-train", action="store_true")
    ap.add_argument("--gen-only", action="store_true")
    ap.add_argument("--gen-seeds", type=int, nargs="*", default=[20260914, 20260915, 20260916])
    args = ap.parse_args()

    api("/system_stats")
    print("ComfyUI OK", flush=True)

    if not args.gen_only:
        ensure_folder_visible()
        if not args.skip_train:
            print(
                f"=== TRAIN steps={args.steps} rank={args.rank} lr={args.lr} ===",
                flush=True,
            )
            wf = wf_train_clean(args.steps, args.rank, args.lr, args.seed)
            pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})[
                "prompt_id"
            ]
            print(f"queued train {pid}", flush=True)
            wait(pid)
            print("train finished", flush=True)
        lora_src = find_latest_lora()
        lora_name = install_lora(lora_src)
    else:
        lora_name = "ashcrow_sr012_anima16.safetensors"
        if not (COMFY_LORA / lora_name).exists():
            raise FileNotFoundError(COMFY_LORA / lora_name)

    # refresh lora list by touching object_info
    api("/object_info/LoraLoaderModelOnly")

    for i, seed in enumerate(args.gen_seeds):
        print(f"=== GEN seed={seed} ===", flush=True)
        wf = wf_gen(lora_name, seed)
        try:
            pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})[
                "prompt_id"
            ]
        except Exception as e:
            # lora list may need exact name from folder
            info = api("/object_info/LoraLoaderModelOnly")
            opts = info["LoraLoaderModelOnly"]["input"]["required"]["lora_name"][0]
            print("available loras:", opts, flush=True)
            # pick matching
            match = [x for x in opts if "ashcrow_sr012" in x]
            if not match:
                raise
            wf = wf_gen(match[0], seed)
            pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})[
                "prompt_id"
            ]
        print(f"queued gen {pid}", flush=True)
        hist = wait(pid)
        copy_gen_to_desktop(hist, f"s{seed}")

    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
