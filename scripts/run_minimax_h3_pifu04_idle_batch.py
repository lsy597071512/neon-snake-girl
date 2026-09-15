"""Batch MiniMax H3: 都市私服 pifu04 greenscreen idle → transparent webm.

Vertical 768×1344, 5s (120 frames @24fps), fixed camera, loop-consistent ends.
Requires ComfyUI http://127.0.0.1:8188 + MiniMax H3 weights.

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_minimax_h3_pifu04_idle_batch.py --stem all
  ... --stem SSR04_1 --force
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

from chroma_key_gs_video_webm import gs_mp4_to_webm  # noqa: E402

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "shenghuoshizhuang01"
QA_DIR = SRC_DIR / "_qa"
FIRST_DIR = SRC_DIR / "_first"

WIDTH, HEIGHT = 768, 1344
LENGTH = 120  # 5.0s @ 24fps
STEPS = 30
MAX_ATTEMPTS = 3

# artStem → display name + locked urban casual look (match pifu04 PNG)
CHARACTERS: dict[str, dict[str, str]] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "identity": (
            "ash-blonde high ponytail with metallic white wing-fin hair clips, light blue eyes, "
            "silver-gray flight jacket over white street skirt outfit, dark gray cybernetic right arm "
            "with gold accents, white/gray cybernetic leg prosthetics and boots — urban casual daywear"
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "identity": (
            "messy short silver-white hair with red headband, pale blue eyes, mint-green sheer jacket "
            "over white sporty crop top and shorts, glossy white mecha arms/legs with black joints "
            "and red fin heels — urban casual"
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "identity": (
            "long wavy ash-blonde hair, teal eyes, translucent halo headset, silver-white streetwear "
            "set with handbag and coffee cup vibe, grey-gold mechanical right arm and boots — gentle urban stroll"
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "identity": (
            "long silver-grey hair with charcoal bang streak, amber-orange eyes, yellow-tipped antenna headset, "
            "transparent short skirt street outfit, white-yellow cyber legs — urban casual reader off-duty"
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "identity": (
            "long jet-black high ponytail, amber-orange eyes, orange-black bomber jacket street look, "
            "MB-02 shoulder plate on white-orange cyber arms and mechanical legs — urban casual gunner"
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "identity": (
            "long white hair, white feline ears with yellow-black accents, amber-gold eyes, black/yellow respirator, "
            "white-yellow transparent windbreaker athletic streetwear, white-silver mechanical hands/feet"
        ),
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "identity": (
            "long straight jet-black hair with cyan-green triangular clips, crimson eyes, black leather short jacket, "
            "matte black left arm prosthetic with green panels, olive/charcoal mechanical right leg — night-out casual"
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "identity": (
            "long straight silver-white hair with bangs, bright neon emerald-green eyes, white-silver fully mechanical arms "
            "with black joints, pointed blade-like mechanical feet with neon green pulse vents, compact angular mechanical wings "
            "on back with dark frame and translucent glowing neon-green panels, oversized semi-transparent white-mint tech bomber "
            "jacket worn open, neon-green zipper accents, fitted short white crop top, high-waist charcoal tech shorts with green trim, "
            "iced coffee cup in one mechanical hand — urban casual Neon Day Stroll"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "identity": (
            "long wavy pastel blue-lavender hair, soft pink eyes, white puff transparent street jacket over soft skirt, "
            "platinum mechanical boots with red heel glow — soft urban daywear"
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "identity": (
            "dusty pink/mauve hair with long bangs, reddish-pink eyes, glossy black robotic ears, black jacket "
            "and ankle boots street outfit, polished black/red cybernetic arms and legs — urban night street look"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "identity": (
            "orange twin-tail hair, amber eyes, teal forehead accessory, bomber jacket with coffee-in-hand street vibe, "
            "white glossy mechanical thigh-high boots with red hazard stripes on legs"
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "identity": (
            "long black hair with vivid pink highlights, reddish-brown eyes, large tech headphones, bomber jacket "
            "over casual top, transparent glass-shell left leg prosthetic with golden gears — urban stroll"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "identity": (
            "short light-blue hair with pink highlights, light-blue headband with pink flower, purple-pink eyes, "
            "large white-pink bunny ears, white-orange street outfit with mechanical rabbit companion aesthetic, "
            "white-silver mechanical legs from mid-thigh with orange heart accents"
        ),
    },
}


def build_idle_prompt(identity: str) -> str:
    return f"""Professional film-set chroma key idle plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution look.

FRAMING: character already fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, do not add empty headroom/footroom, do not pull camera back. Subject stays large and centered as in the first frame.

LOCKED to first frame identity and urban casual wardrobe: {identity}. Exact same character design, outfit colors, cybernetics, hair, and accessories throughout.

CAMERA: completely locked tripod, no pan, no tilt, no zoom, no push-in, no pull-out, no drift. Framing identical from start to end.

ACTION (natural idle only, 5 seconds):
- Soft breathing and tiny weight shift (stay large in frame)
- Gentle breeze physics on hair, jacket hems, skirt/fabric edges
- Natural blinking at normal human rate
- Subtle friendly/neutral expression micro-acting, then settle back toward the opening pose for seamless loop
- First frame and last frame must match pose and expression closely for seamless looping

Do NOT change costume, hair color, cybernetic parts, or background. Keep pure flat #00b140 green everywhere behind the subject, no floor, no city backdrop, no shadow catcher, no vignette.

Audio: very soft quiet room tone only, no speech, no music.
"""


def build_workflow_loop(input_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    wf["104"]["inputs"]["last_frame"] = ["114", 0]
    wf["9"]["inputs"]["steps"] = STEPS
    return wf


def process_one(stem: str, force: bool = False) -> dict:
    meta = CHARACTERS[stem]
    name = meta["name"]
    src = SRC_DIR / f"{stem}_pifu04.png"
    final_webm = SRC_DIR / f"{stem}_pifu04.webm"
    gs_mp4 = SRC_DIR / f"{stem}_pifu04_idle_gs_h3.mp4"
    gs_path = SRC_DIR / f"{stem}_pifu04_greenscreen_first.png"
    result = {"stem": stem, "name": name, "ok": False, "path": str(final_webm), "attempts": []}

    if not src.exists():
        result["error"] = "missing png"
        return result

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} {name} webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    m.make_greenscreen(src, gs_path)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(gs_path, FIRST_DIR / gs_path.name)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = build_idle_prompt(meta["identity"])
    out_leaf = f"{stem}_pifu04_idle_gs"
    out_prefix = f"video/{out_leaf}"
    qa_stem = QA_DIR / stem
    qa_stem.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = 2026081910 + (hash(stem) % 100000) + attempt * 97
        print(f"[{stem}] {name} attempt {attempt}/{MAX_ATTEMPTS} seed={seed}", flush=True)
        t_start = time.time()
        try:
            wf = build_workflow_loop(input_name, out_prefix, prompt, seed)
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            m.wait_prompt(prompt_id)
            print(f"  h3 done in {time.time() - t_start:.1f}s", flush=True)
            out = m.find_latest_output(out_leaf, t_start)
            if out is None:
                raise RuntimeError("output mp4 not found")
            shutil.copy2(out, qa_stem / f"a{attempt}.mp4")

            f0 = m.extract_frame(out, 0.35, qa_stem / f"a{attempt}_t035.png")
            f1 = m.extract_frame(out, 2.5, qa_stem / f"a{attempt}_t250.png")
            f2 = m.extract_frame(out, 4.6, qa_stem / f"a{attempt}_t460.png")
            checks = []
            for fp, label in ((f0, "t0.35"), (f1, "t2.5"), (f2, "t4.6")):
                ok_g, det_g = m.green_screen_ok(fp)
                checks.append((f"green[{label}]", bool(ok_g), str(det_g)))
            ok_l, det_l = m.likeness_ok(gs_path, f0)
            checks.append(("likeness", bool(ok_l), str(det_l)))
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if not all(ok for _, ok, _ in checks):
                result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "checks": checks})
                continue

            shutil.copy2(out, gs_mp4)
            gs_mp4_to_webm(gs_mp4, final_webm, fps=24.0)
            result["ok"] = True
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": True, "mp4": str(gs_mp4)})
            print(f"  ACCEPTED -> {final_webm} ({final_webm.stat().st_size // 1024} KB)", flush=True)
            return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": str(e)})
            time.sleep(5)

    print(f"[FAIL] {stem} {name} after {MAX_ATTEMPTS} attempts", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all", help="artStem or all")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    print("=== pifu04 urban casual idle H3 batch ===", flush=True)
    print(f"SRC: {SRC_DIR}", flush=True)
    print(f"spec: {WIDTH}x{HEIGHT} length={LENGTH} (~5.0s)", flush=True)
    m.api("/system_stats")

    stems = list(CHARACTERS.keys()) if args.stem == "all" else [args.stem]
    if args.stem != "all" and args.stem not in CHARACTERS:
        print(f"unknown stem: {args.stem}", file=sys.stderr)
        return 2

    results = [process_one(stem, force=args.force) for stem in stems]
    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
    }
    report = QA_DIR / "pifu04_idle_batch_report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=== SUMMARY ===", flush=True)
    print("OK:", ", ".join(summary["ok"]) or "(none)", flush=True)
    print("FAIL:", ", ".join(summary["fail"]) or "(none)", flush=True)
    print("report:", report, flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
