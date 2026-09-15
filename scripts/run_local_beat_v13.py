"""Local-only beat pipeline (NO 147AI): Anima LLLite + RealESRGAN.

Sources: out_builtin plates + Asset/daoju for identity/prop lock.
Target: lace/metal clearly above out_builtin; notify only after visual QA pass.
"""
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
BUILTIN = WEIZHI / "out_builtin"
CHAR = WEIZHI / "角色"
DAOJU = WEIZHI / "daoju"
OUT = WEIZHI / "compare_local_v13"
COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")
GEN = (1280, 1920)
GREEN = np.array([0, 177, 64], dtype=np.float32)
NEG = (
    "blurry, lowres, muddy lace, redesign face, white border, letterbox, "
    "deformed hands, photorealistic, orange lingerie, missing limbs"
)

JOBS = [
    {
        "stem": "iqwg1bt7ia",
        "outfit": BUILTIN / "iqwg1bt7ia_服装_2k.png",
        "tent": BUILTIN / "iqwg1bt7ia_触手_soft_2k_v2.png",
        "asset": CHAR / "Asset-iqwg1bt7ia.png",
        "id": (
            "short messy silver-lavender hair, thin red forehead band, dark cyber antennae, "
            "red eyes, pale torso, white mechanical arms and legs with dark joints"
        ),
    },
    {
        "stem": "o3olk3s2lgq",
        "outfit": BUILTIN / "o3olk3s2lgq_服装.png",
        "tent": None,  # build via inpaint
        "asset": CHAR / "Asset-o3olk3s2lgq.png",
        "id": (
            "long black high ponytail, orange amber eyes, orange ear armor, MB-02 on orange shoulder, "
            "white/orange mechanical arms and legs, pale torso"
        ),
    },
]


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


def wait(pid: str, timeout: float = 2400.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = api(f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status") or {}
            if st.get("status_str") == "error":
                raise RuntimeError(str(st.get("messages")))
            if h[pid].get("outputs"):
                return
        time.sleep(1.8)
    raise TimeoutError(pid)


def find_out(prefix: str, t0: float) -> Path:
    cands = [p for p in COMFY_OUT.glob(f"{prefix}_*.png") if p.stat().st_mtime >= t0 - 2]
    if not cands:
        raise RuntimeError(f"no output for {prefix}")
    return max(cands, key=lambda p: p.stat().st_mtime)


def run(wf: dict, prefix: str) -> Path:
    t0 = time.time()
    pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
    wait(pid)
    return find_out(prefix, t0)


def fit(src: Path, size=GEN) -> Image.Image:
    im = Image.open(src).convert("RGB")
    tw, th = size
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, (0, 177, 64))
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def edge_green(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    edge = (yy < 10) | (yy >= h - 10) | (xx < 10) | (xx >= w - 10)
    mx, mn = a.max(2), a.min(2)
    near_white = (mn > 230) | ((mx > 242) & ((mx - mn) < 18))
    a[edge & near_white] = GREEN
    a[np.linalg.norm(a - GREEN, axis=2) < 40] = GREEN
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return out.filter(ImageFilter.UnsharpMask(radius=1.15, percent=90, threshold=2))


def to_2k(im: Image.Image) -> Image.Image:
    im = edge_green(im)
    if im.height != 3072:
        r = 3072 / im.height
        im = im.resize((max(1, int(im.width * r)), 3072), Image.Resampling.LANCZOS)
    return im


def lace_sharp(path: Path) -> float:
    g = np.asarray(Image.open(path).convert("L"), dtype=np.float32)
    h, w = g.shape
    crop = g[int(0.38 * h) : int(0.62 * h), int(0.28 * w) : int(0.72 * w)]
    c = Image.fromarray(crop.astype(np.uint8)).resize((512, 512), Image.Resampling.LANCZOS)
    a = np.asarray(c, dtype=np.float32)
    lap = np.abs(
        a[1:-1, 1:-1] * 4 - a[:-2, 1:-1] - a[2:, 1:-1] - a[1:-1, :-2] - a[1:-1, 2:]
    )
    return float(lap.var())


def stage(im: Image.Image, name: str) -> str:
    COMFY_IN.mkdir(parents=True, exist_ok=True)
    im.save(COMFY_IN / name, "PNG")
    return name


def torso_mask(size=GEN) -> Image.Image:
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    # donut-ish: wrap zone around waist, leave center lace somewhat editable
    d.ellipse([int(w * 0.12), int(h * 0.28), int(w * 0.88), int(h * 0.68)], fill=255)
    # keep face/head unmasked
    d.ellipse([int(w * 0.28), int(h * 0.02), int(w * 0.72), int(h * 0.28)], fill=0)
    return m.filter(ImageFilter.GaussianBlur(18))


def wf_refine(base: str, ctrl: str, prompt: str, seed: int, denoise: float, prefix: str) -> dict:
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "anima-aesthetic-v1.1.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_06b_base.safetensors", "type": "stable_diffusion", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "10": {"class_type": "LoadImage", "inputs": {"image": base}},
        "20": {"class_type": "LoadImage", "inputs": {"image": ctrl}},
        "12": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}},
        "30": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-any-test-like-v2.safetensors"}},
        "31": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["1", 0],
                "model_patch": ["30", 0],
                "image": ["20", 0],
                "strength": 0.95,
                "start_percent": 0.0,
                "end_percent": 0.88,
            },
        },
        "40": {"class_type": "Canny", "inputs": {"image": ["20", 0], "low_threshold": 0.28, "high_threshold": 0.72}},
        "41": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-lineart-1.safetensors"}},
        "42": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["31", 0],
                "model_patch": ["41", 0],
                "image": ["40", 0],
                "strength": 0.72,
                "start_percent": 0.0,
                "end_percent": 0.72,
            },
        },
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["42", 0],
                "seed": seed,
                "steps": 42,
                "cfg": 3.6,
                "sampler_name": "euler",
                "scheduler": "simple",
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["12", 0],
                "denoise": denoise,
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def wf_inpaint(base: str, mask: str, ctrl: str, prompt: str, seed: int, denoise: float, prefix: str) -> dict:
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "anima-aesthetic-v1.1.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_06b_base.safetensors", "type": "stable_diffusion", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_vae.safetensors"}},
        "10": {"class_type": "LoadImage", "inputs": {"image": base}},
        "11": {"class_type": "LoadImage", "inputs": {"image": mask}},
        "20": {"class_type": "LoadImage", "inputs": {"image": ctrl}},
        "12": {"class_type": "ImageToMask", "inputs": {"image": ["11", 0], "channel": "red"}},
        "13": {
            "class_type": "VAEEncodeForInpaint",
            "inputs": {"pixels": ["10", 0], "vae": ["3", 0], "mask": ["12", 0], "grow_mask_by": 8},
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
        "32": {"class_type": "ModelPatchLoader", "inputs": {"name": "anima-lllite-any-test-like-v2.safetensors"}},
        "33": {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["31", 0],
                "model_patch": ["32", 0],
                "image": ["20", 0],
                "strength": 0.5,
                "start_percent": 0.0,
                "end_percent": 0.7,
            },
        },
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["33", 0],
                "seed": seed,
                "steps": 40,
                "cfg": 3.8,
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
        "2": {
            "class_type": "UpscaleModelLoader",
            "inputs": {"model_name": "RealESRGAN_x4plus_anime_6B.pth"},
        },
        "3": {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {"upscale_model": ["2", 0], "image": ["1", 0]},
        },
        "4": {"class_type": "SaveImage", "inputs": {"images": ["3", 0], "filename_prefix": prefix}},
    }


def esrgan_save(src: Path, dest: Path) -> Path:
    im = Image.open(src).convert("RGB")
    if max(im.size) > 1600:
        im.thumbnail((1280, 1920), Image.Resampling.LANCZOS)
    name = f"esr_in_{dest.stem}.png"
    stage(im, name)
    prefix = f"esr_{dest.stem}"
    raw = run(wf_esrgan(name, prefix), prefix)
    out = to_2k(Image.open(raw))
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG")
    return dest


def has_tentacle(path: Path) -> bool:
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    patch = a[int(h * 0.30) : int(h * 0.65), int(w * 0.12) : int(w * 0.88)]
    dark = (patch.max(axis=2) < 75) & (np.linalg.norm(patch - GREEN, axis=2) > 55)
    return float(dark.mean()) > 0.012


def pick_best(cands: list[Path], dest: Path, require_tent: bool = False) -> Path | None:
    """Prefer Anima outputs over pure ESRGAN-of-builtin (user: 优先 Anima)."""
    scored = []
    for p in cands:
        if not p.exists() or p.stat().st_size < 20_000:
            continue
        if require_tent and not has_tentacle(p):
            print(f"  skip no tentacle signal: {p.name}", flush=True)
            continue
        name = p.name.lower()
        # deprioritize pure builtin upscales; boost anima (+ optional esr of anima)
        if "esrgan_bi" in name:
            bonus = -5000.0
        elif name.startswith("v13_") and "_esr" in name:
            bonus = 800.0
        elif name.startswith("v13_"):
            bonus = 400.0
        else:
            bonus = 0.0
        scored.append((lace_sharp(p) + bonus, lace_sharp(p), p, bonus))
    if not scored:
        return None
    scored.sort(key=lambda t: t[0], reverse=True)
    best = scored[0][2]
    shutil.copy2(best, dest)
    print(
        f"  BEST {dest.name} <- {best.name} sharp={scored[0][1]:.1f} (anima_prio bonus={scored[0][3]:.0f})",
        flush=True,
    )
    for total, raw, p, bonus in scored[:6]:
        print(f"    {p.name}: raw={raw:.1f} score={total:.1f}", flush=True)
    return dest


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    api("/system_stats")
    try:
        api("/free", {"unload_models": True, "free_memory": True})
    except Exception:
        pass

    # prop refs (optional visual lock via LLLite ctrl = plate itself primarily)
    outfit_prop = DAOJU / "服装.png"
    tent_prop = DAOJU / "触手.png"

    report = []
    for job in JOBS:
        stem = job["stem"]
        print(f"\n======== {stem} OUTFIT ========", flush=True)
        outfit_src = job["outfit"]
        if not outfit_src.exists():
            print("missing outfit", outfit_src, flush=True)
            continue

        plate = fit(outfit_src)
        # also pure ESRGAN baseline of builtin
        esr_bi = OUT / f"{stem}_outfit_esrgan_bi.png"
        print("  esrgan builtin outfit", flush=True)
        esrgan_save(outfit_src, esr_bi)

        base = stage(plate, f"v13_{stem}_out_b.png")
        # ctrl: plate itself for lock (strongest)
        ctrl = stage(plate, f"v13_{stem}_out_c.png")
        refine_p = (
            f"IDENTITY LOCK: {job['id']}. Keep shy hands-behind-back pose exactly. "
            f"Enhance ONLY: ultra-fine white floral lace weave holes, crisp white mech panel lines, "
            f"richer metal specular. Full-bleed chroma green #00b140. Masterpiece sharp 2D anime. No redesign."
        )
        outfit_cands = [esr_bi]
        for i, den in enumerate((0.08, 0.12, 0.16, 0.20)):
            prefix = f"v13_{stem}_out_d{i}"
            try:
                raw = run(wf_refine(base, ctrl, refine_p, 71000 + abs(hash(stem)) % 5000 + i, den, prefix), prefix)
                native = OUT / f"{prefix}_native.png"
                shutil.copy2(raw, native)
                final = OUT / f"{prefix}.png"
                to_2k(Image.open(native)).save(final)
                # also esrgan the anima result
                esr = OUT / f"{prefix}_esr.png"
                esrgan_save(native, esr)
                outfit_cands.extend([final, esr])
                print(f"  anima outfit den={den} OK", flush=True)
            except Exception as e:
                print(f"  anima outfit fail den={den}: {e}", flush=True)

        best_outfit = OUT / f"BEST_{stem}_服装.png"
        pick_best(outfit_cands, best_outfit)

        print(f"\n======== {stem} TENT ========", flush=True)
        tent_cands: list[Path] = []
        if job["tent"] and Path(job["tent"]).exists():
            tent_src = Path(job["tent"])
            esr_t = OUT / f"{stem}_tent_esrgan_bi.png"
            print("  esrgan builtin tent", flush=True)
            esrgan_save(tent_src, esr_t)
            tent_cands.append(esr_t)
            tplate = fit(tent_src)
            tb = stage(tplate, f"v13_{stem}_tent_b.png")
            tc = stage(tplate, f"v13_{stem}_tent_c.png")
            tp = (
                f"IDENTITY LOCK: {job['id']}. Keep mechanical cable wrap placement identical. "
                f"Enhance black segmented cable bevels, claw tips, lace under wraps, armor edges. "
                f"Hands behind back. Full body. Green #00b140."
            )
            for i, den in enumerate((0.08, 0.12, 0.16)):
                prefix = f"v13_{stem}_tent_d{i}"
                try:
                    raw = run(wf_refine(tb, tc, tp, 72000 + i, den, prefix), prefix)
                    native = OUT / f"{prefix}_native.png"
                    shutil.copy2(raw, native)
                    final = OUT / f"{prefix}.png"
                    to_2k(Image.open(native)).save(final)
                    esr = OUT / f"{prefix}_esr.png"
                    esrgan_save(native, esr)
                    tent_cands.extend([final, esr])
                    print(f"  anima tent den={den} OK", flush=True)
                except Exception as e:
                    print(f"  anima tent fail: {e}", flush=True)
        else:
            # o3: inpaint tentacles onto best outfit
            print("  inpaint tentacles onto outfit", flush=True)
            base_im = fit(best_outfit if best_outfit.exists() else outfit_src)
            # optional: composite tiny tent prop strip is avoided; use prop as ctrl if exists
            ctrl_im = fit(tent_prop) if tent_prop.exists() else base_im
            # better: use outfit plate as ctrl for identity, prompt for tentacles
            ctrl_im = base_im
            mask = torso_mask()
            mask_rgb = Image.merge("RGB", (mask, mask, mask))
            b = stage(base_im, f"v13_{stem}_tin_b.png")
            m = stage(mask_rgb, f"v13_{stem}_tin_m.png")
            c = stage(ctrl_im, f"v13_{stem}_tin_c.png")
            # also try ctrl = tent prop for style
            if tent_prop.exists():
                c2 = stage(fit(tent_prop), f"v13_{stem}_tin_cprop.png")
            else:
                c2 = c
            tin_p = (
                f"Keep white lace outfit and identity ({job['id']}), hands behind back. "
                f"In masked torso ADD exactly two thick matte black segmented mechanical cable-arms "
                f"with three-prong claws tightly wrapping waist over lace (robot prop, not organic). "
                f"Full body head-to-toe. Green #00b140."
            )
            for i, (den, ctrl_name) in enumerate(
                [(0.82, c), (0.90, c), (0.88, c2), (0.95, c2)]
            ):
                prefix = f"v13_{stem}_tin_{i}"
                try:
                    raw = run(wf_inpaint(b, m, ctrl_name, tin_p, 73000 + i, den, prefix), prefix)
                    native = OUT / f"{prefix}_native.png"
                    shutil.copy2(raw, native)
                    final = OUT / f"{prefix}.png"
                    to_2k(Image.open(native)).save(final)
                    if has_tentacle(final):
                        esr = OUT / f"{prefix}_esr.png"
                        esrgan_save(native, esr)
                        tent_cands.extend([final, esr])
                        print(f"  inpaint den={den} tentacle=YES", flush=True)
                    else:
                        print(f"  inpaint den={den} tentacle=NO", flush=True)
                except Exception as e:
                    print(f"  inpaint fail: {e}", flush=True)

            # fallback prior local cands if any
            for alt in [
                WEIZHI / "compare_hybrid_final" / "BEST_o3olk3s2lgq_触手.png",
                WEIZHI / "compare_hybrid_final" / "CAND_o3_tent_v2esr.png",
                WEIZHI / "compare_hybrid_v8_up" / "o3olk3s2lgq_tent_v7_esrgan_2k.png",
            ]:
                if alt.exists():
                    tent_cands.append(alt)

        best_tent = OUT / f"BEST_{stem}_触手.png"
        pick_best(tent_cands, best_tent, require_tent=True)

        # score vs builtin
        bi_out = lace_sharp(outfit_src)
        fo = lace_sharp(best_outfit) if best_outfit.exists() else 0
        row = {
            "stem": stem,
            "outfit_bi_sharp": round(bi_out, 1),
            "outfit_best_sharp": round(fo, 1),
            "outfit_ratio": round(fo / max(bi_out, 1e-6), 2),
        }
        if job["tent"] and Path(job["tent"]).exists() and best_tent.exists():
            bi_t = lace_sharp(job["tent"])
            ft = lace_sharp(best_tent)
            row.update(
                {
                    "tent_bi_sharp": round(bi_t, 1),
                    "tent_best_sharp": round(ft, 1),
                    "tent_ratio": round(ft / max(bi_t, 1e-6), 2),
                }
            )
        elif best_tent.exists():
            row["tent_best_sharp"] = round(lace_sharp(best_tent), 1)
            row["tent_signal"] = has_tentacle(best_tent)
        report.append(row)
        print("  SCORE", row, flush=True)

    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nLOCAL V13 DONE", OUT, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
