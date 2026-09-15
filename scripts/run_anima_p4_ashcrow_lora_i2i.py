"""Img2img P4 fill on locked idleface plate using miaomiaoHarem + ashcrow LoRA."""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

import numpy as np
import urllib.request
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp" / "cmd_discipline_p4_lllite"
QA = ROOT / "tmp" / "cmd_discipline_p4_qa"
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
chroma key pure green #00b140 full-body 9:16,
small scrap robot stands between her thighs at pelvis (NOT held in hands), dome head twin red eyes,
P4: robot three-finger hands pinching nipples through lace, main mechanical pipe vagina, thin tube anus,
oil leak, trembling, biting lip, shame blush, 2d anime cel shading matching official skin"""

NEG = (
    "worst quality, score_1, score_2, blurry, tentacles, holding robot, hugging robot, "
    "merged body, fused robot, redesign face, black background, photorealistic, watermark"
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


def build_plate() -> Image.Image:
    idle = fit(Image.open(QA / "SR01_2_tiaojiao_f0.png"))
    openeye = fit(Image.open(QA / "ref_body_openeye_green.png"))
    # face paste
    w, h = GEN
    box = (int(w * 0.22), int(h * 0.04), int(w * 0.78), int(h * 0.28))
    face = openeye.crop(box)
    mask = Image.new("L", face.size, 0)
    ImageDraw.Draw(mask).ellipse(
        [int(face.size[0] * 0.05), int(face.size[1] * 0.05), int(face.size[0] * 0.95), int(face.size[1] * 0.95)],
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(8))
    base = idle.copy()
    base.paste(face, (box[0], box[1]), mask)
    # erase clasped hands -> green
    ca = np.asarray(base).astype(np.float32)
    y0, y1, x0, x1 = int(h * 0.38), int(h * 0.52), int(w * 0.34), int(w * 0.66)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
    ry, rx = max((y1 - y0) / 2, 1), max((x1 - x0) / 2, 1)
    ell = ((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 <= 1
    patch = ca[y0:y1, x0:x1]
    patch[ell] = GREEN
    ca[y0:y1, x0:x1] = patch
    base = Image.fromarray(np.clip(ca, 0, 255).astype(np.uint8))
    # robot
    zh = Image.open(ROOT / "tex" / "zhujue.png").convert("RGB")
    ww, hh = zh.size
    front = zh.crop((0, 0, int(ww * 0.34), hh))
    fa = np.asarray(front).astype(np.float32)
    white = (fa.min(2) > 230) & ((fa.max(2) - fa.min(2)) < 18)
    fa[white] = GREEN
    front = Image.fromarray(fa.astype(np.uint8))
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(np.asarray(front).astype(np.float32) - g, axis=2)
    ys, xs = np.where(dist > 28)
    front = front.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    robot = front.copy()
    robot.thumbnail((int(w * 0.30), int(h * 0.28)), Image.Resampling.LANCZOS)
    ra = np.asarray(robot).astype(np.float32)
    rmask = Image.fromarray(((np.linalg.norm(ra - g, axis=2) > 28).astype(np.uint8) * 255), "L")
    rx = (w - robot.size[0]) // 2
    ry = int(h * 0.44)
    base.paste(robot, (rx, ry), rmask)
    return base


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
        "13": {
            "class_type": "SaveImage",
            "inputs": {"images": ["12", 0], "filename_prefix": f"ashcrow_p4_lora_i2i_d{int(denoise*100)}_s{seed}"},
        },
    }


def main():
    api("/system_stats")
    WORK.mkdir(parents=True, exist_ok=True)
    plate = build_plate()
    plate.save(WORK / "prep_base_lora_i2i.png")
    name = "ashcrow_p4_lora_plate.png"
    plate.save(COMFY_IN / name)
    for den in (0.35, 0.48, 0.58):
        for seed in (98501, 98517):
            tag = f"d{int(den*100)}_s{seed}"
            print(f"\n=== LoRA i2i {tag} ===", flush=True)
            t0 = time.time()
            pid = api("/prompt", {"prompt": wf(name, seed, den), "client_id": str(uuid.uuid4())})["prompt_id"]
            wait(pid)
            cands = [p for p in COMFY_OUT.glob(f"ashcrow_p4_lora_i2i_{tag}_*.png") if p.stat().st_mtime >= t0 - 2]
            if not cands:
                # prefix may vary
                cands = sorted(COMFY_OUT.glob("ashcrow_p4_lora_i2i_*.png"), key=lambda p: p.stat().st_mtime)[-1:]
            out = max(cands, key=lambda p: p.stat().st_mtime)
            dest = WORK / f"SR01_2_P4-A_lora_i2i_{tag}.png"
            Image.open(out).convert("RGB").save(dest)
            print(f"  saved {dest}", flush=True)
    print("ALL DONE lora i2i", flush=True)


if __name__ == "__main__":
    main()
