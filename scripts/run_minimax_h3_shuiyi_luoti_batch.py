"""Sleepwear (pifu02) → nude idle plates.

Reference standard: tex/juese/pifu/shuiyi/{stem}_pifu02.png
- Face / body / cyber / art style locked to sleepwear plate
- Remove camisole + shorts only; keep cyber limbs
- Soft chroma-key transparent PNG, RealESRGAN → sharp 1440x2560
- Cloth QA: reject & retry if torso fabric/pants remain

Output: tex/juese/pifu/shuiyi/luoti/{stem}_luoti.png
"""
from __future__ import annotations

import argparse
import importlib.util
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from scipy import ndimage
from spandrel import ModelLoader

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"
spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

# MiniMax venv may lack imageio-ffmpeg on PATH — pin a working binary
try:
    import imageio_ffmpeg

    m.FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    for cand in (
        Path(r"C:\Users\LiSuYan\AppData\Local\Python\pythoncore-3.14-64\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"),
        Path(r"C:\ffmpeg\bin\ffmpeg.exe"),
    ):
        if cand.exists():
            m.FFMPEG = str(cand)
            break
print(f"FFMPEG={m.FFMPEG}", flush=True)

SHUIYI = ROOT / "tex" / "juese" / "pifu" / "shuiyi"
OUT = SHUIYI / "luoti"
QA = OUT / "_qa"
FIRST = OUT / "_first"
GREEN = np.array([0.0, 177.0, 64.0], dtype=np.float32)
FW, FH = 768, 1344
OW, OH = 1440, 2560
LENGTH = 100  # ~4.2s
STEPS = 24
MAX_ATTEMPTS = 4

COMFY = Path(r"E:\MiniMaxH3\ComfyUI")
ESRGAN = COMFY / "models" / "upscale_models" / "RealESRGAN_x4plus_anime_6B.pth"

# Sleepwear-locked identity (face/hair/cyber from pifu02; measurements from characters.ts)
CHARS: dict[str, dict[str, str]] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "measure": "168cm B88/W59/H86 athletic slim hourglass",
        "lock": (
            "ash-blonde high ponytail with green-tipped ends, straight bangs, silver wing-fin head clips, "
            "large light-blue eyes, pale skin; white/grey/gold mechanical legs from mid-thigh with pointed cyber heels"
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "measure": "162cm B84/W56/H82 compact slim",
        "lock": (
            "messy short silver-white hair, thin red headband, pale blue eyes; "
            "glossy white mecha arms/legs with black joints and red accents, red fin cyber heels"
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "measure": "166cm B90/W60/H88 soft fuller bust",
        "lock": (
            "long wavy ash-blonde hair, teal aquamarine eyes, gentle face, halo/ear headset if present; "
            "white/grey/gold mechanical right arm and mechanical boots from sleepwear plate"
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "measure": "167cm B87/W57/H85 slim",
        "lock": (
            "very long silver-grey hair with darker bang streak, glowing amber-orange eyes, "
            "bulky headset with yellow antenna tip; keep cyber marks from sleepwear plate"
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "measure": "170cm B92/W61/H90 taller fuller bust",
        "lock": (
            "long jet-black high ponytail, amber-orange eyes; "
            "white/orange/dark cyber arm plating and mechanical legs as in sleepwear plate"
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "measure": "165cm B85/W57/H84",
        "lock": (
            "long white hair, large white feline ears with yellow-black accents, amber-gold eyes, "
            "black/yellow lower-face respirator; white-silver mechanical hands/feet from sleepwear plate"
        ),
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "measure": "169cm B89/W59/H87",
        "lock": (
            "long jet-black hair with cyan-green triangular clips, glowing crimson eyes, black choker; "
            "matte black left arm prosthetic and mechanical right lower leg from sleepwear plate"
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "measure": "165cm B85/W57/H84",
        "lock": (
            "long silver-grey hair with tech plates, luminous green eyes; "
            "silver/white cyber plates on limbs with green glow accents, pointed cyber heels"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "measure": "158cm B82/W55/H80 petite",
        "lock": (
            "long wavy pastel blue-lavender hair, soft purple/pink eyes; "
            "glossy white mechanical arms and legs with gold ball joints as in sleepwear plate"
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "measure": "163cm B88/W58/H86",
        "lock": (
            "dusty pink/mauve hair, reddish-pink eyes, large glossy black robotic ears; "
            "black/red cyber arm and legs from sleepwear plate"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "measure": "166cm B86/W58/H85",
        "lock": (
            "orange high ponytail/twin-tail, amber eyes, teal forehead accessory; "
            "white glossy mechanical thigh-high boots with red/blue accents from sleepwear plate"
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "measure": "170cm B86/W56/H84",
        "lock": (
            "long black hair with pink underside highlights, reddish-brown eyes, large tech headphones; "
            "mechanical collar and glass-shell/cyber leg details from sleepwear plate"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "measure": "160cm B84/W56/H83",
        "lock": (
            "short messy light-blue hair with pink highlights, bunny ears, purple-pink eyes; "
            "white-silver mechanical legs with orange accents from sleepwear plate"
        ),
    },
}


def sleepwear_src(stem: str) -> Path:
    p = SHUIYI / f"{stem}_pifu02.png"
    if not p.exists():
        raise FileNotFoundError(p)
    return p


def make_greenscreen(src: Path, dest: Path) -> Path:
    char = Image.open(src).convert("RGBA")
    a = np.asarray(char)
    mask = a[:, :, 3] > 16
    ys, xs = np.where(mask)
    pad = 4
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(char.width, int(xs.max()) + 1 + pad), min(char.height, int(ys.max()) + 1 + pad)
    char = char.crop((l, t, r, b))
    margin = 0.035
    max_w, max_h = int(FW * (1 - 2 * margin)), int(FH * (1 - 2 * margin))
    scale = min(max_w / char.width, max_h / char.height)
    cw, ch = max(1, int(char.width * scale)), max(1, int(char.height * scale))
    char2 = char.resize((cw, ch), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (FW, FH), (0, 177, 64, 255))
    canvas.alpha_composite(char2, ((FW - cw) // 2, (FH - ch) // 2))
    arr = np.asarray(canvas).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3]
    out = rgb * alpha + np.broadcast_to(GREEN, rgb.shape) * (1.0 - alpha)
    d = np.linalg.norm(out - GREEN, axis=2)
    out[d < 26] = GREEN
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
    shutil.copy2(dest, m.COMFY_INPUT / dest.name)
    print(f"  first {dest.name} {cw}x{ch}", flush=True)
    return dest


def build_prompt(stem: str) -> str:
    c = CHARS[stem]
    return f"""Professional film-set chroma key character plate. Uniform pure green screen (#00b140), studio lighting with zero shadows, seamless matte, subject isolated on solid green, ultra sharp 8K look.

FRAMING (NON-NEGOTIABLE — FULL BODY):
- ENTIRE character must be visible: head/hair top AND feet/heels bottom BOTH inside the frame with a small green margin (~2-4%%) above the head and below the feet.
- NEVER crop the head, hair, arms, hands, hips, legs, or feet. No close-up, no thigh-up crop, no bust crop.
- Standing full-length portrait, character large but COMPLETE. Locked tripod. No pan, tilt, zoom, push-in, or drift.

IDENTITY LOCK from first frame (must stay 1:1 — same face, hair, eyes, skin tone, cyber limbs, art style as the sleepwear reference):
{c['lock']}
Body proportions: {c['measure']}.
Character: {c['name']} adult female anime game character.

REMOVE SLEEPWEAR FABRIC ONLY (camisole + shorts). Cyber limbs are NOT clothes.
The first frame wears a white/ivory satin camisole with lace trim and matching satin shorts.
ACTION timeline (~4s):
[0.0-1.3s] Camisole straps and satin fabric dissolve/slide off and disappear completely; lace vanishes. Chest and midriff become bare human skin.
[1.3-2.5s] Satin shorts slide off and disappear completely — no pants, no underwear, no lace on hips. Hips/groin bare skin.
[2.5-4.2s] Settle into natural nude standing IDLE full-body: head-to-toe visible, balanced stance, arms relaxed, calm face matching first frame, soft blink. Subtle breathing only. Framing stays full-body with head and feet margins.

KEEP FOREVER (body parts, never remove):
- ALL mechanical / prosthetic arms, legs, boots, heels, headset, ears, respirator, hair clips exactly as first frame
- Especially mechanical legs from mid-thigh to feet must remain identical metal plating (do NOT turn them into flesh legs)

HARD REJECT CONDITIONS (must not appear in final frames):
- any camisole, tank top, straps, lace, shorts, pants, underwear, towel, coat, ribbon, bow
- any new clothing fabric on torso or hips
- missing / fleshy replacement of cybernetic limbs that existed in first frame
- redesigned face/hair/eye color
- blurry soft focus
- incomplete body: cropped head, missing feet, cut-off limbs, waist-up or thigh-up framing

Keep pure flat #00b140 everywhere behind subject: no floor, no room, no shadow catcher, no text, no UI.
Ultra-detailed sharp 2D/2.5D anime game art matching sleepwear plate style.

Audio: soft room tone only, no speech, no music.
"""


def subject_mask_rgb(im: np.ndarray) -> np.ndarray:
    dist = np.linalg.norm(im.astype(np.float32) - GREEN, axis=2)
    return dist > 52


def subject_mask_rgba(im: np.ndarray) -> np.ndarray:
    if im.shape[2] == 4:
        return im[:, :, 3] > 24
    return subject_mask_rgb(im)


def fullbody_ok(frame: Path, margin_px: int = 8) -> tuple[bool, str]:
    """Reject if head/feet are clipped or body is only a partial crop."""
    im = np.asarray(Image.open(frame).convert("RGB"))
    h, w, _ = im.shape
    mask = subject_mask_rgb(im)
    ys, xs = np.where(mask)
    if len(xs) < 500:
        return False, "empty_subject"
    top, bot = int(ys.min()), int(ys.max())
    left, right = int(xs.min()), int(xs.max())
    bh = bot - top + 1
    bw = right - left + 1
    # must not touch frame edges (clipped)
    if top <= margin_px:
        return False, f"head_clipped top={top}"
    if bot >= h - 1 - margin_px:
        return False, f"feet_clipped bot={bot}/{h}"
    # full-body aspect: tall silhouette
    if bh < h * 0.72:
        return False, f"too_short_h={bh/h:.2f}"
    if bh / max(bw, 1) < 1.55:
        return False, f"not_fullbody_aspect={bh/max(bw,1):.2f}"
    # occupancy: large but not edge-glued
    if bh > h * 0.96:
        return False, f"too_tight_h={bh/h:.2f}"
    return True, f"ok top={top} bot={h-1-bot} h%={bh/h:.2f}"


def cloth_score(frame: Path) -> float:
    """Higher = more leftover sleepwear fabric. Reject if high."""
    im = np.asarray(Image.open(frame).convert("RGB")).astype(np.float32)
    h, w, _ = im.shape
    # torso only (avoid counting white mech legs as fabric)
    zone = im[int(h * 0.26) : int(h * 0.52), int(w * 0.26) : int(w * 0.74)]
    dist = np.linalg.norm(zone - GREEN, axis=2)
    px = zone[dist > 55]
    if len(px) < 80:
        return 1.0
    white = ((px[:, 0] > 200) & (px[:, 1] > 200) & (px[:, 2] > 195) & (np.abs(px[:, 0] - px[:, 1]) < 22)).mean()
    luma = px.mean(axis=1)
    bright = (luma > 210).mean()
    return float(white * 1.8 + bright * 0.5)


def cyber_leg_score(frame: Path) -> float:
    """Higher = more mechanical-looking lower limbs (good when ref has mech legs)."""
    im = np.asarray(Image.open(frame).convert("RGB")).astype(np.float32)
    h, w, _ = im.shape
    zone = im[int(h * 0.58) : int(h * 0.95), int(w * 0.18) : int(w * 0.82)]
    dist = np.linalg.norm(zone - GREEN, axis=2)
    px = zone[dist > 55]
    if len(px) < 80:
        return 0.0
    # hard white/grey plating + gold joint accents (not soft flesh)
    plate = ((px[:, 0] > 170) & (px[:, 1] > 170) & (px[:, 2] > 165) & (np.abs(px[:, 0] - px[:, 1]) < 28)).mean()
    gold = ((px[:, 0] > 140) & (px[:, 1] > 100) & (px[:, 0] > px[:, 2] + 25) & (px[:, 1] > px[:, 2] + 10)).mean()
    flesh = ((px[:, 0] > 160) & (px[:, 1] > 120) & (px[:, 2] > 110) & (px[:, 0] > px[:, 2] + 15) & (px[:, 0] - px[:, 1] > 8)).mean()
    return float(plate * 1.2 + gold * 2.0 - flesh * 0.8)


def rematte_soft(frame: Path, dest: Path) -> Path:
    rgb = np.asarray(Image.open(frame).convert("RGB")).astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    dist = np.linalg.norm(rgb - GREEN, axis=2)
    dom = g - np.maximum(r, b)
    by_dist = 1.0 - np.clip((dist - 24.0) / 48.0, 0, 1)
    by_dom = np.clip((dom - 6.0) / 42.0, 0, 1)
    screen = np.clip(by_dist * by_dom, 0, 1)
    screen = np.where((dist < 30) & (dom > 16), 1.0, screen)
    # soft matte
    alpha = np.clip(1.0 - screen, 0, 1)
    alpha = ndimage.gaussian_filter(alpha, sigma=0.45)
    alpha = np.where(alpha < 0.02, 0.0, alpha)
    alpha = np.where(alpha > 0.985, 1.0, alpha)
    # despill
    edge = ndimage.binary_dilation(alpha < 0.15, iterations=5) & (alpha > 0.02)
    rb = 0.5 * (r + b)
    excess = np.clip(g - rb - 2, 0, 255)
    w = np.zeros_like(alpha)
    w[edge] = np.clip(0.5 + excess[edge] / 55, 0.5, 0.95)
    g2 = g - excess * w
    # kill green wisps
    wisp = (alpha < 0.4) & (dom > 18) & (dist < 80)
    alpha = np.where(wisp, alpha * 0.12, alpha)
    out = np.stack([r, g2, b], axis=2) * alpha[..., None]
    rgba = np.clip(np.dstack([out, alpha * 255]), 0, 255).astype(np.uint8)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(dest, "PNG", optimize=True)
    return dest


_up_model = None
_up_device = None


def load_upscaler():
    global _up_model, _up_device
    if _up_model is not None:
        return _up_model, _up_device
    sys.path.insert(0, str(COMFY))
    import comfy.utils  # noqa: F401

    desc = ModelLoader().load_from_file(str(ESRGAN)).eval()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    desc.to(device)
    if device.type == "cuda" and desc.supports_half:
        desc.half()
    _up_model, _up_device = desc, device
    return _up_model, _up_device


@torch.inference_mode()
def esrgan_rgba(im: Image.Image, outscale: float = 4.0) -> Image.Image:
    sys.path.insert(0, str(COMFY))
    import comfy.utils

    model, device = load_upscaler()
    rgba = np.asarray(im.convert("RGBA"))
    rgb = rgba[:, :, :3].astype(np.float32)
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    gray = 128.0
    comp = rgb * alpha[..., None] + gray * (1.0 - alpha[..., None])
    t = torch.from_numpy(comp).permute(2, 0, 1).unsqueeze(0) / 255.0
    use_half = device.type == "cuda" and model.supports_half
    dtype = torch.float16 if use_half else torch.float32
    img = t.to(device=device, dtype=dtype)
    tile = 384
    while True:
        try:
            up = comfy.utils.tiled_scale(
                img,
                lambda a: model(a.float() if not use_half else a),
                tile_x=tile,
                tile_y=tile,
                overlap=32,
                upscale_amount=model.scale,
                output_device=torch.device("cpu"),
            )
            break
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            tile //= 2
            if tile < 128:
                raise
    up = torch.clamp(up.float(), 0, 1)
    th = max(1, int(round(rgba.shape[0] * outscale)))
    tw = max(1, int(round(rgba.shape[1] * outscale)))
    if up.shape[-2] != th or up.shape[-1] != tw:
        up = F.interpolate(up, size=(th, tw), mode="bicubic", align_corners=False)
        up = torch.clamp(up, 0, 1)
    rgb_up = (up[0].permute(1, 2, 0).numpy() * 255.0).round().astype(np.uint8)
    alpha_up = np.array(
        Image.fromarray((alpha * 255).astype(np.uint8), "L").resize((tw, th), Image.Resampling.LANCZOS)
    )
    # soft fringe cleanup
    a = alpha_up.astype(np.float32) / 255.0
    a = ndimage.gaussian_filter(a, sigma=0.35)
    a = np.where(a < 0.02, 0.0, a)
    rgb_up = (rgb_up.astype(np.float32) * a[..., None]).round().astype(np.uint8)
    return Image.fromarray(np.dstack([rgb_up, (a * 255).astype(np.uint8)]), "RGBA")


def contain_fit(im: Image.Image, ow: int = OW, oh: int = OH, margin: float = 0.03) -> Image.Image:
    """Fit FULL subject into canvas without cropping (transparent pad)."""
    arr = np.asarray(im.convert("RGBA"))
    mask = subject_mask_rgba(arr)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return Image.new("RGBA", (ow, oh), (0, 0, 0, 0))
    pad = 2
    l = max(0, int(xs.min()) - pad)
    t = max(0, int(ys.min()) - pad)
    r = min(im.width, int(xs.max()) + 1 + pad)
    b = min(im.height, int(ys.max()) + 1 + pad)
    crop = im.crop((l, t, r, b))
    max_w, max_h = int(ow * (1 - 2 * margin)), int(oh * (1 - 2 * margin))
    scale = min(max_w / crop.width, max_h / crop.height)
    cw = max(1, int(crop.width * scale + 0.5))
    ch = max(1, int(crop.height * scale + 0.5))
    char = crop.resize((cw, ch), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (ow, oh), (0, 0, 0, 0))
    canvas.alpha_composite(char, ((ow - cw) // 2, (oh - ch) // 2))
    return canvas


def process_one(stem: str, force: bool = False) -> bool:
    meta = CHARS[stem]
    final = OUT / f"{stem}_luoti.png"
    if final.exists() and final.stat().st_size > 50_000 and not force:
        print(f"SKIP {stem} exists", flush=True)
        return True

    print(f"=== {stem} {meta['name']} ===", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    FIRST.mkdir(parents=True, exist_ok=True)

    src = sleepwear_src(stem)
    first = FIRST / f"{stem}_pifu02_gs.png"
    make_greenscreen(src, first)
    ok0, why0 = fullbody_ok(first, margin_px=4)
    print(f"  first_fullbody={ok0} ({why0})", flush=True)
    input_name = m.upload_image(first)
    shutil.copy2(first, m.COMFY_INPUT / input_name)
    prompt = build_prompt(stem)
    out_leaf = f"{stem}_shuiyi_luoti"
    out_prefix = f"video/{out_leaf}"

    ref_cyber = cyber_leg_score(first)
    print(f"  ref_cyber_legs={ref_cyber:.3f}", flush=True)

    best_frame = None
    best_score = 1e9
    best_cloth = 1e9
    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = 2026081610 + (hash(stem) % 30000) + attempt * 131
        print(f"  attempt {attempt}/{MAX_ATTEMPTS} seed={seed}", flush=True)
        t0 = time.time()
        wf = m.build_workflow(input_name, out_prefix, prompt, seed)
        wf["104"]["inputs"]["length"] = LENGTH
        wf["104"]["inputs"]["width"] = FW
        wf["104"]["inputs"]["height"] = FH
        wf["9"]["inputs"]["steps"] = STEPS
        res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
        pid = res["prompt_id"]
        print("  prompt_id", pid, flush=True)
        m.wait_prompt(pid)
        print(f"  h3 done {time.time()-t0:.1f}s", flush=True)
        mp4 = m.find_latest_output(out_leaf, t0)
        if mp4 is None:
            print("  mp4 missing — retry", flush=True)
            continue
        shutil.copy2(mp4, QA / f"{stem}_a{attempt}.mp4")

        attempt_best = None
        attempt_best_s = 1e9
        attempt_cloth = 1e9
        for t in (2.6, 3.0, 3.4, 3.8):
            tmp = QA / f"{stem}_a{attempt}_t{t:.1f}.png"
            subprocess.run(
                [m.FFMPEG, "-y", "-ss", str(t), "-i", str(mp4), "-frames:v", "1", "-update", "1", "-q:v", "2", str(tmp)],
                check=True,
                capture_output=True,
            )
            fb_ok, fb_why = fullbody_ok(tmp)
            cloth = cloth_score(tmp)
            cyber = cyber_leg_score(tmp)
            score = cloth
            if ref_cyber > 0.25:
                score += max(0.0, 0.35 - cyber) * 2.0
            if not fb_ok:
                score += 2.0  # incomplete body → must regenerate
            print(
                f"    {tmp.name} fullbody={fb_ok}({fb_why}) cloth={cloth:.3f} cyber={cyber:.3f} score={score:.3f}",
                flush=True,
            )
            if score < attempt_best_s:
                attempt_best_s = score
                attempt_best = tmp
                attempt_cloth = cloth

        if attempt_best is not None and attempt_best_s < best_score:
            best_score = attempt_best_s
            best_frame = attempt_best
            best_cloth = attempt_cloth

        fb_ok, fb_why = fullbody_ok(attempt_best) if attempt_best else (False, "none")
        cyber_ok = ref_cyber <= 0.25 or cyber_leg_score(attempt_best) >= 0.20
        pass_ok = fb_ok and attempt_cloth <= 0.12 and cyber_ok
        if pass_ok:
            print(
                f"  PASS fullbody cloth={attempt_cloth:.3f} cyber={cyber_leg_score(attempt_best):.3f}",
                flush=True,
            )
            break
        print(f"  REJECT fullbody={fb_ok}({fb_why}) score={attempt_best_s:.3f} — regenerate", flush=True)

    if best_frame is None:
        print(f"FAIL {stem}: no frame", flush=True)
        return False

    fb_ok, fb_why = fullbody_ok(best_frame)
    if not fb_ok:
        print(f"FAIL {stem}: incomplete body after retries ({fb_why})", flush=True)
        return False
    if best_cloth > 0.22 or (ref_cyber > 0.25 and cyber_leg_score(best_frame) < 0.12):
        print(
            f"WARN {stem}: QA weak cloth={best_cloth:.3f} cyber={cyber_leg_score(best_frame):.3f}",
            flush=True,
        )

    keyed = QA / f"{stem}_keyed.png"
    rematte_soft(best_frame, keyed)
    print("  esrgan 4x…", flush=True)
    up = esrgan_rgba(Image.open(keyed), outscale=4.0)
    out = contain_fit(up, OW, OH, margin=0.03)
    # verify final plate still full-body
    tmp_chk = QA / f"{stem}_final_chk.png"
    arr = np.asarray(out).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3] * alpha + np.broadcast_to(GREEN, arr[:, :, :3].shape) * (1.0 - alpha)
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").save(tmp_chk)
    fb_ok, fb_why = fullbody_ok(tmp_chk, margin_px=12)
    if not fb_ok:
        print(f"FAIL {stem}: final plate incomplete ({fb_why})", flush=True)
        return False
    out.save(final, "PNG", optimize=True)
    print(
        f"  OK {final.name} {out.size} fullbody cloth={best_cloth:.3f} cyber={cyber_leg_score(best_frame):.3f}",
        flush=True,
    )
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    stems = sorted(CHARS) if args.stem == "all" else [args.stem]
    ok = fail = 0
    for stem in stems:
        if stem not in CHARS:
            raise SystemExit(f"unknown {stem}")
        try:
            if process_one(stem, force=args.force):
                ok += 1
            else:
                fail += 1
        except Exception as e:
            fail += 1
            print(f"ERROR {stem}: {e}", flush=True)
    print(f"DONE ok={ok} fail={fail} out={OUT}", flush=True)


if __name__ == "__main__":
    main()
