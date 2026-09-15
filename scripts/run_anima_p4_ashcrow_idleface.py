"""Ashcrow P4 from clean idle (no tentacles) + open-eye face paste + robot + tiny inpaint."""
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

POS = """IDENTITY HARD LOCK: exact same girl as identity plate — Ashcrow Mio / SR01_2.
ash-gold high ponytail, white wing hair clips, ice-blue OPEN eyes, pale skin, white lace discipline bodysuit,
white-silver cyber legs mid-thigh with gold joints. Do NOT redesign face/hair/outfit/legs.

COMPOSITION HARD RULE: the scrap robot STANDS on the ground BETWEEN her thighs at pelvis height.
She is NOT holding the robot. Her own hands are NOT clasped in front.
Robot dome head + twin red eyes + weathered off-white metal, much shorter than the girl, fully visible.

P4 fill in masked zones: robot BOTH three-finger hands reach UP pinching nipples through lace;
main mechanical pipe from robot inserted vagina through lace crotch; thinner secondary tube in anus;
oil/hydraulic fluid stains; trembling thighs; biting lip; shame blush.
Chroma key pure green #00b140. NO tentacles. Premium anime game skin plate quality matching official SR01_2."""

NEG = (
    "worst quality, blurry, redesign face, tentacles, octopus, closed eyes, black background, "
    "photorealistic, missing robot, grey blob, censor bar, watermark, different character, "
    "holding robot in hands, hugging robot, clasped hands, carrying robot"
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


def paste_open_eyes(idle: Image.Image, openeye: Image.Image) -> Image.Image:
    """Feather-paste open-eye face upper region onto idle body."""
    out = idle.copy()
    w, h = GEN
    # upper face band
    box = (int(w * 0.22), int(h * 0.04), int(w * 0.78), int(h * 0.28))
    face = openeye.crop(box)
    mask = Image.new("L", face.size, 0)
    d = ImageDraw.Draw(mask)
    fw, fh = face.size
    d.ellipse([int(fw * 0.05), int(fh * 0.05), int(fw * 0.95), int(fh * 0.95)], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(8))
    out.paste(face, (box[0], box[1]), mask)
    return out


def wf_inpaint(base, mask, ctrl_id, ctrl_cmd, seed, denoise, prefix, id_s=0.97, cmd_s=0.58):
    # VAEEncode + SetLatentNoiseMask：避免 VAEEncodeForInpaint 挖空成灰糊块
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
                "strength": 0.70,
                "start_percent": 0.0,
                "end_percent": 0.70,
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
                "end_percent": 0.65,
            },
        },
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["2", 0]}},
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["51", 0],
                "seed": seed,
                "steps": 36,
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
    """只在躯干两侧查触手线圈，避开义体关节假阳性。"""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(a - g, axis=2)
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    dark = (dist > 35) & (lum < 95) & (sat < 55) & (a[:, :, 1] < 120)
    h, w = a.shape[:2]
    # 左右边缘条带（触手常绕侧）
    left = dark[int(h * 0.25) : int(h * 0.75), 0 : int(w * 0.22)]
    right = dark[int(h * 0.25) : int(h * 0.75), int(w * 0.78) : w]
    return float(left.mean() + right.mean()) / 2 > 0.02


def robot_present(path: Path) -> bool:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    patch = a[int(h * 0.48) : int(h * 0.82), int(w * 0.28) : int(w * 0.72)]
    r, g, b = patch[:, :, 0], patch[:, :, 1], patch[:, :, 2]
    redish = (r > 90) & (r > g * 1.25) & (r > b * 1.25)
    return float(redish.mean()) > 0.0015


def blob_fail(path: Path) -> bool:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im)
    h, w = a.shape[:2]
    patch = a[int(h * 0.45) : int(h * 0.82), int(w * 0.22) : int(w * 0.78)]
    gray = patch.mean(axis=2)
    edge = np.abs(np.diff(gray, axis=1)).mean() + np.abs(np.diff(gray, axis=0)).mean()
    return float(edge) < 10.0 or float(np.std(gray)) < 12.0


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
    work = WORK / f"SR01_2_P4-A_idleface_{tag}.png"
    canvas.save(work)
    canvas.save(DESKTOP_OUT / work.name)
    print(f"  saved {work}", flush=True)
    return work


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, nargs="*", default=[98601, 98617])
    ap.add_argument("--denoise", type=float, nargs="*", default=[0.42, 0.52])
    ap.add_argument("--clip-pass", type=float, default=0.82)
    ap.add_argument("--clip-official", type=float, default=0.70)
    args = ap.parse_args()

    api("/system_stats")
    WORK.mkdir(parents=True, exist_ok=True)

    idle_src = QA / "SR01_2_tiaojiao_f0.png"
    if not idle_src.exists():
        idle_src = QA / "frames_SR01_2_tiaojiao_t05.png"
    open_src = QA / "ref_body_openeye_green.png"
    if not open_src.exists():
        open_src = QA / "frames_SR01_2_tiaojiao_1_t10.png"

    idle = fit_green(idle_src)
    openeye = fit_green(open_src)
    face_clear = paste_open_eyes(idle, openeye)
    ctrl_id = face_clear.copy()
    # 交握双手改成蕾丝填色（禁止绿洞，否则中段融体）
    w, h = GEN
    ca = np.asarray(ctrl_id).astype(np.float32)
    y0, y1 = int(h * 0.38), int(h * 0.50)
    x0, x1 = int(w * 0.36), int(w * 0.64)
    sample = ca[int(h * 0.30) : int(h * 0.36), int(w * 0.40) : int(w * 0.60)]
    fill = sample.reshape(-1, 3).mean(axis=0)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    cy, cx = (y0 + y1) / 2.0, (x0 + x1) / 2.0
    ry_e, rx_e = max((y1 - y0) / 2.0, 1.0), max((x1 - x0) / 2.0, 1.0)
    ell = ((yy - cy) / ry_e) ** 2 + ((xx - cx) / rx_e) ** 2 <= 1.0
    patch = ca[y0:y1, x0:x1]
    # soft feather toward lace fill
    soft = np.clip(1.0 - (((yy - cy) / ry_e) ** 2 + ((xx - cx) / rx_e) ** 2), 0, 1)
    soft = soft[..., None]
    patch = patch * (1.0 - soft * ell[..., None]) + fill * (soft * ell[..., None])
    ca[y0:y1, x0:x1] = patch
    ctrl_id = Image.fromarray(np.clip(ca, 0, 255).astype(np.uint8))
    # 脸区贴回清晰睁眼版
    face_mask = Image.new("L", GEN, 0)
    ImageDraw.Draw(face_mask).ellipse(
        [int(w * 0.20), int(h * 0.02), int(w * 0.80), int(h * 0.32)], fill=255
    )
    face_mask = face_mask.filter(ImageFilter.GaussianBlur(10))
    ctrl_id = Image.composite(face_clear, ctrl_id, face_mask)
    ctrl_id.save(WORK / "prep_ctrl_id_idleface.png")

    front = zhujue_front()
    ctrl_cmd = fit_green(front)
    base = ctrl_id.copy()
    robot = front.copy()
    # 更大更高：双手才够到胸口掐乳
    robot.thumbnail((int(GEN[0] * 0.38), int(GEN[1] * 0.36)), Image.Resampling.LANCZOS)
    g = np.array(GREEN, dtype=np.float32)
    ra = np.asarray(robot).astype(np.float32)
    rdist = np.linalg.norm(ra - g, axis=2)
    rmask_arr = (rdist > 28).astype(np.uint8) * 255
    rmask = Image.fromarray(rmask_arr, "L").filter(ImageFilter.GaussianBlur(0.8))
    rx = (GEN[0] - robot.size[0]) // 2
    ry = int(GEN[1] * 0.40)
    base.paste(robot, (rx, ry), rmask)
    # 底板画「上伸机械臂」结构提示，降低融体概率
    hint = ImageDraw.Draw(base)
    arm_col = (170, 165, 155)
    cx_mid = GEN[0] // 2
    hint.line([(cx_mid - int(w * 0.08), ry + int(robot.size[1] * 0.28)),
               (cx_mid - int(w * 0.10), int(h * 0.38))], fill=arm_col, width=10)
    hint.line([(cx_mid + int(w * 0.08), ry + int(robot.size[1] * 0.28)),
               (cx_mid + int(w * 0.10), int(h * 0.38))], fill=arm_col, width=10)
    hint.ellipse([cx_mid - int(w * 0.14), int(h * 0.355), cx_mid - int(w * 0.06), int(h * 0.395)], fill=arm_col)
    hint.ellipse([cx_mid + int(w * 0.06), int(h * 0.355), cx_mid + int(w * 0.14), int(h * 0.395)], fill=arm_col)

    mm = Image.new("L", GEN, 0)
    d = ImageDraw.Draw(mm)
    w, h = GEN
    # 窄胸带：只改掐乳手
    d.ellipse([int(w * 0.34), int(h * 0.34), int(w * 0.66), int(h * 0.43)], fill=255)
    # 两侧上伸臂走廊
    d.ellipse([int(w * 0.30), int(h * 0.40), int(w * 0.42), int(h * 0.52)], fill=200)
    d.ellipse([int(w * 0.58), int(h * 0.40), int(w * 0.70), int(h * 0.52)], fill=200)
    # 胯缝双管
    d.ellipse([int(w * 0.40), int(h * 0.50), int(w * 0.60), int(h * 0.60)], fill=230)
    rob_full = np.zeros((h, w), dtype=np.uint8)
    rh, rw = rmask_arr.shape
    rob_full[ry : ry + rh, rx : rx + rw] = rmask_arr
    # 保护机器人躯干/腿，允许改肩臂
    rob_prot = np.zeros_like(rob_full, dtype=bool)
    y_prot = ry + int(rh * 0.35)
    rob_prot[y_prot : ry + rh, rx : rx + rw] = rob_full[y_prot : ry + rh, rx : rx + rw] > 0
    m_arr = np.array(mm, dtype=np.uint8, copy=True)
    m_arr[rob_prot] = 0
    mm = Image.fromarray(m_arr, "L")
    d = ImageDraw.Draw(mm)
    d.ellipse([int(w * 0.16), 0, int(w * 0.84), int(h * 0.33)], fill=0)
    mm = mm.filter(ImageFilter.GaussianBlur(5))
    mask = Image.merge("RGB", (mm, mm, mm))

    base.save(WORK / "prep_base_idleface.png")
    mask.save(WORK / "prep_mask_idleface.png")
    ctrl_cmd.save(WORK / "prep_ctrl_cmd.png")

    b = stage(base, "ashcrow_p4_base.png")
    m = stage(mask, "ashcrow_p4_mask.png")
    c_id = stage(ctrl_id, "ashcrow_p4_ctrl_id.png")
    c_cmd = stage(ctrl_cmd, "ashcrow_p4_ctrl_cmd.png")
    ref_off = fit_green(REF_PORTRAIT)

    passed = []
    scores = []
    for den in args.denoise:
        for seed in args.seeds:
            tag = f"d{int(den * 100)}_s{seed}"
            print(f"\n=== {tag} ===", flush=True)
            raw = run(
                wf_inpaint(b, m, c_id, c_cmd, seed, den, f"ashcrow_p4_idle_{tag}"),
                f"ashcrow_p4_idle_{tag}",
            )
            dest = deliver(raw, tag)
            tent = tentacle_left(dest)
            rob = robot_present(dest)
            blob = blob_fail(dest)
            sim_id = clip_face_sim(ctrl_id, Image.open(dest))
            sim_off = clip_face_sim(ref_off, Image.open(dest))
            print(
                f"  CLIP id={sim_id:.4f} off={sim_off:.4f} tent={tent} robot={rob} blob={blob}",
                flush=True,
            )
            scores.append(
                {
                    "tag": tag,
                    "sim_id": sim_id,
                    "sim_off": sim_off,
                    "tent": tent,
                    "robot": rob,
                    "blob": blob,
                    "path": str(dest),
                }
            )
            if (
                (not tent)
                and (not blob)
                and rob
                and sim_id >= args.clip_pass
                and sim_off >= args.clip_official
            ):
                passed.append((sim_id, sim_off, dest))

    (WORK / "qa_idleface.json").write_text(json.dumps(scores, indent=2), encoding="utf-8")
    if not passed:
        print("FAIL: no candidate passed self-QA", flush=True)
        raise SystemExit(2)
    # 仅写报告；P4 互动需肉眼确认后再拷桌面（避免假 PASS）
    print("NUMERIC GATE OK — awaiting visual P4 QA before desktop PASS copy", flush=True)
    for i, (sid, soff, p) in enumerate(passed[:3]):
        print(f"candidate[{i+1}] id={sid:.3f} off={soff:.3f} @ {p}", flush=True)
    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
