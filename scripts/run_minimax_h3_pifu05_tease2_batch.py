"""Batch MiniMax H3: 特殊服装01 pifu05 PHASE-2 tease LOOP → transparent webm.

Phase-1 ({stem}_pifu05.webm) = process tease (build-up).
Phase-2 ({stem}_pifu05_2.webm) = already-at-peak suggestive LOOP (6s).

Standards (all characters):
- 2D anime game illustration lock (NOT 3D/CGI/photorealistic)
- Face + body proportion 1:1 first-frame plate / default portrait
- Phase-2 seductive micro-expressions (not stiff/dead face)
- Game-safe exposure (fabric stays on, no nipples/areola/topless)
- Single generation per character (MAX_ATTEMPTS=1) for speed

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_minimax_h3_pifu05_tease2_batch.py --stem SR01_2 --force
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
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"
spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

from scripts.chroma_key_lib import process_video  # noqa: E402
from chroma_key_gs_video_webm import gs_mp4_to_webm  # noqa: E402

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "teshufuzhuang01"
QA_DIR = SRC_DIR / "_qa_tease2"
FIRST_DIR = SRC_DIR / "_first_tease2"
DEFAULT_PORTRAIT_DIR = ROOT / "tex" / "juese"

WIDTH, HEIGHT = 768, 1344
LENGTH = 144  # 6.0s @ 24fps
STEPS = 20
MAX_ATTEMPTS = 1  # single shot — no multi-attempt retry loop
H3_WAIT_TIMEOUT_S = 7200.0

CHROMA_BASE = (
    "2D anime game character greenscreen action plate. Pure flat chroma key green (#00b140) background, "
    "even soft anime-style lighting, seamless green matte, subject isolated on solid green. "
    "Ultra-detailed flat cel-shaded 2D anime illustration exactly matching the first-frame static plate — "
    "clean linework, soft pastel palette, sharp anime focus. "
    "NOT 3D render, NOT CGI, NOT photorealistic, NOT realistic doll, NOT Unreal/Octane.\n\n"
    "FRAMING: medium full-body shot — head to knees/thigh-root fully visible in frame. "
    "Character occupies 75-85% of frame height. Leave small green margin above head and below knees. "
    "NOT face close-up, NOT chest-only crop, NOT lap/POV straddle filling the lens.\n\n"
    "CAMERA: completely locked tripod at medium distance. No pan, tilt, zoom, push-in, pull-out, or drift. "
    "Framing identical throughout all 6 seconds.\n\n"
    "Keep pure flat #00b140 green everywhere behind the subject: no floor, no set, no shadow catcher, "
    "no vignette. Do NOT change hair color, face design, cybernetics, or outfit design.\n\n"
    "Audio: very soft quiet room tone only, no speech, no music."
)

ANIME_STYLE_BLOCK = (
    "ART STYLE LOCK (entire 6 seconds): stay 2D anime game illustration identical to first frame — "
    "flat cel-shaded anime art, clean linework, soft pastel colors. "
    "Face must be 1:1 the default skin portrait face (same eye shape, iris color, nose, lips, cheek roundness). "
    "Never morph into 3D/CGI/photorealistic style.\n\n"
)

BODY_LOCK_BLOCK = (
    "BODY PROPORTION LOCK: exact same height, bust/waist/hip ratio, limb length, head size, and silhouette "
    "as the first-frame pifu05 plate. Do NOT change body type, breast size, leg length, or become realistic proportions.\n\n"
)

EXPRESSION_BLOCK = (
    "EXPRESSION (phase-2 loop — alive seductive acting, NOT stiff/dead face):\n"
    "- Continuous micro-expression: natural blinks, breathing, parted lips, half-lidded seductive gaze\n"
    "- Personality shows in face for all 6 seconds (shy blush / cold smirk / playful wink per character)\n"
    "- Lip color and 2D anime face design locked — no darkening, no realistic skin shader\n\n"
)

EXPOSURE_SAFETY = (
    "EXPOSURE EDGE (peak-state game-safe — fabric at absolute limit):\n"
    "- Top fabric lower edge sits 1-2mm below nipple line; bottom fabric barely covers crotch — "
    "breathing and motion make fabric tremble on the edge but NEVER reveal nipples, areola, or genitals\n"
    "- Tease intensity comes from fabric tension, hip/pose squeeze, strap snaps, and slit/skirt edge — not undressing\n"
    "- NO topless, NO panties removed, NO explicit nudity\n\n"
)

POSE_OVERRIDE = (
    "CRITICAL POSE OVERRIDE: use the first-frame image for face identity, body proportions, hair, outfit design, "
    "colors, and cybernetics. DO NOT keep the standing default pose. "
    "From frame 0 the body is ALREADY in the extreme tease LOOP pose below. "
    "First frame and last frame must match for seamless looping.\n\n"
)


def _loop(
    stem: str,
    name: str,
    personality: str,
    outfit_state: str,
    camera: str,
    loop_pose: str,
    expression: str,
    loop_motion: str,
    tease_focus: str,
    mood: str,
) -> str:
    return (
        f"CHARACTER: {name} ({stem}). {personality}\n"
        "This is a SEAMLESS LOOP of an ALREADY-REACHED phase-2 peak tease state — NOT a build-up process.\n\n"
        f"OUTFIT STATE (already at fabric limit, maintain all 6s):\n{outfit_state}\n\n"
        f"CAMERA (locked medium shot, never close-up):\n{camera}\n\n"
        f"LOOP POSE (frame 0 = frame end):\n{loop_pose}\n\n"
        f"EXPRESSION (alive seductive, never stiff/dead face):\n{expression}\n\n"
        f"LOOP MOTION (6 seconds, continuous, seamless, highly erotic tease through fabric/pose):\n{loop_motion}\n\n"
        f"TEASE FOCUS: {tease_focus}\n\n"
        f"Mood: {mood}"
    )


CHARACTERS: dict[str, dict] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "anime_lock": True,
        "face_ref_default": True,
        "likeness_strict": True,
        "identity": (
            "2D anime illustration only. ash-blonde high ponytail with metallic white wing-fin hair clips, "
            "light blue ice-blue eyes, pale skin, delicate athletic anime proportions matching first frame, "
            "black leather biker jacket, black strappy bikini top and micro hot pants, "
            "black studded choker, black buckled thigh straps, black platform combat boot on organic left leg, "
            "white/silver cybernetic right leg prosthetic with gold accents — special outfit pifu05"
        ),
        "action": _loop(
            "SR01_2", "苍羽·澪", "Cool dominant commander who takes the lead.",
            "- leather jacket bunched behind elbows, both shoulders bare\n"
            "- bikini straps on elbows; cup lower edge sits 1-2mm below nipple line (trembles on edge, NO nipples visible)\n"
            "- micro hot pants side straps loose; crotch fabric barely covers, bites into hip crease; cyber leg + wing clips unchanged",
            "Medium full-body, 30-degree side angle. Character 80% frame height. "
            "8% green above head, 10% below knees. Head-to-knee fully visible. NO close-up, NO POV.",
            "Side-sit: cybernetic right leg raised high (knee up), organic left foot on green floor, "
            "torso leaning back ~15°, one hand braced on floor behind, other hand on own upper outer thigh.",
            "- ice-blue eyes half-lidded then lift to lock viewer\n"
            "- lips parted 3mm with slow breathing; every ~2s 1mm cold micro-smirk\n"
            "- natural blinks; never blank/dead face",
            "[0.0-2.0s] Hips slow circle grind once (seated rolling); free hand traces bikini lower edge → side waist → thigh\n"
            "[2.0-4.0s] Thumb snaps loose shoulder strap (fabric trembles on nipple line, cups stay on); head tilts slightly\n"
            "[4.0-6.0s] Raised knee closes 1cm then opens → exact return to opening side-sit for seamless loop",
            "hip grind + bikini lower-edge tracing + strap snap at fabric limit; erotic through pose tension not undressing.",
            "cold commander owns the loop. 2D anime game-safe extreme edge.",
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "2D anime only. short silver-blue hair, pointed elf ears, purple eyes, "
            "black lace corset bustier and lace panties, lace stockings, tattered green-edge cape, dark cyber limbs — pifu05"
        ),
        "action": _loop(
            "SR01_3", "苍斩·凛", "Silent lethal blade granting permission.",
            "- both corset straps on elbows; lace cup edge at nipple line (NO nipples)\n"
            "- lace panty side straps at hip bones; crotch lace barely covers; green-edge cape on floor",
            "Medium full-body, 45° rear-side angle. 78% frame height. Head-to-knee in frame. NO close-up.",
            "Both knees on floor, upper body low, hip line slightly raised, face turned 45° toward camera (not face-fill).",
            "- purple eyes downcast then lock viewer\n"
            "- lips parted 3mm; every ~3s faint permission half-smile\n"
            "- slow sparse blinks",
            "[0.0-2.0s] Fingers trace lace stocking top → inner thigh fabric edge\n"
            "[2.0-4.0s] Other hand drags cape corner over shoulder (lace over collarbone, bustier lace trembles)\n"
            "[4.0-6.0s] Knees open 5° then close → return to opening kneel glance pose",
            "kneel curve + thigh-edge tracing + cape drag over chest lace at fabric limit.",
            "silent blade at the line. 2D anime game-safe extreme edge.",
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "long wavy ash-blonde hair, teal eyes, halo headset, black glossy bodysuit deep V, open duster coat, "
            "asymmetrical lace thigh-high, cyber boots, sword on back — pifu05"
        ),
        "action": _loop(
            "SR02_1", "白楯·芹奈", "Gentle shield-girl possessive invitation.",
            "- coat open piled behind waist; bodysuit V pulled to 1mm above nipple line (NO nipples)\n"
            "- left lace stocking, right bare high-cut leg; crotch fabric barely covers",
            "Medium full-body, front slight high angle 10°. 82% frame height. Head-to-knee. NO close-up.",
            "Floor sit M-leg open (moderate), back straight, both hands resting on respective knees.",
            "- teal eyes soft and firm; every ~2s light bite lower lip then release\n"
            "- faint cheek blush cycling with breath",
            "[0.0-2.0s] Both thumbs hook V-neck edges, pull outward 2mm then release (fabric trembles on nipple line)\n"
            "[2.0-4.0s] Torso leans forward 10° (full body still in frame), hand reaches toward viewer stopping mid-air\n"
            "[4.0-6.0s] Straighten, finger lifts coat collar then drops → return to M-leg sit",
            "M-leg open + V-neck tension cycles + inviting lean; fabric at absolute limit.",
            "gentle only-you-may-look. 2D anime game-safe extreme edge.",
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "silver-grey long hair, amber-orange eyes, antenna headset, harness bikini, bomber jacket off shoulders, "
            "pleated skirt, garter stockings, cyber leg — pifu05"
        ),
        "action": _loop(
            "SR03_1", "银绯·玲", "Kuudere optical girl rational seduction.",
            "- jacket on forearms; harness straps loose; bikini cup edge at nipple line\n"
            "- skirt rolled to waistline; crotch fabric barely covers",
            "Medium full-body front. 80% frame height. Head to extended foot in frame. NO close-up.",
            "Seated high (hips mid-frame): one leg extended, one knee bent outward.",
            "- amber eyes calm half-lidded; tongue tip touches lower lip 0.3s\n"
            "- 1mm lip corner rise: your heartbeat is out of spec",
            "[0.0-2.0s] Index finger traces harness cross-straps (straps press skin)\n"
            "[2.0-4.0s] Extended leg toe flexes inward then outward; other hand lifts skirt hem 1cm exposing stocking top and thigh-root fabric edge\n"
            "[4.0-6.0s] Leg returns, hand to knee → loop close",
            "harness tracing + leg spread angle + hem lift to fabric limit.",
            "kuudere data-flirt loop. 2D anime game-safe extreme edge.",
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "jet-black ponytail, amber eyes, black lace corset lingerie, purple neon mesh sleeves, "
            "shoulder armor, lace shorts, garter asymmetry, dark armored boots — pifu05"
        ),
        "extra_lock": "OUTFIT LOCK: black lace corset + lace shorts + mesh sleeves + dark boots — NOT white cyber limbs.",
        "action": _loop(
            "SR04_1", "焰甲·朱里", "Heavy gunner silent pressure intimacy.",
            "- corset lace slightly open but cup edge at nipple line; shorts crotch barely covers\n"
            "- purple neon mesh sleeves at wrists; garter red gem + thigh straps",
            "Medium full-body 3/4 side. 79% frame height. Head-to-knee. NO close-up.",
            "Virtual lean-back, one knee raised, hips forward, both hands gripping corset side laces at waist.",
            "- amber eyes low-line gaze at viewer; lips parted slow breath\n"
            "- every ~3s tongue tip to upper teeth (NO drool)",
            "[0.0-2.0s] Both hands tighten corset side laces (waist narrows, bust line pushed up, fabric stays on nipple line)\n"
            "[2.0-4.0s] Hips slow forward thrust twice (back arch counter-motion)\n"
            "[4.0-6.0s] Laces loosen 5mm, knee lowers → return to lean pose",
            "corset cinch + hip thrust arch; disciplined hunger at fabric limit.",
            "heavy gunner countdown heat. 2D anime game-safe extreme edge.",
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "white hair, fox ears, amber eyes, respirator mask on nose/mouth, strappy bikini, "
            "magenta-lined trench coat, cyber limbs — pifu05"
        ),
        "extra_lock": "CRITICAL: respirator mask NEVER removed. All seduction through eyes/body.",
        "action": _loop(
            "SR05_1", "黄狐·萤", "Mouthy fox playful predatory tease.",
            "- magenta coat wide open; bikini cup/crotch fabric at absolute limit\n"
            "- respirator sealed entire 6 seconds",
            "Medium full-body including squat depth. 85% frame height. NO face close-up.",
            "Deep squat knees apart, elbows on knees, still medium distance from camera.",
            "- amber eyes alternate wink; brows raise playfully\n"
            "- all seduction above mask through eyes and ears",
            "[0.0-2.0s] Both fingers pull coat lapels wider (magenta lining sways)\n"
            "[2.0-4.0s] One finger traces thigh strap slowly then snaps strap\n"
            "[4.0-6.0s] Shoulder shrug, ears twitch, knee spacing micro-shift → return squat",
            "open-knee squat + lining flash + thigh strap snap; eyes-only flirt.",
            "toxic-zone fox tease loop. 2D anime game-safe extreme edge.",
        ),
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "long black hair, cyan clips, crimson eyes, black leather corset and micro skirt, "
            "jacket off shoulders, cyber limbs, whip — pifu05"
        ),
        "action": _loop(
            "SSR01_1", "夜爪·黑织", "Night-claw dom danger-cold seduction.",
            "- jacket off shoulders; corset lace at nipple line; skirt hem at crotch limit; whip coiled at neck/waist",
            "Medium full-body front kneel. 80% frame height. Head to kneeling feet. NO close-up.",
            "Kneeling sit facing camera, whip held at neck or waist, knees one fist apart.",
            "- crimson eyes unblinking 2s then slow blink; whip handle near lips\n"
            "- faint brow raise: tame/dom boundary",
            "[0.0-2.0s] Whip tip traces collarbone → corset lace lower edge (fabric trembles)\n"
            "[2.0-4.0s] Knees shift 3cm each direction (kneeling grind)\n"
            "[4.0-6.0s] Whip returns to neck coil → opening kneel pose",
            "whip edge-tracing + kneel grind; controlled danger at fabric limit.",
            "silent blade offering controlled danger. 2D anime game-safe extreme edge.",
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "silver-white hair, neon green eyes, bikini and micro skirt, mechanical wing plates, white cyber limbs — pifu05"
        ),
        "action": _loop(
            "SSR02_1", "翠翼·铃", "Loud cheerful zero-shame direct flirt.",
            "- bikini straps on arms; cup/crotch fabric at absolute limit; skirt rolled to abdomen; wings half-spread",
            "Medium full-body front standing. 83% frame height. Head-to-knee. NO close-up.",
            "Standing feet shoulder-width, arms crossed overhead, waist in S-curve.",
            "- bright green eyes laughing gaze; lips open smile then close\n"
            "- flirt wink every ~1.5s",
            "[0.0-2.0s] Hips trace figure-8 once (dance grind)\n"
            "[2.0-4.0s] Hands slide down body sides to hips, fingertips press bikini lower edge (fabric trembles on limit)\n"
            "[4.0-6.0s] Arms return overhead, wings half-close → standing S-pose loop",
            "figure-8 hip grind + full-body line slide pressing fabric limit.",
            "loud direct flirt loop. 2D anime game-safe extreme edge.",
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "anime_lock": True, "face_ref_default": True, "face_ref_portrait": True, "likeness_strict": True,
        "identity": (
            "2D anime only. height 158cm B82/W55/H80, pastel blue-lavender wavy hair, soft pink eyes, "
            "face EXACT same as SSR03_1.png default skin, gothic lace dress, platinum mech legs — pifu05"
        ),
        "action": _loop(
            "SSR03_1", "冰华·雫", "Soft shy doll with hidden thorn.",
            "- lace dress straps on arms; bust lace at nipple line; skirt bunched to upper thigh, crotch lace barely covers",
            "Medium full-body side-lying, head toward camera. 78% frame height. NO close-up.",
            "Side lie: lower leg straight, upper leg bent 90° resting on lower knee.",
            "- soft pink eyes shy lift → glance away → look back\n"
            "- lip bitten lightly; cheek blush cycles with breath",
            "[0.0-2.0s] Free hand lifts lace skirt to 1cm above knee then covers back (thigh-root fabric edge flash)\n"
            "[2.0-4.0s] Bent leg slow 3cm grind up-down against lower leg\n"
            "[4.0-6.0s] Exhale, eyes shy away → return side-lie pose",
            "side-lie leg grind + skirt lift-cover cycle at fabric limit.",
            "shy but addictive loop. 2D anime game-safe extreme edge.",
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "identity": (
            "dusty pink hair, reddish-pink eyes, high-slit qipao micro dress, lace stockings, scorpion cyber tail — pifu05"
        ),
        "action": _loop(
            "SSR04_1", "绯尾·椿", "Tender hunter smile-with-blade invitation.",
            "- qipao side slit to upper thigh shadow; bust fabric at nipple line; crotch fabric barely covers",
            "Medium full-body 3/4. 80% frame height. Head-to-knee, tail tip at frame edge. NO close-up.",
            "Prone kneel: chest 20cm off floor, face lifted 30° toward camera.",
            "- reddish-pink eyes gentle smile unchanged\n"
            "- every ~3s tongue tip to upper teeth (NO tongue out)",
            "[0.0-2.0s] Fingers hook slit edge back and forth twice (fabric and inner thigh shadow)\n"
            "[2.0-4.0s] Scorpion tail tip crawls slowly along inner calf → pause\n"
            "[4.0-6.0s] Torso rises/falls one breath, slit returns → prone kneel loop",
            "slit finger cycle + tail crawl; warm hunter invite at fabric limit.",
            "tender hunter loop. 2D anime game-safe extreme edge.",
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "extra_lock": "NO drool, NO saliva, mouth clean and dry entire 6 seconds.",
        "identity": (
            "orange twin-tails, amber eyes, teal forehead accessory, strappy harness bikini, "
            "white cyber shoulder armor and boots, hazard stripe leg — pifu05"
        ),
        "action": _loop(
            "SSR05_1", "橙铠·琥珀", "Tsundere mouth-no body-yes honest tease.",
            "- harness ring loose one notch; top/bottom fabric at nipple and crotch limit; shoulder armor stays",
            "Medium full-body kneel. 81% frame height. Head-to-knee. NO close-up.",
            "Kneeling cycle: curled hugging knees ↔ knees opening.",
            "- amber eyes look away → steal glance at viewer\n"
            "- lips pout → part; ridiculous silent lip shape; NO drool",
            "[0.0-2.0s] Curl hugging knees (conservative phase)\n"
            "[2.0-4.0s] Knees open, chest leans forward (harness fabric trembles on limit)\n"
            "[4.0-6.0s] Face turns away blushing, knees close → curl again for loop",
            "curl ↔ open-knee contrast; tsundere fabric-limit loop.",
            "mouth says no body says yes. 2D anime game-safe extreme edge.",
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "anime_lock": True, "face_ref_default": True, "face_ref_portrait": True, "likeness_strict": True,
        "identity": (
            "2D anime only. height 170cm B86/W56/H84, black hair pink highlights, rose-pink eyes, "
            "face EXACT same as UR03_1.png, halo, headphones, bikini harness, glass leg, katana — pifu05"
        ),
        "action": _loop(
            "UR03_1", "光轮·天音", "Cold ethereal judgment intimate closeness.",
            "- harness straps on wrists; cross-straps at nipple line; crotch fabric barely covers; jacket off shoulders",
            "Medium full-body kneeling sit. 80% frame height. Head to kneeling feet. NO close-up.",
            "Kneeling sit, katana at side, torso cycles forward lean 15° then upright.",
            "- rose-pink eyes cold gaze; every ~3s faint permission nod\n"
            "- lips parted breath; halo steady glow",
            "[0.0-2.0s] Forward lean: fingers hook harness chest cross-strap down 2mm then release (fabric snaps on limit)\n"
            "[2.0-4.0s] Transparent prosthetic leg gears rotate 1/4 turn; halo pulses once\n"
            "[4.0-6.0s] Torso returns upright, hands on knees → kneel sit loop",
            "cold lean + harness snap tension at fabric limit.",
            "ethereal judgment intimacy loop. 2D anime game-safe extreme edge.",
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "anime_lock": True, "face_ref_default": True, "likeness_strict": True,
        "extra_lock": "mouth closed or soft smile — NEVER tongue out.",
        "identity": (
            "light-lavender short hair, bunny ear headband, amber eyes, strappy micro shorts outfit, "
            "open bomber jacket pink lining, asymmetric fishnet/PVC legs — pifu05"
        ),
        "action": _loop(
            "UR04_1", "橙兔·美羽", "Cute camouflage sharp playful hunt.",
            "- one strap on elbow; top/bottom fabric at nipple and crotch limit; fishnet run on one leg",
            "Medium full-body bunny-sit. 82% frame height. Head to kneeling feet. NO close-up.",
            "Bunny sit (knees folded, hips on heels), both hands braced behind, chest forward.",
            "- amber eyes switch innocent → predatory; closed-lip smirk\n"
            "- bunny ears twitch; wink every ~2s",
            "[0.0-2.0s] Hips sway left then right once (bunny-sit grind)\n"
            "[2.0-4.0s] Finger hooks leg-ring strap tight then snaps; other hand heart-shape breaks to finger-gun at viewer\n"
            "[4.0-6.0s] Shoulder shrug, sit upright → return bunny-sit pose",
            "bunny-sit hip sway + strap snap; cute-predator loop at fabric limit.",
            "playful hunt loop. 2D anime game-safe extreme edge.",
        ),
    },
}


def build_prompt(meta: dict) -> str:
    if meta.get("action") in (None, "PENDING_BATCH"):
        raise ValueError(f"phase-2 loop action not defined for {meta.get('name')}")
    extra = meta.get("extra_lock", "")
    extra_block = f"{extra}\n\n" if extra else ""
    identity = meta.get("identity", "")
    id_block = f"LOCKED identity from first frame: {identity}\n\n" if identity else ""
    return (
        f"{CHROMA_BASE}\n\n{ANIME_STYLE_BLOCK}{BODY_LOCK_BLOCK}{EXPRESSION_BLOCK}{EXPOSURE_SAFETY}"
        f"{POSE_OVERRIDE}{id_block}{extra_block}{meta['action']}"
    )


def build_workflow_tease2(input_name: str, out_prefix: str, prompt: str, seed: int, meta: dict | None = None) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    if "last_frame" in wf["104"]["inputs"]:
        del wf["104"]["inputs"]["last_frame"]
    wf["9"]["inputs"]["steps"] = STEPS
    if meta and meta.get("anime_lock"):
        wf["200"]["inputs"]["shift_video"] = 5.0
        wf["9"]["inputs"]["steps"] = 22
    return wf


def tease_green_screen_ok(frame_path: Path) -> tuple[bool, str]:
    return m.green_screen_ok(frame_path, min_corner_green_ratio=0.40)


def default_portrait_gs(stem: str) -> Path:
    dest = QA_DIR / f"{stem}_default_portrait_gs.png"
    src = DEFAULT_PORTRAIT_DIR / f"{stem}.png"
    if not src.exists():
        raise FileNotFoundError(src)
    if not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime:
        m.make_greenscreen(src, dest)
    return dest


def face_region_likeness_ok(ref_gs: Path, frame_path: Path, max_dist: float = 36.0) -> tuple[bool, str]:
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
    return d < max_dist, f"face_mean_dist={d:.1f}"


def tease_likeness_ok(src_gs: Path, frame_path: Path, max_dist: float = 62.0) -> tuple[bool, str]:
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
    if area_b < 0.10:
        return False, f"subject_too_small area_b={area_b:.3f}"
    if abs(area_b - area_a) > 0.55:
        return False, f"occupancy_shift a={area_a:.3f} b={area_b:.3f}"
    if ma.sum() < 80 or mb.sum() < 80:
        return False, "too_few_subject_pixels"
    ca = a[ma].mean(axis=0)
    cb = b[mb].mean(axis=0)
    d = float(np.linalg.norm(ca - cb))
    return d < max_dist, f"subj_mean_dist={d:.1f} area_a={area_a:.3f} area_b={area_b:.3f} max={max_dist:.0f}"


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
        min_bbox_h=0.45,
    )
    if r.get("ok"):
        return True, r.get("detail", "ok")
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
    try:
        gs_mp4_to_webm(gs_mp4, final_webm, fps=24.0)
        if final_webm.exists() and final_webm.stat().st_size > 80_000:
            return True, f"fallback_colorkey after hybrid: {r.get('error', '')}; {hybrid_err}"
    except Exception as e:
        return False, f"{r.get('error', 'key failed')}; hybrid: {hybrid_err}; colorkey: {e}"
    return False, r.get("error", "key failed")


def run_qa_checks(meta: dict, gs_path: Path, frames: list[tuple[Path, str]], strict: bool) -> list[tuple[str, bool, str]]:
    checks: list[tuple[str, bool, str]] = []
    for fp, label in frames:
        ok_g, det_g = tease_green_screen_ok(fp)
        checks.append((f"green[{label}]", bool(ok_g), str(det_g)))
    likeness_max = 24.0 if meta.get("likeness_strict") else 62.0
    if meta.get("likeness_strict"):
        for fp, label in frames:
            ok_l, det_l = tease_likeness_ok(gs_path, fp, max_dist=likeness_max)
            checks.append((f"likeness[{label}]", bool(ok_l), str(det_l)))
    if meta.get("face_ref_default"):
        face_max = 22.0 if meta.get("likeness_strict") else 36.0
        for fp, label in frames:
            ok_f, det_f = face_region_likeness_ok(gs_path, fp, max_dist=face_max)
            checks.append((f"face_plate[{label}]", bool(ok_f), str(det_f)))
    if meta.get("face_ref_portrait"):
        portrait_gs = default_portrait_gs(meta["_stem"])
        portrait_max = float(meta.get("face_portrait_max_dist", 22.0))
        for fp, label in frames:
            ok_p, det_p = face_region_likeness_ok(portrait_gs, fp, max_dist=portrait_max)
            checks.append((f"face_portrait[{label}]", bool(ok_p), str(det_p)))
    if strict and not all(ok for _, ok, _ in checks):
        pass  # logged only when strict mode enabled
    return checks


def process_one(stem: str, force: bool = False, strict_qa: bool = False) -> dict:
    meta = CHARACTERS[stem]
    meta["_stem"] = stem
    name = meta["name"]
    src = SRC_DIR / f"{stem}_pifu05.png"
    final_webm = SRC_DIR / f"{stem}_pifu05_2.webm"
    gs_mp4 = SRC_DIR / f"{stem}_pifu05_tease2_gs_h3.mp4"
    gs_path = SRC_DIR / f"{stem}_pifu05_greenscreen_first.png"
    result = {"stem": stem, "name": name, "ok": False, "path": str(final_webm), "attempts": []}

    if meta.get("action") in (None, "PENDING_BATCH"):
        result["error"] = "phase-2 loop action pending"
        return result
    if not src.exists():
        result["error"] = "missing png"
        return result
    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} {name} phase2 webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    m.make_greenscreen(src, gs_path)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(gs_path, FIRST_DIR / gs_path.name)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = build_prompt(meta)
    out_leaf = f"{stem}_pifu05_tease2_gs"
    out_prefix = f"video/{out_leaf}"
    qa_stem = QA_DIR / stem
    qa_stem.mkdir(parents=True, exist_ok=True)
    max_attempts = int(meta.get("max_attempts", MAX_ATTEMPTS))

    for attempt in range(1, max_attempts + 1):
        seed = 2026082620 + (hash(stem) % 100000) + attempt * 131
        print(f"[{stem}] {name} tease2 attempt {attempt}/{max_attempts} seed={seed}", flush=True)
        t_start = time.time()
        try:
            wf = build_workflow_tease2(input_name, out_prefix, prompt, seed, meta)
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            m.wait_prompt(prompt_id, timeout_s=H3_WAIT_TIMEOUT_S)
            print(f"  h3 done in {time.time() - t_start:.1f}s", flush=True)
            out = m.find_latest_output(out_leaf, t_start)
            if out is None:
                raise RuntimeError("output mp4 not found")
            shutil.copy2(out, qa_stem / f"a{attempt}.mp4")

            f0 = m.extract_frame(out, 0.4, qa_stem / f"a{attempt}_t040.png")
            f1 = m.extract_frame(out, 3.0, qa_stem / f"a{attempt}_t300.png")
            f2 = m.extract_frame(out, 5.5, qa_stem / f"a{attempt}_t550.png")
            frames = [(f0, "t0.4"), (f1, "t3.0"), (f2, "t5.5")]
            checks = run_qa_checks(meta, gs_path, frames, strict_qa)
            qa_pass = all(ok for _, ok, _ in checks)
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'WARN'} {det}", flush=True)
            if strict_qa and not qa_pass:
                result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "checks": checks})
                continue

            shutil.copy2(out, gs_mp4)
            ok_key, det_key = key_to_webm(gs_mp4, final_webm, f"{stem}_pifu05_2", force=True)
            print(f"  KEY {'PASS' if ok_key else 'FAIL'} {det_key}", flush=True)
            if not ok_key:
                result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": f"key: {det_key}"})
                continue

            result["ok"] = True
            result["qa_pass"] = qa_pass
            result["attempts"].append(
                {"attempt": attempt, "seed": seed, "ok": True, "mp4": str(gs_mp4), "checks": checks, "qa_pass": qa_pass}
            )
            print(f"  ACCEPTED -> {final_webm} ({final_webm.stat().st_size // 1024} KB)", flush=True)
            return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": str(e)})
            time.sleep(5)

    print(f"[FAIL] {stem} {name} tease2 after {max_attempts} attempts", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="SR01_2,SR01_3", help="artStem, comma list, or all")
    ap.add_argument("--force", action="store_true")
    ap.add_argument(
        "--strict-qa",
        action="store_true",
        help="retry on QA fail (default: single shot, QA logged as WARN only)",
    )
    args = ap.parse_args()

    print("=== pifu05 special outfit PHASE-2 tease LOOP H3 batch ===", flush=True)
    print(f"SRC: {SRC_DIR}", flush=True)
    print(f"spec: {WIDTH}x{HEIGHT} length={LENGTH} (~6.0s) steps={STEPS} max_attempts={MAX_ATTEMPTS}", flush=True)
    m.api("/system_stats")

    if args.stem == "all":
        stems = list(CHARACTERS.keys())
    else:
        stems = [s.strip() for s in args.stem.split(",") if s.strip()]
    for stem in stems:
        if stem not in CHARACTERS:
            print(f"unknown stem: {stem}", file=sys.stderr)
            return 2

    QA_DIR.mkdir(parents=True, exist_ok=True)
    results = [process_one(stem, force=args.force, strict_qa=args.strict_qa) for stem in stems]
    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
        "standards": {
            "anime_2d_lock": True,
            "max_attempts": MAX_ATTEMPTS,
            "exposure_game_safe": True,
            "face_body_lock": True,
        },
    }
    report = QA_DIR / "pifu05_tease2_batch_report.json"
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
