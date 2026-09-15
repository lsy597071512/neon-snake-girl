"""
MiaoMiao Harem Anima 1.6 · 指挥官亲自调教 P4-A 测试（苍羽·澪 SR01_2）

两种模式：
  1) img2img  — 用绿幕拼底板（调教皮抽帧 + 指挥官）
  2) txt2img  — 空 latent 纯文生（本机 models/loras 为空时的第二对照；
                若你另有角色 LoRA，可之后挂 LoraLoader）

用法：
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_anima16_cmd_p4_ashcrow_test.py
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_anima16_cmd_p4_ashcrow_test.py --mode img2img
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_anima16_cmd_p4_ashcrow_test.py --mode txt2img
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_anima16_cmd_p4_ashcrow_test.py --mode both
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
import uuid
from pathlib import Path

import urllib.request

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp" / "cmd_discipline_p4_test"
# 成图默认落到当前用户桌面（便于直接验收）
DESKTOP = Path.home() / "Desktop"
DESKTOP_OUT = DESKTOP / "cmd_discipline_p4_test"
COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")

UNET = "miaomiaoHarem_anima16.safetensors"
CLIP = "miaomiaoHarem_anima16_txt.safetensors"
# 预设工作流写 stable_diffusion；若报错可改 qwen_image
CLIP_TYPE = "stable_diffusion"
VAE = "qwen_image_vae.safetensors"
UPSCALE = "RealESRGAN_x4plus_anime_6B.pth"

PLATE = WORK / "SR01_2_P4_i2i_plate.png"
POS = (WORK / "SR01_2_P4-A_prompt.txt").read_text(encoding="utf-8").strip()
NEG = (WORK / "SR01_2_P4-A_negative.txt").read_text(encoding="utf-8").strip()


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
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())


def wait(pid: str, timeout=2400):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = api(f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status") or {}
            if st.get("status_str") == "error":
                raise RuntimeError(str(st.get("messages")))
            if h[pid].get("outputs"):
                return h[pid]
        time.sleep(1.5)
    raise TimeoutError(pid)


def upload(local: Path) -> str:
    COMFY_IN.mkdir(parents=True, exist_ok=True)
    name = local.name
    dest = COMFY_IN / name
    shutil.copy2(local, dest)
    return name


def base_loaders() -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": UNET, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": CLIP,
                "type": CLIP_TYPE,
                "device": "default",
            },
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["1", 0], "shift": 3.0},
        },
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": POS},
        },
        "9": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["2", 0], "text": NEG},
        },
    }


def wf_img2img(image_name: str, denoise: float, seed: int) -> dict:
    wf = base_loaders()
    wf.update(
        {
            "5": {
                "class_type": "LoadImage",
                "inputs": {"image": image_name},
            },
            "6": {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["5", 0],
                    "upscale_method": "lanczos",
                    "width": 864,
                    "height": 1536,
                    "crop": "disabled",
                },
            },
            "7": {
                "class_type": "VAEEncode",
                "inputs": {"pixels": ["6", 0], "vae": ["3", 0]},
            },
            "10": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["4", 0],
                    "positive": ["8", 0],
                    "negative": ["9", 0],
                    "latent_image": ["7", 0],
                    "seed": seed,
                    "steps": 30,
                    "cfg": 4.5,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": denoise,
                },
            },
            "11": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["10", 0], "vae": ["3", 0]},
            },
            "15": {
                "class_type": "SaveImage",
                "inputs": {
                    "images": ["11", 0],
                    "filename_prefix": "cmd_p4_ashcrow_i2i",
                },
            },
        }
    )
    return wf


def wf_txt2img(seed: int) -> dict:
    """空 latent 文生图对照（非角色 LoRA；本机 loras 目录为空）。"""
    wf = base_loaders()
    wf.update(
        {
            "7": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": 864, "height": 1536, "batch_size": 1},
            },
            "10": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["4", 0],
                    "positive": ["8", 0],
                    "negative": ["9", 0],
                    "latent_image": ["7", 0],
                    "seed": seed,
                    "steps": 30,
                    "cfg": 4.5,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0,
                },
            },
            "11": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["10", 0], "vae": ["3", 0]},
            },
            "15": {
                "class_type": "SaveImage",
                "inputs": {
                    "images": ["11", 0],
                    "filename_prefix": "cmd_p4_ashcrow_t2i",
                },
            },
        }
    )
    return wf


def collect_and_copy(history: dict, prefix: str, label: str) -> list[Path]:
    outs: list[Path] = []
    WORK.mkdir(parents=True, exist_ok=True)
    DESKTOP_OUT.mkdir(parents=True, exist_ok=True)
    for node_out in (history.get("outputs") or {}).values():
        for img in node_out.get("images") or []:
            src = COMFY_OUT / img["filename"]
            if not src.exists() and img.get("subfolder"):
                src = COMFY_OUT / img["subfolder"] / img["filename"]
            if not src.exists():
                # fallback newest matching prefix
                cands = sorted(
                    COMFY_OUT.glob(f"{prefix}*.png"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True,
                )
                if not cands:
                    continue
                src = cands[0]
            name = f"{label}_{src.name}"
            dest_work = WORK / name
            dest_desk = DESKTOP_OUT / name
            # 桌面根目录再放一份短文件名，方便一眼看到
            short = DESKTOP / f"SR01_2_P4-A_{label}.png"
            shutil.copy2(src, dest_work)
            shutil.copy2(src, dest_desk)
            shutil.copy2(src, short)
            outs.append(short)
            print(f"  saved desktop {short}", flush=True)
            print(f"  saved folder  {dest_desk}", flush=True)
    return outs


def run_mode(mode: str, seed: int, denoise: float):
    print(f"=== {mode} seed={seed} ===", flush=True)
    if mode == "img2img":
        if not PLATE.exists():
            raise FileNotFoundError(PLATE)
        name = upload(PLATE)
        wf = wf_img2img(name, denoise=denoise, seed=seed)
        prefix = "cmd_p4_ashcrow_i2i"
        label = "i2i"
    else:
        wf = wf_txt2img(seed=seed)
        prefix = "cmd_p4_ashcrow_t2i"
        label = "t2i"

    pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
    print(f"  queued {pid}", flush=True)
    hist = wait(pid)
    return collect_and_copy(hist, prefix, label)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--mode",
        choices=["img2img", "txt2img", "both"],
        default="both",
        help="img2img=图生图；txt2img=空latent文生图对照（本机暂无角色LoRA）",
    )
    ap.add_argument("--seed", type=int, default=20260914)
    ap.add_argument("--denoise", type=float, default=0.55, help="图生图 denoise，P4 大改建议 0.50–0.65")
    args = ap.parse_args()

    api("/system_stats")
    print("ComfyUI OK", flush=True)
    print(f"POS chars={len(POS)} NEG chars={len(NEG)}", flush=True)

    modes = ["img2img", "txt2img"] if args.mode == "both" else [args.mode]
    all_out: list[Path] = []
    for i, m in enumerate(modes):
        all_out += run_mode(m, seed=args.seed + i, denoise=args.denoise)

    print("DONE:", [str(p) for p in all_out], flush=True)


if __name__ == "__main__":
    main()
