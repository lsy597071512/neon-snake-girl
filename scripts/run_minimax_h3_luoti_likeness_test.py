"""Likeness regen test: default-skin face+cyber lock → nude idle (H3).

Why not reuse shower/QA frames as first_frame:
  - faces drifted from default portraits
  - cyber limbs often wrong vs default armor layout
  - body proportions exaggerated vs characters.ts measurements

Test set = stems under luoti_daiji/_pre_upscale_bak/_qa/
First frame = default portrait maximized on #00b140
H3 = remove weapon/clothes → nude idle, keep face/hair/cyber 1:1, lock measurements
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"
spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

QA_TEST = ROOT / "tex/juese/pifu/chongzao/luoti_daiji/_pre_upscale_bak/_qa"
OUT = ROOT / "tex/juese/pifu/chongzao/luoti_daiji/_likeness_test"
GREEN = np.array([0, 177, 64], dtype=np.float32)
FW, FH = 768, 1344
LENGTH = 100  # ~4.2s
STEPS = 24

# artStem → game stats + DEFAULT-skin cyber lock (from tex/juese/{stem}.png + characters.ts)
CHARS: dict[str, dict[str, str]] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "measure": "height 168cm, bust-waist-hip B88/W59/H86 (athletic slim hourglass, NOT exaggerated)",
        "face": (
            "ash-blonde/beige high ponytail with straight bangs and chin-length side locks, "
            "two metallic silver wing-fin hair clips at sides of head, large pale icy blue-grey eyes, "
            "delicate youthful face, small neutral mouth, calm focused expression — EXACT default portrait face"
        ),
        "cyber": (
            "RIGHT arm: bulky dark blue-grey power armor with gold/bronze joints and glowing cyan Z mark on shoulder; "
            "LEFT arm: slender white/silver segmented robotic prosthetic; "
            "BOTH legs from mid-thigh: white/grey/gold mechanical prosthetics with pointed digitigrade cyber heels; "
            "optional thin white back cables/fins. NO rifle, NO clothes"
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "measure": "height 162cm, B84/W56/H82 (compact slim)",
        "face": (
            "messy short silver-white hair with faint cool tips, thin red headband, pale blue eyes, "
            "sharp serious youthful face — EXACT default portrait face"
        ),
        "cyber": (
            "glossy white mecha plating on arms and legs with black joints and small red CAUTION accents, "
            "white high-heeled mech boots with black blade-like heel fins and red accents"
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "measure": "height 166cm, B90/W60/H88 (soft fuller bust, gentle waist)",
        "face": (
            "long wavy ash-blonde hair with bangs, teal aquamarine eyes, gentle warm youthful face — "
            "EXACT default portrait face"
        ),
        "cyber": (
            "translucent glowing halo/ear headset modules, grey-gold mechanical collar, "
            "white/grey/gold mechanical right arm, partial thigh/shin armor plates, matching mechanical high-heel boots"
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "measure": "height 167cm, B87/W57/H85 (slim long-legged)",
        "face": (
            "very long straight silver-grey hair with darker charcoal bang streak, glowing amber-orange eyes, "
            "cool distant face — EXACT default portrait face"
        ),
        "cyber": (
            "bulky mechanical headset with sharp yellow-tipped blade antenna, faint glowing shoulder mark, "
            "thin black cyber line on thigh; barefoot OK"
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "measure": "height 170cm, B92/W61/H90 (taller fuller bust)",
        "face": (
            "long jet-black high ponytail, amber-orange eyes, calm serious face — EXACT default portrait face"
        ),
        "cyber": (
            "white/orange/dark cybernetic arm plating with orange shoulder plate marked MB-02, "
            "elaborate white-orange-charcoal mechanical legs"
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "measure": "height 165cm, B85/W57/H84",
        "face": (
            "long white/silver hair, large white feline/fox mechanical ears with yellow-black accents, "
            "amber-gold eyes, black/yellow cybernetic respirator covering lower face — EXACT default portrait face"
        ),
        "cyber": "white-silver mechanical hands and feet with yellow accents and panel lines",
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "measure": "height 169cm, B89/W59/H87",
        "face": (
            "long straight jet-black hair with two small glowing cyan-green triangular clips, "
            "glowing crimson eyes, black choker, cold youthful face — EXACT default portrait face"
        ),
        "cyber": (
            "matte black left arm prosthetic with green light panels, olive/charcoal mechanical right lower leg "
            "with cyan accents, translucent pinkish heels"
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "measure": "height 165cm, B85/W57/H84",
        "face": (
            "long silver-grey hair with tech hair plates, luminous neon-green eyes — EXACT default portrait face"
        ),
        "cyber": (
            "silver/white cybernetic armor plates on shoulders/arms/legs with glowing green accents, "
            "pointed cybernetic heel boots (NO large wing thrusters in nude idle)"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "measure": "height 158cm, B82/W55/H80 (petite)",
        "face": (
            "long voluminous wavy pastel blue-lavender hair, soft pink eyes, gentle soft face — "
            "EXACT default portrait face"
        ),
        "cyber": "white-gold mechanical boots / integrated cyber leg shells with red heel glow; no full bodysuit shell",
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "measure": "height 163cm, B88/W58/H86",
        "face": (
            "dusty pink/mauve hair with long bangs, reddish-pink eyes, large glossy black angular robotic ears/horns — "
            "EXACT default portrait face"
        ),
        "cyber": (
            "polished black left arm prosthetic with red accents, black robotic glove on right hand optional, "
            "glossy black/red cybernetic legs with heel structure"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "measure": "height 166cm, B86/W58/H85",
        "face": (
            "orange twin-tails, amber eyes, teal forehead accessory, calm face — EXACT default portrait face"
        ),
        "cyber": "white glossy mechanical thigh-high boots with red/blue accents, silver arm band",
    },
    "UR03_1": {
        "name": "光轮·天音",
        "measure": "height 170cm, B86/W56/H84",
        "face": (
            "long straight black hair with vivid pink underside/bang highlights, reddish-brown eyes, "
            "large metallic tech headphones — EXACT default portrait face"
        ),
        "cyber": (
            "thick mechanical collar, transparent glass-shell left leg prosthetic revealing golden gears "
            "with green glow accents"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "measure": "height 160cm, B84/W56/H83",
        "face": (
            "short messy light-blue hair with pink highlights, light-blue headband with pink flower, black X hairpins, "
            "purple-pink eyes, large white-pink bunny ears — EXACT default portrait face"
        ),
        "cyber": "white-silver mechanical legs from mid-thigh with orange heart/diamond accents, silver left bicep band",
    },
}


def default_path(stem: str) -> Path:
    return ROOT / "tex" / "juese" / f"{stem}.png"


def make_default_first_frame(stem: str, dest: Path) -> Path:
    src = default_path(stem)
    if not src.exists():
        raise FileNotFoundError(src)
    char = Image.open(src).convert("RGBA")
    a = np.asarray(char)
    mask = a[:, :, 3] > 16
    ys, xs = np.where(mask)
    pad = 4
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(char.width, int(xs.max()) + 1 + pad), min(char.height, int(ys.max()) + 1 + pad)
    char = char.crop((l, t, r, b))
    margin = 0.01
    max_w, max_h = int(FW * (1 - 2 * margin)), int(FH * (1 - 2 * margin))
    scale = min(max_w / char.width, max_h / char.height)
    # prefer filling height for portrait plates
    scale = max(scale, max_h / char.height * 0.98)
    cw, ch = max(1, int(char.width * scale)), max(1, int(char.height * scale))
    char2 = char.resize((cw, ch), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (FW, FH), (0, 177, 64, 255))
    x, y = (FW - cw) // 2, (FH - ch) // 2
    if ch > FH:
        y = FH - ch  # keep feet
    canvas.alpha_composite(char2, (x, y))
    arr = np.asarray(canvas).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3]
    green = np.broadcast_to(GREEN, rgb.shape)
    out = rgb * alpha + green * (1.0 - alpha)
    # flatten near-green fringe
    d = np.linalg.norm(out - GREEN, axis=2)
    out[d < 28] = GREEN
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, "PNG")
    shutil.copy2(dest, m.COMFY_INPUT / dest.name)
    print(f"  first_frame {dest.name} {cw}x{ch}", flush=True)
    return dest


def build_prompt(stem: str) -> str:
    c = CHARS[stem]
    return f"""Professional film-set chroma key character plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, 8K resolution look.

FRAMING: character fills almost the ENTIRE vertical frame — MAXIMUM screen occupancy. Head near top, feet near bottom. Locked tripod camera, no pan/tilt/zoom/drift.

CRITICAL IDENTITY LOCK from first frame (must remain 1:1, do not redesign):
FACE/HAIR: {c['face']}
CYBER BODY PARTS: {c['cyber']}
BODY PROPORTIONS: {c['measure']}

THIS IS A LIKENESS CORRECTION + NUDE IDLE PLATE for adult female anime game character {c['name']}.
ACTION timeline (~4 seconds), natural continuous motion:
[0.0-1.2s] Remove ANY weapons/rifles/guns completely out of frame. Remove ALL clothing fabric (tops, shorts, armor cloth, towels, skirts) so torso and hips are fully nude skin. Keep ONLY the cybernetic limbs/boots/headset/ears/mask listed above.
[1.2-2.8s] Adjust body silhouette to the exact proportions above (correct bust/waist/hip — not exaggerated). Settle into natural relaxed standing IDLE: balanced stance, arms at sides or soft idle hands, calm neutral expression looking forward, normal blinking. Skin dry/clean.
[2.8-4.2s] Hold the nude idle pose with only subtle breathing. Face must stay identical to the first-frame default portrait. Hair style and cyber parts unchanged.

Keep pure flat #00b140 green everywhere behind the subject: no floor, no tiles, no shadow catcher, no vignette, no text, no UI.
Ultra-detailed 2D anime game art matching the first-frame face exactly, sharp focus.

Audio: soft room tone only, no speech, no music.
"""


def rematte_rgba(frame: Path, dest: Path) -> Path:
    """Soft chroma key #00b140 → transparent PNG (keep character)."""
    from scipy import ndimage

    rgb = np.asarray(Image.open(frame).convert("RGB")).astype(np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    dist = np.linalg.norm(rgb - GREEN, axis=2)
    dom = g - np.maximum(r, b)
    by_dist = 1.0 - np.clip((dist - 26.0) / 42.0, 0, 1)
    by_dom = np.clip((dom - 8.0) / 40.0, 0, 1)
    screen = np.clip(by_dist * by_dom, 0, 1)
    screen = np.where((dist < 32) & (dom > 18), 1.0, screen)
    alpha = np.clip(1.0 - screen, 0, 1)
    alpha = np.where(alpha < 0.03, 0.0, alpha)
    edge = ndimage.binary_dilation(alpha < 0.12, iterations=4) & (alpha > 0.02)
    rb = 0.5 * (r + b)
    excess = np.clip(g - rb - 2, 0, 255)
    w = np.zeros_like(alpha)
    w[edge] = np.clip(0.55 + excess[edge] / 60, 0.55, 1)
    g2 = g - excess * w
    out = np.stack([r, g2, b], axis=2) * alpha[..., None]
    rgba = np.clip(np.dstack([out, alpha * 255]), 0, 255).astype(np.uint8)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(dest, "PNG", optimize=True)
    return dest


def cover_fit_rgba(src: Path, dest: Path, ow: int = 1440, oh: int = 2560) -> Path:
    im = Image.open(src).convert("RGBA")
    arr = np.asarray(im)
    mask = arr[:, :, 3] > 24
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError("empty after key")
    pad = 2
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(im.width, int(xs.max()) + 1 + pad), min(im.height, int(ys.max()) + 1 + pad)
    crop = im.crop((l, t, r, b))
    scale = max(ow / crop.width, oh / crop.height)
    cw, ch = max(1, int(crop.width * scale + 0.5)), max(1, int(crop.height * scale + 0.5))
    char = crop.resize((cw, ch), Image.Resampling.LANCZOS)
    left, top = (cw - ow) // 2, (ch - oh) // 2
    if ch > oh:
        top = min(max(0, int(ch * 0.08)), ch - oh)
    out = char.crop((left, top, left + ow, top + oh))
    out.save(dest, "PNG", optimize=True)
    return dest


def process_one(stem: str) -> Path:
    meta = CHARS[stem]
    print(f"=== {stem} {meta['name']} ===", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    first = OUT / f"{stem}_default_first_h3.png"
    make_default_first_frame(stem, first)
    input_name = m.upload_image(first)
    shutil.copy2(first, m.COMFY_INPUT / input_name)

    prompt = build_prompt(stem)
    out_leaf = f"{stem}_luoti_likeness"
    out_prefix = f"video/{out_leaf}"
    seed = 2026081520 + (hash(stem) % 40000)
    print(f"  seed={seed}", flush=True)
    t0 = time.time()
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["length"] = LENGTH
    wf["104"]["inputs"]["width"] = FW
    wf["104"]["inputs"]["height"] = FH
    if "steps" in wf.get("105", {}).get("inputs", {}):
        wf["105"]["inputs"]["steps"] = STEPS
    # some workflows use node 103/105 for steps — patch common keys
    for nid, node in wf.items():
        if isinstance(node, dict) and node.get("class_type") == "MiniMaxH3ImageToVideo":
            node["inputs"]["length"] = LENGTH
            node["inputs"]["width"] = FW
            node["inputs"]["height"] = FH
        if isinstance(node, dict) and "steps" in node.get("inputs", {}):
            if node["class_type"] in ("KSampler", "MiniMaxH3Sampler", "RandomNoise"):
                pass
            if "steps" in node["inputs"] and node["class_type"].startswith("MiniMax"):
                node["inputs"]["steps"] = STEPS

    res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
    pid = res["prompt_id"]
    print("  prompt_id", pid, flush=True)
    m.wait_prompt(pid)
    print(f"  done in {time.time()-t0:.1f}s", flush=True)
    mp4 = m.find_latest_output(out_leaf, t0)
    if mp4 is None:
        raise RuntimeError("mp4 missing")
    shutil.copy2(mp4, OUT / f"{stem}_likeness.mp4")

    # extract late frames, pick least-cloth
    best_path = None
    best_score = 1e9
    for t in (2.8, 3.2, 3.6, 3.9):
        tmp = OUT / f"{stem}_t{t:.1f}.png"
        subprocess.run(
            [m.FFMPEG, "-y", "-ss", str(t), "-i", str(mp4), "-frames:v", "1", "-update", "1", "-q:v", "2", str(tmp)],
            check=True,
            capture_output=True,
        )
        im = np.asarray(Image.open(tmp).convert("RGB")).astype(np.float32)
        h, w, _ = im.shape
        torso = im[int(h * 0.28) : int(h * 0.62), int(w * 0.25) : int(w * 0.75)]
        dist = np.linalg.norm(torso - GREEN, axis=2)
        px = torso[dist > 55]
        if len(px) < 40:
            continue
        white = float(((px[:, 0] > 200) & (px[:, 1] > 200) & (px[:, 2] > 200)).mean())
        if white < best_score:
            best_score = white
            best_path = tmp
    if best_path is None:
        raise RuntimeError("no good frame")
    print(f"  pick {best_path.name} white={best_score:.3f}", flush=True)

    keyed = OUT / f"{stem}_likeness_keyed.png"
    rematte_rgba(best_path, keyed)
    final = OUT / f"{stem}_luoti_daiji_likeness.png"
    cover_fit_rgba(keyed, final)
    # side-by-side compare head: default vs result vs old qa
    make_compare(stem, final)
    return final


def make_compare(stem: str, result: Path) -> None:
    default = default_path(stem)
    qa = next((QA_TEST / stem).glob("*.png"), None)
    imgs = []
    for p, label in [(default, "default"), (qa, "old_qa"), (result, "new")]:
        if p is None or not Path(p).exists():
            continue
        im = Image.open(p).convert("RGBA")
        h = 720
        w = max(1, int(im.width * h / im.height))
        im = im.resize((w, h), Image.Resampling.LANCZOS)
        a = np.asarray(im).astype(np.float32)
        yy, xx = np.mgrid[0:h, 0:w]
        chk = np.where(((xx // 12) + (yy // 12)) % 2 == 0, 210.0, 150.0)
        al = a[:, :, 3:4] / 255.0
        rgb = a[:, :, :3] * al + chk[..., None] * (1 - al)
        imgs.append(Image.fromarray(rgb.astype(np.uint8)))
    if not imgs:
        return
    total_w = sum(i.width for i in imgs) + 16 * (len(imgs) - 1)
    canvas = Image.new("RGB", (total_w, 720), (24, 24, 24))
    x = 0
    for im in imgs:
        canvas.paste(im, (x, 0))
        x += im.width + 16
    canvas.save(OUT / f"{stem}_compare.png")
    print(f"  compare → {stem}_compare.png", flush=True)


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="SR01_2", help="art stem or 'all'")
    args = ap.parse_args()
    stems = sorted(CHARS.keys()) if args.stem == "all" else [args.stem]
    for stem in stems:
        if stem not in CHARS:
            raise SystemExit(f"unknown stem {stem}")
        if not (QA_TEST / stem).exists():
            print(f"skip {stem}: not in QA test set", flush=True)
            continue
        process_one(stem)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
