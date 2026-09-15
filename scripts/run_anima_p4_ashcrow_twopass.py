"""Two-pass Ashcrow P4:
  A) remove tentacles only (identity lock)
  B) paste robot + tiny P4 interaction inpaint
Self-QA before any PASS report.
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
import uuid
from pathlib import Path

import numpy as np
import urllib.request
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp" / "cmd_discipline_p4_lllite"
QA = ROOT / "tmp" / "cmd_discipline_p4_qa"
DESKTOP = Path.home() / "Desktop"
DESKTOP_OUT = DESKTOP / "cmd_discipline_p4_lllite"
COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")

GEN = (864, 1536)
OUT_WH = (1080, 1920)
GREEN = (0, 177, 64)
REF_PORTRAIT = ROOT / "tex" / "juese" / "SR01_2.png"

POS_A = """IDENTITY HARD LOCK: exact same girl as identity plate — Ashcrow Mio SR01_2.
ash-gold high ponytail, white wing hair clips, ice-blue OPEN eyes, pale skin, white lace discipline bodysuit,
white-silver cyber legs from mid-thigh with gold joints. Same face/hair/outfit/legs as plate.
REMOVE ALL mechanical tentacles and claws completely — erase them, fill with pure green #00b140 background or clean body silhouette.
Keep full-body vertical 9:16, chroma key pure green #00b140, no black backdrop.
Do NOT redesign the girl. No tentacles. No octopus. No second character."""

POS_B = """IDENTITY HARD LOCK: exact same girl as identity plate — Ashcrow Mio SR01_2 lace discipline suit.
Keep face, hair, wing clips, eyes, lace bodysuit, cyber legs unchanged.
ONE small scrap robot (dome head, twin red eyes, weathered off-white) between her thighs at pelvis, fully visible.
P4: robot main mechanical pipe through lace crotch, thinner tube in anus, both three-finger hands pinching nipples through lace,
oil stains, trembling, biting lip, shame blush. Green screen #00b140. NO tentacles. Sharp anime game skin quality."""

NEG = (
    "worst quality, blurry, redesign face, tentacles, octopus, mechanical tentacles, closed eyes, "
    "black background, photorealistic, missing robot, grey blob, censor bar, watermark"
)


def api(path: str, data: dict | None = None):
    if data is None:
        req = urllib.request.Request(f"{COMFY}{path}")
    else:
        body = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{COMFY}{path}", data=body, headers={"Content-Type": "application/json"}
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


def punch_bg(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (*GREEN, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        im = bg.convert("RGB")
    else:
        im = im.convert("RGB")
    a = np.asarray(im).astype(np.float32)
    a[a.max(axis=2) < 22] = np.array(GREEN, dtype=np.float32)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def fit_green(src: Path | Image.Image, size=GEN) -> Image.Image:
    im = src if isinstance(src, Image.Image) else Image.open(src)
    im = punch_bg(im)
    tw, th = size
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def stage(im: Image.Image, name: str) -> str:
    COMFY_IN.mkdir(parents=True, exist_ok=True)
    im.save(COMFY_IN / name, "PNG")
    return name


def edge_green(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    g = np.array(GREEN, dtype=np.float32)
    a[np.linalg.norm(a - g, axis=2) < 42] = g
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(
        ImageFilter.UnsharpMask(radius=1.2, percent=90, threshold=2)
    )


def find_out(prefix: str, t0: float) -> Path:
    cands = [p for p in COMFY_OUT.glob(f"{prefix}_*.png") if p.stat().st_mtime >= t0 - 2]
    if not cands:
        raise RuntimeError(f"no out {prefix}")
    return max(cands, key=lambda p: p.stat().st_mtime)


def run(wf: dict, prefix: str) -> Path:
    t0 = time.time()
    pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
    print(f"  queued {prefix} {pid}", flush=True)
    wait(pid)
    return find_out(prefix, t0)


def tentacle_mask(ctrl: Image.Image) -> Image.Image:
    a = np.asarray(ctrl).astype(np.float32)
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(a - g, axis=2)
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    dark = (dist > 28) & (lum < 115) & (sat < 75) & (a[:, :, 1] < 145)
    glow = (dist > 28) & (a[:, :, 1] > a[:, :, 0] + 22) & (a[:, :, 1] > a[:, :, 2] + 12) & (lum < 170) & (lum > 40)
    claw = (dist > 45) & (lum > 55) & (lum < 140) & (sat < 40) & (a[:, :, 0] < 140)
    m = (dark | glow | claw)
    # 保护白蕾丝 / 白皮 / 白义体（高亮）
    protect = (lum > 150) | ((a[:, :, 0] > 170) & (a[:, :, 1] > 150) & (a[:, :, 2] > 145))
    # 保护肤色
    skin = (a[:, :, 0] > 150) & (a[:, :, 1] > 110) & (a[:, :, 2] > 100) & (a[:, :, 0] > a[:, :, 2]) & (sat < 90)
    m = m & (~protect) & (~skin)
    im = Image.fromarray((m.astype(np.uint8) * 255), "L")
    im = im.filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.GaussianBlur(9))
    # 再次抠掉高亮保护区（膨胀后别吃身体）
    arr = np.asarray(im).astype(np.float32)
    arr[protect | skin] = 0
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "L")
    w, h = GEN
    d = ImageDraw.Draw(im)
    d.ellipse([int(w * 0.16), 0, int(w * 0.84), int(h * 0.34)], fill=0)
    return im


def zhujue_front() -> Image.Image:
    zh = Image.open(ROOT / "tex" / "zhujue.png").convert("RGB")
    w, h = zh.size
    front = zh.crop((0, 0, int(w * 0.34), h))
    a = np.asarray(front).astype(np.float32)
    white = (a.min(axis=2) > 230) & ((a.max(axis=2) - a.min(axis=2)) < 18)
    a[white] = np.array(GREEN, dtype=np.float32)
    front = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(np.asarray(front).astype(np.float32) - g, axis=2)
    ys, xs = np.where(dist > 28)
    return front.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def wf_inpaint(
    base: str,
    mask: str,
    ctrl_id: str,
    ctrl_cmd: str | None,
    seed: int,
    denoise: float,
    prefix: str,
    pos: str,
    id_strength: float = 0.96,
    cmd_strength: float = 0.0,
) -> dict:
    wf = {
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
        "12": {"class_type": "ImageToMask", "inputs": {"image": ["11", 0], "channel": "red"}},
        "13": {
            "class_type": "VAEEncodeForInpaint",
            "inputs": {
                "pixels": ["10", 0],
                "vae": ["3", 0],
                "mask": ["12", 0],
                "grow_mask_by": 2,
            },
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
                "strength": id_strength,
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
                "strength": 0.70,
                "start_percent": 0.0,
                "end_percent": 0.70,
            },
        },
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["42", 0],
                "seed": seed,
                "steps": 36,
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
    if ctrl_cmd and cmd_strength > 0:
        wf["21"] = {"class_type": "LoadImage", "inputs": {"image": ctrl_cmd}}
        wf["50"] = {
            "class_type": "ModelPatchLoader",
            "inputs": {"name": "anima-lllite-any-test-like-v2.safetensors"},
        }
        wf["51"] = {
            "class_type": "AnimaLLLiteApply",
            "inputs": {
                "model": ["42", 0],
                "model_patch": ["50", 0],
                "image": ["21", 0],
                "strength": cmd_strength,
                "start_percent": 0.0,
                "end_percent": 0.65,
            },
        }
        wf["7"]["inputs"]["model"] = ["51", 0]
    return wf


_CLIP = {"model": None, "processor": None}


def face_crop(im: Image.Image) -> Image.Image:
    w, h = im.size
    return im.crop((int(w * 0.22), int(h * 0.02), int(w * 0.78), int(h * 0.34))).resize(
        (224, 224), Image.Resampling.LANCZOS
    )


def clip_face_sim(ref: Image.Image, gen: Image.Image) -> float:
    import torch
    from transformers import CLIPModel, CLIPProcessor

    if _CLIP["model"] is None:
        mid = "openai/clip-vit-base-patch32"
        _CLIP["processor"] = CLIPProcessor.from_pretrained(mid)
        _CLIP["model"] = CLIPModel.from_pretrained(mid).to("cpu").eval()
    processor, model = _CLIP["processor"], _CLIP["model"]
    pixel = processor(
        images=[face_crop(ref.convert("RGB")), face_crop(gen.convert("RGB"))],
        return_tensors="pt",
    )["pixel_values"]
    with torch.no_grad():
        vis = model.vision_model(pixel_values=pixel)
        feats = model.visual_projection(vis.pooler_output)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        return float((feats[0] * feats[1]).sum().item())


def tentacle_left(path: Path) -> bool:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(a - g, axis=2)
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    dark = (dist > 35) & (lum < 100) & (sat < 65) & (a[:, :, 1] < 130)
    # ignore feet cyber joints roughly by y range mid
    h, w = a.shape[:2]
    region = dark[int(h * 0.20) : int(h * 0.85), :]
    return float(region.mean()) > 0.012


def robot_present(path: Path) -> bool:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    patch = a[int(h * 0.48) : int(h * 0.82), int(w * 0.28) : int(w * 0.72)]
    r, g, b = patch[:, :, 0], patch[:, :, 1], patch[:, :, 2]
    redish = (r > 90) & (r > g * 1.25) & (r > b * 1.25)
    return float(redish.mean()) > 0.0015


def deliver(src: Path, tag: str) -> Path:
    im = edge_green(Image.open(src).convert("RGB"))
    tw, th = OUT_WH
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", OUT_WH, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    canvas = edge_green(canvas)
    WORK.mkdir(parents=True, exist_ok=True)
    DESKTOP_OUT.mkdir(parents=True, exist_ok=True)
    work = WORK / f"SR01_2_P4-A_twopass_{tag}.png"
    canvas.save(work)
    canvas.save(DESKTOP_OUT / work.name)
    print(f"  saved {work}", flush=True)
    return work


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-a", type=int, default=97001)
    ap.add_argument("--seed-b", type=int, default=97017)
    ap.add_argument("--denoise-a", type=float, default=0.72)
    ap.add_argument("--denoise-b", type=float, default=0.40)
    ap.add_argument("--clip-pass", type=float, default=0.82)
    ap.add_argument("--clip-official", type=float, default=0.70)
    args = ap.parse_args()

    api("/system_stats")
    WORK.mkdir(parents=True, exist_ok=True)

    body = QA / "ref_body_openeye_green.png"
    if not body.exists():
        body = QA / "frames_SR01_2_tiaojiao_1_t10.png"
    ctrl_id = fit_green(body)
    ctrl_id.save(WORK / "prep_ctrl_id.png")

    # ---- Pass A: de-tentacle ----
    m_a = tentacle_mask(ctrl_id)
    # 控制图硬擦触手，避免 LLLite 把触手再画回来
    ctrl_clean = ctrl_id.copy()
    ca = np.asarray(ctrl_clean).astype(np.float32)
    mexp = np.asarray(m_a.filter(ImageFilter.MaxFilter(15))) > 40
    ca[mexp] = np.array(GREEN, dtype=np.float32)
    ctrl_clean = Image.fromarray(np.clip(ca, 0, 255).astype(np.uint8))
    ctrl_clean.save(WORK / "prep_ctrl_id_detent.png")
    c_id = stage(ctrl_clean, "ashcrow_p4_ctrl_id.png")

    mask_a = Image.merge("RGB", (m_a, m_a, m_a))
    mask_a.save(WORK / "prep_mask_A.png")
    # base 也把触手区预填绿，减轻 inpaint 难度
    base_a = ctrl_id.copy()
    ba = np.asarray(base_a).astype(np.float32)
    ba[mexp] = np.array(GREEN, dtype=np.float32)
    base_a = Image.fromarray(np.clip(ba, 0, 255).astype(np.uint8))
    base_a.save(WORK / "prep_base_A.png")
    b_a = stage(base_a, "ashcrow_p4_base_A.png")
    m_a_name = stage(mask_a, "ashcrow_p4_mask_A.png")

    print(f"\n=== PASS A de-tentacle d={args.denoise_a} ===", flush=True)
    raw_a = run(
        wf_inpaint(
            b_a,
            m_a_name,
            c_id,
            None,
            seed=args.seed_a,
            denoise=args.denoise_a,
            prefix="ashcrow_p4_A",
            pos=POS_A,
            cmd_strength=0.0,
        ),
        "ashcrow_p4_A",
    )
    clean = edge_green(Image.open(raw_a).convert("RGB"))
    # re-fit to GEN
    clean = fit_green(clean)
    clean.save(WORK / "passA_clean.png")
    tent_a = tentacle_left(WORK / "passA_clean.png")
    sim_a = clip_face_sim(ctrl_id, clean)
    print(f"  PASS A CLIP={sim_a:.4f} tentacles_left={tent_a}", flush=True)
    if tent_a or sim_a < args.clip_pass:
        print("FAIL pass A — tentacles remain or identity drift", flush=True)
        raise SystemExit(2)

    # ---- Pass B: robot + P4 tiny masks ----
    front = zhujue_front()
    ctrl_cmd = fit_green(front)
    c_cmd = stage(ctrl_cmd, "ashcrow_p4_ctrl_cmd.png")
    base_b = clean.copy()
    robot = front.copy()
    robot.thumbnail((int(GEN[0] * 0.30), int(GEN[1] * 0.28)), Image.Resampling.LANCZOS)
    g = np.array(GREEN, dtype=np.float32)
    ra = np.asarray(robot).astype(np.float32)
    rdist = np.linalg.norm(ra - g, axis=2)
    rmask_arr = (rdist > 28).astype(np.uint8) * 255
    rmask = Image.fromarray(rmask_arr, "L").filter(ImageFilter.GaussianBlur(0.8))
    rx = (GEN[0] - robot.size[0]) // 2
    ry = int(GEN[1] * 0.50)
    base_b.paste(robot, (rx, ry), rmask)

    mm = Image.new("L", GEN, 0)
    d = ImageDraw.Draw(mm)
    w, h = GEN
    d.ellipse([int(w * 0.38), int(h * 0.36), int(w * 0.62), int(h * 0.45)], fill=255)
    d.ellipse([int(w * 0.42), int(h * 0.54), int(w * 0.58), int(h * 0.64)], fill=200)
    # protect robot
    rob_full = np.zeros((h, w), dtype=np.uint8)
    rh, rw = rmask_arr.shape
    rob_full[ry : ry + rh, rx : rx + rw] = rmask_arr
    rob_prot = np.asarray(Image.fromarray(rob_full, "L").filter(ImageFilter.MaxFilter(9))) > 0
    m_arr = np.array(mm, dtype=np.uint8, copy=True)
    m_arr[rob_prot] = 0
    mm = Image.fromarray(m_arr, "L")
    d = ImageDraw.Draw(mm)
    d.ellipse([int(w * 0.16), 0, int(w * 0.84), int(h * 0.36)], fill=0)
    mm = mm.filter(ImageFilter.GaussianBlur(6))
    mask_b = Image.merge("RGB", (mm, mm, mm))
    base_b.save(WORK / "prep_base_B.png")
    mask_b.save(WORK / "prep_mask_B.png")
    b_b = stage(base_b, "ashcrow_p4_base_B.png")
    m_b = stage(mask_b, "ashcrow_p4_mask_B.png")
    # identity ctrl = clean pass A (same outfit, no tentacles)
    c_id2 = stage(clean, "ashcrow_p4_ctrl_id_clean.png")

    print(f"\n=== PASS B P4 fill d={args.denoise_b} ===", flush=True)
    raw_b = run(
        wf_inpaint(
            b_b,
            m_b,
            c_id2,
            c_cmd,
            seed=args.seed_b,
            denoise=args.denoise_b,
            prefix="ashcrow_p4_B",
            pos=POS_B,
            cmd_strength=0.50,
        ),
        "ashcrow_p4_B",
    )
    dest = deliver(raw_b, f"d{int(args.denoise_b*100)}_s{args.seed_b}")
    ref_off = fit_green(REF_PORTRAIT)
    sim_id = clip_face_sim(clean, Image.open(dest))
    sim_off = clip_face_sim(ref_off, Image.open(dest))
    tent_b = tentacle_left(dest)
    rob = robot_present(dest)
    print(
        f"  PASS B CLIP tiaojiao={sim_id:.4f} official={sim_off:.4f} "
        f"tentacles={tent_b} robot={rob}",
        flush=True,
    )

    report = {
        "passA": {"clip": sim_a, "tentacles_left": tent_a},
        "passB": {
            "clip_tiaojiao": sim_id,
            "clip_official": sim_off,
            "tentacles": tent_b,
            "robot": rob,
            "path": str(dest),
        },
    }
    (WORK / "qa_twopass.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    ok = (
        (not tent_b)
        and rob
        and sim_id >= args.clip_pass
        and sim_off >= args.clip_official
    )
    if not ok:
        print("FAIL: visual/identity gate not met — will not copy PASS to desktop", flush=True)
        raise SystemExit(2)

    short = DESKTOP / f"SR01_2_P4-A_PASS_id{sim_id:.3f}_off{sim_off:.3f}.png"
    shutil.copy2(dest, short)
    print(f"PASS -> {short}", flush=True)
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
