"""Batch MiniMax H3: 特殊服装01 pifu05 greenscreen idle → transparent webm.

Vertical 768×1344, 4s (96 frames @24fps), fixed camera, natural idle, loop ends.
Same pipeline standards as pifu05 tease: 2D anime lock, face QA, rembg→hybrid key.

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_minimax_h3_pifu05_idle_batch.py --stem SR01_2
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
QA_DIR = SRC_DIR / "_qa_idle"
FIRST_DIR = SRC_DIR / "_first_idle"
DEFAULT_PORTRAIT_DIR = ROOT / "tex" / "juese"

WIDTH, HEIGHT = 768, 1344
LENGTH = 96  # 4.0s @ 24fps
STEPS = 20
MAX_ATTEMPTS = 3
H3_WAIT_TIMEOUT_S = 7200.0

CHROMA_BASE = (
    "2D anime game character greenscreen idle plate. Pure flat chroma key green (#00b140) background, "
    "even soft anime-style lighting, seamless green matte, subject isolated on solid green. "
    "Ultra-detailed flat cel-shaded 2D anime illustration exactly matching the first-frame static plate — "
    "clean linework, soft pastel palette, sharp anime focus. "
    "NOT 3D render, NOT CGI, NOT photorealistic, NOT realistic doll, NOT Unreal/Octane.\n\n"
    "FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. "
    "Do not shrink the subject, no pull-out, no added headroom.\n\n"
    "CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. "
    "Framing identical throughout. Subject stays large and centered as in the first frame.\n\n"
    "Keep pure flat #00b140 green everywhere behind the subject: no floor, no set, no shadow catcher, "
    "no vignette. Do NOT change hair color, face design, cybernetics, or outfit design.\n\n"
    "Audio: very soft quiet room tone only, no speech, no music."
)

ANIME_STYLE_BLOCK = (
    "ART STYLE LOCK (entire 4 seconds): stay 2D anime game illustration identical to first frame — "
    "flat cel-shaded anime art, clean linework, soft pastel colors. "
    "Face must be 1:1 the default skin portrait face (same eye shape, iris color, nose, lips, cheek roundness). "
    "Never morph into 3D/CGI/photorealistic style.\n\n"
)

# Identity locked from pifu05 static plates (same as tease batch, without tease actions).
CHARACTERS: dict[str, dict] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "identity": (
            "ash-blonde high ponytail with metallic white wing-fin hair clips, light blue eyes, pale skin, "
            "black leather biker jacket draped off shoulders, black strappy bikini top and micro hot pants, "
            "black studded choker, black buckled thigh straps, black platform combat boot on organic left leg, "
            "white/silver cybernetic right leg prosthetic with gold accents — special outfit pifu05"
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
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "anime_lock": True,
        "likeness_strict": True,
        "max_attempts": 6,
        "identity": (
            "long jet-black high ponytail, amber-gold eyes, black lace corset lingerie top with sweetheart neckline "
            "and vertical front lacing, waist side cutouts with black harness straps, black lace micro shorts, "
            "black choker with silver cross pendant, sheer black mesh bishop sleeves with glowing purple neon frayed "
            "distressed edges at cuffs, black metallic segmented shoulder armor with orange MB-02 plate on left shoulder, "
            "asymmetric legs: left leg black garter with red diamond gem and sheer black thigh-high stocking, "
            "right leg black leather buckle thigh straps over bare skin, dark metallic black armored high-heel boots "
            "(NOT white cyber legs), long black outer / purple inner torn cape train at left hip — special outfit pifu05"
        ),
        "extra_lock": (
            "OUTFIT LOCK (1:1 first frame, never redesign):\n"
            "- MUST keep black lace corset + lace shorts + cross choker — NOT combat bodysuit, NOT swimsuit\n"
            "- MUST keep sheer black mesh sleeves with purple neon shredded cuffs — NOT bare arms, NOT white cyber arms\n"
            "- MUST keep dark black metallic shoulder pads + dark armored boots — NOT white-orange full prosthetic limbs\n"
            "- MUST keep left garter red diamond + right thigh buckle straps + left purple/black torn cape train\n"
            "- Orange MB-02 only on left shoulder plate, NOT replacing entire limbs with white mecha shells"
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
        "extra_lock": (
            "CRITICAL: NEVER remove, lift, pull down, or open the respirator mask — "
            "it stays sealed on lower face for all 4 seconds. No drool, dry mouth area under mask."
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
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "identity": (
            "long straight silver-white hair with bangs, bright neon emerald-green eyes, black strappy bikini top and micro pleated skirt, "
            "white-silver fully mechanical arms and legs with black joints, compact neon-green translucent mechanical wing plates on back, "
            "black jacket worn open off shoulders — special outfit pifu05"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "anime_lock": True,
        "face_ref_default": True,
        "pick_best_face": True,
        "likeness_strict": True,
        "max_attempts": 6,
        "identity": (
            "2D anime illustration only. height 158cm petite B82/W55/H80, long voluminous wavy pastel blue-lavender hair "
            "with bangs, soft pink large anime eyes, gentle youthful doll-like 2D anime face (round soft cheeks, small nose, "
            "soft natural pink lips — EXACT same face as default skin SSR03_1.png across all outfits), "
            "black gothic lace mini dress, gold cross pendant, black lace hair bows with gold star chains, "
            "platinum white mechanical legs with red heel glow — special outfit pifu05"
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "identity": (
            "dusty pink/mauve long hair with bangs, reddish-pink eyes, glossy black robotic ear headpieces, "
            "black high-slit qipao-style micro dress with lace long stockings, polished black/red cybernetic arms and legs, "
            "large segmented mechanical scorpion tail behind — special outfit pifu05"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "identity": (
            "orange twin-tail hair, amber eyes, teal forehead accessory, black strappy bikini harness with gold rings, "
            "white glossy cyber shoulder armor and thigh-high boots, red hazard stripe on right leg, black choker — special outfit pifu05"
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "anime_lock": True,
        "face_ref_default": True,
        "pick_best_face": True,
        "likeness_strict": True,
        "max_attempts": 6,
        "identity": (
            "2D anime illustration only. height 170cm B86/W56/H84, long straight black hair with vivid pink underside "
            "and bang highlights, soft reddish-brown rose-pink anime eyes, delicate oval 2D anime face (small nose, "
            "soft pale pink lips — EXACT same face as default skin UR03_1.png across all outfits), thin glowing gold "
            "double-ring halo, large metallic tech headphones with red accents, thick mechanical collar, "
            "black-gold strappy bikini harness, black bomber jacket draped off shoulders, transparent glass-shell left "
            "leg prosthetic with golden gears, cyan katana — special outfit pifu05"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "identity": (
            "short messy light-lavender hair with black X hair clips, amber eyes, white-pink bunny ear headband, "
            "black-pink strappy micro shorts outfit with open bomber jacket (pink lining), asymmetric fishnet thigh-high on one leg "
            "and black PVC knee guard with pink straps on other, barefoot — special outfit pifu05"
        ),
        "extra_lock": "CRITICAL: mouth closed, no tongue out for all 4 seconds.",
    },
}


def build_idle_prompt(meta: dict) -> str:
    identity = meta["identity"]
    style = ANIME_STYLE_BLOCK if meta.get("anime_lock") else ANIME_STYLE_BLOCK  # always 2D for pifu05
    extra = meta.get("extra_lock", "")
    extra_block = f"\n{extra}\n" if extra else ""
    return f"""{CHROMA_BASE}

{style}LOCKED to first frame identity and special outfit wardrobe: {identity}. Exact same character design, outfit colors, cybernetics, hair, face, and accessories throughout.
{extra_block}
POSE: hold EXACTLY the first-frame pose — standing / sitting / kneeling as already drawn. Micro-motion idle only.

ACTION (natural idle only, 4 seconds):
- Soft chest breathing and tiny weight shift (stay large in frame, no walking)
- Gentle breeze physics on hair, jacket hems, fabric edges, cape/wings/tail if present
- Natural blinking at normal human rate
- Subtle neutral expression micro-acting, then settle back toward the opening pose
- First frame and last frame must match pose and expression closely for seamless looping
- NO large pose change, NO leaning into camera, NO walking, NO teasing gestures, NO costume change

Do NOT change costume, hair color, cybernetic parts, or background.
"""


def build_workflow_idle(input_name: str, out_prefix: str, prompt: str, seed: int, meta: dict | None = None) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    # loop: last_frame = first frame image for seamless idle
    wf["104"]["inputs"]["last_frame"] = ["114", 0]
    wf["9"]["inputs"]["steps"] = STEPS
    if meta and meta.get("anime_lock"):
        wf["200"]["inputs"]["shift_video"] = 5.0
        wf["9"]["inputs"]["steps"] = 22
    return wf


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


def face_mean_dist(ref_gs: Path, frame_path: Path) -> float:
    _, det = face_region_likeness_ok(ref_gs, frame_path, max_dist=999.0)
    if "face_mean_dist=" not in det:
        return 999.0
    return float(det.split("face_mean_dist=")[1])


def idle_likeness_ok(src_gs: Path, frame_path: Path, max_dist: float = 28.0) -> tuple[bool, str]:
    """Idle should stay close to first frame occupancy and colors."""
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
    if abs(area_b - area_a) > 0.22:
        return False, f"occupancy_shift a={area_a:.3f} b={area_b:.3f}"
    if ma.sum() < 100 or mb.sum() < 100:
        return False, "too_few_subject_pixels"
    ca = a[ma].mean(axis=0)
    cb = b[mb].mean(axis=0)
    d = float(np.linalg.norm(ca - cb))
    ok = d < max_dist
    return ok, f"subj_mean_dist={d:.1f} area_a={area_a:.3f} area_b={area_b:.3f} max={max_dist:.0f}"


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


def process_one(stem: str, force: bool = False) -> dict:
    meta = CHARACTERS[stem]
    name = meta["name"]
    src = SRC_DIR / f"{stem}_pifu05.png"
    final_webm = SRC_DIR / f"{stem}_pifu05_idle.webm"
    gs_mp4 = SRC_DIR / f"{stem}_pifu05_idle_gs_h3.mp4"
    gs_path = SRC_DIR / f"{stem}_pifu05_greenscreen_first.png"
    result = {"stem": stem, "name": name, "ok": False, "path": str(final_webm), "attempts": []}

    if not src.exists():
        result["error"] = "missing png"
        return result

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} {name} idle webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    m.make_greenscreen(src, gs_path)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(gs_path, FIRST_DIR / gs_path.name)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = build_idle_prompt(meta)
    out_leaf = f"{stem}_pifu05_idle_gs"
    out_prefix = f"video/{out_leaf}"
    qa_stem = QA_DIR / stem
    qa_stem.mkdir(parents=True, exist_ok=True)
    max_attempts = int(meta.get("max_attempts", MAX_ATTEMPTS))

    for attempt in range(1, max_attempts + 1):
        seed = 2026082610 + (hash(stem) % 100000) + attempt * 97
        print(f"[{stem}] {name} idle attempt {attempt}/{max_attempts} seed={seed}", flush=True)
        t_start = time.time()
        try:
            wf = build_workflow_idle(input_name, out_prefix, prompt, seed, meta)
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            m.wait_prompt(prompt_id, timeout_s=H3_WAIT_TIMEOUT_S)
            print(f"  h3 done in {time.time() - t_start:.1f}s", flush=True)
            out = m.find_latest_output(out_leaf, t_start)
            if out is None:
                raise RuntimeError("output mp4 not found")
            shutil.copy2(out, qa_stem / f"a{attempt}.mp4")

            # sample early / mid / late within 4s
            f0 = m.extract_frame(out, 0.3, qa_stem / f"a{attempt}_t030.png")
            f1 = m.extract_frame(out, 2.0, qa_stem / f"a{attempt}_t200.png")
            f2 = m.extract_frame(out, 3.7, qa_stem / f"a{attempt}_t370.png")
            checks = []
            for fp, label in ((f0, "t0.3"), (f1, "t2.0"), (f2, "t3.7")):
                ok_g, det_g = m.green_screen_ok(fp, min_corner_green_ratio=0.55)
                checks.append((f"green[{label}]", bool(ok_g), str(det_g)))
            likeness_max = 18.0 if meta.get("likeness_strict") else 28.0
            if meta.get("likeness_strict"):
                for fp, label in ((f0, "t0.3"), (f1, "t2.0"), (f2, "t3.7")):
                    ok_l, det_l = idle_likeness_ok(gs_path, fp, max_dist=likeness_max)
                    checks.append((f"likeness[{label}]", bool(ok_l), str(det_l)))
            else:
                ok_l, det_l = idle_likeness_ok(gs_path, f0, max_dist=likeness_max)
                checks.append(("likeness", bool(ok_l), str(det_l)))
            if meta.get("face_ref_default"):
                face_max = 18.0 if meta.get("likeness_strict") else 32.0
                for fp, label in ((f0, "t0.3"), (f1, "t2.0"), (f2, "t3.7")):
                    ok_f, det_f = face_region_likeness_ok(gs_path, fp, max_dist=face_max)
                    checks.append((f"face_plate[{label}]", bool(ok_f), str(det_f)))
            if meta.get("face_ref_portrait"):
                portrait_gs = default_portrait_gs(stem)
                portrait_max = float(meta.get("face_portrait_max_dist", 22.0))
                for fp, label in ((f0, "t0.3"), (f1, "t2.0"), (f2, "t3.7")):
                    ok_p, det_p = face_region_likeness_ok(portrait_gs, fp, max_dist=portrait_max)
                    checks.append((f"face_portrait[{label}]", bool(ok_p), str(det_p)))
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if not all(ok for _, ok, _ in checks):
                result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "checks": checks})
                continue

            shutil.copy2(out, gs_mp4)
            ok_key, det_key = key_to_webm(gs_mp4, final_webm, f"{stem}_pifu05_idle", force=True)
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

    print(f"[FAIL] {stem} {name} idle after {max_attempts} attempts", flush=True)
    if meta.get("pick_best_face"):
        # Compare against pifu05 plate (same pose), not standing default portrait
        best_attempt, best_score = None, 999.0
        for attempt in range(1, max_attempts + 1):
            mp4_try = qa_stem / f"a{attempt}.mp4"
            if not mp4_try.exists():
                continue
            dists = []
            for t in (0.3, 2.0, 3.7):
                fp = m.extract_frame(mp4_try, t, qa_stem / f"_pick_a{attempt}_t{t}.png")
                dists.append(face_mean_dist(gs_path, fp))
            avg = sum(dists) / len(dists)
            print(f"  pick_face_plate a{attempt} avg_dist={avg:.1f} dists={dists}", flush=True)
            if avg < best_score:
                best_score, best_attempt = avg, attempt
        plate_pick_max = float(meta.get("face_plate_pick_max_avg", 20.0))
        if best_attempt is not None and best_score <= plate_pick_max:
            pick_mp4 = qa_stem / f"a{best_attempt}.mp4"
            print(f"  PICK best face-plate attempt {best_attempt} avg={best_score:.1f}", flush=True)
            shutil.copy2(pick_mp4, gs_mp4)
            ok_key, det_key = key_to_webm(gs_mp4, final_webm, f"{stem}_pifu05_idle", force=True)
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

    print("=== pifu05 special outfit idle H3 batch ===", flush=True)
    print(f"SRC: {SRC_DIR}", flush=True)
    print(f"spec: {WIDTH}x{HEIGHT} length={LENGTH} (~4.0s) steps={STEPS}", flush=True)
    m.api("/system_stats")

    if args.stem == "all":
        stems = list(CHARACTERS.keys())
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
    report = QA_DIR / "pifu05_idle_batch_report.json"
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
