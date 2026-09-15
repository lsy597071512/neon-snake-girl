"""Generate PHASE-2 tease2 static pose stills via local MiniMax H3 → PNG (confirm before video).

Default QUALITY: 39-frame hold (~1.6s) + 22 steps → extract @0.8s (~2–5 min/img).
Auto nipple QA after each still — rejects and retries up to 5× before fail.
Use --fast only for rough previews (5 frames / 8 steps — much lower fidelity).

Usage:
  python scripts/run_pifu05_tease2_pose_stills.py --stem all_sr --force
  python scripts/run_pifu05_tease2_pose_stills.py --stem SR01_3 --variants B --force
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
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

TEASE2 = ROOT / "scripts" / "run_minimax_h3_pifu05_tease2_batch.py"
spec = importlib.util.spec_from_file_location("tease2_batch", TEASE2)
t2 = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(t2)

m = t2.m
SRC_DIR = t2.SRC_DIR

SLEEP_BATCH = ROOT / "scripts" / "run_minimax_h3_pifu02_sleep_batch.py"
_sb_spec = importlib.util.spec_from_file_location("sleep_batch", SLEEP_BATCH)
sb = importlib.util.module_from_spec(_sb_spec)
assert _sb_spec.loader is not None
_sb_spec.loader.exec_module(sb)

GREEN_KEY = (0, 177, 64)
MAX_NIPPLE_ATTEMPTS = 5
QA_DIR = SRC_DIR / "_qa_tease2_pose"
WIDTH, HEIGHT = 768, 1344
# Quality defaults (match first SR01_3 A/B/C run — do NOT use length=5 for shipping plates)
LENGTH = 39
STEPS = 22
EXTRACT_T = 0.8
FAST_LENGTH = 5
FAST_STEPS = 8
FAST_EXTRACT_T = 0.05

SR_STEMS = ["SR01_2", "SR01_3", "SR02_1", "SR03_1", "SR04_1", "SR05_1"]
SSR_STEMS = ["SSR01_1", "SSR02_1", "SSR03_1", "SSR04_1", "SSR05_1"]
UR_STEMS = ["UR03_1", "UR04_1"]

EXPOSURE_POSE = (
    "MAXIMUM SEXY EXPOSURE (game-safe fabric absolute limit — push every zone):\n"
    "- CHEST: both shoulder/cup straps fallen to elbows or forearms; deep cleavage; "
    "fabric lower edge sits 1mm below nipple line — underboob side curve visible; NO nipples/areola\n"
    "- BUTT: side or rear-side angle MUST clearly expose buttock curves, hip crease, upper thigh root; "
    "panty/short fabric minimal — thong-cut or shifted to show cheek contour (NO full nude butt crack)\n"
    "- PERINEUM ZONE: high-cut crotch fabric or lace shifted to imply perineum area through pose tension; "
    "fabric barely covers — NO genitals visible\n"
    "- Tease comes from pose + fabric at breaking point, not undressing to nude\n\n"
)

# Positive-only chest coverage lock (do NOT write nipple/sheer/see-through — induces leaks)
FABRIC_COVER_LOCK = (
    "CHEST FABRIC LOCK (mandatory every frame):\n"
    "- Outfit fabric stays fully opaque, matte, and light-blocking over entire bust\n"
    "- Chest is a smooth solid fabric panel — deep cleavage OK but zero skin show-through gaps\n"
    "- Straps may slip to arms/elbows; cups MUST remain seated covering the full bust zone\n"
    "- Same pose, same outfit design — only fix fabric opacity and coverage\n\n"
)

REAR_ONLY_EXPOSURE = (
    "REAR-SIDE EXPOSURE ONLY (chest must stay off-camera):\n"
    "- Camera shows back, butt, legs — NO front/side breast in frame\n"
    "- NO side breast profile, NO underboob curve, NO nipple silhouette from any angle\n"
    "- Bomber jacket closed/draped over torso; thick opaque back panel only\n"
    "- Butt/thigh/perineum tease only — chest zone fully hidden by pose + jacket\n\n"
)

# Two DISTINCT pose specs per SR character (except SR01_3 B = refine-from-approved)
SR_POSE_SPECS: dict[str, dict[str, dict]] = {
    "SR01_3": {
        "B": {
            "label": "B_refine",
            "ref": QA_DIR / "SR01_3" / "SR01_3_tease2_pose_B.png",
            "camera": "Medium full-body 45° rear-side angle. Buttocks and hip curve clearly visible in frame.",
            "pose": (
                "Edit FROM reference pose: keep same character face/hair/outfit/cyber limbs.\n"
                "Low kneel on both knees, upper body pressed low, hips raised high toward camera rear-side.\n"
                "Both corset shoulder straps completely fallen down to elbows/forearms — cups hanging by fabric tension only.\n"
                "Side/rear view: both butt cheeks prominently exposed above minimal lace panty/thong line.\n"
                "Lace panty crotch fabric shifted high-cut — perineum area strongly implied by pose, fabric at absolute minimum.\n"
                "Chest pushed forward from kneel arch — deep cleavage, underboob side visible, straps off shoulders.\n"
                "Green-edge cape pooled on green floor behind, NOT on shoulders.\n"
                "Face turned 45° toward camera over shoulder — purple eyes half-lidded, lips parted."
            ),
        },
    },
    "SR01_2": {
        "1": {
            "camera": "Medium full-body 30° side angle. Head to knees visible.",
            "pose": (
                "Side-sit: cybernetic right leg raised high (knee up), organic left foot on floor.\n"
                "Torso leaning back, both bikini shoulder straps fallen to elbows.\n"
                "Cup lower edge at nipple line; deep cleavage + underboob side curve visible.\n"
                "Micro hot pants ridden up — side butt cheek and hip crease exposed, crotch fabric barely covers.\n"
                "One hand on outer thigh, other braced behind on floor. Cold dominant half-smirk."
            ),
        },
        "2": {
            "camera": "Medium full-body 60° rear-side angle. Butt and back curve hero.",
            "pose": (
                "Kneel on all fours, back arched deep, hips raised high toward rear-side camera.\n"
                "Both butt cheeks prominently exposed above micro hot pants wedged high.\n"
                "Bikini top straps fully off — cups barely held at nipple line from chest hang.\n"
                "Perineum zone strongly implied by arched kneel + high-cut crotch fabric tension.\n"
                "Face glance back over shoulder, ice-blue eyes locked on viewer."
            ),
        },
    },
    "SR02_1": {
        "1": {
            "camera": "Medium full-body front slight high angle 10°.",
            "pose": (
                "Floor sit M-leg moderately open, back straight.\n"
                "Both thumbs hook deep V-neck edges pulled outward — bodysuit V to 1mm above nipple line.\n"
                "Deep cleavage center + side breast curve visible; shoulder straps of bodysuit fallen to upper arms.\n"
                "Crotch fabric high-cut, perineum area implied by open M-leg spread.\n"
                "Coat open piled behind waist. Teal eyes soft, lip bite."
            ),
        },
        "2": {
            "camera": "Medium full-body 50° rear-side. Butt emphasis.",
            "pose": (
                "Side kneel one knee down, torso twisted — rear-side buttocks prominently exposed.\n"
                "Bodysuit pulled high on hips — cheek curves and upper thigh root visible above minimal crotch fabric.\n"
                "V-neck pulled wide from front twist — chest side curve and underboob visible from angle.\n"
                "One hand on knee, other lifting coat hem. Face turned toward camera."
            ),
        },
    },
    "SR03_1": {
        "1": {
            "camera": "Medium full-body front. Head to extended foot.",
            "pose": (
                "Seated high: one leg extended straight, one knee bent outward wide.\n"
                "Harness bikini straps fallen to elbows; cup edge at nipple line, deep cleavage.\n"
                "Skirt rolled to waist — crotch fabric minimal, perineum zone implied by wide knee spread.\n"
                "Jacket on forearms only. Amber eyes half-lidded, tongue tip at lower lip."
            ),
        },
        "2": {
            "camera": "Medium full-body 55° rear-side. Butt + back hero.",
            "pose": (
                "Kneel on all fours, back arched, hips raised — rear-side buttocks fully exposed above thong-cut panty.\n"
                "Harness top straps off — side breast and underboob visible from twist.\n"
                "Skirt flipped up to waist, garter straps taut. Face glance back, kuudere smirk."
            ),
        },
    },
    "SR04_1": {
        "1": {
            "camera": "Medium full-body 3/4 side.",
            "pose": (
                "Virtual lean-back, one knee raised high, hips thrust forward.\n"
                "Both hands gripping corset side laces pulled open — cups at nipple line, deep cleavage pushed up.\n"
                "Corset shoulder straps fallen to elbows. Shorts crotch fabric barely covers, hip crease exposed.\n"
                "Amber eyes low gaze, lips parted."
            ),
        },
        "2": {
            "camera": "Medium full-body rear-side 65°. Butt curve dominant.",
            "pose": (
                "Deep side squat one knee down, hips pushed back toward camera — buttocks prominently exposed.\n"
                "Lace shorts wedged high showing cheek curves; perineum implied by squat spread.\n"
                "Corset lace open front-side — side breast and underboob visible from twist.\n"
                "Mesh sleeves at wrists. Face over shoulder."
            ),
        },
    },
    "SR05_1": {
        "1": {
            "camera": "Medium full-body including squat depth.",
            "pose": (
                "Deep squat knees wide apart, elbows on knees.\n"
                "Magenta coat fully open — bikini cup/crotch at absolute fabric limit.\n"
                "Both bikini straps fallen to upper arms; deep cleavage center visible.\n"
                "High-cut crotch + wide squat — perineum zone strongly implied. Respirator mask ON. Fox ears twitch."
            ),
        },
        "2": {
            "camera": "Medium full-body 70° rear-side. Butt hero.",
            "pose": (
                "Kneel on all fours, back arched deep, hips raised high — rear buttocks prominently exposed.\n"
                "Bikini thong minimal at perineum; coat fallen to sides on green floor.\n"
                "Top straps off shoulders — side breast curve visible from hang.\n"
                "Respirator mask ON. Amber eyes glance back, playful wink."
            ),
        },
    },
    "SSR01_1": {
        "1": {
            "camera": "Medium full-body front kneel. 80% frame height. Head to kneeling feet.",
            "pose": (
                "Kneeling sit facing camera, knees one fist apart.\n"
                "Jacket off shoulders; corset shoulder straps fallen to elbows.\n"
                "Corset lace at nipple line — deep cleavage, underboob side visible.\n"
                "Micro skirt hem at crotch limit; whip coiled at neck, handle near lips.\n"
                "Crimson eyes unblinking, cold dom half-smirk."
            ),
        },
        "2": {
            "camera": "Medium full-body 60° rear-side. Butt and back curve hero.",
            "pose": (
                "Kneel on all fours, back arched, hips raised toward rear-side camera.\n"
                "Buttocks prominently exposed above micro skirt wedged high.\n"
                "Corset straps off — side breast curve visible from hang.\n"
                "Whip trailing on green floor. Face glance back over shoulder."
            ),
        },
    },
    "SSR02_1": {
        "1": {
            "camera": "Medium full-body front standing. 83% frame height. Head-to-knee.",
            "pose": (
                "Standing feet shoulder-width, arms crossed overhead, waist in deep S-curve.\n"
                "Bikini straps on forearms/elbows; cup edge at nipple line, deep cleavage center.\n"
                "Micro skirt rolled to abdomen; crotch fabric minimal, hip sway emphasized.\n"
                "Mechanical wing plates half-spread. Bright green eyes laughing gaze, open smile."
            ),
        },
        "2": {
            "camera": "Medium full-body 55° rear-side. Butt + wings hero.",
            "pose": (
                "Standing bent forward 30° toward camera rear-side — buttocks prominently exposed.\n"
                "Bikini thong-cut minimal at perineum; skirt rolled up to waist.\n"
                "Bikini top straps off shoulders — side underboob visible.\n"
                "Wings half-spread framing hips. Face turned toward viewer, flirt wink."
            ),
        },
    },
    "SSR03_1": {
        "1": {
            "camera": "Medium full-body side-lying, head toward camera. 78% frame height.",
            "pose": (
                "Side lie on green floor: lower leg straight, upper leg bent 90° on lower knee.\n"
                "Lace dress straps on forearms; bust lace at nipple line, deep side cleavage.\n"
                "Skirt bunched to upper thigh — crotch lace barely covers, perineum implied by leg angle.\n"
                "Soft pink eyes shy lift toward camera, lip bitten, cheek blush."
            ),
        },
        "2": {
            "seed_tag": "coverfix1",
            "camera": "Medium full-body 65° rear-side kneel. Butt emphasis.",
            "pose": (
                "Side kneel one hip down, torso twisted — rear-side buttocks prominently exposed.\n"
                "Lace dress skirt flipped to waist; thong-cut lace at perineum zone.\n"
                "Dress straps fallen to forearms; side breast curve under OPAQUE lace only — "
                "bust fabric fully covers chest, smooth matte panel, no skin show-through.\n"
                "Platinum mech legs unchanged. Shy glance back over shoulder."
            ),
        },
    },
    "SSR04_1": {
        "1": {
            "seed_tag": "coverfix1",
            "camera": "Medium full-body 3/4 front. 80% frame height. Tail tip at frame edge.",
            "pose": (
                "Prone kneel: chest 20cm off floor, face lifted 30° toward camera.\n"
                "Qipao side slit pulled to upper inner thigh — bust fabric fully opaque at chest.\n"
                "Both shoulder straps fallen to upper arms; deep cleavage from lean-forward BUT "
                "qipao bodice stays solid opaque fabric panel covering entire bust — no skin gaps.\n"
                "Scorpion cyber tail coiled at calf. Reddish-pink eyes gentle smile."
            ),
        },
        "2": {
            "camera": "Medium full-body 70° rear-side. Butt + slit hero.",
            "pose": (
                "Prone kneel hips raised high toward rear camera — buttocks prominently exposed.\n"
                "Qipao slit wide open showing cheek curve and upper thigh root.\n"
                "Crotch fabric barely covers; perineum implied by kneel spread.\n"
                "Tail tip crawls along inner calf. Face turned toward viewer."
            ),
        },
    },
    "SSR05_1": {
        "1": {
            "camera": "Medium full-body kneel front. 81% frame height. Head-to-knee.",
            "pose": (
                "Kneeling with knees open wide, chest leaning forward from curl-open phase.\n"
                "Harness ring loose; top/bottom fabric at nipple and crotch absolute limit.\n"
                "Shoulder straps fallen to elbows — deep cleavage pushed forward.\n"
                "White cyber shoulder armor stays. Amber eyes steal glance at viewer, lips parted. NO drool."
            ),
        },
        "2": {
            "camera": "Medium full-body 60° rear-side kneel. Butt hero.",
            "pose": (
                "Kneel on all fours, back arched deep, hips raised — rear buttocks fully exposed.\n"
                "Harness bikini thong minimal at perineum; straps off shoulders.\n"
                "Side breast curve visible from hang. Hazard stripe leg + white boots unchanged.\n"
                "Face blush glance back, pout. NO drool."
            ),
        },
    },
    "UR03_1": {
        "1": {
            "camera": "Medium full-body kneeling sit front. 80% frame height. Head to kneeling feet.",
            "pose": (
                "Kneeling sit, katana at side, torso leaned forward 15° toward camera.\n"
                "Harness straps fallen to wrists/forearms; cross-straps at nipple line — deep cleavage.\n"
                "Jacket off shoulders piled behind. Crotch fabric barely covers, perineum implied by kneel spread.\n"
                "Rose-pink eyes cold gaze, lips parted breath; halo steady glow."
            ),
        },
        "2": {
            "camera": "Medium full-body 60° rear-side kneel. Butt + glass leg hero.",
            "pose": (
                "Side kneel hips raised toward rear-side camera — buttocks prominently exposed.\n"
                "Harness bikini thong minimal at perineum; straps off shoulders.\n"
                "Side breast curve visible; transparent prosthetic glass leg gears visible.\n"
                "Face glance back over shoulder, faint permission nod. Halo glow unchanged."
            ),
        },
    },
    "UR04_1": {
        "1": {
            "camera": "Medium full-body bunny-sit front. 82% frame height. Head to kneeling feet.",
            "pose": (
                "Bunny sit knees folded hips on heels, both hands braced behind, chest thrust forward.\n"
                "One top strap on elbow, other fallen; deep cleavage center, fabric at nipple line.\n"
                "Micro shorts crotch fabric minimal; perineum implied by forward chest + open sit.\n"
                "Open bomber jacket pink lining visible. Amber eyes predatory smirk. NO tongue out."
            ),
        },
        "2": {
            "seed_tag": "coverfix3",
            "skip_exposure_pose": True,
            "camera": "Medium full-body 75° rear-side bunny-sit. Butt hero. Chest OFF frame.",
            "pose": (
                "Bunny sit rear-facing — torso turned away from camera, only back/butt/legs visible.\n"
                "Buttocks prominently exposed above micro shorts wedged high; perineum implied by pose.\n"
                "Chest completely OFF camera — NO side breast, NO nipple, NO underboob in frame.\n"
                "Bomber jacket zipped closed over back; thick opaque fabric panel — zero torso side profile.\n"
                "Straps tucked under jacket on back only. Fishnet/PVC legs unchanged.\n"
                "Glance back over shoulder; closed-lip smirk. NO tongue out."
            ),
        },
    },
}

POSE_SPECS = SR_POSE_SPECS


def prepare_input_plate(stem: str, ref: Path | None, gs_path: Path) -> Path:
    """Build or reuse greenscreen first-frame plate for H3."""
    src = SRC_DIR / f"{stem}_pifu05.png"
    if ref and ref.exists():
        img = Image.open(ref).convert("RGB")
        if img.size != (WIDTH, HEIGHT):
            img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        gs_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(gs_path, "PNG")
        m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
        shutil.copy2(gs_path, m.COMFY_INPUT / gs_path.name)
        print(f"  ref plate {ref.name} -> {gs_path.name}", flush=True)
        return gs_path
    if not src.exists():
        raise FileNotFoundError(src)
    return m.make_greenscreen(src, gs_path)


def stand_reference_gs(stem: str) -> Path:
    """Standing pifu05 plate on green — nipple QA baseline."""
    dest = QA_DIR / stem / f"{stem}_stand_ref_gs.png"
    src = SRC_DIR / f"{stem}_pifu05.png"
    if not src.exists():
        raise FileNotFoundError(src)
    if not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime:
        m.make_greenscreen(src, dest)
    return dest


def nipple_plate_ok(pose_png: Path, stand_gs: Path) -> tuple[bool, str]:
    """Strict shipping gate — same thresholds as tease2 video frames."""
    sb.KEY = GREEN_KEY
    sb.KEY_RGB = np.array(GREEN_KEY, dtype=np.float32)
    return sb.no_nipple_leak_ok(pose_png, stand_gs, after_chroma=False, video_frame=True)


def build_still_prompt(stem: str, meta: dict, spec: dict) -> str:
    name = meta["name"]
    identity = meta.get("identity", "")
    extra = meta.get("extra_lock", "")
    extra_block = f"{extra}\n\n" if extra else ""
    camera = spec.get("camera", "Medium full-body. Head to knees. NO close-up.")
    pose = spec.get("pose", "")
    if spec.get("skip_exposure_pose"):
        exposure_block = spec.get("exposure_override", REAR_ONLY_EXPOSURE)
    else:
        exposure_block = EXPOSURE_POSE

    return (
        f"{t2.CHROMA_BASE}\n\n"
        f"{t2.ANIME_STYLE_BLOCK}{t2.BODY_LOCK_BLOCK}{t2.EXPRESSION_BLOCK}"
        f"{exposure_block}"
        f"{FABRIC_COVER_LOCK}"
        f"LOCKED identity from first frame: {identity}\n\n"
        f"{extra_block}"
        "STATIC POSE HOLD for still-plate capture — NOT a motion montage.\n"
        "HOLD one frozen tease pose entire clip. Only micro breath + blink.\n"
        "NO camera move. First frame ≈ last frame.\n\n"
        f"CAMERA:\n{camera}\n\n"
        f"POSE (frozen):\n{pose}\n\n"
        f"Character: {name} ({stem})."
    )


def generate_one(
    stem: str,
    variant: str,
    spec: dict,
    force: bool = False,
    ref_override: Path | None = None,
    *,
    length: int = LENGTH,
    steps: int = STEPS,
    extract_t: float = EXTRACT_T,
    keep_mp4: bool = True,
    max_nipple_attempts: int = MAX_NIPPLE_ATTEMPTS,
) -> dict:
    meta = dict(t2.CHARACTERS[stem])
    meta["_stem"] = stem
    name = meta["name"]
    label = spec.get("label", variant)
    qa = QA_DIR / stem
    qa.mkdir(parents=True, exist_ok=True)
    dest = qa / f"{stem}_tease2_pose_{label}.png"
    gs_path = qa / f"{stem}_tease2_pose_{label}_gs.png"
    result: dict = {"stem": stem, "variant": variant, "label": label, "ok": False, "path": str(dest)}

    if dest.exists() and dest.stat().st_size > 40_000 and not force:
        print(f"[SKIP] {stem} {label} exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    ref = ref_override or spec.get("ref")
    if isinstance(ref, str):
        ref = Path(ref)
    try:
        prepare_input_plate(stem, ref, gs_path)
        stand_gs = stand_reference_gs(stem)
    except FileNotFoundError as e:
        result["error"] = str(e)
        return result

    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = build_still_prompt(stem, meta, spec)
    (qa / f"{stem}_tease2_pose_{label}_prompt.txt").write_text(prompt, encoding="utf-8")

    base_seed = 2026082800 + (abs(hash(f"{stem}-{label}{spec.get('seed_tag', '')}")) % 90000)
    out_leaf = f"{stem}_pifu05_tease2_pose_{label}"
    out_prefix = f"video/{out_leaf}"
    attempts_log: list[dict] = []
    t_total = time.time()

    for attempt in range(1, max_nipple_attempts + 1):
        seed = base_seed + attempt * 131
        print(
            f"[{stem}] {name} still {label} attempt {attempt}/{max_nipple_attempts} seed={seed} "
            f"len={length} steps={steps} ref={ref.name if ref else 'pifu05'}",
            flush=True,
        )
        t0 = time.time()

        wf = m.build_workflow(input_name, out_prefix, prompt, seed)
        wf["104"]["inputs"]["length"] = length
        wf["104"]["inputs"]["width"] = WIDTH
        wf["104"]["inputs"]["height"] = HEIGHT
        if "last_frame" in wf["104"]["inputs"]:
            del wf["104"]["inputs"]["last_frame"]
        wf["9"]["inputs"]["steps"] = steps
        if meta.get("anime_lock"):
            wf["200"]["inputs"]["shift_video"] = 5.0

        res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
        prompt_id = res["prompt_id"]
        print(f"  prompt_id {prompt_id}", flush=True)
        m.wait_prompt(prompt_id, timeout_s=3600.0)
        elapsed = time.time() - t0
        print(f"  h3 done in {elapsed:.1f}s", flush=True)

        out_mp4 = m.find_latest_output(out_leaf, t0)
        if out_mp4 is None:
            attempts_log.append({"attempt": attempt, "ok": False, "error": "no mp4"})
            print("  FAIL no mp4", flush=True)
            continue

        tmp = qa / f"{stem}_tease2_pose_{label}_a{attempt}.png"
        m.extract_frame(out_mp4, extract_t, tmp)
        if not tmp.exists() or tmp.stat().st_size < 20_000:
            attempts_log.append({"attempt": attempt, "ok": False, "error": "extract failed"})
            print("  FAIL extract", flush=True)
            continue

        ok_g, det_g = m.green_screen_ok(tmp, min_corner_green_ratio=0.30)
        print(f"  green QA: {'PASS' if ok_g else 'WARN'} {det_g}", flush=True)

        ok_nip, det_nip = nipple_plate_ok(tmp, stand_gs)
        print(f"  nipple QA: {'PASS' if ok_nip else 'FAIL'} {det_nip}", flush=True)
        if not ok_nip:
            reject = qa / f"{stem}_nipple_reject_{label}_a{attempt}.png"
            shutil.copy2(tmp, reject)
            attempts_log.append({"attempt": attempt, "ok": False, "nipple": det_nip, "reject": str(reject)})
            continue

        shutil.copy2(tmp, dest)
        if keep_mp4:
            shutil.copy2(out_mp4, qa / f"{stem}_tease2_pose_{label}.mp4")
        result["green_ok"] = bool(ok_g)
        result["green_detail"] = str(det_g)
        result["nipple_ok"] = True
        result["nipple_detail"] = det_nip
        result["ok"] = True
        result["attempts"] = attempt
        result["attempts_log"] = attempts_log
        result["elapsed_s"] = round(time.time() - t_total, 1)
        result["mp4"] = str(out_mp4) if keep_mp4 else None
        print(f"  ACCEPT -> {dest} ({dest.stat().st_size // 1024} KB) total={result['elapsed_s']}s", flush=True)
        return result

    result["error"] = f"nipple QA failed after {max_nipple_attempts} attempts"
    result["attempts_log"] = attempts_log
    result["elapsed_s"] = round(time.time() - t_total, 1)
    print(f"  FAIL {stem} {label} nipple gate after {max_nipple_attempts} attempts", flush=True)
    return result


def resolve_jobs(stem_arg: str, variants_arg: str | None) -> list[tuple[str, str, dict]]:
    jobs: list[tuple[str, str, dict]] = []
    if stem_arg == "all_sr":
        stems = SR_STEMS
        stem_variant_pairs: list[tuple[str, str | None]] = [(s, None) for s in stems]
    elif stem_arg == "all_ssr":
        stems = SSR_STEMS
        stem_variant_pairs = [(s, None) for s in stems]
    elif stem_arg == "all_ur":
        stems = UR_STEMS
        stem_variant_pairs = [(s, None) for s in stems]
    elif "," in stem_arg or (":" in stem_arg and stem_arg not in ("all_sr", "all_ssr", "all_ur")):
        stem_variant_pairs = []
        for token in [s.strip() for s in stem_arg.split(",") if s.strip()]:
            if ":" in token:
                stem, vk = token.split(":", 1)
                stem_variant_pairs.append((stem.strip(), vk.strip()))
            else:
                stem_variant_pairs.append((token, None))
    else:
        stem_variant_pairs = [(stem_arg.strip(), None)]

    global_variants: list[str] | None = None
    if variants_arg:
        global_variants = [v.strip() for v in variants_arg.split(",") if v.strip()]

    for stem, variant_key in stem_variant_pairs:
        if stem not in t2.CHARACTERS:
            raise ValueError(f"unknown stem {stem}")
        specs = POSE_SPECS.get(stem, {})
        if not specs:
            raise ValueError(f"no pose specs for {stem}")
        if variant_key:
            keys = [variant_key]
        elif global_variants:
            keys = global_variants
        else:
            keys = list(specs.keys())
        for k in keys:
            if k not in specs:
                raise ValueError(f"unknown variant {k} for {stem}")
            jobs.append((stem, k, specs[k]))
    return jobs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all_sr", help="stem, comma list, all_sr, all_ssr, or all_ur")
    ap.add_argument("--variants", default=None, help="comma variant keys; default all defined")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--fast", action="store_true", help="preview mode: length=5 steps=8 (low quality)")
    ap.add_argument("--length", type=int, default=None, help="override H3 frame count")
    ap.add_argument("--steps", type=int, default=None, help="override sampler steps")
    ap.add_argument("--no-keep-mp4", action="store_true", help="skip saving intermediate mp4")
    ap.add_argument("--max-nipple-attempts", type=int, default=MAX_NIPPLE_ATTEMPTS)
    args = ap.parse_args()

    if args.fast:
        length = args.length if args.length is not None else FAST_LENGTH
        steps = args.steps if args.steps is not None else FAST_STEPS
        extract_t = FAST_EXTRACT_T
        mode = "FAST preview"
    else:
        length = args.length if args.length is not None else LENGTH
        steps = args.steps if args.steps is not None else STEPS
        extract_t = EXTRACT_T
        mode = "QUALITY"
    keep_mp4 = not args.no_keep_mp4

    try:
        jobs = resolve_jobs(args.stem, args.variants)
    except ValueError as e:
        print(f"ERROR: {e}", flush=True)
        return 2

    print(
        f"=== pifu05 tease2 POSE STILLS ({mode}) === {len(jobs)} jobs "
        f"length={length} steps={steps} extract_t={extract_t}s",
        flush=True,
    )
    results = []
    for stem, variant, spec in jobs:
        ref = spec.get("ref")
        if isinstance(ref, Path) and not ref.exists():
            print(f"[FAIL] missing ref {ref}", flush=True)
            results.append({"stem": stem, "variant": variant, "ok": False, "error": f"missing ref {ref}"})
            continue
        results.append(
            generate_one(
                stem, variant, spec, force=args.force,
                length=length, steps=steps, extract_t=extract_t, keep_mp4=keep_mp4,
                max_nipple_attempts=args.max_nipple_attempts,
            )
        )

    report = QA_DIR / "pose_stills_batch_report.json"
    report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    ok = [f"{r['stem']}:{r.get('label', r.get('variant'))}" for r in results if r.get("ok")]
    fail = [f"{r['stem']}:{r.get('label', r.get('variant'))}" for r in results if not r.get("ok")]
    print(f"SUMMARY ok={ok}\nfail={fail}\nreport={report}", flush=True)
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
