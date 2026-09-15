"""Batch MiniMax H3: huanzhuang (换装中) greenscreen → 5s vertical I2V for all 13 chars.

Spec: 768×1344, 120 frames @24fps (=5.0s), locked camera, wardrobe pop + changing physics.
Same pipeline as run_minimax_h3_huanzhuang_sample.py.

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/run_minimax_h3_huanzhuang_batch.py
  ... --stem SR01_3 --force
  ... --stem all
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
OUT_DIR = SRC_DIR / "_h3_out"
QA_DIR = SRC_DIR / "_qa_h3"
FIRST_DIR = SRC_DIR / "_first_h3"

WIDTH, HEIGHT = 768, 1344
LENGTH = 120  # 5.0s @ 24fps
STEPS = 30
MAX_ATTEMPTS = 2
GREEN = (0, 177, 64)
GREEN_RGB = np.array(GREEN, dtype=np.float32)

CHARACTERS: dict[str, dict] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "src": "creation_1789113501050.jpg",
        "identity": (
            "ash-blonde high ponytail with metallic white wing-fin hair clips, light blue eyes, pale skin, "
            "holding sheer translucent white changing cloth in front of torso with both hands, "
            "white/silver cybernetic legs from mid-thigh with gold joint accents and heavy mechanical boots, "
            "organic upper body mid-change — huanzhuang changing plate"
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "src": "creation_1789113504554.jpg",
        "identity": (
            "short messy lilac-silver hair, red headband with metal disc, black angular mechanical ear-horns, "
            "golden eyes, full white mecha arms and legs from shoulders/thigh with exposed black joints, "
            "black mechanical neck collar, holding sheer white changing cloth, pale skin upper torso — huanzhuang changing plate"
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "src": "creation_1789113862554.jpg",
        "identity": (
            "long wavy ash-blonde hair with teal-tinted tips and straight bangs, light teal/cyan eyes, "
            "large grey-silver tech headphones with blue glow accents, thin yellow-green glowing halo ring above head, "
            "organic pale body, holding sheer white changing cloth — huanzhuang changing plate"
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "src": "creation_1789113510683.jpg",
        "identity": (
            "long ash-blonde/lavender-silver hair with purple streak in bangs, reddish-pink eyes, "
            "black headset with yellow-gold horizontal wing antenna, dark circuit cybernetics on neck, "
            "white angular mecha legs from mid-thigh with yellow-orange accents, holding sheer white changing cloth — huanzhuang changing plate"
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "src": "creation_1789113507826.jpg",
        "identity": (
            "long black high messy ponytail with orange fin-like mechanical hair clips, orange/golden eyes, "
            "orange-grey-black MB-02 cybernetic arms from shoulders, white-orange angular mecha legs from mid-thigh "
            "to pointed heels, holding sheer orange translucent changing cloth — huanzhuang changing plate"
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "src": "creation_1789113517098.jpg",
        "identity": (
            "long wavy silver-white hair, bright yellow/amber eyes, black half-face respirator gas mask ALWAYS covering "
            "nose and mouth, large white mechanical fox ears with black-grey inner detail, full white cybernetic arms "
            "and legs with gold joint accents, holding sheer white changing cloth — huanzhuang changing plate"
        ),
        "extra": "CRITICAL: NEVER remove or open the respirator mask for all 5 seconds.",
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "src": "creation_1789113521834.jpg",
        "identity": (
            "very long straight jet-black hair with teal-blue mechanical hair clips, red/dark-pink eyes, "
            "teal glowing cyber lines on neck and wrists, black-teal mechanical knee guards and ankle bands, "
            "mostly organic legs with cyber joint accents, holding sheer white changing cloth — huanzhuang changing plate"
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "src": "creation_1789113519786.jpg",
        "identity": (
            "long straight silver-ash hair with white wing-fin side clips, golden-yellow eyes, "
            "large back-mounted mechanical wings with lime-green glowing energy blades and green light strips, "
            "white cybernetic forearms and white pointed mecha legs, holding sheer white changing cloth — huanzhuang changing plate"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "src": "creation_1789113525667.jpg",
        "identity": (
            "long wavy light lavender-blue hair, pink-purple eyes, full white cybernetic arms and legs from "
            "shoulder/thigh with gold circular mechanical joints, chunky white mecha boots with red heel glow accents, "
            "holding sheer white changing cloth — huanzhuang changing plate"
        ),
        "extra": (
            "WARDROBE SIZE LOCK: wardrobe must be a SMALL freestanding prop to one side only (≤25% frame width). "
            "ALL FOUR CORNERS of the frame must stay pure flat #00b140 green — never cover corners with wardrobe, floor, or clothes."
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "src": "creation_1789113523824.jpg",
        "identity": (
            "long straight pink/red hair with bangs, reddish-brown eyes, black pointed mechanical fox-cat ears, "
            "full glossy black cybernetic arms and legs with red joint accents, large black segmented mechanical "
            "scorpion tail curving upward, kneeling pose holding sheer white changing cloth — huanzhuang changing plate"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "src": "creation_1789113527514.jpg",
        "identity": (
            "long vibrant orange hair in multi-tiered high ponytail with golden-bronze hairpins and green tassel ornaments, "
            "reddish-orange eyes, teal-blue metallic forehead plate, mostly organic body barefoot, "
            "holding sheer white changing cloth — huanzhuang changing plate"
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "src": "creation_1789113529595.jpg",
        "identity": (
            "long straight black hair with pink-lavender underlayer highlights, reddish-brown eyes, "
            "glowing double-ring white-cyan mechanical halo above head, dark mechanical neck collar and shoulder ports, "
            "white-chrome transparent-style cybernetic left leg with organic right leg, mechanical earpiece headphones, "
            "holding sheer white changing cloth — huanzhuang changing plate"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "src": "creation_1789113531891.jpg",
        "identity": (
            "short messy light blue/periwinkle bob hair, lavender eyes, tall white rabbit ears with pink inner lining, "
            "black X hair clip and pink heart clip in bangs, thin black choker, organic barefoot body, "
            "holding large sheer white changing cloth — huanzhuang changing plate"
        ),
    },
}


def fit_greenscreen_jpg(src: Path, dest: Path) -> Path:
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


def build_huanzhuang_prompt(identity: str, extra: str = "") -> str:
    extra_block = f"\n{extra}\n" if extra else ""
    return f"""Professional film-set chroma key action plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution.

FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, no pull-out, no added headroom.

LOCKED identity from first frame: {identity}. Keep the same face, hair, cybernetics, accessories, and sheer changing cloth continuity.
{extra_block}
CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. Framing identical throughout. 镜头静止不动.

ACTION timeline (5 seconds), natural continuous motion:
[0.0-0.8s] Suddenly a simple freestanding wardrobe / closet prop pops into frame beside her (still on pure green matte — wardrobe is the only set piece; no floor, no room). 突然弹出衣柜.
[0.8-4.2s] She is mid-change in front of the wardrobe: natural breathing, soft blinks, gentle weight shift; hands adjust / pull the sheer changing cloth with realistic fabric physics (folds, cling, slip); body and cloth keep physical interaction; tasteful game-style changing motion, not frantic, not camera-aware dance.
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


def process_one(stem: str, force: bool = False) -> dict:
    meta = CHARACTERS[stem]
    name = meta["name"]
    src = SRC_DIR / meta["src"]
    result: dict = {"stem": stem, "name": name, "ok": False}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)

    final_mp4 = OUT_DIR / f"{stem}_huanzhuang_gs_h3.mp4"
    # also accept prior sample path for SR01_2
    sample_mp4 = SRC_DIR / "_h3_sample" / f"{stem}_huanzhuang_gs_h3.mp4"
    if not force:
        if final_mp4.exists() and final_mp4.stat().st_size > 80_000:
            print(f"[SKIP] {stem} {name} exists {final_mp4.name}", flush=True)
            result["ok"] = True
            result["skipped"] = True
            result["path"] = str(final_mp4)
            return result
        if sample_mp4.exists() and sample_mp4.stat().st_size > 80_000:
            shutil.copy2(sample_mp4, final_mp4)
            print(f"[SKIP+COPY] {stem} {name} from _h3_sample", flush=True)
            result["ok"] = True
            result["skipped"] = True
            result["path"] = str(final_mp4)
            return result

    if not src.exists():
        result["error"] = f"missing {src.name}"
        print(f"[FAIL] {stem} {result['error']}", flush=True)
        return result

    gs_path = FIRST_DIR / f"{stem}_huanzhuang_first.png"
    fit_greenscreen_jpg(src, gs_path)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)
    prompt = build_huanzhuang_prompt(meta["identity"], meta.get("extra", ""))
    (QA_DIR / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")

    out_leaf = f"{stem}_huanzhuang_gs"
    out_prefix = f"video/{out_leaf}"
    last_err = ""

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = 2026091100 + (abs(hash(stem)) % 100000) + attempt * 131
        if force:
            seed = (seed + int(time.time()) + attempt * 9973) & 0x7FFFFFFF
        print(f"=== {stem} {name} attempt {attempt}/{MAX_ATTEMPTS} seed={seed} ===", flush=True)
        t0 = time.time()
        try:
            wf = build_workflow(input_name, out_prefix, prompt, seed)
            pid = m.api(
                "/prompt",
                {"prompt": wf, "client_id": str(uuid.uuid4())},
            )["prompt_id"]
            print(f"  queued {pid}", flush=True)
            entry = m.wait_prompt(pid, timeout_s=7200.0)
            out = m.find_latest_output(out_leaf, t0)
            if out is None:
                raise RuntimeError(f"no output; status={entry.get('status')}")
            shutil.copy2(out, final_mp4)
            for t, tag in [(0.2, "t02"), (2.5, "t25"), (4.8, "t48")]:
                m.extract_frame(final_mp4, t, QA_DIR / f"{stem}_{tag}.png")
            ok_g, det_g = m.green_screen_ok(QA_DIR / f"{stem}_t25.png")
            print(
                f"  greenQA={'PASS' if ok_g else 'FAIL'} {det_g} elapsed={time.time() - t0:.0f}s",
                flush=True,
            )
            if not ok_g:
                last_err = det_g
                continue
            result["ok"] = True
            result["path"] = str(final_mp4)
            result["seed"] = seed
            result["bytes"] = final_mp4.stat().st_size
            print(f"  ACCEPTED -> {final_mp4.name} ({result['bytes']} bytes)", flush=True)
            return result
        except Exception as e:
            last_err = str(e)
            print(f"  ERROR: {e}", flush=True)
            time.sleep(5)

    result["error"] = last_err or "failed"
    print(f"[FAIL] {stem} {name}: {result['error']}", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all", help="artStem, comma list, or all")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--skip", default="", help="comma stems to skip")
    args = ap.parse_args()

    skip = {s.strip() for s in args.skip.split(",") if s.strip()}
    if args.stem == "all":
        stems = list(CHARACTERS.keys())
    else:
        stems = [s.strip() for s in args.stem.split(",") if s.strip()]
    for stem in stems:
        if stem not in CHARACTERS:
            print(f"unknown stem: {stem}", file=sys.stderr)
            return 2

    print("=== huanzhuang H3 batch ===", flush=True)
    print(f"spec: {WIDTH}x{HEIGHT} length={LENGTH} steps={STEPS}", flush=True)
    m.api("/system_stats")

    results = []
    for stem in stems:
        if stem in skip:
            print(f"[SKIP ARG] {stem}", flush=True)
            continue
        results.append(process_one(stem, force=args.force))

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
        "results": results,
    }
    QA_DIR.mkdir(parents=True, exist_ok=True)
    (QA_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("SUMMARY", json.dumps({"ok": summary["ok"], "fail": summary["fail"]}, ensure_ascii=False), flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    sys.exit(main())
