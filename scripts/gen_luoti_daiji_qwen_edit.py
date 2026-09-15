"""Edit shower nude frames into clean nude idle greenscreen plates via DashScope qwen-image-edit."""
from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(r"D:\neon-snake-girl\neon-snake-girl")
BASE = ROOT / "tex" / "juese" / "pifu" / "chongzao"
OUT = BASE / "luoti_daiji"
REFS = OUT / "_refs"
STEMS = [
    "SR01_2",
    "SR01_3",
    "SR02_1",
    "SR03_1",
    "SR04_1",
    "SR05_1",
    "SSR01_1",
    "SSR02_1",
    "SSR03_1",
    "SSR04_1",
    "SSR05_1",
    "UR03_1",
    "UR04_1",
]

MEASURE = {
    "SR01_2": "B88/W59/H86 height 168cm",
    "SR01_3": "B84/W56/H82 height 162cm",
    "SR02_1": "B90/W60/H88 height 166cm",
    "SR03_1": "B87/W57/H85 height 167cm",
    "SR04_1": "B92/W61/H90 height 170cm",
    "SR05_1": "B85/W57/H84 height 165cm",
    "SSR01_1": "B89/W59/H87 height 169cm",
    "SSR02_1": "B85/W57/H84 height 165cm",
    "SSR03_1": "B82/W55/H80 height 158cm",
    "SSR04_1": "B88/W58/H86 height 163cm",
    "SSR05_1": "B86/W58/H85 height 166cm",
    "UR03_1": "B86/W56/H84 height 170cm",
    "UR04_1": "B84/W56/H83 height 160cm",
}

EDIT_PROMPT = """把这张冲澡参考图改成「裸体常态待机打底图」：
1) 去掉喷头、水管、水流、水花、蒸汽雾气、毛巾；保留角色面部与发型 1:1，保留全部义体/机械肢/靴/耳饰等身体特征 1:1，三围比例 {measure} 与参考一致。
2) 全身裸体自然站立待机，轻松常态，手臂自然垂放或轻柔待机手位，正视镜头，平静表情，正常睁眼。
3) 背景改为 Uniform chroma key，纯绿幕 #00b140，工作室无影灯光，无纹理无反射，角色孤立在纯绿底上。
4) 竖屏 9:16，角色尽量占满画面；二次元超精致细腻，无模糊，结构清晰，符合女性人体生理结构，超高质量。
不要改变人脸身份，不要换发型颜色，不要增删机械部件。"""


def load_api_key() -> str:
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("VITE_QWEN_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("missing VITE_QWEN_API_KEY")


def to_data_url(path: Path) -> str:
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def call_edit(api_key: str, image_path: Path, measure: str) -> bytes:
    # DashScope multimodal generation endpoint for qwen-image-edit
    url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    body = {
        "model": "qwen-image-edit-plus",
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"image": to_data_url(image_path)},
                        {"text": EDIT_PROMPT.format(measure=measure)},
                    ],
                }
            ]
        },
        "parameters": {
            "n": 1,
            "watermark": False,
            "prompt_extend": True,
            "size": "1080*1920",
            "negative_prompt": "blurry, lowres, deformed, extra limbs, bathroom tiles, floor, shadow on background, shower head, water spray, towel, clothes",
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.load(resp)

    # parse output image url or b64
    out = data.get("output") or {}
    choices = out.get("choices") or []
    if choices:
        content = choices[0].get("message", {}).get("content") or []
        for item in content:
            if isinstance(item, dict):
                if item.get("image"):
                    img_ref = item["image"]
                    if isinstance(img_ref, str) and img_ref.startswith("http"):
                        with urllib.request.urlopen(img_ref, timeout=120) as ir:
                            return ir.read()
                    if isinstance(img_ref, str) and img_ref.startswith("data:image"):
                        return base64.b64decode(img_ref.split(",", 1)[1])
    # alternate shapes
    results = out.get("results") or []
    for r in results:
        u = r.get("url") or r.get("image")
        if u and str(u).startswith("http"):
            with urllib.request.urlopen(u, timeout=120) as ir:
                return ir.read()
    raise RuntimeError(f"unexpected response keys={list(data.keys())} output={json.dumps(out, ensure_ascii=False)[:800]}")


def rematte_2k(src_bytes: bytes, dest: Path) -> None:
    from PIL import Image, ImageFilter
    import numpy as np
    import io

    GREEN = np.array([0, 177, 64], dtype=np.float32)
    W, H = 1440, 2560
    im = Image.open(io.BytesIO(src_bytes)).convert("RGB")
    arr = np.asarray(im).astype(np.float32)
    dist = np.linalg.norm(arr - GREEN, axis=2)
    alpha = np.clip((dist - 40.0) / 40.0, 0.0, 1.0)[..., None]
    out = arr * alpha + GREEN * (1.0 - alpha)
    out[dist < 48] = GREEN
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    iw, ih = img.size
    scale = max(W / iw, H / ih)
    nw, nh = int(iw * scale + 0.5), int(ih * scale + 0.5)
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left, top = (nw - W) // 2, (nh - H) // 2
    img = img.crop((left, top, left + W, top + H))
    img = img.filter(ImageFilter.UnsharpMask(radius=1.1, percent=70, threshold=2))
    a = np.asarray(img).astype(np.float32)
    d = np.linalg.norm(a - GREEN, axis=2)
    a[d < 52] = GREEN
    Image.fromarray(a.astype(np.uint8)).save(dest, "PNG", optimize=True)


def main() -> int:
    api_key = load_api_key()
    OUT.mkdir(parents=True, exist_ok=True)
    ok, fail = [], []
    for stem in STEMS:
        src = REFS / f"{stem}_shower_nude_ref.png"
        dest = OUT / f"{stem}_luoti_daiji.png"
        print(f"[{stem}] edit...", flush=True)
        try:
            raw = call_edit(api_key, src, MEASURE[stem])
            rematte_2k(raw, dest)
            print(f"  OK {dest.name} {dest.stat().st_size}", flush=True)
            ok.append(stem)
        except Exception as e:
            msg = str(e)
            if isinstance(e, urllib.error.HTTPError):
                msg = e.read().decode("utf-8", "replace")[:500]
            print(f"  FAIL {msg}", flush=True)
            fail.append(stem)
            time.sleep(1)
        time.sleep(0.5)
    print("OK:", ", ".join(ok))
    print("FAIL:", ", ".join(fail) or "(none)")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
