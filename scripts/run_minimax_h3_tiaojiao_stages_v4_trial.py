"""MiniMax H3: multipose × 3-stage tentacle discipline (r9 NSFW anatomy-accurate).

- Every pose still under webm_tentacle_loop (not one still for all stages)
- Exposure ALLOWED; nipples/genitals must stay anatomically correct (female)
- Reverse char order: UR04_1 → … → SR01_2
- Resume via _pipeline_state.json / _inflight.json

Usage:
  python -u scripts/_build_tiaojiao_pose_inventory.py
  python -u scripts/run_minimax_h3_tiaojiao_stages_v4_trial.py --character all --stem all
  powershell -File scripts/watch_tiaojiao_v4_pipeline.ps1
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

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"
spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

# Import helpers from existing tentacle batch (camera/motion/loop) without changing its OUT_DIR.
TENT = ROOT / "scripts" / "run_minimax_h3_pifu_weizhi_tentacle_loop_batch.py"
tspec = importlib.util.spec_from_file_location("tentacle_batch", TENT)
tm = importlib.util.module_from_spec(tspec)
assert tspec.loader is not None
tspec.loader.exec_module(tm)

OUT_DIR = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "webm_tentacle_loop_v4_stages"
SRC_DIR = OUT_DIR / "_src"  # per-character subdirs
QA_DIR = OUT_DIR / "_qa"
FIRST_DIR = OUT_DIR / "_first"

WIDTH, HEIGHT = 768, 1344
LENGTH = 144  # generate 6.0s @24fps
KEEP_FRAMES = 120  # ship 5.0s
STEPS = 24
MAX_ATTEMPTS = 3
H3_WAIT_TIMEOUT_S = 7200.0
LOOP_BLEND_FRAMES = 3
SEED_BASE = 2026091801  # r9: multipose×3 reverse; NSFW anatomy-accurate exposure allowed
SKIP_GREEN_QA = False  # force green-plate lock for regen
# Tentacle-driven body sway shifts bbox; allow modest scale drift (near-full-frame
# subjects otherwise fail anti-zoom QA on small bob). Still reject real push-in.
CAMERA_CENTER_MAX_SHIFT = 0.12
CAMERA_SCALE_MAX_DELTA = 0.15
OUT_LEAF_SUFFIX = "_r9"

IDENTITY_BIBLE_PATH = OUT_DIR / "_identity_bible.json"
POSE_INVENTORY_PATH = OUT_DIR / "_pose_inventory.json"


def load_identity_bible() -> dict:
    if not IDENTITY_BIBLE_PATH.exists():
        return {}
    try:
        return json.loads(IDENTITY_BIBLE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def load_pose_inventory() -> dict:
    if not POSE_INVENTORY_PATH.exists():
        raise SystemExit(f"missing {POSE_INVENTORY_PATH}; run scripts/_build_tiaojiao_pose_inventory.py first")
    return json.loads(POSE_INVENTORY_PATH.read_text(encoding="utf-8"))


# Reverse order = last character first (UR04 → … → SR01_2).
ALL_CHARS: list[str] = [
    "UR04_1",
    "UR03_1",
    "SSR05_1",
    "SSR04_1",
    "SSR03_1",
    "SSR02_1",
    "SSR01_1",
    "SR05_1",
    "SR04_1",
    "SR03_1",
    "SR02_1",
    "SR01_3",
    "SR01_2",
]


def identity_for(char: str) -> str:
    bible = load_identity_bible().get(char, {})
    prompt = bible.get("identity_prompt")
    extras = bible.get("forbid_extras") or ""
    # NSFW r9: lace may be displaced; identity + anatomy lock matter more than opaque cups.
    anatomy = (
        "ANATOMY HARD LOCK: adult female proportions; nipples centered on each breast mound with natural areola; "
        "vulva only at the crotch cleft between thighs (labia oriented front-to-back along the midline); "
        "FORBIDDEN: nipples on belly/shoulder/arm, misplaced genitals, male anatomy, extra breasts"
    )
    if prompt:
        base = (
            f"{prompt}. "
            "Glossy black segmented mechanical tentacles with three-finger claws. "
            "KEEP face/hair/eyes/body/cyber identity from bible + first frame — never morph into another character. "
            f"{anatomy}."
        )
    else:
        base = (
            f"same character face/hair/body as first frame ({char}); "
            "glossy black segmented mechanical tentacles with three-finger claws; "
            f"{anatomy}."
        )
    return f"{base} {extras}".strip()


LOCK = """Professional film-set chroma key plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, 8K look.

GREEN BACKGROUND HARD LOCK (CRITICAL):
- Entire frame behind the subject MUST stay pure flat #00b140 green for every frame.
- FORBIDDEN: black void, dark backdrop, vignette, gradient sky, floor, wall, room, shadow catcher, gray studio, any non-green background pixels in corners/edges.
- Four corners and full border remain pure chroma green with no spill artifacts inventing scenery.

LOCKED identity from first frame + character bible: {identity}.
Preserve exact face, hair color/style, eye color, body proportions (height/bust/waist/hip), cybernetics from her OTHER skins (lifewear/sleep/shower/casual). Do not slim/enlarge body, do not change face, do not add/remove cyber limbs.

ANATOMY / NSFW HARD LOCK (CRITICAL — when breasts or genitals are visible):
- Nipples: one per breast, centered on the soft breast mound; circular/oval areola sized naturally for her bust; never floating, never on ribs/belly/collarbone/arm.
- Breasts: soft female breasts with correct underbust crease and gravity; bounce under tentacle force without warping anatomy.
- Vulva: only at the female crotch between the inner thighs; outer/inner labia along the midline; clitoral hood at the TOP of the cleft; never on the hip, butt cheek center, or stomach.
- Anus only at the rear cleft if briefly visible — distinct from vulva, anatomically separated.
- FORBIDDEN: wrong sex anatomy, fused crotch mess, nipples duplicated/missing, genitals sliding around, tentacle growing from body.

CLOTHING (escalates by stage — exposure ALLOWED when stage says so):
- Stage prompts may pull lace aside / expose nipples / expose vulva. When exposed, anatomy lock above is mandatory.
- When still clothed, white lace lingerie matches first-frame style.

FRAMING: character fills most of the vertical frame with a thin green margin at top/bottom. Subject pixel scale CONSTANT for every frame — body may sway but must not grow/shrink in frame.

CAMERA HARD LOCK:
- Completely locked tripod. Framing identical entire clip.
- FORBIDDEN: pan, tilt, roll, orbit, dolly, truck, pedestal.
- FORBIDDEN: zoom, push-in, pull-out, punch-in, punch-out, crop-in, sudden enlarge of subject.
- FORBIDDEN: any focal-length change, lens breathe, focus pull, or perspective shift.
- Subject height occupancy must stay nearly identical from first to last frame.

MOTION HARD RULE (ANTI-STIFF):
- Keep LARGE continuous motion alive every second including the final second. No settle-to-static.
- FORBIDDEN: freezing, holding still, dead-stop after ~3–4s, mannequin body, only tiny claw twitches.
- FORBIDDEN: rigid conveyor up-down loop; use organic multi-axis peristalsis (twist + squeeze + travel).
- Body MUST react: torso sway, hip roll, vertical bob, shoulder tremble, knee buckle — driven by tentacle force.
- Continuous tense sensual breathing with clear chest rise/fall; soft natural blinking; micro facial acting never freezes.
- Do NOT morph into a static duplicate of frame-1 near the end.

Keep pure flat #00b140 green everywhere behind the subject.
Audio: soft quiet room tone only, no speech, no music.
"""

STAGE1 = """
STAGE-1 INTENSITY — light discipline tease (erotic but controlled; light exposure OK):

EXPRESSION (unified shy): soft bashful blush, hesitant eye flickers, shy half-lidded gaze, soft natural blinking, lips slightly parted from shy breathing — delicate micro-acting, not exaggerated climax face.

TENTACLES: glossy black mechanical coils tightly wrap and continuously writhe around chest/underbust, waist, hips, inner thighs, crotch — organic peristaltic pressure pulses. Predatory but restrained. Claws tease breasts and crotch. Visible soft-flesh indent grooves, then release and re-coil. Moderate-to-strong amplitude (not tiny vibration).

BODY PHYSICS: soft torso sway + slight vertical bob; tasteful breast jiggle synced to pressure+breath; slight hip/butt sway; soft flesh compression at contact points.

EXPOSURE (light): lace may stretch, slip a strap, or briefly reveal cleavage / partial nipple if pulled; if nipple shows it must be anatomically centered on the breast. Prefer mostly clothed. NO penetration / insertion.
"""

STAGE2 = """
STAGE-2 INTENSITY — heavier erotic edge (MORE motion + clear exposure allowed):

EXPRESSION (unified shy, amplified): deep blush across cheeks/ears, wet shimmering eyes, exaggerated bashful frown-smile, brows knit in overwhelmed shyness, rapid soft blinks, open-mouth shy panting, tiny involuntary gasps, eye-aversion then peeking back — vivid delicate acting, still shy not ahegao.

TENTACLES (alive, not stiff): stronger evil intent with continuous traveling coils. Rhythm: squeeze → twist → slide → re-grip every ~0.6–1.0s. Claws cup and knead bare or half-bare breasts, grind crotch / inner thighs, tug hips into arched poses, shake the whole body. Large amplitude organic writhe — never a frozen pose with twitching tips only.

BODY PHYSICS (stronger, continuous): pronounced breast bounce/jiggle on every pulse (correct nipple placement on bouncing breasts); clear hip/butt sway; thighs tremble; waist twists against restraint; heavier breathing with visible chest heave; reactive struggle that fails but keeps moving.

EXPOSURE (ALLOWED):
- lace top may be yanked aside / cups peeled so one or both nipples+areola are clearly visible and anatomically correct
- midriff exposed; bottoms dug aside to reveal butt cheek and/or vulva cleft with correct female placement between thighs
- sweat sheen
FORBIDDEN HARD: penetration, insertion, thrusting inside, male anatomy, misplaced nipples/genitals, fluids splash climax finish.
"""

STAGE3 = """
STAGE-3 INTENSITY — peak erotic edge (MAX motion + full shy exposure; anatomy must stay correct):

EXPRESSION (unified shy, peak exaggeration): torrential blush, teary wet eyes almost overflowing, exaggerated overwhelmed bashful face, trembling lips, open-mouth panting, soft whimpers (visual only), brows sharply raised in shy distress+pleasure, repeated peek-and-hide eye acting — high drama micro-acting; avoid ahegao tongue-out; keep shy erotic tone.

TENTACLES (max predatory, never stiff): multiple coils attack breasts, underbust, waist, hips, inner thighs, crotch, butt cleft in overlapping waves. Peristalsis: squeeze → lift → drop → knead → travel. Claws may fully expose and knead bare breasts; may spread thighs and expose vulva — but genitals stay at correct female crotch location. Character is rocked, lifted, hip-rolled by machine force. Full-clip continuous large motion — no end freeze. NO insertion / penetration.

BODY PHYSICS (max game-style, continuous): heavy breast bounce and ripple with nipples staying centered on each mound; strong butt jiggle/sway; belly soft give; continuous trembling; knees buckle against coils; whole-body reactive struggle that fails but never goes still.

EXPOSURE (MAX allowed without penetration):
- both breasts may be fully bare with visible nipples+areola (correct placement)
- vulva may be fully visible between spread thighs (correct midline labia / clitoral hood at top of cleft)
- lace may hang ruined at waist/hips; sweat sheen
FORBIDDEN HARD: penetration, insertion, thrusting inside, wrong anatomy placement, fluids splash climax finish.
"""

STAGE_BLOCKS = {1: STAGE1, 2: STAGE2, 3: STAGE3}

JOBS: dict[str, dict] = {}


def build_jobs_for_char(char: str) -> dict[str, dict]:
    """One H3 job per (pose × intensity stage). Different stills = different poses."""
    if char not in ALL_CHARS:
        raise SystemExit(f"unsupported character {char}; choose from {ALL_CHARS}")
    inv = load_pose_inventory()["characters"].get(char)
    if not inv or not inv.get("poses"):
        raise SystemExit(f"no poses in inventory for {char}")
    identity = identity_for(char)
    jobs: dict[str, dict] = {}
    for pose in inv["poses"]:
        pi = int(pose["pose_idx"])
        still_rel = pose["still"]  # e.g. _src/UR04_1/p1_first.png
        covered_rel = pose.get("covered") or still_rel
        for stage in (1, 2, 3):
            stem = f"{char}_p{pi}_s{stage}"
            src_rel = still_rel if stage == 1 else covered_rel
            jobs[stem] = {
                "char": char,
                "pose_idx": pi,
                "asset": pose.get("asset", ""),
                "src_rel": src_rel,  # relative to OUT_DIR
                "stage": stage,
                "stage_block": STAGE_BLOCKS[stage],
                "identity": identity,
            }
    return jobs


def build_prompt(meta: dict) -> str:
    pose_note = (
        f"\nPOSE LOCK: keep the SAME body pose / camera framing / tentacle wrap layout as the first frame "
        f"(pose {meta.get('pose_idx')}, asset {meta.get('asset')}). Intensity may rise but do NOT swap to a different pose."
    )
    return (LOCK.format(identity=meta["identity"]) + "\n" + meta["stage_block"] + pose_note).strip()


def webm_for_stem(stem: str) -> Path:
    return OUT_DIR / f"{stem}_tentacle_loop.webm"


def gs_mp4_for_stem(stem: str) -> Path:
    return OUT_DIR / f"{stem}_tentacle_loop_gs_h3.mp4"


def is_done(stem: str) -> bool:
    p = webm_for_stem(stem)
    return p.exists() and p.stat().st_size > 80_000


SOFT_KEY_VF = (
    "colorkey=0x00B140:0.16:0.04,format=rgba,"
    "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
    "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
    "format=yuva420p"
)


def ship_webm(gs_mp4: Path, final_webm: Path, qa_tag: str) -> tuple[bool, str]:
    """Prefer soft colorkey (stable on this machine); fall back to rembg-safe key."""
    from chroma_key_gs_video_webm import gs_mp4_to_webm

    try:
        gs_mp4_to_webm(gs_mp4, final_webm, fps=24.0, vf=SOFT_KEY_VF)
        if final_webm.exists() and final_webm.stat().st_size > 80_000:
            return True, f"soft_colorkey size={final_webm.stat().st_size} tag={qa_tag}"
    except Exception as e:
        soft_err = str(e)
    else:
        soft_err = "soft_colorkey produced empty"
    ok, det = tm.key_to_webm(gs_mp4, final_webm, qa_tag=qa_tag, force=True)
    if ok:
        return True, f"{det} (after soft fail: {soft_err})"
    return False, f"soft={soft_err}; safe={det}"


def build_workflow(input_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"].pop("last_frame", None)
    wf["9"]["inputs"]["steps"] = STEPS
    return wf


def wait_inflight_if_any(stem: str, out_leaf: str) -> Path | None:
    """If a previous waiter died mid-gen, wait for that prompt / newest leaf output."""
    inflight_path = OUT_DIR / "_inflight.json"
    if not inflight_path.exists():
        return None
    try:
        info = json.loads(inflight_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if info.get("stem") != stem or info.get("out_leaf") != out_leaf:
        return None
    prompt_id = info.get("prompt_id")
    t_start = float(info.get("t_start") or time.time() - 3600)
    print(f"  resume inflight prompt_id={prompt_id}", flush=True)
    try:
        if prompt_id:
            # May already be finished — history empty is OK; fall through to find_latest.
            try:
                m.wait_prompt(prompt_id, timeout_s=H3_WAIT_TIMEOUT_S)
            except Exception as e:
                print(f"  inflight wait note: {e}", flush=True)
        out = m.find_latest_output(out_leaf, t_start)
        if out is not None:
            return out
    except Exception as e:
        print(f"  inflight resume failed: {e}", flush=True)
    return None


def try_salvage_existing_output(stem: str, out_leaf: str, qa_stem: Path, attempt: int) -> Path | None:
    """Only resume an in-flight prompt — do not reuse older failed QA mp4s."""
    resumed = wait_inflight_if_any(stem, out_leaf)
    if resumed is None or not resumed.exists():
        return None
    age_s = time.time() - resumed.stat().st_mtime
    print(f"  salvage candidate {resumed.name} age={age_s/60:.1f}m", flush=True)
    raw_path = qa_stem / f"a{attempt}_raw6s.mp4"
    shutil.copy2(resumed, raw_path)
    return raw_path


def process_one(stem: str, force: bool = False) -> dict:
    meta = JOBS[stem]
    char = meta["char"]
    src = OUT_DIR / meta["src_rel"]
    gs_path = FIRST_DIR / f"{stem}_gs.png"
    gs_mp4 = gs_mp4_for_stem(stem)
    final_webm = webm_for_stem(stem)
    result: dict = {"stem": stem, "stage": meta["stage"], "pose": meta.get("pose_idx"), "src": str(src), "ok": False, "attempts": []}

    if not src.exists():
        result["error"] = f"missing src: {src}"
        return result

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        result["path"] = str(final_webm)
        return result

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)

    # Point tentacle-batch helpers at THIS trial QA dir (do not touch old folder).
    tm.QA_DIR = QA_DIR
    tm.OUT_DIR = OUT_DIR
    tm.CAMERA_CENTER_MAX_SHIFT = CAMERA_CENTER_MAX_SHIFT
    tm.CAMERA_SCALE_MAX_DELTA = CAMERA_SCALE_MAX_DELTA

    m.WIDTH, m.HEIGHT = WIDTH, HEIGHT
    m.make_greenscreen(src, gs_path)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = build_prompt(meta)
    (OUT_DIR / "_prompts.json").write_text(
        json.dumps(
            {s: build_prompt(JOBS[s]) for s in list(JOBS)[:24]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    out_leaf = f"{stem}_tentacle_loop_gs{OUT_LEAF_SUFFIX}"
    out_prefix = f"video/{out_leaf}"
    qa_stem = QA_DIR / stem
    qa_stem.mkdir(parents=True, exist_ok=True)
    (qa_stem / "prompt.txt").write_text(prompt, encoding="utf-8")

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = (
            SEED_BASE
            + (abs(hash(char)) % 1000)
            + int(meta.get("pose_idx") or 0) * 300
            + meta["stage"] * 1000
            + attempt * 211
        )
        print(
            f"[{stem}] attempt {attempt}/{MAX_ATTEMPTS} seed={seed} "
            f"pose={meta.get('pose_idx')} asset={meta.get('asset')} "
            f"(no last_frame, gen={LENGTH} keep={KEEP_FRAMES})",
            flush=True,
        )
        t_start = time.time()
        try:
            # Prefer salvage of orphan Comfy output before re-queueing (resume after disconnect).
            salvaged = None
            if attempt == 1 and not force:
                salvaged = try_salvage_existing_output(stem, out_leaf, qa_stem, attempt)
            if salvaged is None:
                wf = build_workflow(input_name, out_prefix, prompt, seed)
                assert "last_frame" not in wf["104"]["inputs"]
                res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
                prompt_id = res["prompt_id"]
                print(f"  prompt_id {prompt_id}", flush=True)
                # Persist in-flight prompt so a later resume can wait/salvage.
                inflight = {
                    "stem": stem,
                    "prompt_id": prompt_id,
                    "out_leaf": out_leaf,
                    "seed": seed,
                    "t_start": t_start,
                    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                }
                (OUT_DIR / "_inflight.json").write_text(
                    json.dumps(inflight, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                m.wait_prompt(prompt_id, timeout_s=H3_WAIT_TIMEOUT_S)
                print(f"  h3 done in {time.time() - t_start:.1f}s", flush=True)
                out = m.find_latest_output(out_leaf, t_start)
                if out is None:
                    raise RuntimeError("output mp4 not found")
                raw_path = qa_stem / f"a{attempt}_raw6s.mp4"
                shutil.copy2(out, raw_path)
            else:
                raw_path = salvaged
                print(f"  using salvaged raw (skip new H3 queue)", flush=True)

            trimmed = qa_stem / f"a{attempt}.mp4"
            tm.trim_to_keep_frames(raw_path, trimmed, KEEP_FRAMES)

            f0 = m.extract_frame(trimmed, 0.4, qa_stem / f"a{attempt}_t040.png")
            f1 = m.extract_frame(trimmed, 2.5, qa_stem / f"a{attempt}_t250.png")
            f2 = m.extract_frame(trimmed, 4.6, qa_stem / f"a{attempt}_t460.png")
            checks = []
            for fp, label in ((f0, "t0.4"), (f1, "t2.5"), (f2, "t4.6")):
                ok_g, det_g = tm.green_ok(fp)
                if SKIP_GREEN_QA:
                    print(
                        f"  QA green[{label}]: SKIP({'ok' if ok_g else 'warn'}) {det_g}",
                        flush=True,
                    )
                else:
                    checks.append((f"green[{label}]", bool(ok_g), str(det_g)))

            cam_ok, cam_det, cam_meta = tm.camera_lock_ok(trimmed)
            checks.append(("camera_lock", cam_ok, cam_det))

            mot = tm.motion_profile(trimmed)
            checks.append(
                (
                    "motion_late",
                    not mot["freeze"],
                    f"early={mot['early']:.2f} late={mot['late']:.2f} "
                    f"tail={mot['tail']:.2f} ratio={mot['ratio']:.2f} "
                    f"tail_r={mot['tail_ratio']:.2f}",
                )
            )
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if not all(ok for _, ok, _ in checks):
                result["attempts"].append(
                    {
                        "attempt": attempt,
                        "seed": seed,
                        "ok": False,
                        "checks": checks,
                        "motion": mot,
                        "camera": cam_meta,
                    }
                )
                continue

            looped = qa_stem / f"a{attempt}_loop.mp4"
            tm.make_loop_crossfade_mp4(trimmed, looped, blend=LOOP_BLEND_FRAMES)
            shutil.copy2(looped, gs_mp4)
            ok_w, det_w = ship_webm(gs_mp4, final_webm, qa_tag=stem)
            print(f"  webm: {'PASS' if ok_w else 'FAIL'} {det_w}", flush=True)
            result["attempts"].append(
                {
                    "attempt": attempt,
                    "seed": seed,
                    "ok": ok_w,
                    "checks": checks,
                    "motion": mot,
                    "camera": cam_meta,
                    "webm": det_w,
                }
            )
            if ok_w:
                result["ok"] = True
                result["path"] = str(final_webm)
                inflight_path = OUT_DIR / "_inflight.json"
                if inflight_path.exists():
                    inflight_path.unlink(missing_ok=True)
                return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": str(e)})

    result["error"] = "all attempts failed"
    return result


def ensure_stills(char: str) -> None:
    inv = load_pose_inventory()["characters"].get(char)
    if inv and inv.get("poses"):
        missing = []
        for pose in inv["poses"]:
            p = OUT_DIR / pose["still"]
            if not p.exists():
                missing.append(str(p))
        if not missing:
            return
    print(f"rebuilding pose inventory (missing stills for {char})...", flush=True)
    subprocess.run(
        [sys.executable, "-u", str(ROOT / "scripts" / "_build_tiaojiao_pose_inventory.py")],
        check=True,
    )


def load_pipeline_state() -> dict:
    state_path = OUT_DIR / "_pipeline_state.json"
    if state_path.exists():
        try:
            return json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_pipeline_state(**updates) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    state_path = OUT_DIR / "_pipeline_state.json"
    prev = load_pipeline_state()
    done = set(prev.get("done_stems", []))
    failed = set(prev.get("failed_stems", []))
    # Always re-scan shipped webms so resume after disconnect keeps truth.
    for p in OUT_DIR.glob("*_tentacle_loop.webm"):
        if p.stat().st_size > 80_000 and ("_p" in p.name or "_stage" in p.name):
            done.add(p.name.replace("_tentacle_loop.webm", ""))
    add_done = updates.pop("add_done", None)
    add_fail = updates.pop("add_fail", None)
    if add_done:
        done.add(add_done)
        failed.discard(add_done)
    if add_fail:
        failed.add(add_fail)
    prev.update(updates)
    prev["done_stems"] = sorted(done)
    prev["failed_stems"] = sorted(failed)
    prev["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    state_path.write_text(json.dumps(prev, ensure_ascii=False, indent=2), encoding="utf-8")


def run_character(char: str, stem: str = "all", force: bool = False) -> list[dict]:
    global JOBS
    JOBS = build_jobs_for_char(char)
    ensure_stills(char)
    save_pipeline_state()  # refresh done_stems from disk

    if stem == "all":
        stems = list(JOBS.keys())
    elif "," in stem:
        stems = [s.strip() for s in stem.split(",") if s.strip()]
    else:
        stems = [stem]

    for s in stems:
        if s not in JOBS:
            raise SystemExit(f"unknown stem {s}; choose from {list(JOBS)}")

    print(
        f"TRIAL OUT={OUT_DIR}\n"
        f"character={char} jobs={stems} force={force} "
        f"LENGTH={LENGTH} keep={KEEP_FRAMES} suffix={OUT_LEAF_SUFFIX} "
        f"last_frame=OFF (isolated; will not touch webm_tentacle_loop / tiaojiao)",
        flush=True,
    )
    report: list[dict] = []
    for s in stems:
        print(f"\n===== {s} =====", flush=True)
        r = process_one(s, force=force)
        report.append(r)
        print(
            json.dumps(
                {k: r[k] for k in ("stem", "stage", "ok", "error", "path") if k in r},
                ensure_ascii=False,
            ),
            flush=True,
        )
        if r.get("ok"):
            save_pipeline_state(add_done=s, last_stem=s, last_ok=True)
        else:
            save_pipeline_state(add_fail=s, last_stem=s, last_ok=False)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rep_path = OUT_DIR / f"_batch_report_{char}.json"
    rep_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    ok_n = sum(1 for r in report if r.get("ok"))
    print(f"\nCHAR DONE {char} {ok_n}/{len(report)} → {OUT_DIR} ({rep_path.name})", flush=True)
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--character",
        default="SSR05_1",
        help="one char | comma-list | all",
    )
    ap.add_argument("--stem", default="all", help="stage stem | all | comma-list")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.character.strip().lower() == "all":
        chars = list(ALL_CHARS)
    elif "," in args.character:
        chars = [c.strip() for c in args.character.split(",") if c.strip()]
    else:
        chars = [args.character.strip()]

    all_report: list[dict] = []
    for char in chars:
        all_report.extend(run_character(char, stem=args.stem, force=args.force))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "_batch_report_all.json").write_text(
        json.dumps(all_report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    ok_n = sum(1 for r in all_report if r.get("ok"))
    print(f"\nTRIAL DONE {ok_n}/{len(all_report)} → {OUT_DIR}", flush=True)


if __name__ == "__main__":
    main()
