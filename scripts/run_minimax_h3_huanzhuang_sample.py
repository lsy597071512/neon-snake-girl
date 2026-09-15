"""Sample MiniMax H3: huanzhuang (换装中) greenscreen → 5s vertical I2V.

First plate: 苍羽·澪 / SR01_2 (creation_1789113501050.jpg)
Spec: 768×1344, 120 frames @24fps (=5.0s), locked camera, wardrobe pop + changing physics.

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/run_minimax_h3_huanzhuang_sample.py
  ... --force
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import time
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"
spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "huanzhuang"
OUT_DIR = SRC_DIR / "_h3_sample"
QA_DIR = SRC_DIR / "_qa_sample"
FIRST_DIR = SRC_DIR / "_first_sample"

WIDTH, HEIGHT = 768, 1344
LENGTH = 120  # 5.0s @ 24fps
STEPS = 30
GREEN = (0, 177, 64)
GREEN_RGB = np.array(GREEN, dtype=np.float32)

SAMPLE = {
    "stem": "SR01_2",
    "name": "苍羽·澪",
    "src": "creation_1789113501050.jpg",
    "identity": (
        "ash-blonde high ponytail with metallic white wing-fin hair clips, light blue eyes, pale skin, "
        "holding sheer translucent white changing cloth / slip in front of torso with both hands, "
        "white/silver cybernetic legs from mid-thigh with gold accents and heavy mechanical boots, "
        "organic upper body mid-change — huanzhuang changing plate"
    ),
}


def fit_greenscreen_jpg(src: Path, dest: Path) -> Path:
    """Resize already-keyed RGB greenscreen JPG onto 768×1344 #00b140 canvas (max occupancy)."""
    im = Image.open(src).convert("RGB")
    arr = np.asarray(im).astype(np.float32)
    dist = np.linalg.norm(arr - GREEN_RGB, axis=2)
    mask = dist > 55.0
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError(f"no subject pixels: {src}")
    pad = 6
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(im.width, int(xs.max()) + 1 + pad), min(im.height, int(ys.max()) + 1 + pad)
    crop = im.crop((l, t, r, b))

    margin = 0.02
    max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * (1 - 2 * margin))
    scale = min(max_w / crop.width, max_h / crop.height)
    cw, ch = max(1, int(crop.width * scale)), max(1, int(crop.height * scale))
    crop2 = crop.resize((cw, ch), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (WIDTH, HEIGHT), GREEN)
    x, y = (WIDTH - cw) // 2, (HEIGHT - ch) // 2
    canvas.paste(crop2, (x, y))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG")
    m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, m.COMFY_INPUT / dest.name)
    print(f"  first plate {dest.name} subject={cw}x{ch} h%={ch / HEIGHT * 100:.1f}", flush=True)
    return dest


def build_huanzhuang_prompt(identity: str) -> str:
    return f"""Professional film-set chroma key action plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution.

FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, no pull-out, no added headroom.

LOCKED identity from first frame: {identity}. Keep the same face, hair, cybernetic legs, wing-fin clips, and sheer white changing cloth continuity.

CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. Framing identical throughout. 镜头静止不动.

ACTION timeline (5 seconds), natural continuous motion:
[0.0-0.8s] Suddenly a simple freestanding wardrobe / closet prop pops into frame beside her (still on pure green matte — wardrobe is the only set piece; no floor, no room). 突然弹出衣柜.
[0.8-4.2s] She is mid-change in front of the wardrobe: natural breathing, soft blinks, gentle weight shift; hands adjust / pull the sheer white cloth with realistic fabric physics (folds, cling, slip); body and cloth keep physical interaction; tasteful game-style changing motion, not frantic, not camera-aware dance.
[4.2-5.0s] Continues a natural wardrobe-changing micro-action and soft breathing; wardrobe stays present; settle slightly without leaving frame.

Keep pure flat #00b140 green everywhere behind subject and wardrobe: no bedroom set, no floor plane, no shadow catcher, no vignette. Do NOT redesign hair, face, or cybernetics.

Audio: very soft quiet room tone only, no speech, no music.
"""


def build_workflow(input_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    wf["9"]["inputs"]["steps"] = STEPS
    return wf


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    stem = SAMPLE["stem"]
    name = SAMPLE["name"]
    src = SRC_DIR / SAMPLE["src"]
    if not src.exists():
        print(f"missing {src}", flush=True)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)

    final_mp4 = OUT_DIR / f"{stem}_huanzhuang_gs_h3.mp4"
    if final_mp4.exists() and final_mp4.stat().st_size > 80_000 and not args.force:
        print(f"[SKIP] exists {final_mp4}", flush=True)
        return 0

    gs_path = FIRST_DIR / f"{stem}_huanzhuang_first.png"
    fit_greenscreen_jpg(src, gs_path)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    seed = args.seed or (int(time.time()) & 0x7FFFFFFF)
    prompt = build_huanzhuang_prompt(SAMPLE["identity"])
    out_leaf = f"{stem}_huanzhuang_gs"
    out_prefix = f"video/{out_leaf}"
    (QA_DIR / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")
    (QA_DIR / f"{stem}_meta.json").write_text(
        json.dumps(
            {
                "stem": stem,
                "name": name,
                "src": SAMPLE["src"],
                "seed": seed,
                "width": WIDTH,
                "height": HEIGHT,
                "length": LENGTH,
                "steps": STEPS,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        f"=== SAMPLE {stem} {name} seed={seed} {WIDTH}x{HEIGHT} len={LENGTH} steps={STEPS} ===",
        flush=True,
    )
    t0 = time.time()
    wf = build_workflow(input_name, out_prefix, prompt, seed)
    pid = m.api(
        "/prompt",
        {"prompt": wf, "client_id": str(uuid.uuid4())},
    )["prompt_id"]
    print(f"  queued {pid}", flush=True)
    entry = m.wait_prompt(pid, timeout_s=7200.0)
    out = m.find_latest_output(out_leaf, t0)
    if out is None:
        print(f"  FAIL no output; status={entry.get('status')}", flush=True)
        return 1

    shutil.copy2(out, final_mp4)
    # QA frames
    for t, tag in [(0.2, "t02"), (2.5, "t25"), (4.8, "t48")]:
        m.extract_frame(final_mp4, t, QA_DIR / f"{stem}_{tag}.png")
    ok_g, det_g = m.green_screen_ok(QA_DIR / f"{stem}_t25.png")
    print(f"  OK -> {final_mp4.name} ({final_mp4.stat().st_size} bytes) greenQA={ok_g} {det_g}", flush=True)
    print(f"  elapsed {time.time() - t0:.0f}s", flush=True)
    print(f"SAMPLE_PATH {final_mp4}", flush=True)
    return 0 if ok_g else 2


if __name__ == "__main__":
    sys.exit(main())
