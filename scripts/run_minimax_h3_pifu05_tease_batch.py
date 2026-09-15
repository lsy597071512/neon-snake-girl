"""Batch MiniMax H3: 特殊服装01 pifu05 greenscreen tease → transparent webm.

Vertical 768×1344, 5s (120 frames @24fps), fixed camera, sexy teasing action per character.
Requires ComfyUI http://127.0.0.1:8188 + MiniMax H3 weights.

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_minimax_h3_pifu05_tease_batch.py --stem SR01_2
  ... --stem all --force
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
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"
spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

from scripts.chroma_key_lib import process_video  # noqa: E402
from chroma_key_gs_video_webm import gs_mp4_to_webm  # noqa: E402

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "teshufuzhuang01"
QA_DIR = SRC_DIR / "_qa_tease"
FIRST_DIR = SRC_DIR / "_first_tease"

WIDTH, HEIGHT = 768, 1344
LENGTH = 120  # 5.0s @ 24fps
STEPS = 20  # match chongzao/pifu02 H3 default
MAX_ATTEMPTS = 3
H3_WAIT_TIMEOUT_S = 7200.0  # tease clips + queue backup: allow up to 2h

CHROMA_BASE = (
    "2D anime game character greenscreen action plate. Pure flat chroma key green (#00b140) background, "
    "even soft anime-style lighting, seamless green matte, subject isolated on solid green. "
    "Ultra-detailed flat cel-shaded 2D anime illustration exactly matching the first-frame static plate — "
    "clean linework, soft pastel palette, sharp anime focus. "
    "NOT 3D render, NOT CGI, NOT photorealistic, NOT realistic doll, NOT Unreal/Octane.\n\n"
    "FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. "
    "Do not shrink the subject, no pull-out, no added headroom.\n\n"
    "CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. "
    "Framing identical throughout.\n\n"
    "Keep pure flat #00b140 green everywhere behind the subject: no floor, no set, no shadow catcher, "
    "no vignette. Do NOT change hair color, face design, cybernetics, or outfit design.\n\n"
    "Audio: very soft quiet room tone only, no speech, no music."
)

ANIME_STYLE_BLOCK = (
    "ART STYLE LOCK (entire 5 seconds): stay 2D anime game illustration identical to first frame — "
    "flat cel-shaded anime art, clean linework, soft pastel colors. "
    "Face must be 1:1 the default skin portrait face (same eye shape, iris color, nose, lips, cheek roundness). "
    "Never morph into 3D/CGI/photorealistic style.\n\n"
)

CHARACTERS: dict[str, dict[str, str]] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "identity": (
            "ash-blonde high ponytail with metallic white wing-fin hair clips, light blue eyes, pale skin, "
            "black leather biker jacket draped off shoulders, black strappy bikini top and micro hot pants, "
            "black studded choker, black buckled thigh straps, black platform combat boot on organic left leg, "
            "white/silver cybernetic right leg prosthetic with gold accents — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity and special outfit from first frame: same character, same black leather/strappy bikini, "
            "same cyber leg and wing hair clips throughout.\n\n"
            "POSE: standing forward lunge toward camera, dominant cold seduction.\n\n"
            "ACTION timeline (5 seconds), continuous sensual teasing motion:\n"
            "[0.0-1.2s] Arms crossed, ice-blue eyes scan viewer from below, chin slightly raised, confident cold stare.\n"
            "[1.2-3.2s] Uncross arms; slowly slide black leather jacket further off one shoulder exposing collarbone; "
            "front cyber leg steps forward; fingertips trace from collarbone down to bikini strap edge and pause "
            "without covering, intense direct eye contact, lips barely parted.\n"
            "[3.2-5.0s] Thumb hooks bikini strap edge and releases; slow breath, still cold dominant expression, "
            "return weight to opening lunge stance for near-loop settle.\n\n"
            "Mood: cool commander flirting through control, not shy. Game-safe sexy tease, no nudity."
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "identity": (
            "short messy silver-blue hair with pointed elf ears and dark mechanical ear jewelry, purple eyes, pale skin, "
            "black lace corset bustier and lace panties, black lace-top stockings with garter, tattered black skirt-cape "
            "with glowing green matrix speckles at hem, dark glossy cyber arms and legs with small red/green indicator lights, "
            "mechanical high-heel feet — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity and special outfit from first frame: same lace corset, stockings, tattered green-edge cape, "
            "same dark cyber limbs throughout.\n\n"
            "POSE: side kneeling sit, one knee raised, silent lethal seduction.\n\n"
            "ACTION timeline (5 seconds), minimal but intense teasing motion:\n"
            "[0.0-1.2s] Kneeling side sit, eyes downcast, fingertips slowly stroke lace stocking top at thigh.\n"
            "[1.2-3.2s] Very slow look up to camera; one hand pulls lace corset shoulder strap down exposing shoulder and "
            "upper chest line; other hand slides along inner thigh upward under skirt-cape edge and stops at lace hem, "
            "parted lips, restrained desire.\n"
            "[3.2-5.0s] Hand retreats; brief half-smirk; cyber leg green lights pulse once; return to kneeling stillness.\n\n"
            "Mood: silent blade granting permission. Game-safe sexy tease, no nudity."
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "identity": (
            "long wavy ash-blonde hair, teal aquamarine eyes, translucent glowing halo headset with ear modules, "
            "black glossy latex-like bodysuit with deep sweetheart neckline and black lace trim, open long black duster coat, "
            "detached black tactical sleeves with gold/silver armor plates and blue circuit lines, asymmetrical black lace "
            "thigh-high stocking on left leg, bare right leg high-cut, white/silver high-tech armored heeled boots, "
            "long sheathed sword on back — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity and special outfit from first frame: same bodysuit, coat, halo headset, sword, cyber boots throughout.\n\n"
            "POSE: seated on floor, sword across knees, coat open over legs; transitions to half-kneel lean forward.\n\n"
            "ACTION timeline (5 seconds), gentle possessive seduction:\n"
            "[0.0-1.2s] Seated, sword resting across knees, coat open, warm teal eyes gaze at viewer with protective tenderness.\n"
            "[1.2-3.2s] Sets sword aside; both hands slowly loosen black coat belt; leans forward, fingertips hook deep V neckline "
            "of bodysuit and pull slightly wider exposing more cleavage line; soft inviting half-smile, chin tilt.\n"
            "[3.2-5.0s] Shifts to half-kneel lean, one hand on floor, other hand reaches toward camera stopping just before lips, "
            "fingers slightly curled beckoning; whisper-like expression: only you may stand this close.\n\n"
            "Mood: gentle shield-girl claiming you softly, not tsundere. Game-safe sexy tease, no nudity."
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "identity": (
            "very long straight silver-grey hair with darker charcoal bang streak, glowing amber-orange eyes, bulky mechanical "
            "headset with sharp yellow-tipped blade antenna, black strappy bikini top with harness crossing chest and midriff, "
            "oversized black bomber jacket worn off shoulders, micro black pleated skirt with silver chain belt, black lace-top "
            "garter stockings, white-yellow cybernetic right leg from mid-thigh and matching white mecha boot on left foot, "
            "black tactical gloves, eye tattoo on left shoulder — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity and special outfit from first frame: same harness bikini, skirt, jacket, antenna headset, cyber leg throughout.\n\n"
            "POSE: leaning against invisible wall, one knee bent foot on wall, hip cocked, cool analytical seduction.\n\n"
            "ACTION timeline (5 seconds), rational teasing motion:\n"
            "[0.0-1.2s] Leaning back, one cyber leg raised and bent, arms crossed under chest pushing cleavage subtly, cool amber stare.\n"
            "[1.2-3.2s] Uncross arms; slow finger trail from corner of lips down chest along harness straps to skirt hem; "
            "lifts raised leg slightly higher showing lace stocking top; flat tone seductive micro-expression, tongue briefly "
            "touches lower lip.\n"
            "[3.2-5.0s] Flicks pleated skirt edge with finger, snaps garter strap lightly, returns cool gaze: your heartbeat is out of spec.\n\n"
            "Mood: kuudere optical girl flirting with data and distance. Game-safe sexy tease, no nudity."
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "identity": (
            "long jet-black high ponytail, amber-orange eyes, black lace corset bodice with structured cups, purple neon "
            "tattered sheer cape at shoulders, black tactical shoulder armor and arm guards with orange MB-02 plate accents, "
            "black micro shorts or corset bottom, white-orange cybernetic arms and mechanical legs with panel lines — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity and special outfit from first frame: same lace corset, purple neon cape, shoulder armor, cyber limbs throughout.\n\n"
            "POSE: bent forward hands on knees, arched back toward camera, then rises close — pressure seduction.\n\n"
            "ACTION timeline (5 seconds), silent heavy teasing motion:\n"
            "[0.0-1.2s] Bent forward, hands on knees, purple cape neon fringe swaying, amber eyes look up through bangs under ponytail.\n"
            "[1.2-3.2s] Slowly straightens while tightening corset side laces with both hands, emphasizing waist and chest curve; "
            "steps closer until face near camera, parted lips, warm breath implied, intense low gaze.\n"
            "[3.2-5.0s] Thumb presses to own lips in silent shush gesture, then points at viewer chest; settles half-step back, "
            "cape neon flicker, disciplined hunger.\n\n"
            "Mood: heavy gunner countdown intimacy, minimal words maximum heat. Game-safe sexy tease, no nudity."
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "identity": (
            "long white hair, large white fox ears with yellow-black mechanical accents, amber-gold eyes, "
            "black/yellow cybernetic half-face respirator mask ALWAYS covering nose and mouth (toxic-zone gear), "
            "black strappy bikini top and micro shorts, open black trench coat with vivid magenta/pink interior lining, "
            "white-silver mechanical arms and legs with yellow panel accents, black buckled thigh straps — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity and special outfit from first frame: same fox ears, SAME respirator mask fully on, "
            "magenta-lined coat, strappy bikini, cyber limbs throughout. "
            "CRITICAL: NEVER remove, lift, pull down, or open the respirator mask — it stays sealed on lower face for all 5 seconds.\n\n"
            "POSE: low squat knees apart, playful predatory teasing, then lean in close.\n\n"
            "ACTION timeline (5 seconds), cheeky toxic-zone flirt motion:\n"
            "[0.0-1.2s] Squats low knees apart, elbows on knees, respirator mask stays fully on, fox ears twitch, "
            "mischievous amber eyes above mask narrow playfully.\n"
            "[1.2-3.2s] Hooks magenta coat lapel pulling it open wider over bikini; other hand slides along inner thigh strap "
            "slow and deliberate; leans closer, teasing eye-smile above mask (no mouth visible).\n"
            "[3.2-5.0s] Winks with eyes only, flicks coat shut then open again playfully; returns squat with shoulder shrug, "
            "mask never moves.\n\n"
            "Mood: mouthy fox-girl teasing with danger and humor, all seduction through eyes/body/coat — mask always on. "
            "Game-safe sexy tease, no nudity."
        ),
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "identity": (
            "long straight jet-black hair with small cyan-green triangular clips, glowing crimson eyes, pale skin, "
            "black leather corset bodice and micro mini skirt, black leather jacket draped off shoulders, "
            "matte black left arm prosthetic and olive/charcoal mechanical right leg with cyan glow accents, "
            "long black whip in hand, black heels — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity from first frame: same black hair clips, crimson eyes, corset, skirt, jacket, cyber limbs, whip throughout.\n\n"
            "POSE: back-turn three-quarter glance, whip coiled at waist, one leg back-pointed — dangerous tame seduction.\n\n"
            "ACTION timeline (5 seconds):\n"
            "[0.0-1.2s] Back to camera, whip loops once around waist, shoulders tense, slow side glance over shoulder, crimson eyes cold-hot.\n"
            "[1.2-3.2s] Turns three-quarters; whip tip traces past lips without touching; free hand tugs corset neckline lower exposing collarbone; "
            "unblinking stare at viewer.\n"
            "[3.2-5.0s] Whip tip points at camera then drops; cyan cyber glow pulses once; returns guarded stillness.\n\n"
            "Mood: silent blade offering controlled danger. Game-safe sexy tease, no nudity."
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "identity": (
            "long straight silver-white hair with bangs, bright neon emerald-green eyes, black strappy bikini top and micro pleated skirt, "
            "white-silver fully mechanical arms and legs with black joints, compact neon-green translucent mechanical wing plates on back, "
            "black jacket worn open off shoulders — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity from first frame: same silver hair, green eyes, bikini skirt, cyber limbs, green wing plates throughout.\n\n"
            "POSE: straddle-sit on invisible ledge, wings spread, bold direct tease.\n\n"
            "ACTION timeline (5 seconds):\n"
            "[0.0-1.2s] Straddle sit, wing plates fan open, bright grin at camera.\n"
            "[1.2-3.2s] Stretch arms overhead arching back emphasizing curves; lean forward blowing kiss, finger follows kiss toward viewer.\n"
            "[3.2-5.0s] Hips sway twice, playful pat on own thigh invitingly, wink, wings half-close.\n\n"
            "Mood: loud cheerful direct flirt, zero shyness. Game-safe sexy tease, no nudity."
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "anime_lock": True,
        "face_ref_default": True,
        "likeness_strict": True,
        "max_attempts": 8,
        "identity": (
            "2D anime illustration only. height 158cm petite B82/W55/H80, long voluminous wavy pastel blue-lavender hair "
            "with bangs, soft pink large anime eyes, gentle youthful doll-like 2D anime face (round soft cheeks, small nose, "
            "soft natural pink lips — EXACT same face as default skin SSR03_1.png across all outfits), "
            "black gothic lace mini dress, gold cross pendant, black lace hair bows with gold star chains, "
            "platinum white mechanical legs with red heel glow — special outfit pifu05"
        ),
        "action": (
            "CHARACTER: 冰华·雫 (SSR03_1). Default-skin face is the master reference — all skins share this same 2D anime face.\n\n"
            "FACE LOCK (1:1 default skin portrait, never redesign):\n"
            "- 2D flat cel-shaded anime face, NOT 3D doll, NOT realistic skin shader\n"
            "- long wavy pastel blue-lavender hair with bangs; soft pink large gentle anime eyes\n"
            "- youthful innocent doll face: round cheeks, small delicate nose, soft pink lips (lip color fixed, no darkening)\n"
            "- pale smooth anime skin; expression soft and shy\n\n"
            "OUTFIT LOCK: black gothic lace mini dress, gold cross choker, lace hair bows, platinum mech legs, faint mecha shadow.\n\n"
            "POSE: seated EXACTLY as first frame — micro-motion only (breathing, blink, tiny hand shift). "
            "NO large pose change, NO lying down, NO leg lift.\n\n"
            "ACTION timeline (5 seconds):\n"
            "[0.0-2.0s] Hold seated pose from first frame, gentle breathing, soft blink; 2D anime face locked.\n"
            "[2.0-4.0s] One hand shifts slightly toward inner thigh strap (minimal movement); eyes lift shyly to viewer; face unchanged.\n"
            "[4.0-5.0s] Fingertips pause near lower lip (same soft pink lip color), small shy smile; hand returns; near-identical to opening frame.\n\n"
            "Mood: soft shy seduction. Game-safe tease, no nudity."
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "identity": (
            "dusty pink/mauve long hair with bangs, reddish-pink eyes, glossy black robotic ear headpieces, "
            "black high-slit qipao-style micro dress with lace long stockings, polished black/red cybernetic arms and legs, "
            "large segmented mechanical scorpion tail behind — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity from first frame: same pink hair, red eyes, high-slit dress, stockings, cyber limbs, scorpion tail throughout.\n\n"
            "POSE: prone kneel looking back, arched lower back, tail raised — smile-with-blade seduction.\n\n"
            "ACTION timeline (5 seconds):\n"
            "[0.0-1.2s] Prone kneel glancing back, gentle smile, scorpion tail sways slow.\n"
            "[1.2-3.2s] Turns more toward camera; fingers hook high slit lifting to thigh root; other hand beckons viewer; "
            "smile unchanged, dangerous warmth in eyes.\n"
            "[3.2-5.0s] Tail tip arcs behind hip line; tongue tip touches upper teeth; soft laugh expression.\n\n"
            "Mood: tender hunter inviting you closer. Game-safe sexy tease, no nudity."
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "identity": (
            "orange twin-tail hair, amber eyes, teal forehead accessory, black strappy bikini harness with gold rings, "
            "white glossy cyber shoulder armor and thigh-high boots, red hazard stripe on right leg, black choker — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity from first frame: EXACT default portrait face — orange twin-tails, amber eyes, teal forehead accessory; "
            "same strappy bikini, white cyber armor, hazard stripe leg throughout. "
            "CRITICAL: mouth stays clean and dry — NO drool, NO saliva, NO wet lips, NO dripping from mouth at any time.\n\n"
            "POSE: kneeling lean forward, hands gripping own hip straps, tsundere body-honest tease.\n\n"
            "ACTION timeline (5 seconds):\n"
            "[0.0-1.2s] Kneels gripping side straps, looks away, temple blush implied, mutters ridiculous under breath.\n"
            "[1.2-3.2s] Reluctant lean forward chest closer to camera; presses lips together briefly then shy peek back; hazard-stripe leg steps forward.\n"
            "[3.2-5.0s] Small controlled exhale through nose, straps snap back lightly, pretends cool but knees stay — don't stare too long; lips dry and closed.\n\n"
            "Mood: mouth says no body says yes. Game-safe sexy tease, no nudity."
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "anime_lock": True,
        "face_ref_default": True,
        "face_ref_portrait": True,
        "pick_best_face": True,
        "likeness_strict": True,
        "max_attempts": 8,
        "identity": (
            "2D anime illustration only. height 170cm B86/W56/H84, long straight black hair with vivid pink underside "
            "and bang highlights, soft reddish-brown rose-pink anime eyes, delicate oval 2D anime face (small nose, "
            "soft pale pink lips — EXACT same face as default skin UR03_1.png across all outfits), thin glowing gold "
            "double-ring halo, large metallic tech headphones with red accents, thick mechanical collar, "
            "black-gold strappy bikini harness, black bomber jacket draped off shoulders, transparent glass-shell left "
            "leg prosthetic with golden gears, cyan katana — special outfit pifu05"
        ),
        "action": (
            "CHARACTER: 光轮·天音 (UR03_1). Default-skin face is the master reference — all skins share this same 2D anime face.\n\n"
            "FACE LOCK (1:1 default skin portrait, never redesign):\n"
            "- 2D flat cel-shaded anime face, NOT 3D doll, NOT realistic skin shader, NOT CGI render\n"
            "- long straight black hair with vivid pink inner-layer highlights at bangs and sides\n"
            "- soft reddish-brown rose-pink anime eyes (not harsh crimson); large metallic tech headphones; thin gold halo\n"
            "- delicate oval face: small nose, soft pale pink lips, calm cold ethereal expression\n"
            "- pale smooth anime skin; face proportions identical to UR03_1.png default portrait\n\n"
            "OUTFIT LOCK: black-gold strappy bikini harness, bomber jacket slipping off shoulders, mechanical collar, "
            "transparent glass left leg with golden gears, cyan katana low — same as first frame.\n\n"
            "POSE: kneel EXACTLY as first frame — one knee down, katana tip near ground. Micro-motion only "
            "(breathing, blink, tiny hand shift). NO large pose change, NO standing up, NO camera push-in.\n\n"
            "ACTION timeline (5 seconds):\n"
            "[0.0-2.0s] Hold kneel pose from first frame, gentle breathing, soft blink; 2D anime face locked; halo steady.\n"
            "[2.0-4.0s] Jacket shifts slightly on shoulders (minimal); free hand lifts barely toward viewer beckon; "
            "eyes stay cold rose gaze; face unchanged.\n"
            "[4.0-5.0s] Hand pauses, small parted-lip breath; transparent leg glints; returns near-identical to opening frame.\n\n"
            "Mood: cold ethereal judgment, intimate closeness. Game-safe sexy tease, no nudity."
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "identity": (
            "short messy light-lavender hair with black X hair clips, amber eyes, white-pink bunny ear headband, "
            "black-pink strappy micro shorts outfit with open bomber jacket (pink lining), asymmetric fishnet thigh-high on one leg "
            "and black PVC knee guard with pink straps on other, barefoot — special outfit pifu05"
        ),
        "action": (
            "LOCKED identity from first frame: same lavender hair, bunny ears, strappy shorts, jacket, asymmetric legwear throughout. "
            "CRITICAL: mouth stays closed or soft smile only — NEVER stick tongue out.\n\n"
            "POSE: kneel-crawl look-back hip sway, then flip to seated — playful hunt tease.\n\n"
            "ACTION timeline (5 seconds):\n"
            "[0.0-1.2s] Kneel-crawl glance back over shoulder, playful closed-lip smirk (mouth closed, no tongue), bunny ears bounce.\n"
            "[1.2-3.2s] Slow hip sway; fingers hook leg-ring strap and snap lightly; other hand pats shorts hip: ticket is one joke — dare redeem?\n"
            "[3.2-5.0s] Rolls to seated, knees squeeze then part teasingly; heart-hands break into come-catch-me gesture.\n\n"
            "Mood: cute camouflage, sharp playful attack. Game-safe sexy tease, no nudity."
        ),
    },
}


def build_tease_prompt(meta: dict[str, str]) -> str:
    if meta.get("action") == "PENDING_BATCH":
        raise ValueError(f"action prompt not defined for {meta.get('name')}")
    style = ANIME_STYLE_BLOCK if meta.get("anime_lock") else ""
    return f"{CHROMA_BASE}\n\n{style}{meta['action']}"


def build_workflow_tease(input_name: str, out_prefix: str, prompt: str, seed: int, meta: dict | None = None) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    wf["9"]["inputs"]["steps"] = STEPS
    if meta and meta.get("anime_lock"):
        wf["200"]["inputs"]["shift_video"] = 5.0
        wf["9"]["inputs"]["steps"] = 22
    return wf


def tease_green_screen_ok(frame_path: Path) -> tuple[bool, str]:
    """Tease motion may spray green edges; corners can be looser than idle."""
    return m.green_screen_ok(frame_path, min_corner_green_ratio=0.42)


DEFAULT_PORTRAIT_DIR = ROOT / "tex" / "juese"


def default_portrait_gs(stem: str) -> Path:
    """Greenscreen first frame from default skin portrait for face QA."""
    dest = QA_DIR / f"{stem}_default_portrait_gs.png"
    src = DEFAULT_PORTRAIT_DIR / f"{stem}.png"
    if not src.exists():
        raise FileNotFoundError(src)
    if not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime:
        m.make_greenscreen(src, dest)
    return dest


def face_region_likeness_ok(ref_gs: Path, frame_path: Path, max_dist: float = 36.0) -> tuple[bool, str]:
    """Compare upper subject region (face/head) vs default portrait greenscreen."""
    import numpy as np
    from PIL import Image

    a = np.asarray(Image.open(ref_gs).convert("RGB")).astype(float)
    b = np.asarray(Image.open(frame_path).convert("RGB")).astype(float)
    if a.shape != b.shape:
        b = np.asarray(
            Image.open(frame_path).convert("RGB").resize((a.shape[1], a.shape[0]), Image.Resampling.BILINEAR)
        ).astype(float)
    green = np.array(m.GREEN_RGB, dtype=float)
    h = a.shape[0]

    def subject_mask(rgb: np.ndarray) -> np.ndarray:
        return np.linalg.norm(rgb - green, axis=2) > 70.0

    def face_mask(rgb: np.ndarray) -> np.ndarray:
        mask = subject_mask(rgb)
        ys, _ = np.where(mask)
        if len(ys) == 0:
            return mask
        y_min, y_max = int(ys.min()), int(ys.max())
        y_cut = y_min + int((y_max - y_min) * 0.38)
        row_idx = np.arange(h)[:, None]
        return mask & (row_idx <= y_cut)

    ma, mb = face_mask(a), face_mask(b)
    if ma.sum() < 40 or mb.sum() < 40:
        return False, "too_few_face_pixels"
    ca = a[ma].mean(axis=0)
    cb = b[mb].mean(axis=0)
    d = float(np.linalg.norm(ca - cb))
    ok = d < max_dist
    return ok, f"face_mean_dist={d:.1f}"


def tease_likeness_ok(src_gs: Path, frame_path: Path, max_dist: float = 62.0) -> tuple[bool, str]:
    """Tease lean-in changes subject occupancy; allow larger shift."""
    import numpy as np
    from PIL import Image

    a = np.asarray(Image.open(src_gs).convert("RGB")).astype(float)
    b = np.asarray(Image.open(frame_path).convert("RGB")).astype(float)
    if a.shape != b.shape:
        b = np.asarray(
            Image.open(frame_path).convert("RGB").resize((a.shape[1], a.shape[0]), Image.Resampling.BILINEAR)
        ).astype(float)
    green = np.array(m.GREEN_RGB, dtype=float)

    def subject_mask(rgb):
        return np.linalg.norm(rgb - green, axis=2) > 70.0

    ma, mb = subject_mask(a), subject_mask(b)
    area_a, area_b = float(ma.mean()), float(mb.mean())
    if area_b < 0.12:
        return False, f"subject_too_small area_b={area_b:.3f}"
    if abs(area_b - area_a) > 0.48:
        return False, f"occupancy_shift a={area_a:.3f} b={area_b:.3f}"
    if ma.sum() < 100 or mb.sum() < 100:
        return False, "too_few_subject_pixels"
    ca = a[ma].mean(axis=0)
    cb = b[mb].mean(axis=0)
    d = float(np.linalg.norm(ca - cb))
    ok = d < max_dist
    return ok, f"subj_mean_dist={d:.1f} area_a={area_a:.3f} area_b={area_b:.3f} max={max_dist:.0f}"


def face_mean_dist(ref_gs: Path, frame_path: Path) -> float:
    _, det = face_region_likeness_ok(ref_gs, frame_path, max_dist=999.0)
    if "face_mean_dist=" not in det:
        return 999.0
    return float(det.split("face_mean_dist=")[1])


def key_to_webm(gs_mp4: Path, final_webm: Path, qa_tag: str, force: bool) -> tuple[bool, str]:
    from rembg import new_session

    session = new_session("u2net")
    qa = QA_DIR / "_key_qa"
    out_tmp = QA_DIR / "_webm_out" / final_webm.name
    r = process_video(
        gs_mp4,
        out_tmp,
        session=session,
        qa_dir=qa,
        qa_tag=qa_tag,
        ship_path=final_webm,
        key_rgb=(0, 177, 64),
        key_color="green",
        force=force,
        min_bbox_h=0.55,
    )
    if r.get("ok"):
        return True, r.get("detail", "ok")
    # Hybrid rembg+chroma before destructive colorkey (tease motion fringe)
    try:
        from scripts.rekey_hybrid_pifu05 import process as hybrid_process

        hybrid_tmp = QA_DIR / "_webm_out" / f"{final_webm.stem}_hybrid.webm"
        hybrid_qa = QA_DIR / "_rekey_hybrid"
        if hybrid_process(gs_mp4, hybrid_tmp, hybrid_qa, qa_tag, session):
            shutil.copy2(hybrid_tmp, final_webm)
            return True, f"fallback_hybrid after safe fail: {r.get('error', '')}"
    except Exception as e:
        hybrid_err = str(e)
    else:
        hybrid_err = "hybrid failed"
    # Last resort: fast colorkey (may punch holes in character interior)
    try:
        gs_mp4_to_webm(gs_mp4, final_webm, fps=24.0)
        if final_webm.exists() and final_webm.stat().st_size > 80_000:
            return True, f"fallback_colorkey after hybrid: {r.get('error', '')}; {hybrid_err}"
    except Exception as e:
        return False, f"{r.get('error', 'key failed')}; hybrid: {hybrid_err}; colorkey: {e}"
    return False, r.get("error", "key failed")


def process_one(stem: str, force: bool = False) -> dict:
    meta = CHARACTERS[stem]
    name = meta["name"]
    src = SRC_DIR / f"{stem}_pifu05.png"
    final_webm = SRC_DIR / f"{stem}_pifu05.webm"
    gs_mp4 = SRC_DIR / f"{stem}_pifu05_tease_gs_h3.mp4"
    gs_path = SRC_DIR / f"{stem}_pifu05_greenscreen_first.png"
    result = {"stem": stem, "name": name, "ok": False, "path": str(final_webm), "attempts": []}

    if meta.get("action") == "PENDING_BATCH":
        result["error"] = "action prompt pending"
        return result

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

    prompt = build_tease_prompt(meta)
    out_leaf = f"{stem}_pifu05_tease_gs"
    out_prefix = f"video/{out_leaf}"
    qa_stem = QA_DIR / stem
    qa_stem.mkdir(parents=True, exist_ok=True)
    max_attempts = int(meta.get("max_attempts", MAX_ATTEMPTS))

    for attempt in range(1, max_attempts + 1):
        seed = 2026082410 + (hash(stem) % 100000) + attempt * 97
        print(f"[{stem}] {name} attempt {attempt}/{max_attempts} seed={seed}", flush=True)
        t_start = time.time()
        try:
            wf = build_workflow_tease(input_name, out_prefix, prompt, seed, meta)
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            m.wait_prompt(prompt_id, timeout_s=H3_WAIT_TIMEOUT_S)
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
                ok_g, det_g = tease_green_screen_ok(fp)
                checks.append((f"green[{label}]", bool(ok_g), str(det_g)))
            likeness_max = 22.0 if meta.get("likeness_strict") else 62.0
            if meta.get("likeness_strict"):
                for fp, label in ((f0, "t0.35"), (f1, "t2.5"), (f2, "t4.6")):
                    ok_l, det_l = tease_likeness_ok(gs_path, fp, max_dist=likeness_max)
                    checks.append((f"likeness[{label}]", bool(ok_l), str(det_l)))
            else:
                ok_l, det_l = tease_likeness_ok(gs_path, f0, max_dist=likeness_max)
                checks.append(("likeness", bool(ok_l), str(det_l)))
            if meta.get("face_ref_default"):
                face_max = 20.0 if meta.get("likeness_strict") else 36.0
                for fp, label in ((f0, "t0.35"), (f1, "t2.5"), (f2, "t4.6")):
                    ok_f, det_f = face_region_likeness_ok(gs_path, fp, max_dist=face_max)
                    checks.append((f"face_plate[{label}]", bool(ok_f), str(det_f)))
            if meta.get("face_ref_portrait"):
                portrait_gs = default_portrait_gs(stem)
                portrait_max = float(meta.get("face_portrait_max_dist", 22.0))
                for fp, label in ((f0, "t0.35"), (f1, "t2.5"), (f2, "t4.6")):
                    ok_p, det_p = face_region_likeness_ok(portrait_gs, fp, max_dist=portrait_max)
                    checks.append((f"face_portrait[{label}]", bool(ok_p), str(det_p)))
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if not all(ok for _, ok, _ in checks):
                result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "checks": checks})
                continue

            shutil.copy2(out, gs_mp4)
            ok_key, det_key = key_to_webm(gs_mp4, final_webm, f"{stem}_pifu05", force=True)
            print(f"  KEY {'PASS' if ok_key else 'FAIL'} {det_key}", flush=True)
            if not ok_key:
                result["attempts"].append(
                    {"attempt": attempt, "seed": seed, "ok": False, "error": f"key: {det_key}"}
                )
                continue

            result["ok"] = True
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": True, "mp4": str(gs_mp4)})
            print(f"  ACCEPTED -> {final_webm} ({final_webm.stat().st_size // 1024} KB)", flush=True)
            return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": str(e)})
            time.sleep(5)

    print(f"[FAIL] {stem} {name} after {max_attempts} attempts", flush=True)
    if meta.get("pick_best_face"):
        portrait_gs = default_portrait_gs(stem)
        best_attempt, best_score = None, 999.0
        for attempt in range(1, max_attempts + 1):
            mp4_try = qa_stem / f"a{attempt}.mp4"
            if not mp4_try.exists():
                continue
            dists = []
            for t in (0.35, 2.5, 4.6):
                fp = m.extract_frame(mp4_try, t, qa_stem / f"_pick_a{attempt}_t{t}.png")
                dists.append(face_mean_dist(portrait_gs, fp))
            avg = sum(dists) / len(dists)
            print(f"  pick_face a{attempt} avg_dist={avg:.1f} dists={dists}", flush=True)
            if avg < best_score:
                best_score, best_attempt = avg, attempt
        portrait_pick_max = float(meta.get("face_portrait_pick_max_avg", 22.0))
        if best_attempt is not None and best_score <= portrait_pick_max:
            pick_mp4 = qa_stem / f"a{best_attempt}.mp4"
            print(f"  PICK best face attempt {best_attempt} avg={best_score:.1f}", flush=True)
            shutil.copy2(pick_mp4, gs_mp4)
            ok_key, det_key = key_to_webm(gs_mp4, final_webm, f"{stem}_pifu05", force=True)
            print(f"  KEY {'PASS' if ok_key else 'FAIL'} {det_key}", flush=True)
            if ok_key:
                result["ok"] = True
                result["picked_attempt"] = best_attempt
                result["picked_face_avg"] = best_score
                print(f"  ACCEPTED (pick_best_face) -> {final_webm}", flush=True)
                return result
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all", help="artStem, comma list, or all")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    print("=== pifu05 special outfit tease H3 batch ===", flush=True)
    print(f"SRC: {SRC_DIR}", flush=True)
    print(f"spec: {WIDTH}x{HEIGHT} length={LENGTH} (~5.0s) steps={STEPS}", flush=True)
    m.api("/system_stats")

    if args.stem == "all":
        stems = list(CHARACTERS.keys())
    elif args.stem == "ssr,ur":
        stems = [s for s in CHARACTERS if s.startswith("SSR") or s.startswith("UR")]
    else:
        stems = [s.strip() for s in args.stem.split(",") if s.strip()]
    for stem in stems:
        if stem not in CHARACTERS:
            print(f"unknown stem: {stem}", file=sys.stderr)
            return 2

    results = [process_one(stem, force=args.force) for stem in stems]
    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
    }
    report = QA_DIR / "pifu05_tease_batch_report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("=== SUMMARY ===", flush=True)
    print("OK:", ", ".join(summary["ok"]) or "(none)", flush=True)
    print("FAIL:", ", ".join(summary["fail"]) or "(none)", flush=True)
    print("report:", report, flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
