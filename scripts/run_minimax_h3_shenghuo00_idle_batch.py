"""Batch MiniMax H3: 生活服装00 (shenghuofuzhuang00) greenscreen idle 4s → webm.

Vertical 768×1344, 96 frames @24fps (=4.0s), locked camera, natural idle + cloth/body physics.
Then soft/#green_dom key → {Stem}_shenghuo00.webm

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/run_minimax_h3_shenghuo00_idle_batch.py --stem all
  ... --stem SR01_2 --force
  ... --key-only   # skip H3, only webm from existing mp4
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

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"
spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))
from chroma_key_gs_video_webm import gs_mp4_to_webm  # noqa: E402
from key_huanzhuang_h3_to_webm import (  # noqa: E402
    HUANZHUANG_SAFE_VF,
    encode_green_dom_webm,
)

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "shenghuofuzhuang00"
OUT_DIR = SRC_DIR / "_h3_out"
QA_DIR = SRC_DIR / "_qa_idle"
FIRST_DIR = SRC_DIR / "_first"
WEBM_QA = SRC_DIR / "_webm_qa"

WIDTH, HEIGHT = 768, 1344
LENGTH = 96  # 4.0s @ 24fps
STEPS = 30
MAX_ATTEMPTS = 2

# file → stem (SR04 / SSR05 swapped vs naive orange-hair guess: dark+orange cyber=焰甲, orange twin vibe=橙铠)
CHARACTERS: dict[str, dict] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "src": "tke_img_20260911_215004_3053.png",
        "identity": (
            "ash-blonde high wavy ponytail with wispy bangs, silver-white wing-like cybernetic head plates, "
            "light-blue eyes, white/silver/gold mechanical lower legs with pointed boot-feet, "
            "beige oversized tee and beige cropped joggers — casual home daywear"
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "src": "tke_img_20260911_215019_3054.png",
        "identity": (
            "long wavy periwinkle-lavender hair, light purple eyes, full white cybernetic arms and legs "
            "with gold-bronze elbow/knee joints, plain white oversized tee and white athletic shorts — casual daywear"
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "src": "tke_img_20260911_215035_3056.png",
        "identity": (
            "very long straight ash-blonde hair with blunt bangs, vivid turquoise/teal eyes, "
            "gold headband with silver ear-armor and glowing cyan light strips, white scoop-neck tee and navy dolphin shorts, "
            "barefoot — gentle casual daywear"
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "src": "tke_img_20260911_220243_3094.jpg",
        "identity": (
            "long silver-grey hair with dark streak in bangs, crimson eyes, black left headpiece with glowing yellow optical fin-blade, "
            "white/grey cybernetic lower legs with yellow-orange accents, heather-grey tee and grey shorts — casual daywear"
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "src": "tke_img_20260911_215540_3075.jpg",
        "identity": (
            "dark brown-black hair in high side ponytail with orange mechanical ear accents, amber-orange eyes, "
            "full white/charcoal/orange cybernetic arms and legs with pointed heel-boot feet, "
            "bright orange tee and orange athletic shorts — casual daywear"
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "src": "tke_img_20260911_215716_3082.jpg",
        "identity": (
            "long voluminous white-silver wavy hair, yellow/amber feline eyes, white/black/yellow fox-ear cybernetics, "
            "black respirator mask ALWAYS covering nose and mouth, white/gold/black cybernetic arms and legs, "
            "black oversized tee and grey athletic shorts — casual daywear"
        ),
        "extra": "CRITICAL: NEVER remove or open the respirator mask for all 4 seconds.",
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "src": "tke_img_20260911_215942_3090.jpg",
        "identity": (
            "very long straight black hair with blunt bangs, reddish-brown eyes, teal/cyan glowing circuit lines on neck "
            "and translucent teal forearm/knee panels, barefoot with teal ankle rings, plain black tee and black shorts — casual daywear"
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "src": "tke_img_20260911_215734_3083.jpg",
        "identity": (
            "long straight silver-grey hair with blunt bangs, bright lime-green eyes, large back-mounted mechanical wings "
            "with glowing translucent emerald-green panels, silver cybernetic forearms and pointed silver feet, "
            "off-white oversized sweatshirt and matching shorts — casual daywear"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "src": "tke_img_20260911_215802_3087.jpg",
        "identity": (
            "messy silvery-lavender-blue hair, pale violet eyes, small orange-red forehead plate, black segmented neck, "
            "white/black cybernetic forearms and full legs with orange circular accents, white sweatshirt and black shorts — casual daywear"
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "src": "tke_img_20260911_215749_3085.jpg",
        "identity": (
            "long dusty-rose/pinkish-red hair with blunt bangs, orange-red eyes, pointed black mechanical ear fins, "
            "glossy black cybernetic forearms and legs with red accents, large black segmented mechanical scorpion tail, "
            "white oversized tee and black gym shorts — casual daywear"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "src": "tke_img_20260911_215652_3081.jpg",
        "identity": (
            "bright orange hair with straight bangs in high ponytail with white ruffled scrunchie, reddish-orange eyes, "
            "teal metallic forehead plate, white oversized hoodie, navy athletic shorts, white crew socks and chunky white sneakers — casual daywear"
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "src": "tke_img_20260911_215549_3077.jpg",
        "identity": (
            "long straight black hair with pink under-layer highlights, vivid red eyes, glowing white double-ring halo above head, "
            "mechanical ear attachments and dark neck collar, left leg heavily cybernetic with gears, right leg mostly human with braces, "
            "cream/beige oversized tee and shorts — casual daywear"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "src": "tke_img_20260911_215124_3063.png",
        "identity": (
            "short messy light-blue/periwinkle bob with pink bunny clip and black X clip, warm amber eyes, "
            "large white/pink mechanical bunny ears, cream long-sleeve sweatshirt, cuffed blue denim shorts, "
            "black choker with gold pendant, barefoot — casual daywear"
        ),
    },
}

GREEN_DOM_STEMS = {"SSR03_1", "UR04_1"}


def build_idle_prompt(identity: str, extra: str = "") -> str:
    extra_block = f"\n{extra}\n" if extra else ""
    return f"""Professional film-set chroma key idle plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution.

FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, no pull-out, no added headroom.

LOCKED identity from first frame: {identity}. Exact same face, hair, cybernetics, casual outfit throughout.
{extra_block}
CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. Framing identical throughout. 镜头静止不动.

ACTION (natural idle only, 4 seconds) 待机动作:
- Soft natural breathing and subtle chest physics with cloth/body physical interaction (物理胸部)
- Tiny weight shift, micro idle gestures, natural blinking and gentle facial expression
- Hair, sleeves, shorts hems and soft fabric keep realistic physics
- Stay large and centered; settle toward opening pose for a calm idle loop
- Do NOT change costume, hair color, cybernetics, or add set pieces

Keep pure flat #00b140 green everywhere behind the subject: no floor, no room, no shadow catcher, no vignette.

Audio: very soft quiet room tone only, no speech, no music.
"""


def build_workflow(input_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    wf["9"]["inputs"]["steps"] = STEPS
    return wf


def fit_plate(src: Path, dest: Path) -> Path:
    """Fit PNG/JPG greenscreen plate onto 768×1344 #00b140 canvas."""
    import numpy as np
    from PIL import Image

    GREEN = (0, 177, 64)
    GREEN_RGB = np.array(GREEN, dtype=np.float32)
    im = Image.open(src).convert("RGBA")
    arr = np.asarray(im)
    if arr.shape[2] == 4 and (arr[:, :, 3] < 250).any():
        # has alpha — composite on green
        rgb = arr[:, :, :3].astype(np.float32)
        a = arr[:, :, 3:4].astype(np.float32) / 255.0
        green = np.broadcast_to(GREEN_RGB, rgb.shape)
        out = rgb * a + green * (1.0 - a)
        base = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    else:
        base = im.convert("RGB")
        arr = np.asarray(base).astype(np.float32)
        dist = np.linalg.norm(arr - GREEN_RGB, axis=2)
        mask = dist > 55.0
        ys, xs = np.where(mask)
        if len(xs):
            pad = 4
            l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
            r, b = min(base.width, int(xs.max()) + 1 + pad), min(base.height, int(ys.max()) + 1 + pad)
            base = base.crop((l, t, r, b))

    margin = 0.02
    max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * (1 - 2 * margin))
    scale = min(max_w / base.width, max_h / base.height)
    cw, ch = max(1, int(base.width * scale)), max(1, int(base.height * scale))
    base2 = base.resize((cw, ch), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (WIDTH, HEIGHT), GREEN)
    canvas.paste(base2, ((WIDTH - cw) // 2, (HEIGHT - ch) // 2))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG")
    m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, m.COMFY_INPUT / dest.name)
    print(f"  first plate {dest.name} {cw}x{ch} h%={ch / HEIGHT * 100:.1f}", flush=True)
    return dest


def key_to_webm(stem: str, mp4: Path, webm: Path) -> None:
    WEBM_QA.mkdir(parents=True, exist_ok=True)
    if stem in GREEN_DOM_STEMS:
        encode_green_dom_webm(mp4, webm, fps=24.0, crf=28)
    else:
        gs_mp4_to_webm(mp4, webm, fps=24.0, crf=28, vf=HUANZHUANG_SAFE_VF)


def process_one(stem: str, force: bool = False, key_only: bool = False) -> dict:
    meta = CHARACTERS[stem]
    name = meta["name"]
    src = SRC_DIR / meta["src"]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)

    mp4 = OUT_DIR / f"{stem}_shenghuo00_idle_gs_h3.mp4"
    webm = SRC_DIR / f"{stem}_shenghuo00.webm"
    result: dict = {"stem": stem, "name": name, "ok": False}

    if not src.exists():
        result["error"] = f"missing {src.name}"
        print(f"[MISS] {stem} {result['error']}", flush=True)
        return result

    if webm.exists() and webm.stat().st_size > 50_000 and not force and key_only is False:
        # if both exist skip entirely unless force
        if mp4.exists():
            print(f"[SKIP] {stem} {name} webm exists", flush=True)
            result["ok"] = True
            result["skipped"] = True
            return result

    if not key_only:
        if mp4.exists() and mp4.stat().st_size > 80_000 and not force:
            print(f"[SKIP H3] {stem} mp4 exists", flush=True)
        else:
            gs_path = FIRST_DIR / f"{stem}_shenghuo00_first.png"
            fit_plate(src, gs_path)
            input_name = m.upload_image(gs_path)
            shutil.copy2(gs_path, m.COMFY_INPUT / input_name)
            prompt = build_idle_prompt(meta["identity"], meta.get("extra", ""))
            (QA_DIR / f"{stem}_prompt.txt").write_text(prompt, encoding="utf-8")
            out_leaf = f"{stem}_shenghuo00_idle_gs"
            out_prefix = f"video/{out_leaf}"
            last_err = ""
            ok_h3 = False
            for attempt in range(1, MAX_ATTEMPTS + 1):
                seed = (2026091122 + abs(hash(stem)) % 100000 + attempt * 173 + int(time.time()) % 997) & 0x7FFFFFFF
                print(f"=== {stem} {name} H3 attempt {attempt}/{MAX_ATTEMPTS} seed={seed} ===", flush=True)
                t0 = time.time()
                try:
                    wf = build_workflow(input_name, out_prefix, prompt, seed)
                    pid = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
                    print(f"  queued {pid}", flush=True)
                    entry = m.wait_prompt(pid, timeout_s=7200.0)
                    out = m.find_latest_output(out_leaf, t0)
                    if out is None:
                        raise RuntimeError(f"no output; {entry.get('status')}")
                    shutil.copy2(out, mp4)
                    f1 = m.extract_frame(mp4, 1.5, QA_DIR / f"{stem}_t15.png")
                    ok_g, det_g = m.green_screen_ok(f1)
                    print(f"  greenQA={'PASS' if ok_g else 'FAIL'} {det_g} {time.time()-t0:.0f}s", flush=True)
                    if not ok_g:
                        last_err = det_g
                        continue
                    ok_h3 = True
                    break
                except Exception as e:
                    last_err = str(e)
                    print(f"  ERROR: {e}", flush=True)
                    time.sleep(4)
            if not ok_h3:
                result["error"] = last_err or "h3 failed"
                print(f"[FAIL H3] {stem}: {result['error']}", flush=True)
                return result

    if not mp4.exists():
        result["error"] = "missing mp4 for key"
        return result

    print(f"=== {stem} {name} key→webm ===", flush=True)
    try:
        key_to_webm(stem, mp4, webm)
        result["ok"] = True
        result["mp4"] = str(mp4)
        result["webm"] = str(webm)
        result["bytes"] = webm.stat().st_size
        print(f"  ACCEPTED {webm.name} ({result['bytes']//1024} KB)", flush=True)
    except Exception as e:
        result["error"] = str(e)
        print(f"  FAIL key {e}", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--key-only", action="store_true")
    args = ap.parse_args()

    stems = list(CHARACTERS.keys()) if args.stem == "all" else [s.strip() for s in args.stem.split(",") if s.strip()]
    for s in stems:
        if s not in CHARACTERS:
            print(f"unknown stem {s}", file=sys.stderr)
            return 2

    print("=== shenghuo00 idle H3 4s batch ===", flush=True)
    print(f"spec {WIDTH}x{HEIGHT} length={LENGTH} steps={STEPS}", flush=True)
    if not args.key_only:
        m.api("/system_stats")

    results = [process_one(s, force=args.force, key_only=args.key_only) for s in stems]
    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
        "results": results,
    }
    QA_DIR.mkdir(parents=True, exist_ok=True)
    (QA_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY", json.dumps({"ok": summary["ok"], "fail": summary["fail"]}, ensure_ascii=False), flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    sys.exit(main())
