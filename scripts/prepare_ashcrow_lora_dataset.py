"""
收集苍羽·澪 (SR01_2 / ashcrow) 全部可用静帧皮肤 → 归一化绿幕 RGB → 写 caption
输出到 ComfyUI input/ashcrow_sr012_train/ 供 TrainLoraNode 使用。
"""
from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
JUESE = ROOT / "tex" / "juese"
COMFY_IN = Path(r"E:\MiniMaxH3\ComfyUI\input")
OUT = COMFY_IN / "ashcrow_sr012_train"
DESKTOP_DS = Path.home() / "Desktop" / "ashcrow_sr012_lora_dataset"
GREEN = (0, 177, 64)
TARGET = (768, 1152)  # 训练统一分辨率 2:3
TRIGGER = "ashcrow_sr012"

# 产品静帧 PNG（正式皮肤）
CANON_PNG = [
    JUESE / "SR01_2.png",
    JUESE / "pifu" / "SR01_2_pifu01.png",
    JUESE / "pifu" / "shuiyi" / "SR01_2_pifu02.png",
    JUESE / "pifu" / "shuiyi" / "SR01_2_pifu02_sleep_pose_gs.png",
    JUESE / "pifu" / "shuiyi" / "SR01_2_pifu02_sleep_stand_gs.png",
    JUESE / "pifu" / "chongzao" / "SR01_2_pifu03.png",
    JUESE / "pifu" / "chongzao" / "SR01_2_pifu03_greenscreen_first.png",
    JUESE / "pifu" / "shenghuoshizhuang01" / "SR01_2_pifu04.png",
    JUESE / "pifu" / "teshufuzhuang01" / "SR01_2_pifu05.png",
    JUESE / "avatars" / "ashcrow.png",
]

# 从 webm 抽帧（每条取 2 帧）
WEBM_SKINS = [
    JUESE / "SR01_2.webm",
    JUESE / "SR01_2_1.webm",
    JUESE / "pifu" / "SR01_2_pifu01.webm",
    JUESE / "pifu" / "shuiyi" / "SR01_2_pifu02.webm",
    JUESE / "pifu" / "shuiyi" / "SR01_2_pifu02_sleep.webm",
    JUESE / "pifu" / "chongzao" / "SR01_2_pifu03.webm",
    JUESE / "pifu" / "chongzao" / "SR01_2_pifu03_idle.webm",
    JUESE / "pifu" / "shenghuofuzhuang00" / "SR01_2_pifu00.webm",
    JUESE / "pifu" / "shenghuoshizhuang01" / "SR01_2_pifu04.webm",
    JUESE / "pifu" / "teshufuzhuang01" / "SR01_2_pifu05.webm",
    JUESE / "pifu" / "teshufuzhuang01" / "SR01_2_pifu05_1.webm",
    JUESE / "pifu" / "huanzhuang" / "SR01_2_huanzhuang.webm",
    JUESE / "pifu" / "tiaojiao" / "SR01_2_tiaojiao.webm",
    JUESE / "pifu" / "tiaojiao" / "SR01_2_tiaojiao_1.webm",
    JUESE / "pifu" / "tiaojiao" / "SR01_2_tiaojiao_2.webm",
    JUESE / "pifu" / "tiaojiao" / "SR01_2_tiaojiao_3.webm",
    JUESE / "pifu" / "tiaojiao" / "SR01_2_tiaojiao_4.webm",
]

# ComfyUI input 里已有的 SR01_2 绿幕静帧（历史抽帧，补姿态多样性）
COMFY_GLOBS = [
    "SR01_2_*.png",
    "SR01_2.png",
]


OUTFIT_HINTS = [
    (re.compile(r"tiaojiao", re.I), "white tight discipline catsuit, restraint suit"),
    (re.compile(r"pifu05|teshu|tease", re.I), "special seductive outfit, lingerie-like armor accents"),
    (re.compile(r"pifu04|shizhuang|都市", re.I), "urban casual street fashion outfit"),
    (re.compile(r"pifu03|chongzao|shower|luoti|nude", re.I), "bath towel / post-bath look"),
    (re.compile(r"pifu02|shuiyi|sleep", re.I), "pajamas sleepwear"),
    (re.compile(r"pifu01|swim|泳", re.I), "swimsuit"),
    (re.compile(r"pifu00|shenghuo00|homeland|lifewear", re.I), "camp daily lifewear"),
    (re.compile(r"huanzhuang", re.I), "outfit change transition pose"),
    (re.compile(r"emotion-poses|ashcrow[/\\]\d", re.I), "upper body emotion pose, mesh lower silhouette"),
]


BASE_FACE = (
    "1girl, solo, ashcrow_sr012, character Ashcrow Mio, "
    "short messy silver-lavender hair, ice-blue eyes, pale fair skin, "
    "cybernetic mechanical right leg, anime 2d cel shading, "
    "full body or clear upper body, chroma key green background #00b140"
)


def outfit_from_name(name: str) -> str:
    for rx, hint in OUTFIT_HINTS:
        if rx.search(name):
            return hint
    return "default combat armor portrait outfit"


def caption_for(stem: str) -> str:
    outfit = outfit_from_name(stem)
    return (
        f"{TRIGGER}, best quality, score_9, score_7, very aesthetic, "
        f"{BASE_FACE}, {outfit}, keep exact face and body proportions"
    )


def to_green_rgb(im: Image.Image) -> Image.Image:
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (*GREEN, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg.convert("RGB")
    return im.convert("RGB")


def fit_canvas(im: Image.Image, size=TARGET) -> Image.Image:
    tw, th = size
    scale = min(tw / im.width, th / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, GREEN)
    canvas.paste(im2, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def ffmpeg_frame(webm: Path, ss: str, dest: Path) -> bool:
    if not webm.exists():
        return False
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        ss,
        "-i",
        str(webm),
        "-frames:v",
        "1",
        "-update",
        "1",
        str(dest),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0 and dest.exists()


def add_image(src: Path | Image.Image, stem: str, seen: set[str], rows: list) -> None:
    if isinstance(src, Path):
        if not src.exists():
            return
        im = Image.open(src)
        key_src = str(src.resolve()).lower()
    else:
        im = src
        key_src = stem
    im = fit_canvas(to_green_rgb(im))
    # content hash dedupe
    h = hashlib.md5(im.tobytes()).hexdigest()
    if h in seen:
        return
    seen.add(h)
    rows.append((stem, im, caption_for(stem)))


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    DESKTOP_DS.mkdir(parents=True, exist_ok=True)
    for old in DESKTOP_DS.glob("*"):
        if old.is_file():
            old.unlink()

    seen: set[str] = set()
    rows: list[tuple[str, Image.Image, str]] = []

    print("=== canon PNG ===", flush=True)
    for p in CANON_PNG:
        add_image(p, p.stem, seen, rows)
        print(f"  + {p.name}" if p.exists() else f"  miss {p}", flush=True)

    print("=== emotion poses ===", flush=True)
    emo = JUESE / "emotion-poses" / "ashcrow"
    for p in sorted(emo.glob("*.png")):
        add_image(p, f"emo_{p.stem}", seen, rows)
    print(f"  emotion count folder={len(list(emo.glob('*.png')))}", flush=True)

    print("=== comfy input SR01_2 stills ===", flush=True)
    for pat in COMFY_GLOBS:
        for p in sorted(COMFY_IN.glob(pat)):
            if "P4" in p.name or "plate" in p.name:
                continue
            if p.parent.name == OUT.name:
                continue
            add_image(p, f"comfy_{p.stem}", seen, rows)

    print("=== webm extract ===", flush=True)
    tmp = OUT / "_tmp_frames"
    tmp.mkdir(exist_ok=True)
    for webm in WEBM_SKINS:
        if not webm.exists():
            print(f"  miss {webm.name}", flush=True)
            continue
        for i, ss in enumerate(("0.2", "1.2")):
            dest = tmp / f"{webm.stem}_f{i}.png"
            ok = ffmpeg_frame(webm, ss, dest)
            if ok:
                add_image(dest, f"webm_{webm.stem}_f{i}", seen, rows)
                print(f"  + {webm.name} @{ss}s", flush=True)
            else:
                print(f"  fail extract {webm.name} @{ss}", flush=True)

    # write dataset
    print(f"=== write {len(rows)} samples ===", flush=True)
    manifest = []
    for idx, (stem, im, cap) in enumerate(rows, 1):
        name = f"{idx:03d}_{re.sub(r'[^a-zA-Z0-9_\\-]+', '_', stem)[:60]}"
        png = OUT / f"{name}.png"
        txt = OUT / f"{name}.txt"
        im.save(png, "PNG", optimize=True)
        txt.write_text(cap, encoding="utf-8")
        # mirror to desktop
        im.save(DESKTOP_DS / f"{name}.png", "PNG", optimize=True)
        (DESKTOP_DS / f"{name}.txt").write_text(cap, encoding="utf-8")
        manifest.append({"file": name + ".png", "caption": cap})

    # cleanup tmp
    shutil.rmtree(tmp, ignore_errors=True)

    man = OUT / "manifest.json"
    import json

    man.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy2(man, DESKTOP_DS / "manifest.json")
    print(f"DONE samples={len(rows)} -> {OUT}", flush=True)
    print(f"DESKTOP copy -> {DESKTOP_DS}", flush=True)


if __name__ == "__main__":
    main()
