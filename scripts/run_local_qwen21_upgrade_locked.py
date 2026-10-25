# -*- coding: utf-8 -*-
"""Upgrade locked builtin stills with local ComfyUI Qwen-Image-2.1 (pose/identity lock)."""
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
PICK2 = Path(r"C:\Users\LiSuYan\Desktop\新建文件夹 (2)\out_pose_cands_builtin_pick2")
DESK_OUT = Path(r"C:\Users\LiSuYan\Desktop\新建文件夹 (2)\out_pose_cands_qwen21_upgrade3_2k")
PROJ_OUT = REF / "out_s1_pose_qwen21_upgrade3_2k"

CHAR = REF / "01_asset.png"
TENT = REF / "03_tentacle.png"

# 3 locked builtin plates (diverse poses)
JOBS = [
    ("raise_a", PICK2 / "builtin_pick_raise_a.png", 2026092391),
    ("arch_b", PICK2 / "builtin_pick_arch_b.png", 2026092392),
    ("supine_a", PICK2 / "builtin_pick_supine_a.png", 2026092393),
]

UNET = "qwen_image_2.1_int8_convrot.safetensors"
CLIP = "qwen3vl_8b_int8_convrot.safetensors"
VAE = "qwen_image_2.1_vae_bf16.safetensors"

# True 2K+ vertical 9:16 (long edge 2560). Do NOT use TextEncode latent —
# that follows the 720x1280 builtin and collapses to ~960x1696.
WIDTH, HEIGHT = 1440, 2560
STEPS = 40
CFG = 1.0
DENOISE = 1.0

PROMPT = """画面升级（严格保构图）。竖屏 9:16 高清 2K+ 绿幕二次元游戏静帧精修（输出约 1440x2560）。

【参考图分工】
Image 1 = 已锁定的最终构图主稿：姿势、镜头角度、肢体开合、触手缠绕布局、表情、服装、绿幕背景全部以 Image 1 为准，禁止改姿势、禁止换构图、禁止重排触手、禁止换背景。Image 1 虽分辨率较低，只借构图与身份，输出必须是清晰 2K 竖屏，禁止输出低清小图。
Image 2 = 角色身份材质参考：只强化脸、发型发色、冰蓝瞳、白色蕾丝、白色机械义体腿与金灰关节的精致度；禁止吸收站立姿势。
Image 3 = 触手材质参考：分段金属光泽与三指爪细节；禁止新增插入、禁止乱长额外触手肢。

【升级目标】
在完全保留 Image 1 构图的前提下，提升到 2K+ 竖屏清晰度：线稿干净、皮肤质感、蕾丝织纹、金属触手分段高光、义体关节细节。输出更精致的二次元立绘质感。

【表情硬锁 · S1 unified shy】
薄红晕、害羞半眯、犹豫躲闪的眼神、微张嘴的害羞喘息；禁止得意挑逗浅笑、禁止 smug、禁止夸张高潮脸。

【解剖硬锁】
有且仅有 2 条腿 + 2 只手臂；禁止多余肢体；体型跟 Image 1 / Image 2 纤细比例。

【场景】
纯绿幕 #00b140；禁止房间、地板、道具。"""

NEG = (
    "pose change, different pose, standing when lying, kneeling rewrite, "
    "extra legs, third leg, four legs, duplicated limbs, fused hips, "
    "smug smile, confident smirk, ahegao, tongue out, "
    "wrong face, black twin tails, gymnasium, wooden floor, "
    "penetration, insertion, blurry, lowres, text, watermark"
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


def build_workflow(locked_name: str, char_name: str, tent_name: str, seed: int, prefix: str) -> dict:
    # Empty latent at fixed 1440x2560; refs only condition via TextEncode.
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
        "10": {"class_type": "LoadImage", "inputs": {"image": locked_name}},
        "11": {"class_type": "LoadImage", "inputs": {"image": char_name}},
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

    for _, locked, _ in JOBS:
        if not locked.exists():
            raise SystemExit(f"missing locked plate: {locked}")
    for p in (CHAR, TENT):
        if not p.exists():
            raise SystemExit(f"missing ref: {p}")

    print("Comfy queue check...", flush=True)
    q = api("/queue")
    print(
        f"  running={len(q.get('queue_running') or [])} pending={len(q.get('queue_pending') or [])}",
        flush=True,
    )

    print("Upload identity + tentacle...", flush=True)
    char_n = upload_image(CHAR)
    tent_n = upload_image(TENT)

    results: list[Path] = []
    for i, (tag, locked, seed) in enumerate(JOBS, 1):
        print(
            f"\n=== upgrade {i}/{len(JOBS)} {tag} seed={seed} {WIDTH}x{HEIGHT} ===",
            flush=True,
        )
        # unique upload name to avoid overwrite collisions
        locked_upload = REF / f"_upgrade_locked_{tag}.png"
        shutil.copy2(locked, locked_upload)
        locked_n = upload_image(locked_upload)
        prefix = f"qwen21_up_{tag}"
        wf = build_workflow(locked_n, char_n, tent_n, seed, prefix)
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
        desk = DESK_OUT / f"up_{tag}_seed{seed}.png"
        shutil.copy2(src, desk)
        shutil.copy2(src, PROJ_OUT / desk.name)
        # also keep side-by-side source copy
        shutil.copy2(locked, DESK_OUT / f"src_{tag}.png")
        print(f"  saved {desk} ({desk.stat().st_size} bytes)", flush=True)
        results.append(desk)

    index = DESK_OUT / "INDEX.md"
    index.write_text(
        "\n".join(
            [
                "# qwen21 upgrade3 2K+ vertical (from builtin pick2 locks)",
                "",
                f"Target: {WIDTH}x{HEIGHT} (9:16, long edge >= 2048)",
                "",
                "| out | source | note |",
                "|-----|--------|------|",
                "| up_raise_a_*.png | builtin_pick_raise_a | pose34 raise |",
                "| up_arch_b_*.png | builtin_pick_arch_b | pose23 arch |",
                "| up_supine_a_*.png | builtin_pick_supine_a | pose36 supine |",
                "",
                "Mode: EmptyLatentImage @ fixed 2K+; Image1=locked still.",
                "Expression: S1 shy.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    print("\nDONE_UPGRADE:")
    for p in results:
        print(f"  {p}")


if __name__ == "__main__":
    main()
