# -*- coding: utf-8 -*-
"""Local ComfyUI Qwen-Image-2.1: identity + illust pose + tentacle → greenscreen stills."""
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
REF = ROOT / "_tmp-desk-refs"
DESK_OUT = Path(r"C:\Users\LiSuYan\Desktop\新建文件夹 (2)\out_pose_cands_qwen21_illustPose")
PROJ_OUT = REF / "out_s1_pose_qwen21_illustPose"
REJECT = DESK_OUT / "_reject"

CHAR = REF / "01_asset.png"
TENT = REF / "03_tentacle.png"
POSE = REF / "02_illust.jpg"  # illust_149752921 pose master

UNET = "qwen_image_2.1_int8_convrot.safetensors"
CLIP = "qwen3vl_8b_int8_convrot.safetensors"
VAE = "qwen_image_2.1_vae_bf16.safetensors"

WIDTH, HEIGHT = 1152, 2048
STEPS = 40
CFG = 1.0
SEEDS = [2026092371, 2026092372, 2026092373, 2026092374, 2026092375, 2026092376]

PROMPT = """多参考图合成竖屏绿幕调教静帧。必须通过人体结构验收。禁止跪姿。

【参考图分工】
Image 1 = 角色身份与身材硬锁：灰金发高马尾、冰蓝瞳、五官、纤细运动型身材、白色蕾丝内衣、大腿中段以下白色机械义体腿（金灰关节+机械足）。禁止换脸、禁止黑发双马尾。
Image 2 = 姿势/镜头/表情主参考（illust）：只借骨架、腿部开合、臀部朝向、低机位透视与表情演技；禁止吸收其黑发双马尾、金耳环、湿透背心、蓝短裤、体育馆、木地板、跳箱、排球。
Image 3 = 触手造型：深色分段金属触手；缠绕腰臀与大腿根，可绕胸；布局干净；禁止插入。

【姿势详细描述 — 来自 Image 2，必须落地，禁止跪下】
不是跪趴，不是双膝着地。
角色仰躺在平面上，上半身在画面远端，下半身抬起并大幅朝镜头倾斜。
双腿向头部方向收折并左右打开：大腿根与臀部成为画面最近、最大的主体；小腿向头侧回折，脚/机械足出现在画面上方或侧上方前景。
臀部正面朝向镜头（髋部对镜），形成强烈的「从后下方看抬起的臀腿」构图。
一只手臂可自然放在身侧或轻触地面支撑扭转；另一只手臂可放在身侧。
整体动作是「躺着把臀腿抬向镜头并打开」，不是站立，不是跪姿。

【镜头详细描述 — 来自 Image 2】
极低机位、近距离、略仰视的后下方视角（接近蛙视角/胯下仰视）。
强透视：近处的臀、腿根、大腿巨大清晰；远处的腰、胸、头明显更小。
竖屏 9:16，角色占满画面；能同时看到对镜的臀部、打开的双腿，以及远端回看的脸。

【表情与动作演技 — 来自 Image 2】
头从身体远端回看镜头（越过身体向下看向观众）。
半眯眼、眼睑偏沉，带自信/挑逗的轻蔑浅笑或得意嘴角；脸颊有红晕；口鼻处可有轻微吐息感。
神情是「知道镜头在看、主动对视」的冷静撩拨，不是惊恐大哭，也不是跪姿温顺低头。

【身材 / 肢体硬锁】
体型跟 Image 1：纤细、腿偏细、胸臀适中，不要吸收 Image 2 的夸张肉感。
有且仅有 2 条腿 + 2 只手臂；禁止第三条腿、禁止胯部额外腿根。
义体腿与机械足跟 Image 1。自然透视，禁止把下半身鱼眼放大到畸形。

【场景】
纯绿幕 #00b140；禁止体育馆、木地板、跳箱、排球、枕头、房间。"""

NEG = (
    "kneeling, on knees, doggy style kneeling, crawling pose, "
    "standing upright, sitting front view, "
    "extra legs, third leg, four legs, duplicated limbs, fused hips, broken pelvis, "
    "black twin tails, gymnasium, wooden floor, vaulting box, volleyball, "
    "thick thighs, huge hips, fisheye crotch, pillow, cushion, "
    "wrong face, penetration, insertion, blurry, lowres, text, watermark"
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
    out = info.get("name") or name
    print(f"  uploaded {out}", flush=True)
    return out


def build_workflow(char_name: str, pose_name: str, tent_name: str, seed: int, prefix: str) -> dict:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": UNET, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": CLIP, "type": "qwen_image", "device": "default"},
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": VAE},
        },
        "4": {
            "class_type": "QwenImage21Cache",
            "inputs": {"model": ["1", 0], "device": "auto", "dtype": "default"},
        },
        "10": {"class_type": "LoadImage", "inputs": {"image": char_name}},
        "11": {"class_type": "LoadImage", "inputs": {"image": pose_name}},
        "12": {"class_type": "LoadImage", "inputs": {"image": tent_name}},
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
                "resolution": 1280,
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
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["30", 0],
                "negative": ["30", 1],
                "latent_image": ["20", 0],
            },
        },
        "50": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["40", 0], "vae": ["3", 0]},
        },
        "60": {
            "class_type": "SaveImage",
            "inputs": {"images": ["50", 0], "filename_prefix": prefix},
        },
    }


def wait_prompt(prompt_id: str, timeout_s: float = 1800.0) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            return hist[prompt_id]
        time.sleep(2.0)
    raise TimeoutError(f"prompt {prompt_id} timeout")


def newest_outputs(hist_item: dict) -> list[Path]:
    outs: list[Path] = []
    for node_out in (hist_item.get("outputs") or {}).values():
        for im in node_out.get("images") or []:
            sub = im.get("subfolder") or ""
            name = im.get("filename")
            if not name:
                continue
            p = COMFY_OUTPUT / sub / name if sub else COMFY_OUTPUT / name
            outs.append(p)
    return outs


def main() -> None:
    DESK_OUT.mkdir(parents=True, exist_ok=True)
    PROJ_OUT.mkdir(parents=True, exist_ok=True)
    REJECT.mkdir(parents=True, exist_ok=True)
    for p in (CHAR, TENT, POSE):
        if not p.exists():
            raise SystemExit(f"missing ref: {p}")

    print("Comfy queue check...", flush=True)
    q = api("/queue")
    print(f"  running={len(q.get('queue_running') or [])} pending={len(q.get('queue_pending') or [])}", flush=True)

    print("Upload refs (char→illustPose→tentacle)...", flush=True)
    char_n = upload_image(CHAR)
    pose_n = upload_image(POSE)
    tent_n = upload_image(TENT)

    results: list[Path] = []
    for i, seed in enumerate(SEEDS, 1):
        prefix = f"qwen21_illustPose_c{i}"
        print(f"\n=== gen{i}/{len(SEEDS)} seed={seed} {WIDTH}x{HEIGHT} illustPose ===", flush=True)
        wf = build_workflow(char_n, pose_n, tent_n, seed, prefix)
        try:
            res = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", "replace")
            raise SystemExit(f"prompt submit failed: {e.code} {err[:1200]}")
        pid = res.get("prompt_id")
        print(f"  prompt_id={pid}", flush=True)
        hist = wait_prompt(pid)
        status = (hist.get("status") or {}).get("status_str")
        if status == "error":
            msgs = hist.get("status", {}).get("messages") or []
            raise SystemExit(f"comfy error: {msgs[:3]}")
        outs = newest_outputs(hist)
        if not outs:
            raise SystemExit(f"no outputs for {pid}")
        src = outs[0]
        desk = DESK_OUT / f"raw{i}_qwen21_seed{seed}.png"
        shutil.copy2(src, desk)
        shutil.copy2(src, PROJ_OUT / desk.name)
        print(f"  saved {desk} ({desk.stat().st_size} bytes)", flush=True)
        print(f"  QA_PENDING path={desk}", flush=True)
        results.append(desk)

    print("\nDONE_RAW:")
    for p in results:
        print(f"  {p}")
    print("Agent QA: reject kneeling / extra legs / wrong identity; keep lying raised-hip illust pose.", flush=True)


if __name__ == "__main__":
    main()
