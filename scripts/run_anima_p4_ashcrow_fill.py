"""P4 geometry hard-composite on locked identity plate, then tiny Anima blend.

Uses SR01_2_P4-A_idleface_* (identity locked) as base.
Pastes robot claws onto nipples + dual pipes into crotch, then SetLatentNoiseMask inpaint.
"""
from __future__ import annotations

import argparse
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

POS = """IDENTITY HARD LOCK: exact same Ashcrow Mio / SR01_2 lace plate — do not redesign face/hair/legs.
Keep scrap robot between thighs. P4 fill only in mask:
robot BOTH three-finger metal hands reach UP pinching nipples through white lace;
main thick mechanical pipe vagina insertion through lace crotch; thinner secondary tube anus;
hydraulic oil stains; trembling; biting lip; shame blush.
Chroma key #00b140. NO tentacles. NO girl hands holding robot. Sharp anime game skin."""

NEG = (
    "worst quality, blurry, redesign face, tentacles, closed eyes, black background, "
    "holding robot, hugging robot, clasped hands, photorealistic, censor, watermark"
)


def api(path: str, data: dict | None = None):
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


def wait(pid: str, timeout=2400):
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


def fit(im: Image.Image, size=GEN) -> Image.Image:
    im = punch(im)
    tw, th = size
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def zhujue_front() -> Image.Image:
    zh = Image.open(ROOT / "tex" / "zhujue.png").convert("RGB")
    w, h = zh.size
    front = zh.crop((0, 0, int(w * 0.34), h))
    a = np.asarray(front).astype(np.float32)
    white = (a.min(2) > 230) & ((a.max(2) - a.min(2)) < 18)
    a[white] = GREEN
    front = Image.fromarray(a.astype(np.uint8))
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(np.asarray(front).astype(np.float32) - g, axis=2)
    ys, xs = np.where(dist > 28)
    return front.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def claw_crop(front: Image.Image, side: str) -> Image.Image:
    """Crop one three-finger hand region from robot front plate."""
    a = np.asarray(front).astype(np.float32)
    h, w = a.shape[:2]
    if side == "L":
        box = (0, int(h * 0.42), int(w * 0.42), int(h * 0.78))
    else:
        box = (int(w * 0.58), int(h * 0.42), w, int(h * 0.78))
    hand = front.crop(box)
    # trim green
    g = np.array(GREEN, dtype=np.float32)
    ha = np.asarray(hand).astype(np.float32)
    dist = np.linalg.norm(ha - g, axis=2)
    ys, xs = np.where(dist > 28)
    if len(xs) < 8:
        return hand
    return hand.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def soft_paste(base: Image.Image, patch: Image.Image, xy: tuple[int, int], feather=2) -> Image.Image:
    g = np.array(GREEN, dtype=np.float32)
    pa = np.asarray(patch).astype(np.float32)
    mask = Image.fromarray(((np.linalg.norm(pa - g, axis=2) > 24).astype(np.uint8) * 255), "L")
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    out = base.copy()
    out.paste(patch, xy, mask)
    return out


def build_p4_plate(locked: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Return (base_with_geometry, mask, ctrl_id)."""
    w, h = GEN
    base = fit(locked)
    ctrl_id = base.copy()

    # erase girl hands / ghost straps near robot head with lace sample
    ca = np.asarray(base).astype(np.float32)
    sample = ca[int(h * 0.30) : int(h * 0.36), int(w * 0.40) : int(w * 0.60)]
    fill = sample.reshape(-1, 3).mean(axis=0)
    for (y0, y1, x0, x1) in [
        (int(h * 0.36), int(h * 0.48), int(w * 0.28), int(w * 0.48)),  # L hand
        (int(h * 0.36), int(h * 0.48), int(w * 0.52), int(w * 0.72)),  # R hand
        (int(h * 0.42), int(h * 0.50), int(w * 0.40), int(w * 0.60)),  # straps over head
    ]:
        yy, xx = np.mgrid[y0:y1, x0:x1]
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        ry, rx = max((y1 - y0) / 2, 1), max((x1 - x0) / 2, 1)
        soft = np.clip(1.0 - (((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2), 0, 1)[..., None]
        patch = ca[y0:y1, x0:x1]
        ca[y0:y1, x0:x1] = patch * (1 - soft) + fill * soft
    base = Image.fromarray(np.clip(ca, 0, 255).astype(np.uint8))

    front = zhujue_front()
    # enlarge robot presence if needed (already on plate); add upward arms + claws
    claw_l = claw_crop(front, "L").resize((int(w * 0.12), int(h * 0.07)), Image.Resampling.LANCZOS)
    claw_r = claw_crop(front, "R").resize((int(w * 0.12), int(h * 0.07)), Image.Resampling.LANCZOS)
    # nipple approx
    nip_l = (int(w * 0.38), int(h * 0.355))
    nip_r = (int(w * 0.50), int(h * 0.355))
    # arm shafts from robot shoulders (~pelvis height) to nipples
    draw = ImageDraw.Draw(base)
    metal = (168, 162, 150)
    metal_d = (120, 115, 105)
    rob_shoulder_y = int(h * 0.50)
    draw.line([(int(w * 0.40), rob_shoulder_y), (nip_l[0] + claw_l.size[0] // 2, nip_l[1] + claw_l.size[1] // 2)], fill=metal, width=14)
    draw.line([(int(w * 0.60), rob_shoulder_y), (nip_r[0] + claw_r.size[0] // 2, nip_r[1] + claw_r.size[1] // 2)], fill=metal, width=14)
    draw.line([(int(w * 0.40), rob_shoulder_y), (nip_l[0] + claw_l.size[0] // 2, nip_l[1] + claw_l.size[1] // 2)], fill=metal_d, width=6)
    draw.line([(int(w * 0.60), rob_shoulder_y), (nip_r[0] + claw_r.size[0] // 2, nip_r[1] + claw_r.size[1] // 2)], fill=metal_d, width=6)
    base = soft_paste(base, claw_l, nip_l, feather=1)
    base = soft_paste(base, claw_r, nip_r, feather=1)

    # dual pipes: thick center + thin offset
    pipe = (150, 155, 160)
    pipe2 = (110, 130, 140)
    # main vagina pipe from robot chest up into lace crotch
    draw = ImageDraw.Draw(base)
    draw.ellipse([int(w * 0.46), int(h * 0.52), int(w * 0.54), int(h * 0.58)], fill=pipe)
    draw.rectangle([int(w * 0.475), int(h * 0.48), int(w * 0.525), int(h * 0.56)], fill=pipe)
    draw.ellipse([int(w * 0.465), int(h * 0.465), int(w * 0.535), int(h * 0.50)], fill=(180, 185, 190))
    # thin anus tube
    draw.ellipse([int(w * 0.50), int(h * 0.54), int(w * 0.55), int(h * 0.59)], fill=pipe2)
    draw.rectangle([int(w * 0.515), int(h * 0.50), int(w * 0.540), int(h * 0.57)], fill=pipe2)

    # mask = only geometry we changed
    mm = Image.new("L", GEN, 0)
    d = ImageDraw.Draw(mm)
    # claws + arms
    d.ellipse([int(w * 0.34), int(h * 0.34), int(w * 0.66), int(h * 0.44)], fill=255)
    d.line([(int(w * 0.40), rob_shoulder_y), (nip_l[0] + 20, nip_l[1] + 20)], fill=220, width=28)
    d.line([(int(w * 0.60), rob_shoulder_y), (nip_r[0] + 20, nip_r[1] + 20)], fill=220, width=28)
    # erased hand zones
    d.ellipse([int(w * 0.28), int(h * 0.36), int(w * 0.48), int(h * 0.48)], fill=200)
    d.ellipse([int(w * 0.52), int(h * 0.36), int(w * 0.72), int(h * 0.48)], fill=200)
    # pipes
    d.ellipse([int(w * 0.42), int(h * 0.46), int(w * 0.58), int(h * 0.60)], fill=240)
    # protect face
    d.ellipse([int(w * 0.16), 0, int(w * 0.84), int(h * 0.32)], fill=0)
    # protect most robot body (keep red eyes)
    d.ellipse([int(w * 0.36), int(h * 0.50), int(w * 0.64), int(h * 0.68)], fill=0)
    mm = mm.filter(ImageFilter.GaussianBlur(4))
    mask = Image.merge("RGB", (mm, mm, mm))
    return base, mask, ctrl_id


def wf(base, mask, ctrl_id, ctrl_cmd, seed, denoise, prefix, id_s=0.97, cmd_s=0.55):
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "anima-aesthetic-v1.1.safetensors", "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen_3_06b_base.safetensors",
                "type": "stable_diffusion",
                "device": "default",
            },
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "10": {"class_type": "LoadImage", "inputs": {"image": base}},
        "11": {"class_type": "LoadImage", "inputs": {"image": mask}},
        "20": {"class_type": "LoadImage", "inputs": {"image": ctrl_id}},
        "21": {"class_type": "LoadImage", "inputs": {"image": ctrl_cmd}},
        "12": {"class_type": "ImageToMask", "inputs": {"image": ["11", 0], "channel": "red"}},
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}},
        "14": {
            "class_type": "SetLatentNoiseMask",
            "inputs": {"samples": ["13", 0], "mask": ["12", 0]},
        },
        "30": {
            "class_type": "ModelPatchLoader",
            "inputs": {"name": "anima-lllite-inpainting-v2.safetensors"},
        },
        "31": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["1", 0],
                "model_patch": ["30", 0],
                "image": ["20", 0],
                "strength": 1.0,
                "start_percent": 0.0,
                "end_percent": 1.0,
                "mask": ["12", 0],
            },
        },
        "32": {
            "class_type": "ModelPatchLoader",
            "inputs": {"name": "anima-lllite-any-test-like-v2.safetensors"},
        },
        "33": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["31", 0],
                "model_patch": ["32", 0],
                "image": ["20", 0],
                "strength": id_s,
                "start_percent": 0.0,
                "end_percent": 0.90,
            },
        },
        "40": {
            "class_type": "Canny",
            "inputs": {"image": ["20", 0], "low_threshold": 0.28, "high_threshold": 0.72},
        },
        "41": {
            "class_type": "ModelPatchLoader",
            "inputs": {"name": "anima-lllite-lineart-1.safetensors"},
        },
        "42": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["33", 0],
                "model_patch": ["41", 0],
                "image": ["40", 0],
                "strength": 0.55,
                "start_percent": 0.0,
                "end_percent": 0.65,
            },
        },
        "50": {
            "class_type": "ModelPatchLoader",
            "inputs": {"name": "anima-lllite-any-test-like-v2.safetensors"},
        },
        "51": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["42", 0],
                "model_patch": ["50", 0],
                "image": ["21", 0],
                "strength": cmd_s,
                "start_percent": 0.0,
                "end_percent": 0.70,
            },
        },
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["51", 0],
                "seed": seed,
                "steps": 32,
                "cfg": 4.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["14", 0],
                "denoise": denoise,
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def stage(im: Image.Image, name: str) -> str:
    COMFY_IN.mkdir(parents=True, exist_ok=True)
    im.save(COMFY_IN / name, "PNG")
    return name


def find_out(prefix: str, t0: float) -> Path:
    cands = [p for p in COMFY_OUT.glob(f"{prefix}_*.png") if p.stat().st_mtime >= t0 - 2]
    if not cands:
        raise RuntimeError(f"no out {prefix}")
    return max(cands, key=lambda p: p.stat().st_mtime)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--base",
        type=str,
        default=str(WORK / "SR01_2_P4-A_idleface_d42_s98601.png"),
    )
    ap.add_argument("--seeds", type=int, nargs="*", default=[98701, 98717])
    ap.add_argument("--denoise", type=float, nargs="*", default=[0.38, 0.48])
    args = ap.parse_args()

    api("/system_stats")
    WORK.mkdir(parents=True, exist_ok=True)
    locked = Image.open(args.base).convert("RGB")
    # if deliver upscaled 1080x1920, fit back
    locked = fit(locked)

    base, mask, ctrl_id = build_p4_plate(locked)
    base.save(WORK / "prep_base_fill.png")
    mask.save(WORK / "prep_mask_fill.png")
    ctrl_id.save(WORK / "prep_ctrl_id_fill.png")

    front = zhujue_front()
    ctrl_cmd = fit(front)
    ctrl_cmd.save(WORK / "prep_ctrl_cmd_fill.png")

    b = stage(base, "ashcrow_p4_fill_base.png")
    m = stage(mask, "ashcrow_p4_fill_mask.png")
    c_id = stage(ctrl_id, "ashcrow_p4_fill_ctrl_id.png")
    c_cmd = stage(ctrl_cmd, "ashcrow_p4_fill_ctrl_cmd.png")

    for den in args.denoise:
        for seed in args.seeds:
            tag = f"d{int(den * 100)}_s{seed}"
            print(f"\n=== FILL {tag} ===", flush=True)
            t0 = time.time()
            prefix = f"ashcrow_p4_fill_{tag}"
            pid = api(
                "/prompt",
                {"prompt": wf(b, m, c_id, c_cmd, seed, den, prefix), "client_id": str(uuid.uuid4())},
            )["prompt_id"]
            print(f"  queued {pid}", flush=True)
            wait(pid)
            out = find_out(prefix, t0)
            dest = WORK / f"SR01_2_P4-A_fill_{tag}.png"
            Image.open(out).convert("RGB").save(dest)
            print(f"  saved {dest}", flush=True)
    print("ALL DONE fill", flush=True)


if __name__ == "__main__":
    main()
