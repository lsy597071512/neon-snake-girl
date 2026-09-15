"""H3 stills: tiaojiao v0.4 — white sexy thin leather suit + mechanical tentacle bind.

Pipeline (body lock from sleepwear pifu02):
  A) pifu02 stand → WHITE thin sexy leather catsuit stand
       → {stem}_tiaojiao_suit_stand.png
  B) suit stand → discipline pose + commander mechanical tentacles
       → {stem}_tiaojiao_pose_{1|2}.png

Usage:
  # Stage A only (approve suit first)
  python scripts/run_tiaojiao_pose_stills.py --stem SR01_2,SR01_3 --stage-a-only --force --quality

  # Stage B after suit approved
  python scripts/run_tiaojiao_pose_stills.py --stem SR01_2,SR01_3 --stage-b-only --force --quality
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
_spec = importlib.util.spec_from_file_location("tease2_batch", TEASE2)
t2 = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(t2)

SLEEP = ROOT / "scripts" / "run_minimax_h3_pifu02_sleep_batch.py"
_ss = importlib.util.spec_from_file_location("pifu02_sleep", SLEEP)
sb = importlib.util.module_from_spec(_ss)
assert _ss.loader is not None
_ss.loader.exec_module(sb)

m = t2.m

EMOTION_DIR = ROOT / "tex" / "juese" / "emotion-poses"
SHUIYI_DIR = ROOT / "tex" / "juese" / "pifu" / "shuiyi"
OUT_DIR = ROOT / "tex" / "juese" / "pifu" / "tiaojiao"
QA_DIR = OUT_DIR / "_qa"
WIDTH, HEIGHT = 768, 1344
GREEN = (0, 177, 64)

LENGTH = 9
STEPS = 12
EXTRACT_T = 0.25
Q_LENGTH = 39
Q_STEPS = 22
Q_EXTRACT_T = 0.55
A_LENGTH = 21
A_STEPS = 22
A_EXTRACT_T = 0.35
QA_LENGTH = 21
QA_STEPS = 22
QA_EXTRACT_T = 0.40

MAX_COVER_ATTEMPTS = 3

STEM_TO_EMOTION: dict[str, str] = {
    "SR01_2": "ashcrow",
    "SR01_3": "neoncoil",
    "SR02_1": "heartforge",
    "SR03_1": "mirror",
    "SR04_1": "prismrift",
    "SR05_1": "wireguard",
    "SSR01_1": "frostline",
    "SSR02_1": "pulse",
    "SSR03_1": "skyshard",
    "SSR04_1": "dustblade",
    "SSR05_1": "ironrain",
    "UR03_1": "stellar",
    "UR04_1": "outercore",
}

# Face/body lock strings from sleepwear analysis (shuiyi pifu02)
BODY_LOCK_META: dict[str, dict[str, str]] = {
    "SR01_2": {
        "measure": "168cm B88/W59/H86 athletic slim hourglass — NOT mega-bust",
        "lock": (
            "ash-blonde high ponytail, silver wing-fin head clips, large light-blue eyes, pale skin; "
            "white/grey/gold mechanical legs from mid-thigh with pointed cyber heels"
        ),
    },
    "SR01_3": {
        "measure": "162cm B84/W56/H82 compact slim — modest bust",
        "lock": (
            "messy short silver-white hair, thin red headband, pale eyes, elf ears; "
            "glossy white mecha arms/legs with black joints, red accents"
        ),
    },
    "SR02_1": {
        "measure": "166cm B90/W60/H88 soft fuller bust",
        "lock": "long wavy ash-blonde, teal eyes; white/grey/gold mech right arm + boots from pifu02",
    },
    "SR03_1": {
        "measure": "167cm B87/W57/H85 slim",
        "lock": "very long silver-grey hair, amber eyes, bulky headset; cyber marks from pifu02",
    },
    "SR04_1": {
        "measure": "170cm B92/W61/H90 taller fuller bust",
        "lock": "long jet-black high ponytail, amber eyes; white/orange cyber arm + mech legs from pifu02",
    },
    "SR05_1": {
        "measure": "165cm B85/W57/H84",
        "lock": "long white hair, feline ears, amber eyes, respirator; white-silver mech hands/feet from pifu02",
    },
    "SSR01_1": {
        "measure": "169cm B89/W59/H87",
        "lock": "long jet-black hair, crimson eyes; matte black left arm + mech right lower leg from pifu02",
    },
    "SSR02_1": {
        "measure": "165cm B85/W57/H84",
        "lock": "long silver-grey hair, green eyes; silver/white cyber plates from pifu02",
    },
    "SSR03_1": {
        "measure": "158cm B82/W55/H80 petite",
        "lock": "pastel blue-lavender hair, soft purple eyes; white mech arms/legs gold joints from pifu02",
    },
    "SSR04_1": {
        "measure": "163cm B88/W58/H86",
        "lock": "dusty pink hair, reddish eyes, black robotic ears; black/red cyber limbs from pifu02",
    },
    "SSR05_1": {
        "measure": "166cm B86/W58/H85",
        "lock": "orange high ponytail, amber eyes; white mech thigh boots from pifu02",
    },
    "UR03_1": {
        "measure": "170cm B86/W56/H84",
        "lock": "long black hair pink underside, reddish-brown eyes, headphones; cyber collar/legs from pifu02",
    },
    "UR04_1": {
        "measure": "160cm B84/W56/H83",
        "lock": "short messy light-blue hair, bunny ears, purple-pink eyes; white-silver mech legs from pifu02",
    },
}

FACE_PREF = [
    "15-tension.png",
    "36-shame.png",
    "14-panic.png",
    "16-fluster.png",
    "27-intimacy.png",
    "Generated_image.png",
    "_ref-lock.png",
    "_run-lock.png",
]

BODY_LOCK = (
    "BODY PROPORTION HARD LOCK (1:1 星夜睡衣 pifu02):\n"
    "- Measurements: {measure}\n"
    "- Identity: {lock}\n"
    "- LOCK exact height, head size, breast VOLUME, waist, hip WIDTH, thigh thickness, leg length\n"
    "- FORBIDDEN: enlarge bust, thicken hips/butt, pear morph, another body type\n\n"
)

WHITE_LEATHER_SUIT = (
    "OUTFIT CHANGE ONLY — STANDING POSE FROZEN:\n"
    "- Strip white satin camisole + shorts completely\n"
    "- Replace with designed WHITE thin sexy leather catsuit (皮衣质感):\n"
    "  * Glossy soft white leather / thin latex-leather hybrid — OPAQUE, light-blocking\n"
    "  * Form-fitting thin catsuit hugging bust/waist/hips/butt/thighs with clothing folds & specular sheen\n"
    "  * Fashion design details: subtle panel seams, underbust contour stitch, hip high-cut seam, "
    "tiny collar or zipper accent, clean edge at neck/shoulders\n"
    "  * Looks like real designed lingerie-tech leatherwear — NOT flat paint, NOT mesh, NOT fishnet, NOT pajamas\n"
    "  * Bust fully covered by opaque white leather panel — ZERO tip show-through\n"
    "  * Crotch fully covered by opaque white leather panel\n"
    "- Keep cyber mechanical limbs/plating from first frame; face + hair uncovered\n"
    "- NO ropes, NO tentacles, NO pose change, NO camera move — micro blink + breath only\n\n"
)

SUIT_KEEP = (
    "KEEP the WHITE thin sexy leather catsuit from first frame (opaque, designed seams/sheen):\n"
    "- Do NOT remove suit; do NOT turn sheer/nude/mesh\n"
    "- Tentacles wrap OVER the white leather\n\n"
)

TENTACLE_LOCK = (
    "COMMANDER BLACK MECHANICAL TENTACLE BIND (zhujue claw language):\n"
    "- Matte / semi-gloss BLACK segmented MECHANICAL tentacle arms (industrial robot segments)\n"
    "- Color = BLACK / charcoal metal ONLY — NOT white, NOT off-white, NOT light-grey armor tubes\n"
    "- Each tentacle end = identical three-finger claw (2 fingers + thumb), dark metal matching tentacles; "
    "small red accent lights optional on joints\n"
    "- Tentacles TIGHTLY wrap body with 勒肉感 through white leather: neck, chest/underbust, waist, "
    "perineum/crotch press, butt cleft, thigh-root (≥5 wrap zones)\n"
    "- Living SM tension: arch, hip tilt, open/closed legs — not stiff doll\n"
    "- FORBIDDEN: white/light-grey tentacles, organic octopus tentacles, black rope-only, "
    "mismatched hands, 5-finger hands, half-body crop\n\n"
)

LIGHTING_BLOCK = (
    "LIGHTING: dim indoor on subject; background pure #00b140 only — "
    "NO floor disk, NO pedestal, NO shadow catcher\n\n"
)

FULLBODY_LOCK = (
    "FRAMING — COMPLETE FULL BODY:\n"
    "- Crown of head AND both FEET/toes visible with green margin above+below\n"
    "- Subject ~68-78% frame height; prefer smaller subject over any limb crop\n\n"
)

POSE_SPECS: dict[str, dict[str, dict]] = {
    "SR01_2": {
        "1": {
            "camera": (
                "LOCKED full-body 40° rear-side FAR: head-to-TOES, green margins. ~72% height."
            ),
            "pose": (
                "FULL BODY side-kneel on green — white leather catsuit kept:\n"
                "hips presented, slight back arch; BLACK mechanical tentacles wrap neck, underbust, waist, "
                "thigh-root, butt cleft; cyber right leg extended; feet visible.\n"
                "0–2 zhujue three-finger claws as tentacle ends. Ice-blue tense face.\n"
                "Body proportions identical to first-frame white-suit stand."
            ),
        },
        "2": {
            "camera": (
                "LOCKED full-body FRONT FAR: head-to-TOES, both feet, green margins. ~74% height."
            ),
            "pose": (
                "FULL BODY front kneel — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "knees open, FEET visible; tentacles: neck collar, chest harness, waist, crotch press, thigh bands.\n"
                "Asymmetric wrists bound by tentacles. Wet eyes. Same slim body as suit stand."
            ),
        },
    },
    "SR01_3": {
        "1": {
            "camera": (
                "LOCKED full-body 55° rear-side FAR: head-to-TOES, feet visible, green margins. ~72% height."
            ),
            "pose": (
                "FULL BODY low kneel rear-side — white leather catsuit kept:\n"
                "face turned; hip tilt WITHOUT enlarging butt; tentacles on waist, butt cleft, perineum, "
                "thigh-root, neck, chest-side. Both feet on green. Purple wet eyes.\n"
                "Compact slim proportions of first-frame suit stand."
            ),
        },
        "2": {
            "camera": (
                "LOCKED full-body FRONT FAR: crown to TOES, green margins. ~74% height."
            ),
            "pose": (
                "FULL BODY upright kneel lean-back — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "tentacles: neck, chest, waist, crotch, thighs; wrists behind back; feet visible.\n"
                "Same compact slim body as suit stand."
            ),
        },
    },
    "SR02_1": {
        "1": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~73% height.",
            "pose": (
                "FULL BODY ground M-sit — white leather catsuit kept:\n"
                "knees forced open by mech tentacles; wrists pulled from chest-guard to knees; waist hoop keeps spine straight; "
                "feet visible. Teal wet eyes, gentle bitten lip. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body 35° side FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY side kneel lean — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "one knee down, other thigh lifted by tentacle; wrists bound behind; neck+waist+thigh-root wraps; "
                "halo/headset tilt. Soft fluster face. Same body as suit stand."
            ),
        },
    },
    "SR03_1": {
        "1": {
            "camera": "LOCKED full-body FRONT-SIDE FAR: head-to-TOES, green margins. ~73% height.",
            "pose": (
                "FULL BODY seated — white leather catsuit kept:\n"
                "one leg pulled straight horizontal by tentacle, other knee open-fixed; wrists raised beside shoulders; "
                "waist crossed wraps; feet visible. Amber calculating eyes cracking. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body FRONT FAR kneel: head-to-TOES, green margins. ~74% height.",
            "pose": (
                "FULL BODY upright kneel — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "tentacles cinch waist+chest+thighs; wrists overhead; headset antenna tremble; feet under knees. "
                "Bitter micro-smile. Same slim body as suit stand."
            ),
        },
    },
    "SR04_1": {
        "1": {
            "camera": "LOCKED full-body 3/4 FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY lean-back kneel — white leather catsuit kept:\n"
                "one knee raised outward, hip forced forward; wrists bound behind after failed waist-grab; "
                "waist hoop lifts chest; feet visible. Amber stare, slow breath. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~74% height.",
            "pose": (
                "FULL BODY wide kneel — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "both knees open; tentacles on neck, underbust, waist, crotch, thighs; wrists to ankles; "
                "fire-discipline tension face. Same proportions as suit stand."
            ),
        },
    },
    "SR05_1": {
        "1": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY deep squat knees-open — white leather catsuit kept:\n"
                "elbows yanked off knees by tentacles; waist-back tentacle forces arch+hip lift; "
                "wrist cuffs crossed at neck FRONT but NEVER cover respirator; feline ears twitching; feet flat visible. "
                "Amber eyes panicking wink. KEEP respirator. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body 40° rear-side FAR: head-to-TOES, green margins. ~73% height.",
            "pose": (
                "FULL BODY rear-side kneel — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "respirator ON; tentacles waist+thigh-root+butt cleft+wrists; face half-turned. Same body as suit stand."
            ),
        },
    },
    "SSR01_1": {
        "1": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~73% height.",
            "pose": (
                "FULL BODY front kneel-sit Dom-reversed — white leather catsuit kept:\n"
                "knees forced beyond fist-width; wrists high overhead cuffed; neck-side tentacle; "
                "whip-hand empty/symbolically disarmed; crimson eyes wet. Keep knife-edge pride. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body 50° rear FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY rear kneel presentation — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "wrists back; tentacles waist+chest harness+thighs; looking over shoulder cold-wet. Same body."
            ),
        },
    },
    "SSR02_1": {
        "1": {
            "camera": "LOCKED full-body FRONT FAR standing: head-to-TOES, green margins. ~75% height.",
            "pose": (
                "FULL BODY standing feet pinned shoulder-width — white leather catsuit kept:\n"
                "arms cuffed at highest reach; waist S-curve cinched; mech wings half-open stuck; "
                "neon-green laughing wet eyes. Bright collapse. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body FRONT FAR kneel: head-to-TOES, green margins. ~73% height.",
            "pose": (
                "FULL BODY kneel arms-up — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "tentacles chest+waist+thighs; wings trembling; laughing-gasp face. Same body."
            ),
        },
    },
    "SSR03_1": {
        "1": {
            "camera": "LOCKED full-body SIDE FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY side-lying — white leather catsuit kept:\n"
                "lower leg straight ankle-cuffed; upper leg bent 90° lifted at knee; wrists crossed in front of chest "
                "(can't fully hide); waist-side tentacle micro-push; soft pink wet shy eyes. Petite body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body FRONT FAR kneel: head-to-TOES, green margins. ~74% height.",
            "pose": (
                "FULL BODY shy kneel — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "knees together then forced slight open; wrists to thighs; neck+waist wraps; peeking then look-away. Same petite body."
            ),
        },
    },
    "SSR04_1": {
        "1": {
            "camera": "LOCKED full-body 45° rear FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY prone-kneel hunter-prey — white leather catsuit kept:\n"
                "chest lifted off floor by tentacle; face forced +30°; wrists forward pinned; hips high; "
                "scorpion-tail lightly wrapped if present; soft pink smile cracking. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~74% height.",
            "pose": (
                "FULL BODY front kneel — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "tentacles neck+waist+thighs+wrists behind; gentle-hunter eyes wet. Same body."
            ),
        },
    },
    "SSR05_1": {
        "1": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~73% height.",
            "pose": (
                "FULL BODY kneel hug-knees then forced open — white leather catsuit kept:\n"
                "tentacles pry knees apart; chest forced forward; wrists pulled off knees; shoulders locked; "
                "amber eyes look aside then peek; CLEAN mouth NO drool. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body 35° side FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY side kneel stubborn — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "waist+thigh+wrist wraps; twin-tails shake; pout without saliva. Same body."
            ),
        },
    },
    "UR03_1": {
        "1": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~73% height.",
            "pose": (
                "FULL BODY kneel-sit verdict-broken — white leather catsuit kept:\n"
                "blade/weapon pinned at side by tentacle; torso locked ~15° lean-forward; wrists on knees pinned; "
                "glass/cyber legs ringed; ethereal wet eyes. Keep airy calm. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body 40° rear-side FAR: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY rear-side kneel — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "wrists back; tentacles waist+chest+thighs; headphones tremble; empty serene-cracked face. Same body."
            ),
        },
    },
    "UR04_1": {
        "1": {
            "camera": "LOCKED full-body FRONT FAR: head-to-TOES, green margins. ~74% height.",
            "pose": (
                "FULL BODY bunny-sit (knees on heels) — white leather catsuit kept:\n"
                "hands propped behind pinned by wrist cuffs; chest forced forward; knees tentacle-spread; "
                "bunny ears; cute camouflage cracking to predator glance. Body 1:1 suit stand."
            ),
        },
        "2": {
            "camera": "LOCKED full-body 55° rear-side FAR standing/kneel hybrid: head-to-TOES, green margins. ~72% height.",
            "pose": (
                "FULL BODY rear-side forced lookback — DIFFERENT from pose_1 — white leather catsuit kept:\n"
                "hips pinned; neck turn forced by tentacle; waist+thigh wraps; feet visible. Same body."
            ),
        },
    },
}


def resolve_body_ref(stem: str) -> Path:
    p = SHUIYI_DIR / f"{stem}_pifu02.png"
    if not p.exists():
        raise FileNotFoundError(f"missing sleepwear body plate: {p}")
    return p


def resolve_face_ref(stem: str) -> Path:
    eid = STEM_TO_EMOTION[stem]
    folder = EMOTION_DIR / eid
    for name in FACE_PREF:
        p = folder / name
        if p.exists():
            return p
    pngs = sorted(folder.glob("*.png")) if folder.exists() else []
    for p in pngs:
        if not p.name.startswith("_"):
            return p
    if not pngs:
        raise FileNotFoundError(f"no emotion-poses for {eid}")
    return pngs[0]


def suit_stand_path(stem: str) -> Path:
    return OUT_DIR / f"{stem}_tiaojiao_suit_stand.png"


def plate_to_greenscreen(src: Path, dest: Path, *, max_h_frac: float = 0.96) -> Path:
    im = Image.open(src).convert("RGBA")
    arr = np.asarray(im).astype(np.float32)
    rgb, a = arr[:, :, :3], arr[:, :, 3]
    lum = rgb.mean(axis=2)
    if float(a.mean()) > 250:
        mask = lum > 18
        g = np.array(GREEN, dtype=np.float32)
        dist = np.linalg.norm(rgb - g, axis=2)
        if float((dist < 55).mean()) > 0.35:
            mask = dist >= 55
    else:
        mask = a > 16
    ys, xs = np.where(mask)
    if len(xs) < 80:
        raise RuntimeError(f"empty subject: {src}")
    pad = 4
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(im.width, int(xs.max()) + 1 + pad), min(im.height, int(ys.max()) + 1 + pad)
    crop = im.crop((l, t, r, b))
    margin = 0.02
    max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * max_h_frac)
    scale = min(max_w / crop.width, max_h / crop.height)
    nw, nh = max(1, int(crop.width * scale)), max(1, int(crop.height * scale))
    crop2 = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (*GREEN, 255))
    canvas.alpha_composite(crop2, ((WIDTH - nw) // 2, (HEIGHT - nh) // 2))
    out = np.asarray(canvas).astype(np.float32)
    alpha = out[:, :, 3:4] / 255.0
    rgb_o = out[:, :, :3]
    g = np.broadcast_to(np.array(GREEN, dtype=np.float32), rgb_o.shape)
    flat = rgb_o * alpha + g * (1.0 - alpha)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(flat, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
    m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, m.COMFY_INPUT / dest.name)
    print(f"  plate {dest.name} from {src.name} scale={nw}x{nh} h%={nh / HEIGHT * 100:.1f}", flush=True)
    return dest


def meta_for(stem: str) -> dict:
    base = dict(t2.CHARACTERS[stem])
    extra = BODY_LOCK_META.get(stem, {"measure": "slim athletic", "lock": "match pifu02"})
    base["measure"] = extra["measure"]
    base["id_lock"] = extra["lock"]
    return base


def build_stage_a_prompt(stem: str, meta: dict) -> str:
    return (
        f"{t2.CHROMA_BASE}\n\n"
        f"{t2.ANIME_STYLE_BLOCK}"
        f"{BODY_LOCK.format(measure=meta['measure'], lock=meta['id_lock'])}"
        f"{FULLBODY_LOCK}{LIGHTING_BLOCK}{WHITE_LEATHER_SUIT}"
        f"First frame = {stem}_pifu02 星夜睡衣 standing plate. "
        "ONLY replace pajamas with designed white thin sexy leather catsuit. Pose/body 1:1.\n\n"
        "STATIC STAND HOLD. Micro breath + blink. NO kneel. NO tentacles.\n\n"
        f"Character: {meta['name']} ({stem})."
    )


def build_stage_b_prompt(stem: str, meta: dict, spec: dict, face_ref_name: str) -> str:
    eid = STEM_TO_EMOTION[stem]
    return (
        f"{t2.CHROMA_BASE}\n\n"
        f"{t2.ANIME_STYLE_BLOCK}"
        f"{BODY_LOCK.format(measure=meta['measure'], lock=meta['id_lock'])}"
        f"{FULLBODY_LOCK}{LIGHTING_BLOCK}{SUIT_KEEP}{TENTACLE_LOCK}"
        "First frame = APPROVED white leather catsuit standing plate. "
        "KEEP white suit. CHANGE pose + add mechanical tentacles only.\n"
        f"FACE: emotion-poses/{eid}/{face_ref_name} expression OK — do NOT change body.\n\n"
        "STATIC POSE HOLD after settle. Micro breath + blink. NO camera move.\n\n"
        f"CAMERA:\n{spec['camera']}\n\n"
        f"POSE (frozen):\n{spec['pose']}\n\n"
        f"Character: {meta['name']} ({stem} / {eid})."
    )


def cover_ok(candidate: Path, stand_gs: Path) -> tuple[bool, str]:
    return sb.no_nipple_leak_ok(candidate, stand_gs, after_chroma=False, video_frame=True)


def suit_cover_ok(candidate: Path, stand_gs: Path) -> tuple[bool, str]:
    """Stage A white-leather: allow designed neck/cleavage cutouts; reject tip show-through only."""
    ok, det = cover_ok(candidate, stand_gs)
    if ok:
        return True, det
    # Designed V-neck / collar cutout often trips bare/severe without tip_show
    if "tip_show=True" in det or "tip_worsen=True" in det:
        return False, det
    if "sheer=True" in det and "tip_n': 0" not in det and "tip_n':0" not in det:
        # sheer with tips
        if "tip_max': 0" not in det and "tip_max':0" not in det:
            # check tip_max numerically from string
            pass
    # Parse tip_max from detail string
    import re
    m_tip = re.search(r"tip_max': (\d+)", det)
    tip_max = int(m_tip.group(1)) if m_tip else 0
    m_n = re.search(r"tip_n': (\d+)", det)
    tip_n = int(m_n.group(1)) if m_n else 0
    if tip_max >= 140 or tip_n >= 2:
        return False, det
    return True, det + " | suit_cutout_override=True"


def _run_h3(
    *,
    input_name: str,
    out_leaf: str,
    prompt: str,
    seed: int,
    length: int,
    steps: int,
    extract_t: float,
    tmp_png: Path,
) -> Path | None:
    out_prefix = f"video/{out_leaf}"
    t0 = time.time()
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = length
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    if "last_frame" in wf["104"]["inputs"]:
        del wf["104"]["inputs"]["last_frame"]
    wf["9"]["inputs"]["steps"] = steps
    wf["200"]["inputs"]["shift_video"] = 5.0

    res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
    print(f"  prompt_id {res['prompt_id']}", flush=True)
    m.wait_prompt(res["prompt_id"], timeout_s=3600.0)
    print(f"  h3 done in {time.time() - t0:.1f}s", flush=True)

    out_mp4 = m.find_latest_output(out_leaf, t0)
    if out_mp4 is None:
        return None
    m.extract_frame(out_mp4, extract_t, tmp_png)
    if not tmp_png.exists() or tmp_png.stat().st_size < 20_000:
        return None
    return out_mp4


def generate_suit_stand(
    stem: str,
    *,
    force: bool = False,
    length: int = A_LENGTH,
    steps: int = A_STEPS,
    extract_t: float = A_EXTRACT_T,
) -> dict:
    """Stage A: pifu02 → white sexy leather catsuit stand."""
    meta = meta_for(stem)
    name = meta["name"]
    qa = QA_DIR / stem
    qa.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = suit_stand_path(stem)
    gs_path = qa / f"{stem}_tiaojiao_suit_stand_gs.png"
    result: dict = {"stem": stem, "stage": "A_suit_stand", "ok": False, "path": str(dest)}

    if dest.exists() and dest.stat().st_size > 40_000 and not force:
        print(f"[SKIP A] {dest.name}", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    body = resolve_body_ref(stem)
    plate_to_greenscreen(body, gs_path, max_h_frac=0.96)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = build_stage_a_prompt(stem, meta)
    (qa / f"{stem}_tiaojiao_suit_stand_prompt.txt").write_text(prompt, encoding="utf-8")

    attempts_log = []
    for attempt in range(1, MAX_COVER_ATTEMPTS + 1):
        seed = 2026082901 + (abs(hash(f"{stem}-whitesuit-v40-a{attempt}")) % 90000)
        out_leaf = f"{stem}_tiaojiao_suit_stand_a{attempt}"
        print(
            f"[A {stem}] {name} white-suit attempt {attempt}/{MAX_COVER_ATTEMPTS} "
            f"seed={seed} len={length} steps={steps} body={body.name}",
            flush=True,
        )
        tmp = qa / f"{stem}_tiaojiao_suit_stand_raw_a{attempt}.png"
        mp4 = _run_h3(
            input_name=input_name,
            out_leaf=out_leaf,
            prompt=prompt,
            seed=seed,
            length=length,
            steps=steps,
            extract_t=extract_t,
            tmp_png=tmp,
        )
        if mp4 is None:
            attempts_log.append({"attempt": attempt, "ok": False, "error": "h3 failed"})
            continue

        ok_g, det_g = m.green_screen_ok(tmp, min_corner_green_ratio=0.30)
        print(f"  green QA: {'PASS' if ok_g else 'WARN'} {det_g}", flush=True)
        ok_c, det_c = suit_cover_ok(tmp, gs_path)
        print(f"  cover QA: {'PASS' if ok_c else 'FAIL'} {det_c}", flush=True)
        if not ok_c:
            reject = qa / f"{stem}_cover_reject_suit_a{attempt}.png"
            shutil.copy2(tmp, reject)
            attempts_log.append({"attempt": attempt, "ok": False, "cover": det_c})
            continue

        img = Image.open(tmp).convert("RGB")
        if img.size != (WIDTH, HEIGHT):
            img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        img.save(dest, "PNG")
        shutil.copy2(mp4, qa / f"{stem}_tiaojiao_suit_stand.mp4")
        result["ok"] = True
        result["attempt"] = attempt
        result["cover"] = det_c
        print(f"  SHIP A -> {dest} ({dest.stat().st_size // 1024} KB)", flush=True)
        return result

    result["error"] = f"cover QA failed after {MAX_COVER_ATTEMPTS} attempts"
    result["attempts"] = attempts_log
    print(f"  FAIL A {stem}: {result['error']}", flush=True)
    return result


def generate_pose(
    stem: str,
    variant: str,
    spec: dict,
    *,
    force: bool = False,
    length: int = LENGTH,
    steps: int = STEPS,
    extract_t: float = EXTRACT_T,
) -> dict:
    """Stage B: white suit stand → pose + mechanical tentacles."""
    meta = meta_for(stem)
    name = meta["name"]
    qa = QA_DIR / stem
    qa.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUT_DIR / f"{stem}_tiaojiao_pose_{variant}.png"
    gs_path = qa / f"{stem}_tiaojiao_pose_{variant}_gs.png"
    result: dict = {"stem": stem, "variant": variant, "stage": "B_pose", "ok": False, "path": str(dest)}

    if dest.exists() and dest.stat().st_size > 40_000 and not force:
        print(f"[SKIP B] {dest.name}", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    suit = suit_stand_path(stem)
    if not suit.exists():
        result["error"] = f"missing stage A plate: {suit.name}"
        print(f"  ERROR {result['error']}", flush=True)
        return result

    face = resolve_face_ref(stem)
    plate_to_greenscreen(suit, gs_path, max_h_frac=0.78)
    stand_ref = qa / f"{stem}_tiaojiao_pifu02_stand_gs.png"
    if not stand_ref.exists():
        plate_to_greenscreen(resolve_body_ref(stem), stand_ref, max_h_frac=0.96)

    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = build_stage_b_prompt(stem, meta, spec, face.name)
    (qa / f"{stem}_tiaojiao_pose_{variant}_prompt.txt").write_text(prompt, encoding="utf-8")

    attempts_log = []
    for attempt in range(1, MAX_COVER_ATTEMPTS + 1):
        seed = 2026082920 + (abs(hash(f"{stem}-pose-v41-blacktent-{variant}-a{attempt}")) % 90000)
        out_leaf = f"{stem}_tiaojiao_pose_{variant}_a{attempt}"
        print(
            f"[B {stem}] {name} pose_{variant} attempt {attempt}/{MAX_COVER_ATTEMPTS} "
            f"seed={seed} len={length} steps={steps} body={suit.name}",
            flush=True,
        )
        tmp = qa / f"{stem}_tiaojiao_pose_{variant}_raw_a{attempt}.png"
        mp4 = _run_h3(
            input_name=input_name,
            out_leaf=out_leaf,
            prompt=prompt,
            seed=seed,
            length=length,
            steps=steps,
            extract_t=extract_t,
            tmp_png=tmp,
        )
        if mp4 is None:
            attempts_log.append({"attempt": attempt, "ok": False, "error": "h3 failed"})
            continue

        ok_g, det_g = m.green_screen_ok(tmp, min_corner_green_ratio=0.30)
        print(f"  green QA: {'PASS' if ok_g else 'WARN'} {det_g}", flush=True)
        ok_c, det_c = cover_ok(tmp, stand_ref)
        print(f"  cover QA: {'PASS' if ok_c else 'FAIL'} {det_c}", flush=True)
        if not ok_c:
            reject = qa / f"{stem}_cover_reject_pose{variant}_a{attempt}.png"
            shutil.copy2(tmp, reject)
            attempts_log.append({"attempt": attempt, "ok": False, "cover": det_c})
            continue

        img = Image.open(tmp).convert("RGB")
        if img.size != (WIDTH, HEIGHT):
            img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
        img.save(dest, "PNG")
        shutil.copy2(mp4, qa / f"{stem}_tiaojiao_pose_{variant}.mp4")
        result["ok"] = True
        result["attempt"] = attempt
        print(f"  SHIP B -> {dest} ({dest.stat().st_size // 1024} KB)", flush=True)
        return result

    result["error"] = f"cover QA failed after {MAX_COVER_ATTEMPTS} attempts"
    result["attempts"] = attempts_log
    print(f"  FAIL B {stem}:{variant}: {result['error']}", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="SR01_2,SR01_3")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--quality", action="store_true")
    ap.add_argument("--variants", default="1,2")
    ap.add_argument("--stage-a-only", action="store_true")
    ap.add_argument("--stage-b-only", action="store_true")
    args = ap.parse_args()

    if args.quality:
        a_len, a_steps, a_ext = QA_LENGTH, QA_STEPS, QA_EXTRACT_T
        b_len, b_steps, b_ext = Q_LENGTH, Q_STEPS, Q_EXTRACT_T
        mode = "QUALITY v0.4"
    else:
        a_len, a_steps, a_ext = A_LENGTH, A_STEPS, A_EXTRACT_T
        b_len, b_steps, b_ext = LENGTH, STEPS, EXTRACT_T
        mode = "FAST v0.4"

    stems = list(STEM_TO_EMOTION.keys()) if args.stem == "all" else [
        s.strip() for s in args.stem.split(",") if s.strip()
    ]
    variants = [v.strip() for v in args.variants.split(",") if v.strip()]

    print(f"=== tiaojiao WHITE LEATHER + MECH TENTACLE ({mode}) ===", flush=True)
    print("A = pifu02→white sexy leather stand | B = suit→pose+tentacles", flush=True)
    print(f"OUT: {OUT_DIR}", flush=True)
    m.api("/system_stats")

    results = []
    for stem in stems:
        if not args.stage_b_only:
            try:
                r = generate_suit_stand(
                    stem, force=args.force, length=a_len, steps=a_steps, extract_t=a_ext,
                )
            except Exception as e:
                r = {"stem": stem, "stage": "A_suit_stand", "ok": False, "error": str(e)}
                print(f"  ERROR A {stem}: {e}", flush=True)
            results.append(r)
            if not r.get("ok"):
                continue

        if args.stage_a_only:
            continue

        if stem not in POSE_SPECS:
            print(f"[SKIP B] no pose specs for {stem}", flush=True)
            continue
        for v in variants:
            if v not in POSE_SPECS[stem]:
                continue
            try:
                r = generate_pose(
                    stem, v, POSE_SPECS[stem][v], force=args.force,
                    length=b_len, steps=b_steps, extract_t=b_ext,
                )
            except Exception as e:
                r = {"stem": stem, "variant": v, "stage": "B_pose", "ok": False, "error": str(e)}
                print(f"  ERROR B {stem}:{v}: {e}", flush=True)
            results.append(r)

    summary = {
        "ok": [f"{r.get('stem')}:{r.get('stage')}:{r.get('variant', '-')}" for r in results if r.get("ok")],
        "fail": [f"{r.get('stem')}:{r.get('stage')}:{r.get('variant', '-')}" for r in results if not r.get("ok")],
    }
    QA_DIR.mkdir(parents=True, exist_ok=True)
    (QA_DIR / "tiaojiao_stills_report.json").write_text(
        json.dumps({"summary": summary, "results": results, "mode": mode, "spec": "v0.4-white-leather-tentacle"},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("SUMMARY ok=", summary["ok"], "fail=", summary["fail"], flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
