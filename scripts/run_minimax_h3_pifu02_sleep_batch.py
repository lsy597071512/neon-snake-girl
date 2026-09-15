"""Batch MiniMax H3: 星夜睡衣 pifu02 → 4s sleeping loop transparent WebM.

Vertical 768×1344, 4.0s (96 frames @24fps), fixed camera, loop-consistent ends.
Sleep loops LOCKED to first-frame sleep plate identity/coverage.
HARD GATE: pose plate + breath video frames must pass opacity/cover QA (透点打回).
Requires ComfyUI http://127.0.0.1:8188 + MiniMax H3.

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/run_minimax_h3_pifu02_sleep_batch.py --stem all --force
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

from chroma_key_gs_video_webm import gs_mp4_to_webm  # noqa: E402

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "shuiyi"
QA_DIR = SRC_DIR / "_qa_sleep"
FIRST_DIR = SRC_DIR / "_first_sleep"

# --- Content policy (non-negotiable) ---
# 只用正向锁衣/锁不透明；禁止在提示词里写透点、露点、sheer、see-through、nipple 等词（负面词会诱导）。
CONTENT_RULES = (
    "CONTENT POLICY (must obey every frame — HIGHEST PRIORITY): "
    "IDENTITY LOCK to the FIRST FRAME sleep plate. Same outfit, same coverage, same silhouette. "
    "Clothes stay exactly as first frame — no removing, sliding, hiking, opening, or loosening. "
    "Sleepwear is THICK MATTE OPAQUE cloth that blocks all light; flat smooth fabric surface; "
    "no surface bumps, no body contours printed on cloth, no wet look. "
    "Motion is ONLY soft sleeping breath — clothing shape and coverage stay identical to first frame."
)
COVER_LOCK = (
    "COVER LOCK (non-negotiable): "
    "pixel-faithful thick matte opaque sleepwear from first frame; "
    "camisole and shorts stay fixed; cloth stays fully light-blocking; flat chest panel."
)
OPACITY_LOCK = (
    "OPACITY LOCK (non-negotiable): "
    "sleepwear fabric is thick, matte, fully light-blocking; "
    "chest area is a smooth flat cloth panel with no embossed body detail; "
    "no glossy thin silk look that reveals body under the cloth."
)

WIDTH, HEIGHT = 768, 1344
LENGTH_MORPH = 72  # ~3s @24fps — find a sleep pose mid-frame
LENGTH = 96  # 4.0s final breathing loop
# Match shower-batch quality/speed profile (6s@20steps ~10min). 30 steps made 4s ~11min/attempt.
STEPS = 20
MAX_ATTEMPTS = 6
# Temporarily skip stems that need a different pose-cover strategy (H3 morph always undresses)
SKIP_STEMS = {"SR01_2"}
# Blue key avoids eating green hair tips / mint accents (green #00b140 was destroying bodies)
KEY = (0, 102, 255)  # #0066FF
KEY_RGB = np.array(KEY, dtype=np.float32)
KEY_HEX = "0x0066FF"
SLEEP_WEBM_VF = (
    f"colorkey={KEY_HEX}:0.28:0.06,format=rgba,"
    "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
    "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
    "format=yuva420p"
)

# Accurate sleepwear colors from pifu02 plates; poses lock clothing to first frame
CHARS: dict[str, dict[str, str]] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "fabric": (
            "THICK MATTE OPAQUE WHITE ivory sleepwear cloth camisole + matching WHITE shorts ONLY "
            "(heavy light-blocking cloth, never thin silk look; never mint/teal/green fabric)"
        ),
        "identity": (
            "ash-blonde high ponytail with green-tipped ends, silver wing-fin clips, light-blue eyes, "
            "THICK MATTE OPAQUE WHITE ivory camisole with white lace hem, matching WHITE opaque shorts, "
            "white-grey-gold mechanical legs from mid-thigh"
        ),
        "pose": (
            "side-lying drowsy sleep, knees lightly drawn, eyes closed, "
            "KEEP exact same thick opaque ivory camisole and shorts as first frame, "
            "flat smooth cloth on chest with no body-print detail"
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "fabric": "silver-white satin sleepwear with red ribbon accents (never mint/teal/green fabric)",
        "identity": (
            "messy short silver-white hair, thin red headband, pale blue eyes, glossy white mecha limbs, "
            "silver-white satin camisole with red ribbon/knot details and matching silver-white shorts"
        ),
        "pose": (
            "semi-reclined side-sit drowsy sleep, head nodding, "
            "KEEP identical opaque silver-white camisole and shorts coverage as first frame"
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "fabric": "pearl-white satin sleepwear (never mint/teal/green fabric)",
        "identity": (
            "long wavy ash-blonde hair, teal aquamarine eyes, gentle face, "
            "pearl-white satin camisole and shorts, grey-gold mechanical right arm and boots"
        ),
        "pose": (
            "side-lying stretch sleep, "
            "KEEP identical opaque pearl-white camisole and shorts coverage as first frame"
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "fabric": "silver-white satin sleepwear (never mint/teal/green fabric)",
        "identity": (
            "very long silver-grey hair with darker bang streak, amber-orange eyes, yellow antenna headset, "
            "silver-white satin camisole and shorts"
        ),
        "pose": (
            "curled fetal sleep three-quarter to camera, "
            "KEEP identical opaque silver-white camisole and shorts coverage as first frame"
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "fabric": "bright orange satin sleepwear (never mint/teal/green fabric)",
        "identity": (
            "long jet-black high ponytail, amber-orange eyes, "
            "bright orange satin camisole and shorts, white-orange cyber arm plating and mechanical legs"
        ),
        "pose": (
            "prone-side sprawl sleep, "
            "KEEP identical opaque orange camisole and shorts coverage as first frame"
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "fabric": "cream ivory satin sleepwear with soft gold edge (never mint/teal/green fabric)",
        "identity": (
            "long white hair, white feline ears yellow-black accents, amber-gold eyes, black/yellow respirator, "
            "cream ivory satin camisole and shorts, white-silver mechanical hands/feet"
        ),
        "pose": (
            "side-sitting drowsy lean, "
            "KEEP identical opaque cream camisole coverage as first frame, "
            "shorts coverage identical to first frame"
        ),
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "fabric": "black satin sleepwear (never mint/teal/green fabric)",
        "identity": (
            "long jet-black hair with cyan-green clips, crimson eyes, black choker, "
            "black satin camisole and shorts, matte black left arm prosthetic and mechanical right lower leg"
        ),
        "pose": (
            "side-lying sleep one knee raised as first frame, "
            "KEEP identical opaque black camisole coverage as first frame, "
            "shorts coverage identical to first frame"
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "fabric": "mint-green satin sleepwear matching pifu02 plate (keep mint, do not turn neon/acid)",
        "identity": (
            "long silver-grey hair, luminous neon-green eyes, "
            "mint-green satin camisole and shorts exactly as sleepwear plate, "
            "silver/white cyber limb plates with green glow accents, pointed cyber heels"
        ),
        "pose": (
            "curled side sleep, "
            "KEEP identical opaque mint camisole coverage as first frame, "
            "shorts coverage identical to first frame"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "fabric": "ice-white satin sleepwear (never mint/teal/green fabric)",
        "identity": (
            "long wavy pastel blue-lavender hair, soft pink eyes, "
            "ice-white satin camisole and shorts, glossy white mechanical arms/legs with gold ball joints"
        ),
        "pose": (
            "petite curled sleep, "
            "KEEP identical opaque ice-white camisole coverage as first frame, "
            "shorts coverage identical to first frame"
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "fabric": "rose-pink satin sleepwear (never mint/teal/green fabric)",
        "identity": (
            "dusty pink/mauve hair, reddish-pink eyes, large glossy black robotic ears, "
            "rose-pink satin camisole and shorts, black/red cyber arms and legs"
        ),
        "pose": (
            "reclined side-sit sleep, "
            "KEEP identical opaque rose-pink camisole and shorts coverage as first frame"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "fabric": "white lace camisole + white robe sleepwear (never mint/teal/green fabric)",
        "identity": (
            "orange twin-tail hair, amber eyes, teal forehead accessory, "
            "white lace camisole with loose white robe wrap, white glossy mechanical thigh-high boots with red accents"
        ),
        "pose": (
            "sprawled side sleep, robe stays as first frame, "
            "KEEP identical opaque lace camisole coverage as first frame, "
            "shorts coverage identical to first frame"
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "fabric": "soft ivory/white night sleepwear (never mint/teal/green fabric)",
        "identity": (
            "long black hair with pink underside highlights, reddish-brown eyes, large tech headphones, "
            "ivory-white satin sleepwear camisole and shorts, mechanical collar and glass-shell/cyber leg details"
        ),
        "pose": (
            "long-legged side-lying sleep, headphones on, "
            "KEEP identical opaque ivory camisole coverage as first frame, "
            "shorts coverage identical to first frame"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "fabric": "soft white/ivory sleepwear (never mint/teal/green fabric)",
        "identity": (
            "short light-blue hair with pink highlights, light-blue headband with pink flower, purple-pink eyes, "
            "large white-pink bunny ears, ivory-white satin camisole and shorts, white-silver mechanical legs"
        ),
        "pose": (
            "bunny-ear girl curled cute sleep, "
            "KEEP identical opaque ivory camisole coverage as first frame, "
            "shorts coverage identical to first frame"
        ),
    },
}


def build_sleep_prompt(identity: str, fabric: str, pose: str) -> str:
    return f"""Professional film-set chroma key sleeping plate. Uniform chroma key background, pure BLUE screen (#0066FF), studio lighting with zero shadows, seamless matte color.

CRITICAL VOID RULES (must obey every frame):
- NO bed, NO mattress, NO pillow, NO sheets, NO blanket, NO floor, NO furniture, NO room, NO wall
- Subject FLOATS isolated in solid #0066FF blue void only
- Pure flat chroma blue everywhere behind/around the body — professional matte, no props

FRAMING: vertical 9:16. Character fills almost the entire frame from head to cyber-feet — MAXIMUM screen occupancy. Keep WHOLE body complete: head, both arms, torso, hips, both legs/feet. Do not crop. Do not amputate limbs.

FABRIC LOCK (highest priority): {fabric}
LOCKED identity from first frame: {identity}. Same face, hair, eyes, cybernetics. EXACT same sleepwear colors as first-frame reference. Do NOT recolor sleepwear. Do NOT change into armor, swimsuit, or urban casual.

SLEEPWEAR COVERAGE LOCK (critical):
- Keep the SAME thick matte opaque camisole + shorts as the first-frame reference
- Cloth is heavy and light-blocking; flat smooth chest panel; no body-print under cloth
- Only soft breath motion; do NOT remove, slide, yank, open, or loosen any clothing

POSE (already sleeping on FRAME 1 — do not start standing then lie down):
{pose}
- {CONTENT_RULES}
- {COVER_LOCK}
- {OPACITY_LOCK}
- Same sleepwear set and coverage as first frame
- Eyes closed; soft unconscious micro-breathing only
- Same sleep pose from start to end for looping

CAMERA: locked tripod, no pan, no tilt, no zoom. Portrait framing on blue void.

Audio: very soft quiet room tone only, no speech, no music.
"""


def build_breath_prompt(
    identity: str, fabric: str, pose: str, *, screen: str = "blue"
) -> str:
    if screen == "green":
        void = """Professional film-set chroma key sleeping plate. Uniform pure GREEN screen (#00B140) ONLY. Zero shadows. Subject isolated in green void.

CRITICAL VOID (every frame):
- Flat solid #00B140 green background ONLY
- NO bed, pillow, sheets, furniture, floor, room, wall
- NO blue/teal/cyan painted backdrop — never replace the green key
- Keep blue/cyan hair colors exactly — do NOT recolor hair to green"""
        cam = "CAMERA: locked tripod, no pan/tilt/zoom. Portrait framing on green void."
    else:
        void = """Professional film-set chroma key sleeping plate. Uniform pure BLUE screen (#0066FF) ONLY. Zero shadows. Subject isolated in blue void.

CRITICAL VOID (every frame):
- Flat solid #0066FF blue background ONLY
- NO bed, pillow, sheets, furniture, floor, room, wall
- NO teal/mint/cyan/green painted backdrop — never replace the blue key"""
        cam = "CAMERA: locked tripod, no pan/tilt/zoom. Portrait framing on blue void."

    return f"""{void}

FRAMING: vertical 9:16. Keep EXACT sleep pose and EXACT clothing from the first-frame reference. Whole body intact.

FABRIC LOCK: {fabric}
IDENTITY LOCK: {identity}. Same face, hair, cybernetics, sleepwear colors and coverage as first frame.
Do NOT recolor fabric. Do NOT change outfit type. Keep first-frame sleepwear coverage locked.

ACTION (4s seamless loop — micro motion only):
- Hold the SAME sleeping pose as first frame: {pose}
- Soft breathing only (tiny torso rise/fall), eyes closed
- Clothing silhouette MUST match first frame every frame — straps, hem, shorts fixed
- Keep cloth thick, matte, fully light-blocking; chest stays a flat smooth fabric panel
- {CONTENT_RULES}
- {COVER_LOCK}
- {OPACITY_LOCK}
- First and last frame must match for looping

{cam} Audio: soft room tone only.
"""


def make_keyscreen(src: Path, dest: Path) -> Path:
    """RGBA source → max-fill on blue key canvas."""
    char = Image.open(src).convert("RGBA")
    a = np.asarray(char)
    mask = a[:, :, 3] > 16
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError(f"no opaque pixels: {src}")
    pad = 4
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(char.width, int(xs.max()) + 1 + pad), min(char.height, int(ys.max()) + 1 + pad)
    char = char.crop((l, t, r, b))

    margin = 0.02
    max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * (1 - 2 * margin))
    scale = min(max_w / char.width, max_h / char.height)
    cw, ch = max(1, int(char.width * scale)), max(1, int(char.height * scale))
    char2 = char.resize((cw, ch), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (*KEY, 255))
    x, y = (WIDTH - cw) // 2, (HEIGHT - ch) // 2
    canvas.alpha_composite(char2, (x, y))
    arr = np.asarray(canvas).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3]
    key = np.broadcast_to(KEY_RGB, rgb.shape)
    out = rgb * alpha + key * (1.0 - alpha)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
    m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, m.COMFY_INPUT / dest.name)
    print(f"  keyscreen {dest.name} scale={cw}x{ch} h%={ch / HEIGHT * 100:.1f}", flush=True)
    return dest


def _dilate_mask(mask: np.ndarray, iterations: int = 3) -> np.ndarray:
    out = mask.astype(np.uint8) * 255
    # cheap box dilate without cv2
    for _ in range(iterations):
        pad = np.pad(out, 1, mode="edge")
        stacked = np.stack(
            [
                pad[:-2, :-2],
                pad[:-2, 1:-1],
                pad[:-2, 2:],
                pad[1:-1, :-2],
                pad[1:-1, 1:-1],
                pad[1:-1, 2:],
                pad[2:, :-2],
                pad[2:, 1:-1],
                pad[2:, 2:],
            ],
            axis=0,
        )
        out = stacked.max(axis=0)
    return out > 0


def subject_cutout_rgba(frame_path: Path) -> Image.Image:
    """Prefer soft blue-key cutout (keeps limbs); rembg only if bed/props dominate."""
    rgb = np.asarray(Image.open(frame_path).convert("RGB")).astype(np.float32)
    dist = np.linalg.norm(rgb - KEY_RGB, axis=2)
    chroma_mask = dist > 55.0
    key_ratio = float((dist < 55.0).mean())

    use_rembg = key_ratio < 0.28  # too little key = bed/scene
    if use_rembg:
        from rembg import remove

        cut = remove(Image.open(frame_path).convert("RGBA")).convert("RGBA")
        alpha = np.asarray(cut)[:, :, 3] > 16
        alpha = _dilate_mask(alpha, iterations=4)
        rgba = np.asarray(cut).copy()
        rgba[:, :, 3] = np.where(alpha, np.maximum(rgba[:, :, 3], 220), 0)
        print(f"  cutout=rembg+dilate key_ratio={key_ratio:.3f}", flush=True)
        return Image.fromarray(rgba, "RGBA")

    # Soft chroma: keep near-subject fringe so hair tips / straps aren't chewed
    soft = np.clip((dist - 40.0) / 40.0, 0.0, 1.0)
    hard = chroma_mask.astype(np.float32)
    alpha_f = np.maximum(soft, hard * 0.85)
    alpha_f = np.where(_dilate_mask(alpha_f > 0.35, iterations=2), np.maximum(alpha_f, 0.92), alpha_f)
    rgba = np.dstack([rgb, alpha_f * 255.0]).astype(np.uint8)
    print(f"  cutout=chroma+dilate key_ratio={key_ratio:.3f}", flush=True)
    return Image.fromarray(rgba, "RGBA")


def frame_to_sleep_keyscreen(frame_path: Path, dest: Path) -> Path:
    """Sleep mid-frame → complete body on blue key, max fill."""
    cut = subject_cutout_rgba(frame_path)
    a = np.asarray(cut)
    mask = a[:, :, 3] > 16
    ys, xs = np.where(mask)
    if len(xs) < 80:
        raise RuntimeError(f"empty cutout: {frame_path}")
    pad = 8
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(cut.width, int(xs.max()) + 1 + pad), min(cut.height, int(ys.max()) + 1 + pad)
    cut = cut.crop((l, t, r, b))

    margin = 0.02
    max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * (1 - 2 * margin))
    scale = min(max_w / cut.width, max_h / cut.height)
    cw, ch = max(1, int(cut.width * scale)), max(1, int(cut.height * scale))
    cut2 = cut.resize((cw, ch), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (*KEY, 255))
    x, y = (WIDTH - cw) // 2, (HEIGHT - ch) // 2
    canvas.alpha_composite(cut2, (x, y))
    arr = np.asarray(canvas).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3]
    key = np.broadcast_to(KEY_RGB, rgb.shape)
    out = rgb * alpha + key * (1.0 - alpha)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
    m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, m.COMFY_INPUT / dest.name)
    print(f"  sleep-key {dest.name} scale={cw}x{ch} h%={ch / HEIGHT * 100:.1f}", flush=True)
    return dest


def sleep_key_ok(frame_path: Path) -> tuple[bool, str]:
    im = Image.open(frame_path).convert("RGB")
    arr = np.asarray(im).astype(np.float32)
    h, w, _ = arr.shape
    cs = max(12, min(h, w) // 16)
    tops = [arr[:cs, :cs, :], arr[:cs, -cs:, :]]
    top_px = np.concatenate([c.reshape(-1, 3) for c in tops], axis=0)
    dist = np.linalg.norm(top_px - KEY_RGB, axis=1)
    ratio = float((dist < 90.0).mean())
    mean = top_px.mean(axis=0)
    # Key-channel dominance: blue key → B; green key → G
    if KEY[1] >= KEY[2]:
        dom = mean[1] > mean[0] + 20 and mean[1] > mean[2] + 20 and mean[1] > 120
        tag = "g_dom"
    else:
        dom = mean[2] > mean[0] + 20 and mean[2] > mean[1] + 20 and mean[2] > 120
        tag = "b_dom"
    ok = ratio >= 0.50 and dom
    return ok, f"top_key={ratio:.3f} meanRGB=({mean[0]:.0f},{mean[1]:.0f},{mean[2]:.0f}) {tag}={dom}"


def sleep_void_ok(frame_path: Path) -> tuple[bool, str]:
    arr = np.asarray(Image.open(frame_path).convert("RGB")).astype(np.float32)
    dist = np.linalg.norm(arr - KEY_RGB, axis=2)
    key = dist < 70.0
    key_ratio = float(key.mean())
    white = (
        (arr[:, :, 0] > 200)
        & (arr[:, :, 1] > 200)
        & (arr[:, :, 2] > 200)
        & (~key)
    )
    white_ratio = float(white.mean())
    ok = key_ratio >= 0.28 and white_ratio <= 0.14
    return ok, f"overall_key={key_ratio:.3f} white_prop={white_ratio:.3f}"


def fabric_lock_ok(stand_gs: Path, frame_path: Path, fabric: str) -> tuple[bool, str]:
    """Reject accidental mint/teal cast when fabric lock forbids green clothes."""
    forbid_green = "never mint" in fabric.lower() or "never teal" in fabric.lower()
    if not forbid_green:
        return True, "mint_allowed"

    def torso_mean(path: Path) -> np.ndarray:
        rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
        dist = np.linalg.norm(rgb - KEY_RGB, axis=2)
        m = dist > 70.0
        h, w = m.shape
        band = np.zeros_like(m)
        band[int(h * 0.28) : int(h * 0.55), int(w * 0.25) : int(w * 0.75)] = True
        sel = m & band
        if sel.sum() < 80:
            sel = m
        return rgb[sel].mean(axis=0)

    a = torso_mean(stand_gs)
    b = torso_mean(frame_path)
    d = float(np.linalg.norm(a - b))
    # reject if frame torso became much greener than stand plate
    green_cast = (b[1] - b[0]) - (a[1] - a[0])
    ok = d < 55.0 and green_cast < 18.0
    return ok, f"torso_dist={d:.1f} green_cast={green_cast:.1f} a={a.round(0)} b={b.round(0)}"


def _chest_cover_geometry(path: Path) -> dict:
    """Geometry signals for pulled-down cups / bare bust (fabric below breast skin)."""
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = (r + g + b) / 3.0
    subj = np.linalg.norm(rgb - KEY_RGB, axis=2) > 70.0
    y0, y1 = int(h * 0.18), int(h * 0.55)
    x0, x1 = int(w * 0.20), int(w * 0.80)
    roi = np.zeros((h, w), dtype=bool)
    roi[y0:y1, x0:x1] = True
    s = subj & roi
    fab = s & (lum > 180) & (np.abs(r - g) < 45) & (np.abs(r - b) < 55)
    skin = (
        s
        & (r > 140)
        & (g > 105)
        & (b > 90)
        & (lum < 200)
        & (lum > 115)
        & (np.abs(r - g) < 55)
        & ((r - b) > 4)
        & (~fab)
    )
    ys_s, _ = np.where(skin)
    ys_f, _ = np.where(fab)
    if len(ys_s) < 80 or len(ys_f) < 80:
        return {
            "skin_above_fab": 0.0,
            "gap": 0.0,
            "scy": 0.0,
            "fcy": 0.0,
            "skin_upper": 0.0,
        }
    scy = float(ys_s.mean()) / h
    fcy = float(ys_f.mean()) / h
    skin_above = float((ys_s < fcy * h).mean())
    mid = y0 + (y1 - y0) // 2
    skin_upper = float(skin[y0:mid, :].mean()) if skin[y0:mid, :].size else 0.0
    return {
        "skin_above_fab": round(skin_above, 3),
        "gap": round(fcy - scy, 4),
        "scy": round(scy, 3),
        "fcy": round(fcy, 3),
        "skin_upper": round(skin_upper, 4),
    }


def _compact_tip_blobs(path: Path) -> list[int]:
    """Compact rose/tip blobs in chest ROI (catches nipple-through-sheer fabric)."""
    from scipy import ndimage

    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = (r + g + b) / 3.0
    subj = np.linalg.norm(rgb - KEY_RGB, axis=2) > 70.0
    roi = np.zeros((h, w), dtype=bool)
    roi[int(h * 0.22) : int(h * 0.48), int(w * 0.28) : int(w * 0.72)] = True
    cand = (
        roi
        & subj
        & (lum > 95)
        & (lum < 170)
        & (r > g + 10)
        & (r > b + 8)
        & (g < 155)
        & ((r - g) > 8)
    )
    lab, n = ndimage.label(cand)
    sizes: list[int] = []
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        if area < 80 or area > 900:
            continue
        ys, xs = np.where(m)
        box = (ys.max() - ys.min() + 1) * (xs.max() - xs.min() + 1)
        fill = area / max(1, box)
        if fill >= 0.35:
            sizes.append(area)
    sizes.sort(reverse=True)
    return sizes


def _bust_leak_score(path: Path) -> tuple[float, dict]:
    """Heuristic bare-bust / nipple-leak score (higher = riskier)."""
    from scipy import ndimage  # local import keeps module import light when unused

    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    y0, y1 = int(h * 0.16), int(h * 0.52)
    x0, x1 = int(w * 0.14), int(w * 0.86)
    roi = np.zeros((h, w), dtype=bool)
    roi[y0:y1, x0:x1] = True
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = (r + g + b) / 3.0
    dist = np.linalg.norm(rgb - KEY_RGB, axis=2)
    subj = (dist > 70.0) & roi
    fabric = (
        subj
        & (lum > 190)
        & (np.abs(r - g) < 38)
        & (np.abs(r - b) < 48)
    )
    fabric |= subj & (lum < 90) & (r < 110) & (g < 110) & (b < 110)
    fabric |= subj & (r > 160) & (g < 130) & (b < 100) & ((r - g) > 40)
    skin = (
        subj
        & (r > 138)
        & (g > 100)
        & (b > 85)
        & (lum < 202)
        & (lum > 115)
        & (np.abs(r - g) < 50)
        & ((r - b) > 5)
        & (~fabric)
    )
    areola = (
        subj
        & (~fabric)
        & (r > 130)
        & (r < 205)
        & (g > 75)
        & (g < 140)
        & (b > 75)
        & (b < 140)
        & ((r - g) > 20)
        & ((r - b) > 12)
        & (lum < 155)
        & (lum > 95)
        & (np.abs(g - b) < 30)
    )
    lab, n = ndimage.label(areola)
    sizes = sorted((int((lab == i).sum()) for i in range(1, n + 1)), reverse=True)
    max_blob = int(sizes[0]) if sizes else 0
    top3 = int(sum(sizes[:3])) if sizes else 0
    tip_blobs = _compact_tip_blobs(path)
    tip_n = len(tip_blobs)
    tip_max = int(tip_blobs[0]) if tip_blobs else 0
    geo = _chest_cover_geometry(path)
    skin_f = float(skin.mean())
    nip_f = float(areola.mean())
    fab_f = float(fabric.mean())
    score = (
        skin_f * 40.0
        + nip_f * 800.0
        + max_blob * 0.02
        + top3 * 0.008
        + tip_max * 0.04
        + tip_n * 6.0
        + geo["skin_above_fab"] * 40.0
        + max(0.0, geo["gap"]) * 200.0
        + max(0.0, 0.22 - fab_f) * 80.0
    )
    detail = {
        "skin": round(skin_f, 3),
        "nip": round(nip_f, 4),
        "fab": round(fab_f, 3),
        "max_blob": max_blob,
        "top3": top3,
        "tip_n": tip_n,
        "tip_max": tip_max,
        "skin_above_fab": geo["skin_above_fab"],
        "gap": geo["gap"],
        "skin_upper": geo["skin_upper"],
        "score": round(score, 2),
    }
    return score, detail


def no_nipple_leak_ok(
    pose_gs: Path, stand_gs: Path, *, after_chroma: bool = False, video_frame: bool = False
) -> tuple[bool, str]:
    """Hard gate on sleep pose / video frames for show-through and undress.

    video_frame=True: keep tip/sheer checks; reject if tips worsen vs stand or absolute tip mass is high.
    after_chroma=True (pose plate only): ignore chroma fringe tip inflation; only fail collapsed cover.
    """
    pose_score, pose_d = _bust_leak_score(pose_gs)
    stand_score, stand_d = _bust_leak_score(stand_gs)
    delta = pose_score - stand_score
    max_blob = int(pose_d["max_blob"])
    stand_blob = int(stand_d["max_blob"])
    tip_n = int(pose_d["tip_n"])
    tip_max = int(pose_d["tip_max"])
    stand_tip_n = int(stand_d["tip_n"])
    stand_tip_max = int(stand_d["tip_max"])

    absolute = (max_blob >= 900 and max_blob > stand_blob + 50) or (
        max_blob >= 700
        and max_blob > stand_blob * 1.18
        and pose_d["nip"] >= 0.0030
    )
    sheer_tips = tip_n >= 2
    if stand_tip_n >= 1:
        sheer_tips = tip_n >= 2 or (
            tip_max >= 180 and (tip_max > stand_tip_max * 1.4 or tip_n > stand_tip_n)
        )
    bare_bust = pose_d["skin_above_fab"] >= 0.52 or (
        pose_d["skin_above_fab"] >= 0.48
        and pose_d["gap"] >= 0.012
        and pose_d["skin_upper"] > stand_d["skin_upper"] * 1.25
    )
    severe = pose_score >= stand_score + 6.0 and (
        max_blob >= 600 or tip_max >= 150 or bare_bust
    )
    cover_collapse = pose_d["fab"] + 0.06 < stand_d["fab"] and pose_d["skin"] >= 0.18
    low_cover = pose_d["fab"] < 0.10 and pose_d["skin"] > 0.22
    mass_jump = pose_d["top3"] >= max(1800, int(stand_d["top3"] * 1.25)) and max_blob >= 650

    # Absolute tip show-through on white camisole (透点)
    tip_show = tip_max >= 280 or (tip_n >= 2 and tip_max >= 160)
    tip_worsen = tip_max > max(stand_tip_max * 1.8, stand_tip_max + 80) and tip_max >= 140

    if after_chroma and not video_frame:
        absolute = False
        mass_jump = False
        sheer_tips = False
        bare_bust = pose_d["skin_above_fab"] >= 0.72 and float(pose_d["fab"]) < 0.055
        severe = bare_bust
        cover_collapse = False
        low_cover = False
        # still reject strong tip show-through on the plate itself
        tip_show = tip_max >= 420
        tip_worsen = tip_max > max(stand_tip_max * 3.0, 350)

    if video_frame:
        # Video must not introduce / keep 透点. Stricter than plate.
        bare_bust = pose_d["skin_above_fab"] >= 0.68 and float(pose_d["fab"]) < 0.04
        tip_show = tip_max >= 220 or (tip_n >= 2 and tip_max >= 140)
        tip_worsen = tip_max > max(stand_tip_max * 1.5, stand_tip_max + 60) and tip_max >= 120

    leak = (
        absolute
        or sheer_tips
        or bare_bust
        or severe
        or cover_collapse
        or low_cover
        or mass_jump
        or tip_show
        or tip_worsen
    )
    det = (
        f"pose={pose_d} stand_score={stand_score:.1f} stand_blob={stand_blob} "
        f"stand_tip=({stand_tip_n},{stand_tip_max}) delta={delta:.1f} "
        f"abs={absolute} sheer={sheer_tips} bare={bare_bust} severe={severe} "
        f"cover_collapse={cover_collapse} low_cover={low_cover} mass_jump={mass_jump} "
        f"tip_show={tip_show} tip_worsen={tip_worsen} "
        f"after_chroma={after_chroma} video_frame={video_frame}"
    )
    return (not leak), det


def harden_sleepwear_opacity(src: Path, dest: Path) -> tuple[Path, str]:
    """Paint over tip-like chest blobs with nearby fabric color (pre-breath plate repair)."""
    from scipy import ndimage

    rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = (r + g + b) / 3.0
    subj = np.linalg.norm(rgb - KEY_RGB, axis=2) > 70.0
    y0, y1 = int(h * 0.20), int(h * 0.50)
    x0, x1 = int(w * 0.26), int(w * 0.74)
    roi = np.zeros((h, w), dtype=bool)
    roi[y0:y1, x0:x1] = True
    fabric = (
        roi
        & subj
        & (lum > 185)
        & (np.abs(r - g) < 42)
        & (np.abs(r - b) < 55)
    )
    tip = (
        roi
        & subj
        & (~fabric)
        & (lum > 95)
        & (lum < 175)
        & (r > g + 8)
        & (r > b + 6)
        & ((r - g) > 8)
        & (g < 160)
    )
    # also catch darker areola-like blobs
    tip |= (
        roi
        & subj
        & (~fabric)
        & (r > 130)
        & (r < 205)
        & ((r - g) > 18)
        & ((r - b) > 10)
        & (lum < 155)
        & (lum > 95)
    )
    tip = ndimage.binary_dilation(tip, iterations=2)
    if not tip.any() or not fabric.any():
        Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
        return dest, "no_tip_or_fabric skip"

    # local fabric fill
    fab_ys, fab_xs = np.where(fabric)
    fab_cols = rgb[fabric]
    med = np.median(fab_cols, axis=0)
    out = rgb.copy()
    tip_ys, tip_xs = np.where(tip)
    for y, x in zip(tip_ys, tip_xs):
        # nearest fabric pixel color
        d2 = (fab_ys - y) ** 2 + (fab_xs - x) ** 2
        j = int(np.argmin(d2))
        if d2[j] < (28 * 28):
            out[y, x] = rgb[fab_ys[j], fab_xs[j]]
        else:
            out[y, x] = med
    # slight blur on patched region only
    patched = out.copy()
    for c in range(3):
        ch = out[:, :, c]
        blur = ndimage.uniform_filter(ch, size=3)
        ch2 = ch.copy()
        ch2[tip] = blur[tip]
        patched[:, :, c] = ch2
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(patched, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
    return dest, f"patched_tips={int(tip.sum())} fabric={int(fabric.sum())}"


def body_complete_ok(frame_path: Path) -> tuple[bool, str]:
    """Reject amputated / over-keyed bodies (too small or fragmented)."""
    rgb = np.asarray(Image.open(frame_path).convert("RGB")).astype(np.float32)
    dist = np.linalg.norm(rgb - KEY_RGB, axis=2)
    m = dist > 70.0
    area = float(m.mean())
    ys, xs = np.where(m)
    if len(ys) < 200:
        return False, f"too_few_px n={len(ys)}"
    h = float(ys.max() - ys.min() + 1) / m.shape[0]
    w = float(xs.max() - xs.min() + 1) / m.shape[1]
    # sleep should still occupy a large vertical plate
    ok = area >= 0.16 and h >= 0.55 and w >= 0.35
    return ok, f"area={area:.3f} bbox_h={h:.2f} bbox_w={w:.2f}"


def likeness_sleep_ok(src_gs: Path, frame_path: Path) -> tuple[bool, str]:
    """Looser occupancy (pose change) but keep subject color consistency."""
    a = np.asarray(Image.open(src_gs).convert("RGB")).astype(np.float32)
    b = np.asarray(Image.open(frame_path).convert("RGB")).astype(np.float32)
    if a.shape != b.shape:
        b_img = Image.open(frame_path).convert("RGB").resize(
            (a.shape[1], a.shape[0]), Image.Resampling.BILINEAR
        )
        b = np.asarray(b_img).astype(np.float32)

    def subject_mask(rgb: np.ndarray) -> np.ndarray:
        return np.linalg.norm(rgb - KEY_RGB, axis=2) > 70.0

    ma, mb = subject_mask(a), subject_mask(b)
    area_a, area_b = float(ma.mean()), float(mb.mean())
    if area_b < 0.14:
        return False, f"subject_too_small area_b={area_b:.3f}"
    if abs(area_b - area_a) > 0.55:
        return False, f"occupancy_shift a={area_a:.3f} b={area_b:.3f}"
    if ma.sum() < 100 or mb.sum() < 100:
        return False, "too_few_subject_pixels"
    ca = a[ma].mean(axis=0)
    cb = b[mb].mean(axis=0)
    d = float(np.linalg.norm(ca - cb))
    ok = d < 70.0
    return ok, f"subj_mean_dist={d:.1f} area_a={area_a:.3f} area_b={area_b:.3f}"


def sleep_pose_changed_ok(src_gs: Path, mid_frame: Path) -> tuple[bool, str]:
    """Reject clips that stay near-identical to standing keyscreen (no sleep)."""
    a = np.asarray(Image.open(src_gs).convert("RGB")).astype(np.float32)
    b = np.asarray(Image.open(mid_frame).convert("RGB")).astype(np.float32)
    if a.shape != b.shape:
        b = np.asarray(
            Image.open(mid_frame)
            .convert("RGB")
            .resize((a.shape[1], a.shape[0]), Image.Resampling.BILINEAR)
        ).astype(np.float32)

    def subject_mask(rgb: np.ndarray) -> np.ndarray:
        return np.linalg.norm(rgb - KEY_RGB, axis=2) > 70.0

    ma, mb = subject_mask(a), subject_mask(b)

    def bbox_stats(mask: np.ndarray) -> tuple[float, float, float]:
        ys, xs = np.where(mask)
        if len(ys) < 50:
            return 0.0, 0.0, 0.0
        h = float(ys.max() - ys.min() + 1) / mask.shape[0]
        w = float(xs.max() - xs.min() + 1) / mask.shape[1]
        return h, w, float(mask.mean())

    ha, wa, aa = bbox_stats(ma)
    hb, wb, ab = bbox_stats(mb)
    h_drop = ha - hb
    w_gain = wb - wa
    changed = (h_drop > 0.08) or (w_gain > 0.08) or (abs(ab - aa) > 0.08)
    detail = f"h={ha:.2f}->{hb:.2f} w={wa:.2f}->{wb:.2f} area={aa:.2f}->{ab:.2f}"
    return changed, detail


def build_workflow(
    input_name: str,
    out_prefix: str,
    prompt: str,
    seed: int,
    *,
    length: int,
    loop: bool,
) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = length
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    if loop:
        wf["104"]["inputs"]["last_frame"] = ["114", 0]
    else:
        wf["104"]["inputs"].pop("last_frame", None)
    wf["9"]["inputs"]["steps"] = STEPS
    return wf


def run_h3(
    input_name: str,
    out_leaf: str,
    prompt: str,
    seed: int,
    *,
    length: int,
    loop: bool,
) -> Path:
    t_start = time.time()
    wf = build_workflow(
        input_name, f"video/{out_leaf}", prompt, seed, length=length, loop=loop
    )
    res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
    prompt_id = res["prompt_id"]
    print(f"  prompt_id {prompt_id} length={length} loop={loop}", flush=True)
    m.wait_prompt(prompt_id)
    print(f"  h3 done in {time.time() - t_start:.1f}s", flush=True)
    out = m.find_latest_output(out_leaf, t_start)
    if out is None:
        raise RuntimeError("output mp4 not found")
    return out


def free_comfy_vram() -> None:
    """Best-effort VRAM cleanup between characters (avoids Errno 22 after long runs)."""
    try:
        m.api("/free", {"unload_models": False, "free_memory": True})
        print("  freed Comfy VRAM", flush=True)
    except Exception as e:
        print(f"  free VRAM warn: {e}", flush=True)
    time.sleep(2)


def process_one(stem: str, force: bool = False) -> dict:
    meta = CHARS[stem]
    name = meta["name"]
    src = SRC_DIR / f"{stem}_pifu02.png"
    final_webm = SRC_DIR / f"{stem}_pifu02_sleep.webm"
    gs_mp4 = SRC_DIR / f"{stem}_pifu02_sleep_gs_h3.mp4"
    stand_gs = SRC_DIR / f"{stem}_pifu02_sleep_stand_gs.png"
    sleep_gs = SRC_DIR / f"{stem}_pifu02_sleep_pose_gs.png"
    result = {"stem": stem, "name": name, "ok": False, "path": str(final_webm), "attempts": []}

    if not src.exists():
        result["error"] = "missing png"
        return result

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} {name} sleep webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    make_keyscreen(src, stand_gs)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(stand_gs, FIRST_DIR / stand_gs.name)
    stand_input = m.upload_image(stand_gs)
    shutil.copy2(stand_gs, m.COMFY_INPUT / stand_input)

    fabric = meta["fabric"]
    morph_prompt = build_sleep_prompt(meta["identity"], fabric, meta["pose"])
    breath_prompt = build_breath_prompt(meta["identity"], fabric, meta["pose"])
    qa_stem = QA_DIR / stem
    qa_stem.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = 2026082410 + (hash(stem) % 100000) + attempt * 181
        print(f"[{stem}] {name} sleep attempt {attempt}/{MAX_ATTEMPTS} seed={seed}", flush=True)
        try:
            # --- Pass A: morph standing → sleep (no last_frame lock) ---
            morph_leaf = f"{stem}_pifu02_sleep_morph"
            morph_mp4 = run_h3(
                stand_input,
                morph_leaf,
                morph_prompt,
                seed,
                length=LENGTH_MORPH,
                loop=False,
            )
            shutil.copy2(morph_mp4, qa_stem / f"a{attempt}_morph.mp4")
            mid_t = (LENGTH_MORPH / 24.0) * 0.55
            mid = m.extract_frame(morph_mp4, mid_t, qa_stem / f"a{attempt}_morph_mid.png")
            ok_pose, det_pose = sleep_pose_changed_ok(stand_gs, mid)
            print(f"  QA morph_pose: {'PASS' if ok_pose else 'FAIL'} {det_pose}", flush=True)
            if not ok_pose:
                result["attempts"].append(
                    {"attempt": attempt, "seed": seed, "ok": False, "stage": "morph", "det": det_pose}
                )
                continue

            ok_fab_m, det_fab_m = fabric_lock_ok(stand_gs, mid, fabric)
            print(f"  QA fabric_morph: {'PASS' if ok_fab_m else 'FAIL'} {det_fab_m}", flush=True)
            if not ok_fab_m:
                result["attempts"].append(
                    {
                        "attempt": attempt,
                        "seed": seed,
                        "ok": False,
                        "stage": "fabric_morph",
                        "det": det_fab_m,
                    }
                )
                continue

            # Gate nipples on morph mid BEFORE writing plate / starting video
            ok_nip_mid, det_nip_mid = no_nipple_leak_ok(mid, stand_gs)
            print(f"  QA no_nipple_morph: {'PASS' if ok_nip_mid else 'FAIL'} {det_nip_mid}", flush=True)
            if not ok_nip_mid:
                result["attempts"].append(
                    {
                        "attempt": attempt,
                        "seed": seed,
                        "ok": False,
                        "stage": "nipple_leak_morph",
                        "det": det_nip_mid,
                    }
                )
                continue

            frame_to_sleep_keyscreen(mid, sleep_gs)
            ok_body, det_body = body_complete_ok(sleep_gs)
            print(f"  QA body_plate: {'PASS' if ok_body else 'FAIL'} {det_body}", flush=True)
            if not ok_body:
                if sleep_gs.exists():
                    sleep_gs.unlink()
                result["attempts"].append(
                    {
                        "attempt": attempt,
                        "seed": seed,
                        "ok": False,
                        "stage": "body_plate",
                        "det": det_body,
                    }
                )
                continue

            ok_nip, det_nip = no_nipple_leak_ok(sleep_gs, stand_gs, after_chroma=True)
            print(f"  QA no_nipple_plate: {'PASS' if ok_nip else 'FAIL'} {det_nip}", flush=True)
            if not ok_nip:
                # Do not keep a leaky plate on disk for the next video pass / human glance
                leak_bak = qa_stem / f"a{attempt}_nipple_reject_pose_gs.png"
                shutil.move(str(sleep_gs), str(leak_bak))
                result["attempts"].append(
                    {
                        "attempt": attempt,
                        "seed": seed,
                        "ok": False,
                        "stage": "nipple_leak_plate",
                        "det": det_nip,
                    }
                )
                continue

            # Plate passed — safe to generate breath video (no video nipple re-QA)
            sleep_input = m.upload_image(sleep_gs)
            shutil.copy2(sleep_gs, m.COMFY_INPUT / sleep_input)

            # --- Pass B: breathing loop from sleep plate ---
            loop_leaf = f"{stem}_pifu02_sleep_gs"
            loop_mp4 = run_h3(
                sleep_input,
                loop_leaf,
                breath_prompt,
                seed + 17,
                length=LENGTH,
                loop=True,
            )
            shutil.copy2(loop_mp4, qa_stem / f"a{attempt}_loop.mp4")

            f0 = m.extract_frame(loop_mp4, 0.3, qa_stem / f"a{attempt}_t030.png")
            f1 = m.extract_frame(loop_mp4, 2.0, qa_stem / f"a{attempt}_t200.png")
            f2 = m.extract_frame(loop_mp4, 3.6, qa_stem / f"a{attempt}_t360.png")
            checks = []
            for fp, label in ((f0, "t0.3"), (f1, "t2.0"), (f2, "t3.6")):
                ok_k, det_k = sleep_key_ok(fp)
                checks.append((f"key[{label}]", bool(ok_k), str(det_k)))
                ok_v, det_v = sleep_void_ok(fp)
                checks.append((f"void[{label}]", bool(ok_v), str(det_v)))
                ok_b, det_b = body_complete_ok(fp)
                checks.append((f"body[{label}]", bool(ok_b), str(det_b)))
            ok_l, det_l = likeness_sleep_ok(sleep_gs, f0)
            checks.append(("likeness", bool(ok_l), str(det_l)))
            ok_fab, det_fab = fabric_lock_ok(stand_gs, f1, fabric)
            checks.append(("fabric", bool(ok_fab), str(det_fab)))
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if not all(ok for _, ok, _ in checks):
                result["attempts"].append(
                    {"attempt": attempt, "seed": seed, "ok": False, "stage": "loop", "checks": checks}
                )
                continue

            shutil.copy2(loop_mp4, gs_mp4)
            gs_mp4_to_webm(gs_mp4, final_webm, fps=24.0, vf=SLEEP_WEBM_VF)
            # durable backups — final webms have gone missing mid-batch before
            bak_dir = QA_DIR / "accepted"
            bak_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(final_webm, bak_dir / final_webm.name)
            shutil.copy2(final_webm, qa_stem / f"{stem}_pifu02_sleep.webm.bak")
            result["ok"] = True
            result["attempts"].append(
                {"attempt": attempt, "seed": seed, "ok": True, "mp4": str(gs_mp4)}
            )
            print(
                f"  ACCEPTED -> {final_webm} ({final_webm.stat().st_size // 1024} KB)",
                flush=True,
            )
            return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append(
                {"attempt": attempt, "seed": seed, "ok": False, "error": str(e)}
            )
            time.sleep(5)

    print(f"[FAIL] {stem} {name} after {MAX_ATTEMPTS} attempts", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all", help="artStem or all")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    print("=== pifu02 sleep loop H3 batch (2-pass morph+breath) ===", flush=True)
    print(f"SRC: {SRC_DIR}", flush=True)
    print(
        f"spec: {WIDTH}x{HEIGHT} morph={LENGTH_MORPH} loop={LENGTH} (~4.0s)",
        flush=True,
    )
    m.api("/system_stats")

    stems = list(CHARS.keys()) if args.stem == "all" else [args.stem]
    if args.stem == "all":
        stems = [s for s in stems if s not in SKIP_STEMS]
        if SKIP_STEMS:
            print(f"skipping (deferred): {', '.join(sorted(SKIP_STEMS))}", flush=True)
    if args.stem != "all" and args.stem not in CHARS:
        print(f"unknown stem: {args.stem}", file=sys.stderr)
        return 2

    results = []
    for stem in stems:
        r = process_one(stem, force=args.force)
        results.append(r)
        if not r.get("skipped"):
            free_comfy_vram()
    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
    }
    report = QA_DIR / "pifu02_sleep_batch_report.json"

    def _jsonable(obj):
        if isinstance(obj, dict):
            return {k: _jsonable(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [_jsonable(x) for x in obj]
        if isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        return obj

    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps(
            {"summary": summary, "results": _jsonable(results)},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("=== SUMMARY ===", flush=True)
    print("OK:", ", ".join(summary["ok"]) or "(none)", flush=True)
    print("FAIL:", ", ".join(summary["fail"]) or "(none)", flush=True)
    print("report:", report, flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
