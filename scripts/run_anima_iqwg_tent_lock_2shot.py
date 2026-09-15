"""Anima: lock iqwg outfit plate identity, add daoju tentacles tightly wrapping. Exactly 2 shots, 2K vertical."""
from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path

import numpy as np
import urllib.request
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WEIZHI = ROOT / "tex/juese/pifu/pifu_weizhi"
BASE = WEIZHI / "out_builtin" / "iqwg1bt7ia_服装_2k.png"
TENT_PROP = WEIZHI / "daoju" / "触手.png"
OUT = WEIZHI / "compare_anima_iqwg_tent_lock"
COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")
GEN = (1280, 1920)  # vertical work res
OUT_WH = (2048, 3072)  # 2K vertical delivery
GREEN = np.array([0, 177, 64], dtype=np.float32)

PROMPT = (
    "IDENTITY HARD LOCK: exact same cyborg girl as the reference plate — "
    "short messy silver-lavender hair, thin red forehead band, dark cyber head antennae, "
    "red eyes, pale organic torso, white mechanical armored arms, white robotic legs from mid-thigh, "
    "same white floral lace outfit, same face and body proportions. Do NOT redesign identity. "
    "ADD multiple thick matte black gunmetal segmented mechanical tentacle cables "
    "(match the tentacle prop: articulated robotic cable arms with three-prong claw tips, NOT organic). "
    "The cables tightly wrap and restrain her: underbust, waist, hips, thighs, and joints in a firm binding grip. "
    "Awkward unnatural restrained pose, shy embarrassed uncomfortable expression looking aside, "
    "NO blush on cheeks, hands pinned or held by cables. "
    "Full-body vertical, subject isolated. "
    "Uniform chroma key background pure green screen #00b140, studio lighting with zero shadows on background, "
    "seamless matte color, no texture or reflection, professional film set chroma key, "
    "ultra sharp 2D anime masterpiece, highest quality, 8K detail."
)
NEG = (
    "blurry, lowres, muddy, redesign face, different hair, different armor, white border, letterbox, "
    "organic octopus suckers, blushing cheeks, heavy blush, smile, confident pose, photorealistic, "
    "duplicate character, cropped feet, watermark, text"
)


def api(path: str, data: dict | None = None):
    if data is None:
        req = urllib.request.Request(f"{COMFY}{path}")
    else:
        body = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{COMFY}{path}", data=body, headers={"Content-Type": "application/json"}
        )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode())


def wait(pid: str):
    t0 = time.time()
    while time.time() - t0 < 2400:
        h = api(f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status") or {}
            if st.get("status_str") == "error":
                raise RuntimeError(str(st.get("messages")))
            if h[pid].get("outputs"):
                return
        time.sleep(1.5)
    raise TimeoutError(pid)


def find_out(prefix: str, t0: float) -> Path:
    cands = [p for p in COMFY_OUT.glob(f"{prefix}_*.png") if p.stat().st_mtime >= t0 - 2]
    if not cands:
        raise RuntimeError(f"no out {prefix}")
    return max(cands, key=lambda p: p.stat().st_mtime)


def run(wf: dict, prefix: str) -> Path:
    t0 = time.time()
    pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
    print(f"  queued {prefix} id={pid}", flush=True)
    wait(pid)
    return find_out(prefix, t0)


def fit_green(src: Path, size=GEN) -> Image.Image:
    im = Image.open(src).convert("RGB")
    tw, th = size
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (0, 177, 64))
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def wrap_mask(size=GEN) -> Image.Image:
    """Mask torso/hips/thighs for tentacle wrap; keep head/face unmasked for identity."""
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    # underbust + waist + hips
    d.ellipse([int(w * 0.10), int(h * 0.28), int(w * 0.90), int(h * 0.62)], fill=255)
    # upper thighs
    d.ellipse([int(w * 0.18), int(h * 0.52), int(w * 0.82), int(h * 0.74)], fill=255)
    # keep face/hair locked
    d.ellipse([int(w * 0.26), int(h * 0.00), int(w * 0.74), int(h * 0.30)], fill=0)
    return m.filter(ImageFilter.GaussianBlur(16))


def make_ctrl(plate: Image.Image, prop: Path) -> Image.Image:
    """Identity plate dominant; small tentacle prop strip on the right for style lock (not dual-character)."""
    tw, th = plate.size
    ctrl = plate.copy()
    if not prop.exists():
        return ctrl
    p = Image.open(prop).convert("RGB")
    strip_w = max(96, tw // 5)
    p.thumbnail((strip_w - 8, th - 16), Image.Resampling.LANCZOS)
    # paste on far right over green margin if any; otherwise overlay thin strip
    x = tw - p.size[0] - 4
    y = (th - p.size[1]) // 2
    # soft edge panel
    panel = Image.new("RGB", (strip_w, th), (0, 177, 64))
    panel.paste(p, ((strip_w - p.size[0]) // 2, y))
    ctrl.paste(panel, (tw - strip_w, 0))
    return ctrl


def edge_green(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    edge = (yy < 10) | (yy >= h - 10) | (xx < 10) | (xx >= w - 10)
    mx, mn = a.max(2), a.min(2)
    near_white = (mn > 230) | ((mx > 242) & ((mx - mn) < 18))
    a[edge & near_white] = GREEN
    a[np.linalg.norm(a - GREEN, axis=2) < 42] = GREEN
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=95, threshold=2))


def to_2k(im: Image.Image) -> Image.Image:
    im = edge_green(im)
    return im.resize(OUT_WH, Image.Resampling.LANCZOS).filter(
        ImageFilter.UnsharpMask(radius=1.1, percent=80, threshold=2)
    )


def stage(im: Image.Image, name: str) -> str:
    COMFY_IN.mkdir(parents=True, exist_ok=True)
    im.save(COMFY_IN / name, "PNG")
    return name


def wf_inpaint_best(
    base: str,
    mask: str,
    ctrl_id: str,
    ctrl_tent: str,
    prompt: str,
    seed: int,
    denoise: float,
    prefix: str,
) -> dict:
    """Inpaint wrap zone; dual LLLite: identity plate + tentacle prop style."""
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "anima-aesthetic-v1.1.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_06b_base.safetensors", "type": "stable_diffusion", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "10": {"class_type": "LoadImage", "inputs": {"image": base}},
        "11": {"class_type": "LoadImage", "inputs": {"image": mask}},
        "20": {"class_type": "LoadImage", "inputs": {"image": ctrl_id}},
        "21": {"class_type": "LoadImage", "inputs": {"image": ctrl_tent}},
        "12": {"class_type": "ImageToMask", "inputs": {"image": ["11", 0], "channel": "red"}},
        "13": {
            "class_type": "VAEEncodeForInpaint",
            "inputs": {"pixels": ["10", 0], "vae": ["3", 0], "mask": ["12", 0], "grow_mask_by": 10},
        },
        "30": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-inpainting-v2.safetensors"}},
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
        # hard identity lock from outfit plate
        "32": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-any-test-like-v2.safetensors"}},
        "33": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["31", 0],
                "model_patch": ["32", 0],
                "image": ["20", 0],
                "strength": 0.92,
                "start_percent": 0.0,
                "end_percent": 0.85,
            },
        },
        # lineart from identity plate
        "40": {"class_type": "Canny", "inputs": {"image": ["20", 0], "low_threshold": 0.28, "high_threshold": 0.72}},
        "41": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-lineart-1.safetensors"}},
        "42": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["33", 0],
                "model_patch": ["41", 0],
                "image": ["40", 0],
                "strength": 0.70,
                "start_percent": 0.0,
                "end_percent": 0.70,
            },
        },
        # tentacle prop style (lower strength so it doesn't overwrite identity)
        "50": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-any-test-like-v2.safetensors"}},
        "51": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["42", 0],
                "model_patch": ["50", 0],
                "image": ["21", 0],
                "strength": 0.45,
                "start_percent": 0.0,
                "end_percent": 0.75,
            },
        },
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["51", 0],
                "seed": seed,
                "steps": 48,
                "cfg": 4.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["13", 0],
                "denoise": denoise,
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def wf_esrgan(base: str, prefix: str) -> dict:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": base}},
        "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "RealESRGAN_x4plus_anime_6B.pth"}},
        "3": {"class_type": "ImageUpscaleWithModel", "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]}},
        "4": {"class_type": "SaveImage", "inputs": {"images": ["3", 0], "filename_prefix": prefix}},
    }


def has_tentacle(path: Path) -> bool:
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    patch = a[int(h * 0.28) : int(h * 0.70), int(w * 0.10) : int(w * 0.90)]
    dark = (patch.max(axis=2) < 80) & (np.linalg.norm(patch - GREEN, axis=2) > 55)
    return float(dark.mean()) > 0.015


def main() -> int:
    assert BASE.exists(), BASE
    assert TENT_PROP.exists(), TENT_PROP
    OUT.mkdir(parents=True, exist_ok=True)
    api("/system_stats")
    try:
        api("/free", {"unload_models": True, "free_memory": True})
    except Exception:
        pass

    plate = fit_green(BASE)
    tent_fit = fit_green(TENT_PROP)
    # identity ctrl = plate only (no strip) for strongest face/body lock
    ctrl_id = plate.copy()
    # tentacle ctrl = prop on green
    ctrl_tent = tent_fit
    mask = wrap_mask()
    mask_rgb = Image.merge("RGB", (mask, mask, mask))

    b = stage(plate, "iqwg_tentlock_base.png")
    m = stage(mask_rgb, "iqwg_tentlock_mask.png")
    c_id = stage(ctrl_id, "iqwg_tentlock_ctrl_id.png")
    c_t = stage(ctrl_tent, "iqwg_tentlock_ctrl_tent.png")
    plate.save(OUT / "prep_base.png")
    mask_rgb.save(OUT / "prep_mask.png")
    ctrl_tent.save(OUT / "prep_tent_prop.png")

    # two best settings from prior Anima tent success band
    jobs = [
        (0.88, 81001, "v1"),
        (0.94, 81017, "v2"),
    ]
    finals = []
    for den, seed, tag in jobs:
        prefix = f"iqwg_tentlock_{tag}"
        print(f"\n=== shot {tag} denoise={den} seed={seed} ===", flush=True)
        raw = run(
            wf_inpaint_best(b, m, c_id, c_t, PROMPT, seed, den, prefix),
            prefix,
        )
        native = OUT / f"{tag}_native.png"
        shutil.copy2(raw, native)
        print(f"  native tentacle_signal={has_tentacle(native)}", flush=True)

        # ESRGAN then force 2K vertical
        up_in = stage(
            Image.open(native).convert("RGB").resize(GEN, Image.Resampling.LANCZOS),
            f"iqwg_tentlock_{tag}_upin.png",
        )
        esr_prefix = f"iqwg_tentlock_{tag}_esr"
        esr_raw = run(wf_esrgan(up_in, esr_prefix), esr_prefix)
        im = Image.open(esr_raw).convert("RGB")
        # contain into 2K vertical canvas
        tw, th = OUT_WH
        scale = min(tw / im.size[0], th / im.size[1])
        nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
        im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", OUT_WH, (0, 177, 64))
        canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
        final = edge_green(canvas)
        dest = OUT / f"FINAL_iqwg1bt7ia_触手_{tag}_2k.png"
        final.save(dest, "PNG")
        finals.append(dest)
        print(f"  FINAL -> {dest} tentacle={has_tentacle(dest)} size={final.size}", flush=True)

    print("\nDONE", flush=True)
    for p in finals:
        print(" ", p, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
