"""pifu05 phase-2 tease LOOP from user-selected pose stills → 5s VP9 WebM.

Uses one approved pose PNG per character under _qa_tease2_pose/{stem}/.
Generates locked-camera 5s idle loop (H3 quality), keys to transparent WebM.
Retries on QA fail (green/likeness/nipple/over-key).

Usage:
  python scripts/run_pifu05_tease2_from_pose_batch.py --stem all --force
  python scripts/run_pifu05_tease2_from_pose_batch.py --stem SR02_1,UR04_1 --force
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

TEASE2 = ROOT / "scripts" / "run_minimax_h3_pifu05_tease2_batch.py"
_t2_spec = importlib.util.spec_from_file_location("tease2_batch", TEASE2)
t2 = importlib.util.module_from_spec(_t2_spec)
assert _t2_spec.loader is not None
_t2_spec.loader.exec_module(t2)

SLEEP = ROOT / "scripts" / "run_minimax_h3_pifu02_sleep_batch.py"
_sb_spec = importlib.util.spec_from_file_location("sleep_batch", SLEEP)
sb = importlib.util.module_from_spec(_sb_spec)
assert _sb_spec.loader is not None
_sb_spec.loader.exec_module(sb)

from_pose = importlib.util.spec_from_file_location(
    "sleep_from_pose", ROOT / "scripts" / "run_minimax_h3_pifu02_sleep_from_pose_batch.py"
)
sfp = importlib.util.module_from_spec(from_pose)
assert from_pose.loader is not None
from_pose.loader.exec_module(sfp)

from chroma_key_gs_video_webm import verify_has_alpha  # noqa: E402

m = t2.m
SRC_DIR = t2.SRC_DIR
QA_POSE = SRC_DIR / "_qa_tease2_pose"
QA_OUT = SRC_DIR / "_qa_tease2_from_pose"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
GREEN_KEY = (0, 177, 64)

WIDTH, HEIGHT = t2.WIDTH, t2.HEIGHT
LENGTH = 120  # 5.0s @ 24fps
STEPS = 22
MAX_ATTEMPTS = 6
H3_WAIT_TIMEOUT_S = 7200.0

# User-selected pose stills (one per character)
POSE_SOURCES: dict[str, Path] = {
    "SR01_2": QA_POSE / "SR01_2" / "screenshot-20260827-210955.png",
    "SR01_3": QA_POSE / "SR01_3" / "SR01_3_tease2_pose_A.png",
    "SR02_1": QA_POSE / "SR02_1" / "SR02_1_tease2_pose_1.png",
    "SR03_1": QA_POSE / "SR03_1" / "screenshot-20260827-211331.png",
    "SR04_1": QA_POSE / "SR04_1" / "SR04_1_tease2_pose_2.png",
    "SR05_1": QA_POSE / "SR05_1" / "SR05_1_tease2_pose_2.png",
    "SSR01_1": QA_POSE / "SSR01_1" / "screenshot-20260827-211544.png",
    "SSR02_1": QA_POSE / "SSR02_1" / "SSR02_1_tease2_pose_1_gs.png",
    "SSR03_1": QA_POSE / "SSR03_1" / "SSR03_1_tease2_pose_2.png",
    "SSR04_1": QA_POSE / "SSR04_1" / "SSR04_1_tease2_pose_1.png",
    "SSR05_1": QA_POSE / "SSR05_1" / "SSR05_1_tease2_pose_2.png",
    "UR03_1": QA_POSE / "UR03_1" / "UR03_1_tease2_pose_1.png",
    "UR04_1": QA_POSE / "UR04_1" / "UR04_1_nipple_reject_2_a3.png",
}

POSE_FROM_PLATE_LOCK = (
    "CRITICAL POSE LOCK: the first-frame image IS the user-approved pose plate.\n"
    "Body pose, limb angles, camera angle, outfit coverage MUST match frame 0 exactly.\n"
    "DO NOT morph into a different pose or standing default. Micro idle motion ONLY.\n"
    "First frame ≈ last frame for seamless 5-second loop.\n\n"
)

OUTFIT_FROM_PLATE_LOCK = (
    "OUTFIT LOCK (entire 5 seconds):\n"
    "- Clothing identical to first frame — same straps, cups, skirt/shorts positions\n"
    "- Fabric may tremble 1-2mm on breathing; NO undress, NO strap slip beyond plate state\n"
    "- Chest fabric fully opaque; NO nipples/areola visible at any frame\n\n"
)

# Per-character 5s micro-loop acting (personality + subtle hip/chest sway)
IDLE_5S: dict[str, dict[str, str]] = {
    "SR01_2": {
        "expression": (
            "ice-blue eyes half-lidded → lock viewer; lips parted 3mm with breath; "
            "cold micro-smirk every ~2s; natural blinks"
        ),
        "motion": (
            "[0.0-1.7s] Seated hip slow circle grind once; subtle chest rise on inhale\n"
            "[1.7-3.3s] Free hand micro-traces waist/thigh; shoulder strap fabric trembles (stays on)\n"
            "[3.3-5.0s] Raised knee closes 1cm then opens → return to opening pose"
        ),
    },
    "SR01_3": {
        "expression": (
            "purple eyes downcast → lock viewer; lips parted; faint permission half-smile ~3s; slow blinks"
        ),
        "motion": (
            "[0.0-1.7s] Fingers trace lace stocking top; subtle hip sway\n"
            "[1.7-3.3s] Cape corner drags over shoulder; chest lace trembles on breath\n"
            "[3.3-5.0s] Knees open 5° then close → return kneel glance"
        ),
    },
    "SR02_1": {
        "expression": (
            "teal eyes soft firm gaze; bite lower lip lightly every ~2s; blush cycles with breath; natural blinks"
        ),
        "motion": (
            "[0.0-1.7s] Thumbs hook V-neck edges outward 2mm then release; chest soft bounce on breath\n"
            "[1.7-3.3s] Torso lean forward 8° then back; hip micro-sway\n"
            "[3.3-5.0s] Finger lifts coat collar then drops → M-leg sit loop"
        ),
    },
    "SR03_1": {
        "expression": (
            "amber eyes calm half-lidded; tongue tip touches lower lip 0.3s once; 1mm lip-corner rise; blinks"
        ),
        "motion": (
            "[0.0-1.7s] Index traces harness straps; extended leg toe flex; hip sway\n"
            "[1.7-3.3s] Skirt hem lifts 1cm then covers; chest rise on breath\n"
            "[3.3-5.0s] Leg returns, hand to knee → loop close"
        ),
    },
    "SR04_1": {
        "expression": (
            "amber eyes low-line gaze; lips parted slow breath; tongue tip to upper teeth ~3s (NO drool); blinks"
        ),
        "motion": (
            "[0.0-1.7s] Hands tighten corset laces slightly; bust line lifts on fabric (stays covered)\n"
            "[1.7-3.3s] Hips slow forward thrust once; chest/hip counter-sway\n"
            "[3.3-5.0s] Laces loosen 5mm → return lean pose"
        ),
    },
    "SR05_1": {
        "expression": (
            "amber eyes alternate wink; brows playful; seduction through eyes (respirator stays); blinks"
        ),
        "motion": (
            "[0.0-1.7s] Fingers pull coat lapels wider; hip micro-sway in squat\n"
            "[1.7-3.3s] Finger traces thigh strap; chest bounce on breath\n"
            "[3.3-5.0s] Shoulder shrug, ears twitch → return squat"
        ),
    },
    "SSR01_1": {
        "expression": (
            "crimson eyes unblinking 2s then slow blink; whip handle near lips; faint brow raise; blinks"
        ),
        "motion": (
            "[0.0-1.7s] Whip tip traces collarbone → corset edge; subtle hip grind kneeling\n"
            "[1.7-3.3s] Knees shift 3cm; chest rise on breath\n"
            "[3.3-5.0s] Whip returns to neck coil → opening kneel"
        ),
    },
    "SSR02_1": {
        "expression": (
            "bright green eyes laughing gaze; open smile → close; flirt wink ~1.5s; natural blinks"
        ),
        "motion": (
            "[0.0-1.7s] Hips trace small figure-8; chest soft sway with wings half-spread\n"
            "[1.7-3.3s] Hands slide to hips; fingertips press bikini edge (fabric trembles)\n"
            "[3.3-5.0s] Arms return overhead → S-curve standing loop"
        ),
    },
    "SSR03_1": {
        "expression": (
            "soft pink eyes shy lift → glance away → look back; lip bitten lightly; blush with breath; blinks"
        ),
        "motion": (
            "[0.0-1.7s] Hand lifts lace skirt 1cm then covers; hip micro-grind side-lying\n"
            "[1.7-3.3s] Bent leg slow 3cm grind; chest rise on exhale\n"
            "[3.3-5.0s] Eyes shy away → return side-lie pose"
        ),
    },
    "SSR04_1": {
        "expression": (
            "reddish-pink eyes gentle smile; tongue tip to upper teeth ~3s (NO tongue out); blinks"
        ),
        "motion": (
            "[0.0-1.7s] Fingers hook slit edge twice; hip sway prone kneel\n"
            "[1.7-3.3s] Tail tip crawls inner calf; chest rise/fall one breath cycle\n"
            "[3.3-5.0s] Torso settles → prone kneel loop"
        ),
    },
    "SSR05_1": {
        "expression": (
            "amber eyes look away → steal glance; lips pout → part; NO drool; blinks"
        ),
        "motion": (
            "[0.0-1.7s] Curl hugging knees; subtle shoulder tremble on breath\n"
            "[1.7-3.3s] Knees open slightly; chest lean forward (harness trembles, stays on)\n"
            "[3.3-5.0s] Face turns away blushing, knees close → curl loop"
        ),
    },
    "UR03_1": {
        "expression": (
            "rose-pink eyes cold gaze; faint permission nod ~3s; lips parted breath; halo steady; blinks"
        ),
        "motion": (
            "[0.0-1.7s] Forward lean 10°; harness strap micro-tension; chest rise\n"
            "[1.7-3.3s] Glass leg gears rotate slightly; hip sway kneeling\n"
            "[3.3-5.0s] Torso upright, hands on knees → kneel sit loop"
        ),
    },
    "UR04_1": {
        "expression": (
            "amber eyes innocent → predatory switch; closed-lip smirk; bunny ears twitch; wink ~2s; blinks"
        ),
        "motion": (
            "[0.0-1.7s] Rear-side hip sway left-right once; subtle shoulder roll\n"
            "[1.7-3.3s] Jacket fabric shifts 2mm on breath; glance back over shoulder\n"
            "[3.3-5.0s] Heel lowers then raises → return rear-side stand pose"
        ),
    },
}


def resolve_pose_source(stem: str) -> Path | None:
    preferred = POSE_SOURCES.get(stem)
    if preferred and preferred.exists():
        return preferred
    folder = QA_POSE / stem
    if not folder.is_dir():
        return None
    cands: list[Path] = []
    for p in sorted(folder.glob("*.png"), key=lambda x: -x.stat().st_mtime):
        n = p.name.lower()
        if any(x in n for x in ("reject", "nipple", "prompt", "_gs.png")):
            continue
        if n.endswith("_gs.png"):
            continue
        cands.append(p)
    return cands[0] if cands else None


def _corner_green_ok(rgb: np.ndarray) -> bool:
    key = np.array(GREEN_KEY, dtype=np.float32)
    h, w = rgb.shape[:2]
    pts = [rgb[8, 8], rgb[8, w - 9], rgb[h - 9, 8], rgb[h - 9, w - 9]]
    return all(float(np.linalg.norm(p - key)) < 45.0 for p in pts)


def normalize_pose_plate(stem: str, src: Path, dest: Path) -> Path:
    """Build 768x1344 green first-frame plate from user pose still."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(src)
    if img.mode == "RGBA" and img.getchannel("A").getextrema()[1] < 250:
        plate = m.make_greenscreen(src, dest)
    else:
        rgb = np.asarray(img.convert("RGB")).astype(np.float32)
        h, w = rgb.shape[:2]
        if (w, h) == (WIDTH, HEIGHT) and _corner_green_ok(rgb):
            Image.fromarray(rgb.astype(np.uint8), "RGB").save(dest, "PNG")
        else:
            key = np.array(m.GREEN, dtype=np.float32)
            subj = np.linalg.norm(rgb - key, axis=2) > 70.0
            ys, xs = np.where(subj)
            if len(xs) < 80:
                raise RuntimeError(f"empty subject on green plate: {src}")
            pad = 4
            l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
            r, b = min(w, int(xs.max()) + 1 + pad), min(h, int(ys.max()) + 1 + pad)
            crop = rgb[t:b, l:r]
            ch, cw = crop.shape[:2]
            margin = 0.02
            max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * (1 - 2 * margin))
            scale = min(max_w / cw, max_h / ch)
            nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
            crop_img = Image.fromarray(crop.astype(np.uint8)).resize((nw, nh), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (WIDTH, HEIGHT), tuple(m.GREEN))
            canvas.paste(crop_img, ((WIDTH - nw) // 2, (HEIGHT - nh) // 2))
            canvas.save(dest, "PNG")
            print(f"  pose plate {dest.name} scale={nw}x{nh} h%={nh / HEIGHT * 100:.1f}", flush=True)
        m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dest, m.COMFY_INPUT / dest.name)
        plate = dest
    ok_b, det_b = sb.body_complete_ok(plate)
    print(f"  pose_plate body: {'PASS' if ok_b else 'FAIL'} {det_b}", flush=True)
    if not ok_b:
        raise RuntimeError(f"pose plate body incomplete: {det_b}")
    return plate


def stand_reference_gs(stem: str) -> Path:
    dest = QA_OUT / stem / f"{stem}_stand_ref_gs.png"
    src = SRC_DIR / f"{stem}_pifu05.png"
    if not src.exists():
        raise FileNotFoundError(src)
    if not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime:
        m.make_greenscreen(src, dest)
    return dest


def build_from_pose_prompt(meta: dict, stem: str) -> str:
    idle = IDLE_5S[stem]
    extra = meta.get("extra_lock", "")
    extra_block = f"{extra}\n\n" if extra else ""
    identity = meta.get("identity", "")
    id_block = f"LOCKED identity from first frame: {identity}\n\n" if identity else ""
    return (
        f"{t2.CHROMA_BASE}\n\n"
        f"{t2.ANIME_STYLE_BLOCK}{t2.BODY_LOCK_BLOCK}{t2.EXPRESSION_BLOCK}"
        f"{t2.EXPOSURE_SAFETY}"
        f"{POSE_FROM_PLATE_LOCK}{OUTFIT_FROM_PLATE_LOCK}"
        f"{id_block}{extra_block}"
        f"5-SECOND SEAMLESS IDLE LOOP — micro motion on frozen approved pose.\n"
        f"Natural blinks, breathing, subtle hip/chest sway allowed (small amplitude).\n\n"
        f"EXPRESSION (alive seductive, character personality):\n{idle['expression']}\n\n"
        f"LOOP MOTION (5 seconds, seamless):\n{idle['motion']}\n\n"
        f"Character: {meta['name']} ({stem})."
    )


def build_workflow_pose(input_name: str, out_prefix: str, prompt: str, seed: int, meta: dict) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    if "last_frame" in wf["104"]["inputs"]:
        del wf["104"]["inputs"]["last_frame"]
    wf["9"]["inputs"]["steps"] = STEPS
    if meta.get("anime_lock"):
        wf["200"]["inputs"]["shift_video"] = 5.0
    return wf


def key_with_overkey_check(
    gs_mp4: Path,
    pose_gs: Path,
    final_webm: Path,
    qa_stem: Path,
    qa_tag: str,
    attempt: int,
) -> tuple[bool, str]:
    """Key via tease2 rembg pipeline; reject if alpha OK but silhouette eaten vs pose plate."""
    tmp_webm = qa_stem / f"a{attempt}_keyed.webm"
    ok_key, det_key = t2.key_to_webm(gs_mp4, tmp_webm, qa_tag, force=True)
    if not ok_key:
        return False, det_key
    ok_a, det_a = verify_has_alpha(tmp_webm, min_zero_pct=25.0)
    if not ok_a:
        return False, f"alpha verify fail: {det_a}"
    frame_rgba = qa_stem / f"a{attempt}_key_rgba.png"
    sfp.KEY_RGB = np.array(GREEN_KEY, dtype=np.float32)
    sfp.decode_webm_frame(tmp_webm, frame_rgba, t=0.35)
    ok_o, det_o = sfp.overkey_vs_static_ok(pose_gs, frame_rgba)
    if not ok_o:
        return False, f"overkey: {det_o}"
    shutil.copy2(tmp_webm, final_webm)
    return True, f"{det_key} | overkey {det_o}"


def process_one(stem: str, force: bool = False, *, skip_nipple_qa: bool = False) -> dict:
    if stem not in t2.CHARACTERS:
        return {"stem": stem, "ok": False, "error": "unknown stem"}
    meta = dict(t2.CHARACTERS[stem])
    meta["_stem"] = stem
    name = meta["name"]
    src_pose = resolve_pose_source(stem)
    final_webm = SRC_DIR / f"{stem}_pifu05_2.webm"
    gs_mp4 = SRC_DIR / f"{stem}_pifu05_tease2_from_pose_gs.mp4"
    pose_gs = QA_OUT / stem / f"{stem}_tease2_from_pose_gs.png"
    result: dict = {
        "stem": stem,
        "name": name,
        "ok": False,
        "path": str(final_webm),
        "pose_src": str(src_pose) if src_pose else "",
        "attempts": [],
    }

    if src_pose is None or not src_pose.exists():
        result["error"] = "missing selected pose"
        print(f"[FAIL] {stem} missing pose under _qa_tease2_pose/{stem}/", flush=True)
        return result

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} {name} pifu05_2.webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    print(f"=== {stem} {name} tease2 FROM-POSE (5s) ===", flush=True)
    print(f"  pose_src: {src_pose.name}", flush=True)

    qa_stem = QA_OUT / stem
    qa_stem.mkdir(parents=True, exist_ok=True)
    must_rebuild = force or not pose_gs.exists() or pose_gs.stat().st_mtime < src_pose.stat().st_mtime
    if must_rebuild:
        normalize_pose_plate(stem, src_pose, pose_gs)
    else:
        print(f"  reuse pose plate {pose_gs.name}", flush=True)

    stand_gs = stand_reference_gs(stem)
    sb.KEY = GREEN_KEY
    sb.KEY_RGB = np.array(GREEN_KEY, dtype=np.float32)
    ok_nip_pose, det_nip_pose = sb.no_nipple_leak_ok(
        pose_gs, stand_gs, after_chroma=False, video_frame=True
    )
    print(f"  QA pose_nipple: {'PASS' if ok_nip_pose else 'WARN'} {det_nip_pose}", flush=True)

    prompt = build_from_pose_prompt(meta, stem)
    (qa_stem / f"{stem}_from_pose_prompt.txt").write_text(prompt, encoding="utf-8")

    input_name = m.upload_image(pose_gs)
    shutil.copy2(pose_gs, m.COMFY_INPUT / input_name)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = 2026082710 + (abs(hash(stem)) % 100000) + attempt * 193
        print(
            f"[{stem}] attempt {attempt}/{MAX_ATTEMPTS} seed={seed} len={LENGTH} steps={STEPS}",
            flush=True,
        )
        t0 = time.time()
        try:
            out_leaf = f"{stem}_pifu05_tease2_from_pose"
            out_prefix = f"video/{out_leaf}"
            wf = build_workflow_pose(input_name, out_prefix, prompt, seed, meta)
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            m.wait_prompt(prompt_id, timeout_s=H3_WAIT_TIMEOUT_S)
            print(f"  h3 done in {time.time() - t0:.1f}s", flush=True)

            out = m.find_latest_output(out_leaf, t0)
            if out is None:
                raise RuntimeError("output mp4 not found")
            shutil.copy2(out, qa_stem / f"a{attempt}.mp4")
            shutil.copy2(out, gs_mp4)

            f0 = m.extract_frame(out, 0.35, qa_stem / f"a{attempt}_t035.png")
            f1 = m.extract_frame(out, 2.5, qa_stem / f"a{attempt}_t250.png")
            f2 = m.extract_frame(out, 4.6, qa_stem / f"a{attempt}_t460.png")
            frames = [(f0, "t0.35"), (f1, "t2.5"), (f2, "t4.6")]

            checks: list[tuple[str, bool, str]] = []
            checks.extend(t2.run_qa_checks(meta, pose_gs, frames, strict=True))
            if skip_nipple_qa:
                checks = [
                    (l, o, d)
                    for l, o, d in checks
                    if not l.startswith("face_portrait")
                ]
            else:
                for fp, label in frames:
                    ok_vnip, det_vnip = sb.no_nipple_leak_ok(
                        fp, stand_gs, after_chroma=False, video_frame=True
                    )
                    checks.append((f"nipple[{label}]", bool(ok_vnip), str(det_vnip)))
            ok_fab, det_fab = sfp.cover_lock_vs_static_ok(pose_gs, f1)
            checks.append(("cover[t2.5]", bool(ok_fab), str(det_fab)))

            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)

            if not all(ok for _, ok, _ in checks):
                result["attempts"].append(
                    {"attempt": attempt, "seed": seed, "ok": False, "stage": "frame_qa", "checks": checks}
                )
                print(f"  REJECT frame QA attempt {attempt}", flush=True)
                continue

            ok_key, det_key = key_with_overkey_check(
                gs_mp4, pose_gs, final_webm, qa_stem, f"{stem}_pifu05_2", attempt
            )
            print(f"  KEY {'PASS' if ok_key else 'FAIL'} {det_key}", flush=True)
            if not ok_key:
                result["attempts"].append(
                    {"attempt": attempt, "seed": seed, "ok": False, "stage": "overkey", "det": det_key}
                )
                continue

            result["ok"] = True
            result["attempts"].append(
                {
                    "attempt": attempt,
                    "seed": seed,
                    "ok": True,
                    "mp4": str(gs_mp4),
                    "key": det_key,
                    "checks": checks,
                }
            )
            print(
                f"  ACCEPTED -> {final_webm} ({final_webm.stat().st_size // 1024} KB)",
                flush=True,
            )
            return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": str(e)})
            time.sleep(3)

    result["error"] = f"failed after {MAX_ATTEMPTS} attempts"
    print(f"[FAIL] {stem} {name} after {MAX_ATTEMPTS} attempts", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all", help="stem, comma list, or all (13 chars)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    stems = list(POSE_SOURCES.keys()) if args.stem == "all" else [
        s.strip() for s in args.stem.replace(";", ",").split(",") if s.strip()
    ]
    unknown = [s for s in stems if s not in POSE_SOURCES]
    if unknown:
        print(f"unknown stem(s): {', '.join(unknown)}", file=sys.stderr)
        return 2

    missing = [s for s in stems if resolve_pose_source(s) is None]
    if missing:
        print("MISSING pose plates:", ", ".join(missing), flush=True)
        stems = [s for s in stems if s not in missing]
        if not stems:
            return 2

    print("=== pifu05 tease2 FROM-POSE batch (5s quality loop) ===", flush=True)
    print(f"SRC: {SRC_DIR}", flush=True)
    print(f"spec: {WIDTH}x{HEIGHT} length={LENGTH} (~5.0s) steps={STEPS} max_attempts={MAX_ATTEMPTS}", flush=True)
    m.api("/system_stats")

    QA_OUT.mkdir(parents=True, exist_ok=True)
    results = []
    for stem in stems:
        r = process_one(stem, force=args.force)
        results.append(r)
        if not r.get("skipped"):
            sb.free_comfy_vram()

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
    }
    manifest = {
        "summary": summary,
        "pose_sources": {k: str(v) for k, v in POSE_SOURCES.items()},
        "results": results,
        "spec": {"length": LENGTH, "steps": STEPS, "duration_s": 5.0},
    }
    report = QA_OUT / "tease2_from_pose_batch_report.json"
    report.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=== SUMMARY ===", flush=True)
    print("OK:", ", ".join(summary["ok"]) or "(none)", flush=True)
    print("FAIL:", ", ".join(summary["fail"]) or "(none)", flush=True)
    print("report:", report, flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
