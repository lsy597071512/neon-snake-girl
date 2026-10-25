# -*- coding: utf-8 -*-
"""Batch Qwen-Image-2.1 upgrade for tiaojiao_multipose_v1 locks → 1440x2560."""
from __future__ import annotations

import json
import shutil
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

HOST = "http://127.0.0.1:8188"
COMFY_OUTPUT = Path(r"E:\MiniMaxH3\ComfyUI\output")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "tiaojiao_multipose_v1"
REFS = OUT / "_refs"
LOCKS = OUT / "_locks"
OUT_2K = OUT / "_2k"
MANIFEST = OUT / "MANIFEST.json"

UNET = "qwen_image_2.1_int8_convrot.safetensors"
CLIP = "qwen3vl_8b_int8_convrot.safetensors"
VAE = "qwen_image_2.1_vae_bf16.safetensors"
WIDTH, HEIGHT = 1440, 2560
STEPS, CFG, DENOISE = 40, 1.0, 1.0

PROMPT = """画面升级（严格保构图）。竖屏 9:16 高清 2K+ 绿幕二次元游戏静帧精修（输出约 1440x2560）。

【参考图分工】
Image 1 = 已锁定的最终构图主稿：姿势、镜头、触手布局、表情、服装、绿幕全部以 Image 1 为准，禁止改姿势与构图。Image 1 可低清，只借构图；输出必须清晰 2K 竖屏。
Image 2 = 角色身份材质：强化脸/发/瞳/蕾丝/义体精致度；禁止吸收站立姿势。
Image 3 = 触手材质：分段金属光泽；禁止插入、禁止乱长肢。

【表情】S1 害羞：薄红晕、犹豫半眯、微张嘴；禁止 smug。
【解剖】仅 2 腿 2 臂。场景：纯绿幕 #00b140。"""

NEG = (
    "pose change, different pose, extra legs, third leg, duplicated limbs, "
    "smug smile, ahegao, wrong face, penetration, insertion, "
    "blurry, lowres, text, watermark, room, wooden floor"
)


def api(path: str, payload: dict | None = None, timeout: float = 120.0):
    if payload is None:
        req = urllib.request.Request(f"{HOST}{path}")
    else:
        req = urllib.request.Request(
            f"{HOST}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def upload_image(path: Path) -> str:
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    name = path.name
    body = b""
    body += f"--{boundary}\r\n".encode()
    ctype = "image/jpeg" if path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    body += (
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode()
    body += path.read_bytes()
    body += f"\r\n--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{HOST}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        info = json.load(resp)
    return info.get("name") or name


def build_workflow(locked: str, char: str, tent: str, seed: int, prefix: str) -> dict:
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": UNET, "weight_dtype": "default"}},
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": CLIP, "type": "qwen_image", "device": "default"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "4": {
            "class_type": "QwenImage21Cache",
            "inputs": {"model": ["1", 0], "device": "auto", "dtype": "default"},
        },
        "10": {"class_type": "LoadImage", "inputs": {"image": locked}},
        "11": {"class_type": "LoadImage", "inputs": {"image": char}},
        "12": {"class_type": "LoadImage", "inputs": {"image": tent}},
        "20": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1},
        },
        "30": {
            "class_type": "TextEncodeQwenImage21",
            "inputs": {
                "clip": ["2", 0],
                "prompt": PROMPT,
                "negative_prompt": NEG,
                "resolution": 1536,
                "vae": ["3", 0],
                "images.image_1": ["10", 0],
                "images.image_2": ["11", 0],
                "images.image_3": ["12", 0],
            },
        },
        "40": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": STEPS,
                "cfg": CFG,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": DENOISE,
                "model": ["4", 0],
                "positive": ["30", 0],
                "negative": ["30", 1],
                "latent_image": ["20", 0],
            },
        },
        "50": {"class_type": "VAEDecode", "inputs": {"samples": ["40", 0], "vae": ["3", 0]}},
        "60": {"class_type": "SaveImage", "inputs": {"images": ["50", 0], "filename_prefix": prefix}},
    }


def wait_prompt(prompt_id: str, timeout_s: float = 1800.0) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            return hist[prompt_id]
        time.sleep(2.0)
    raise TimeoutError(prompt_id)


def newest_output(hist_item: dict) -> Path:
    for node_out in (hist_item.get("outputs") or {}).values():
        for im in node_out.get("images") or []:
            name = im.get("filename")
            if not name:
                continue
            sub = im.get("subfolder") or ""
            return COMFY_OUTPUT / sub / name if sub else COMFY_OUTPUT / name
    raise RuntimeError("no output image")


def main() -> None:
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    tent_n = upload_image(REFS / "tentacle.png")
    poses = man["poses"]
    seed0 = 2026092401

    for ci, char in enumerate(man["characters"]):
        char_path = REFS / "chars" / f"{char}.png"
        if not char_path.exists():
            print(f"SKIP {char}: missing outfit ref", flush=True)
            continue
        char_n = upload_image(char_path)
        lock_dir = LOCKS / char
        out_dir = OUT_2K / char
        out_dir.mkdir(parents=True, exist_ok=True)
        for pose in poses:
            pid = pose["id"]
            idx = pose["idx"]
            locked = lock_dir / f"p{idx}_{pid}.png"
            dest = out_dir / f"p{idx}_{pid}_2k.png"
            if dest.exists() and dest.stat().st_size > 100_000:
                print(f"EXISTS {dest.name}", flush=True)
                continue
            if not locked.exists():
                print(f"WAIT_LOCK {char} {pid}", flush=True)
                continue
            seed = seed0 + ci * 10 + idx
            print(f"=== {char} {pid} {WIDTH}x{HEIGHT} seed={seed} ===", flush=True)
            # unique upload name
            tmp = REFS / f"_up_{char}_{pid}.png"
            shutil.copy2(locked, tmp)
            locked_n = upload_image(tmp)
            prefix = f"mp_{char}_{pid}"
            wf = build_workflow(locked_n, char_n, tent_n, seed, prefix)
            try:
                res = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            except urllib.error.HTTPError as e:
                raise SystemExit(e.read().decode("utf-8", "replace")[:1200])
            hist = wait_prompt(res["prompt_id"])
            if (hist.get("status") or {}).get("status_str") == "error":
                raise SystemExit(str((hist.get("status") or {}).get("messages"))[:800])
            src = newest_output(hist)
            shutil.copy2(src, dest)
            print(f"  saved {dest} ({dest.stat().st_size})", flush=True)

    print("DONE batch upgrade", flush=True)


if __name__ == "__main__":
    main()
