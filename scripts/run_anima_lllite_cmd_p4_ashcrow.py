"""
苍羽·澪 P4（指挥官亲自调教）— Anima aesthetic + LLLite 身份锁定。
与既有皮肤同管线：底板 inpaint + identity LLLite + lineart，脸/发不重画。

自检：CLIP 脸区相似度 vs 原皮，未过阈值不写「通过」。
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
DESKTOP = Path.home() / "Desktop"
DESKTOP_OUT = DESKTOP / "cmd_discipline_p4_lllite"
COMFY = "http://127.0.0.1:8188"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUT = Path(r"E:\MiniMaxH3\ComfyUI\output")

GEN = (864, 1536)
OUT_WH = (1080, 1920)
GREEN = (0, 177, 64)

REF_PORTRAIT = ROOT / "tex" / "juese" / "SR01_2.png"
REF_TIAO = WORK.parents[0] / "cmd_discipline_p4_test" / "SR01_2_tiaojiao_ref.png"
REF_CMD = WORK.parents[0] / "cmd_discipline_p4_test" / "commander_zhujue_ref.png"
PLATE_EXISTING = WORK.parents[0] / "cmd_discipline_p4_test" / "SR01_2_P4_i2i_plate.png"

# 与原皮同级验收
CLIP_ID_PASS = 0.86  # vs 调教皮底板（同脸同装）
CLIP_OFFICIAL_PASS = 0.74  # vs 正式立绘 SR01_2.png

POS = """IDENTITY HARD LOCK: exact same girl as the identity plate — Ashcrow Mio / SR01_2 苍羽·澪.
ash-gold / light ash-blonde high ponytail with straight bangs, white mechanical wing hair clips on both sides of head,
ice-blue OPEN eyes, pale fair skin, serious cold beauty face, same face proportions and lineart as official skin.
white-silver cybernetic mechanical legs from mid-thigh with gold/grey joints, same body proportions.
Do NOT redesign face, hair, eyes, wing clips, cyber legs, or art style.

Outfit: white semi-sheer lace discipline bodysuit (tiaojiao lace), full-body vertical 9:16.
Chroma key pure green screen #00b140, seamless matte, no floor shadow on background, no black backdrop.

REMOVE all tentacles completely. Replace with ONE small scrap robot matching commander reference —
dome head, twin red eyes, weathered off-white metal, much shorter than the girl,
fully visible between her thighs / pressed to her pelvis (not hands-only, not three-view sheet).

SCENE P4 FILL: robot main mechanical pipe inserted vagina through lace crotch, thinner secondary tube in anus,
both robot three-finger hands pinching nipples through lace, oil/hydraulic fluid leak on both,
trembling thighs, arched spine, biting lip, overwhelmed shame blush, eyes open.
NO tentacles.

2D anime game character illustration, ultra sharp lineart, premium skin plate quality matching official SR01_2."""

NEG = (
    "worst quality, lowres, blurry, redesign face, short messy hair, silver-lavender hair, purple hair, "
    "closed eyes, sleeping face, wrong face, different character, photorealistic, shiny skin pores, "
    "watermark, text, cropped feet, missing robot, tentacles, octopus, mechanical tentacles, "
    "three-view character sheet, multiple robots, duplicate character, letterbox, white border, "
    "black background, split collage"
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


def punch_bg_to_green(im: Image.Image) -> Image.Image:
    """黑底 / 近黑底 / 透明 → 纯绿幕，与既有皮肤进包一致。"""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (*GREEN, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        im = bg.convert("RGB")
    else:
        im = im.convert("RGB")
    a = np.asarray(im).astype(np.float32)
    dark = a.max(axis=2) < 22
    a[dark] = np.array(GREEN, dtype=np.float32)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def fit_green(src: Path | Image.Image, size=GEN) -> Image.Image:
    im = src if isinstance(src, Image.Image) else Image.open(src)
    im = punch_bg_to_green(im)
    tw, th = size
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def p4_mask(size=GEN) -> Image.Image:
    """只改胸手与胯间互动；脸/发/肩/义体腿轮廓尽量锁定。"""
    w, h = size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    # 乳首双手区（较小）
    d.ellipse([int(w * 0.32), int(h * 0.34), int(w * 0.68), int(h * 0.48)], fill=255)
    # 胯间插入 + 机器人贴身
    d.ellipse([int(w * 0.30), int(h * 0.52), int(w * 0.70), int(h * 0.78)], fill=255)
    # 锁脸发肩
    d.ellipse([int(w * 0.18), int(h * 0.00), int(w * 0.82), int(h * 0.36)], fill=0)
    # 锁小腿/脚
    d.rectangle([0, int(h * 0.86), w, h], fill=0)
    return m.filter(ImageFilter.GaussianBlur(10))


def stage(im: Image.Image, name: str) -> str:
    COMFY_IN.mkdir(parents=True, exist_ok=True)
    im.save(COMFY_IN / name, "PNG")
    return name


def edge_green(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    g = np.array(GREEN, dtype=np.float32)
    near = np.linalg.norm(a - g, axis=2) < 42
    a[near] = g
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=90, threshold=2))


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


def wf_p4(
    base: str,
    mask: str,
    ctrl_id: str,
    ctrl_cmd: str,
    seed: int,
    denoise: float,
    prefix: str,
    id_strength: float = 0.95,
    cmd_strength: float = 0.55,
) -> dict:
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
                "end_percent": 0.88,
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
                "strength": 0.72,
                "start_percent": 0.0,
                "end_percent": 0.72,
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
                "strength": cmd_strength,
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
                "steps": 40,
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


def face_crop(im: Image.Image) -> Image.Image:
    w, h = im.size
    box = (int(w * 0.22), int(h * 0.02), int(w * 0.78), int(h * 0.34))
    return im.crop(box).resize((224, 224), Image.Resampling.LANCZOS)


def blob_fail(path: Path) -> bool:
    """下半身若几乎无边缘（大面积糊块）则判失败。"""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im)
    h, w = a.shape[:2]
    patch = a[int(h * 0.45) : int(h * 0.82), int(w * 0.22) : int(w * 0.78)]
    gray = patch.mean(axis=2)
    gx = np.abs(np.diff(gray, axis=1)).mean()
    gy = np.abs(np.diff(gray, axis=0)).mean()
    # 也抓「大片近恒定灰」伪影
    flat = float(np.std(gray)) < 12.0
    return float(gx + gy) < 10.0 or flat


def robot_present(path: Path) -> bool:
    """胯区是否出现偏红的机器人眼/锈斑信号（粗检）。"""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    patch = a[int(h * 0.52) : int(h * 0.78), int(w * 0.28) : int(w * 0.72)]
    r, g, b = patch[:, :, 0], patch[:, :, 1], patch[:, :, 2]
    redish = (r > 90) & (r > g * 1.25) & (r > b * 1.25)
    return float(redish.mean()) > 0.002


_CLIP = {"model": None, "processor": None}


def clip_face_sim(ref: Image.Image, gen: Image.Image) -> float:
    import torch
    from transformers import CLIPModel, CLIPProcessor

    device = "cpu"
    model_id = "openai/clip-vit-base-patch32"
    if _CLIP["model"] is None:
        _CLIP["processor"] = CLIPProcessor.from_pretrained(model_id)
        _CLIP["model"] = CLIPModel.from_pretrained(model_id).to(device).eval()
    processor = _CLIP["processor"]
    model = _CLIP["model"]
    a = face_crop(ref.convert("RGB"))
    b = face_crop(gen.convert("RGB"))
    pixel = processor(images=[a, b], return_tensors="pt")["pixel_values"].to(device)
    with torch.no_grad():
        vis = model.vision_model(pixel_values=pixel)
        feats = model.visual_projection(vis.pooler_output)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        sim = float((feats[0] * feats[1]).sum().item())
    return sim


def prepare_assets() -> tuple[str, str, str, str, Image.Image]:
    WORK.mkdir(parents=True, exist_ok=True)
    DESKTOP_OUT.mkdir(parents=True, exist_ok=True)

    qa = ROOT / "tmp" / "cmd_discipline_p4_qa"
    candidates = [
        qa / "ref_body_openeye_green.png",
        qa / "frames_SR01_2_tiaojiao_1_t10.png",
        qa / "SR01_2_tiaojiao_f0.png",
    ]
    tiao = next((p for p in candidates if p.exists()), None)
    if tiao is None:
        raise FileNotFoundError("no tiaojiao/openeye body ref")
    zhujue = ROOT / "tex" / "zhujue.png"
    if not zhujue.exists():
        raise FileNotFoundError(zhujue)

    print(f"  body ref -> {tiao.name}", flush=True)
    ctrl_id = fit_green(tiao)

    zh = Image.open(zhujue).convert("RGB")
    w, h = zh.size
    front = zh.crop((0, 0, int(w * 0.34), h))
    a = np.asarray(front).astype(np.float32)
    white = (a.min(axis=2) > 230) & ((a.max(axis=2) - a.min(axis=2)) < 18)
    a[white] = np.array(GREEN, dtype=np.float32)
    front = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    g = np.array(GREEN, dtype=np.float32)
    dist = np.linalg.norm(np.asarray(front).astype(np.float32) - g, axis=2)
    ys, xs = np.where(dist > 28)
    front = front.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    ctrl_cmd = fit_green(front)

    # 1) 触手区（暗灰） 2) 小胸手区 3) 小胯缝区 —— 禁止大椭圆盖住机器人
    ba = np.asarray(ctrl_id).astype(np.float32)
    dist_g = np.linalg.norm(ba - g, axis=2)
    lum = ba.mean(axis=2)
    sat = ba.max(axis=2) - ba.min(axis=2)
    tent = (dist_g > 40) & (lum < 95) & (sat < 55) & (ba[:, :, 1] < 120)
    mm = Image.fromarray((tent.astype(np.uint8) * 255), "L")
    d = ImageDraw.Draw(mm)
    gw, gh = GEN
    # 乳首双手：小椭圆
    d.ellipse([int(gw * 0.36), int(gh * 0.36), int(gw * 0.64), int(gh * 0.46)], fill=255)
    # 胯缝插入：窄椭圆，不覆盖腿间站位中心大块
    d.ellipse([int(gw * 0.40), int(gh * 0.54), int(gw * 0.60), int(gh * 0.66)], fill=220)
    # 锁脸发
    d.ellipse([int(gw * 0.16), int(gh * 0.00), int(gw * 0.84), int(gh * 0.36)], fill=0)
    # 锁脚
    d.rectangle([0, int(gh * 0.86), gw, gh], fill=0)

    base = ctrl_id.copy()
    robot = front.copy()
    robot.thumbnail((int(GEN[0] * 0.30), int(GEN[1] * 0.28)), Image.Resampling.LANCZOS)
    ra = np.asarray(robot).astype(np.float32)
    rdist = np.linalg.norm(ra - g, axis=2)
    rmask_arr = (rdist > 28).astype(np.uint8) * 255
    rmask = Image.fromarray(rmask_arr, "L").filter(ImageFilter.GaussianBlur(0.8))
    rx = (GEN[0] - robot.size[0]) // 2
    ry = int(GEN[1] * 0.52)
    base.paste(robot, (rx, ry), rmask)

    # 机器人像素强制 mask=0（保留清晰机体，只改触手/胸/窄胯缝）
    m_arr = np.asarray(mm).copy()
    rob_full = np.zeros_like(m_arr)
    rh, rw = rmask_arr.shape
    rob_full[ry : ry + rh, rx : rx + rw] = rmask_arr
    # 略扩张保护带
    rob_prot = Image.fromarray(rob_full, "L").filter(ImageFilter.MaxFilter(7))
    rob_prot = np.asarray(rob_prot) > 0
    m_arr[rob_prot] = 0
    mm = Image.fromarray(m_arr, "L").filter(ImageFilter.GaussianBlur(8))
    mask_rgb = Image.merge("RGB", (mm, mm, mm))

    b = stage(base, "ashcrow_p4_lllite_base.png")
    m = stage(mask_rgb, "ashcrow_p4_lllite_mask.png")
    c_id = stage(ctrl_id, "ashcrow_p4_lllite_ctrl_id.png")
    c_cmd = stage(ctrl_cmd, "ashcrow_p4_lllite_ctrl_cmd.png")

    ctrl_id.save(WORK / "prep_ctrl_id.png")
    base.save(WORK / "prep_base.png")
    mask_rgb.save(WORK / "prep_mask.png")
    ctrl_cmd.save(WORK / "prep_ctrl_cmd.png")
    return b, m, c_id, c_cmd, ctrl_id


def deliver(src: Path, tag: str) -> Path:
    im = edge_green(Image.open(src).convert("RGB"))
    # contain to OUT_WH
    tw, th = OUT_WH
    scale = min(tw / im.size[0], th / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", OUT_WH, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    canvas = edge_green(canvas)

    work = WORK / f"SR01_2_P4-A_lllite_{tag}.png"
    desk = DESKTOP / f"SR01_2_P4-A_lllite_{tag}.png"
    desk_folder = DESKTOP_OUT / f"SR01_2_P4-A_lllite_{tag}.png"
    canvas.save(work, "PNG")
    canvas.save(desk_folder, "PNG")
    print(f"  saved {work}", flush=True)
    return work


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, nargs="*", default=[95001, 95017, 95033])
    ap.add_argument("--denoise", type=float, nargs="*", default=[0.42, 0.52])
    ap.add_argument("--id-strength", type=float, default=0.96)
    ap.add_argument("--cmd-strength", type=float, default=0.48)
    ap.add_argument("--clip-pass", type=float, default=CLIP_ID_PASS)
    ap.add_argument("--clip-official", type=float, default=CLIP_OFFICIAL_PASS)
    ap.add_argument("--max-pass", type=int, default=3, help="最多保留几张过检图到桌面短名")
    args = ap.parse_args()

    api("/system_stats")
    print("ComfyUI OK", flush=True)
    try:
        api("/free", {"unload_models": True, "free_memory": True})
    except Exception:
        pass

    b, m, c_id, c_cmd, id_im = prepare_assets()
    ref_official = fit_green(REF_PORTRAIT) if REF_PORTRAIT.exists() else id_im

    passed: list[tuple[float, Path]] = []
    all_scores: list[tuple[str, float, Path]] = []

    for den in args.denoise:
        for seed in args.seeds:
            tag = f"d{int(den * 100)}_s{seed}"
            prefix = f"ashcrow_p4_lllite_{tag}"
            print(f"\n=== {tag} denoise={den} ===", flush=True)
            raw = run(
                wf_p4(
                    b,
                    m,
                    c_id,
                    c_cmd,
                    seed=seed,
                    denoise=den,
                    prefix=prefix,
                    id_strength=args.id_strength,
                    cmd_strength=args.cmd_strength,
                ),
                prefix,
            )
            dest = deliver(raw, tag)
            blob = blob_fail(dest)
            has_robot = robot_present(dest)
            try:
                sim_id = clip_face_sim(id_im, Image.open(dest))
                sim_off = clip_face_sim(ref_official, Image.open(dest))
            except Exception as e:
                print(f"  CLIP QA failed: {e}", flush=True)
                sim_id, sim_off = 0.0, 0.0
            print(
                f"  CLIP vs tiaojiao={sim_id:.4f} (thr {args.clip_pass}) "
                f"vs official={sim_off:.4f} (thr {args.clip_official}) "
                f"blob={blob} robot={has_robot}",
                flush=True,
            )
            all_scores.append((tag, sim_id, sim_off, dest))
            if (
                (not blob)
                and has_robot
                and sim_id >= args.clip_pass
                and sim_off >= args.clip_official
            ):
                passed.append((sim_id, sim_off, dest))

    report = WORK / "qa_report.json"
    report.write_text(
        json.dumps(
            {
                "clip_id_pass": args.clip_pass,
                "clip_official_pass": args.clip_official,
                "scores": [
                    {
                        "tag": t,
                        "sim_tiaojiao": sid,
                        "sim_official": soff,
                        "path": str(p),
                    }
                    for t, sid, soff, p in all_scores
                ],
                "passed": [
                    {"sim_tiaojiao": sid, "sim_official": soff, "path": str(p)}
                    for sid, soff, p in passed
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nQA report -> {report}", flush=True)

    if not passed:
        print("FAIL: no candidate reached identity quality gate", flush=True)
        best = max(all_scores, key=lambda x: x[1]) if all_scores else None
        if best:
            print(f"best so far {best[0]} sim={best[1]:.4f} @ {best[2]}", flush=True)
        raise SystemExit(2)

    passed.sort(key=lambda x: (x[0] + x[1]), reverse=True)
    for i, (sid, soff, p) in enumerate(passed[: args.max_pass]):
        short = DESKTOP / f"SR01_2_P4-A_PASS_{i + 1}_id{sid:.3f}_off{soff:.3f}.png"
        shutil.copy2(p, short)
        print(f"PASS[{i + 1}] tiaojiao={sid:.4f} official={soff:.4f} -> {short}", flush=True)

    print("ALL DONE — identity gate passed", flush=True)


if __name__ == "__main__":
    main()
