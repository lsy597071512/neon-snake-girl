"""H3: shower-likeness → nude NORMAL idle stills (no shower action/props), max occupancy, GS #00b140.

Why H3 (not cloud/local inpaint):
- Cursor/DashScope image edit blocks nude
- Comfy Flux* API nodes need Comfy.org login; no local SD checkpoint for inpaint
- MiniMax H3 already locks identity from first_frame + green screen well

Pipeline per character:
1) Take nude frame from shower H3 video (~4s)
2) Rematte + maximize subject occupancy on 768x1344 first frame
3) H3 I2V: put away shower gear → settle nude idle (not bathing)
4) Extract late frame, rematte, upscale to 1440x2560 → luoti_daiji/{stem}_luoti_daiji.png
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

OUT_DIR = m.SRC_DIR / "luoti_daiji"
REFS = OUT_DIR / "_refs"
QA = OUT_DIR / "_qa"
GREEN = np.array([0, 177, 64], dtype=np.float32)
FW, FH = 768, 1344  # H3 native
OW, OH = 1440, 2560  # ~2K 9:16 deliverable
LENGTH = 124  # ~5.17s @24fps
STEPS = 20
MAX_ATTEMPTS = 3

# Nude idle identity locks — DO NOT mention towel/bodysuit/clothes (H3 will keep them)
IDENTITIES = {
    "SR01_2": (
        "ash-blonde high ponytail with metallic white wing-fin hair clips, light blue eyes, pale skin, "
        "NUDE torso, dark gray cybernetic right arm with gold accents, white/gray cybernetic right leg prosthetic "
        "and matching left cyber boot"
    ),
    "SR01_3": (
        "messy short silver-white hair with red headband, pale blue eyes, NUDE pale skin torso, "
        "glossy white mecha arms and legs with black joints and red accents, red fin-like mechanical heels"
    ),
    "SR02_1": (
        "long wavy ash-blonde hair, teal aquamarine eyes, translucent glowing halo headset, grey-gold mechanical collar, "
        "NUDE torso, white/grey/gold mechanical right arm, mechanical high-heel boots"
    ),
    "SR03_1": (
        "very long straight silver-grey hair with darker charcoal bang streak, glowing amber-orange eyes, "
        "bulky mechanical headset with yellow-tipped blade antenna, NUDE body, barefoot"
    ),
    "SR04_1": (
        "long jet-black high ponytail, amber-orange eyes, NUDE torso, white/orange/dark cybernetic arms with "
        "orange shoulder plate marked MB-02, elaborate white-orange-charcoal mechanical legs"
    ),
    "SR05_1": (
        "long white hair, large white feline ears with yellow-black mechanical accents, amber-gold eyes, "
        "black/yellow cybernetic respirator on lower face, NUDE torso, white-silver mechanical hands and feet"
    ),
    "SSR01_1": (
        "long straight jet-black hair with two small glowing cyan-green triangular clips, glowing crimson eyes, "
        "black choker, NUDE torso, matte black left arm prosthetic with green light panels, olive/charcoal mechanical "
        "right lower leg with cyan accents, translucent pinkish heels"
    ),
    "SSR02_1": (
        "long silver-grey hair with tech hair plates, luminous green eyes, NUDE torso, silver/white cybernetic armor "
        "plates on shoulders arms and legs with glowing green accents, pointed cybernetic heel boots"
    ),
    "SSR03_1": (
        "long voluminous wavy pastel blue-lavender hair, soft pink eyes, pale NUDE skin body with NO bodysuit and NO towel, "
        "white-gold mechanical boots with red heel glow only — torso and hips fully nude"
    ),
    "SSR04_1": (
        "dusty pink/mauve hair with long bangs, reddish-pink eyes, large glossy black angular robotic ears, "
        "NUDE torso, polished black left arm prosthetic with red accents, glossy black/red cybernetic legs"
    ),
    "SSR05_1": (
        "orange twin-tail anime girl with amber eyes, teal forehead accessory, NUDE torso, "
        "white glossy mechanical thigh-high boots with red/blue accents, silver arm band"
    ),
    "UR03_1": (
        "long straight black hair with vivid pink underside highlights, reddish-brown eyes, "
        "large metallic tech headphones and thick mechanical collar, NUDE torso, transparent glass-shell left leg prosthetic"
    ),
    "UR04_1": (
        "short messy light-blue hair with pink highlights, light-blue headband with pink flower, black X hairpins, "
        "purple-pink eyes, large white-pink bunny ears, NUDE torso with NO towel, white-silver mechanical legs from mid-thigh "
        "with orange heart/diamond accents, silver left bicep band"
    ),
}
# Prefer cybernetic boots kept as body parts; fully nude otherwise
IDLE_EXTRA = {
    "SSR03_1": "keep white-gold mechanical boots / integrated cyber leg shells only",
    "SSR05_1": "keep white glossy mechanical thigh-high boots with red/blue accents and silver arm band",
    "SR01_2": "keep dark gray cyber right arm and white/gray cyber legs/boots",
    "SR01_3": "keep glossy white mecha arms/legs and red fin heels",
    "SR02_1": "keep white/grey/gold mechanical right arm, collar, headset, mechanical boots",
    "SR04_1": "keep white/orange cyber arm plating MB-02 and mechanical legs",
    "SR05_1": "keep feline ears, respirator mask, white-silver mechanical hands/feet",
    "SSR01_1": "keep black left arm prosthetic, olive mechanical right lower leg, pinkish heels",
    "SSR02_1": "keep silver/white cyber plates and pointed cyber heel boots",
    "SSR04_1": "keep black robotic ears, black/red cyber arm and legs",
    "UR03_1": "keep headphones, collar, transparent glass-shell left leg prosthetic",
    "UR04_1": "keep bunny ears, white-silver mechanical legs with orange accents, silver bicep band",
    "SR03_1": "keep bulky headset with yellow antenna; barefoot OK",
}


def subject_mask(rgb: np.ndarray) -> np.ndarray:
    dist = np.linalg.norm(rgb.astype(np.float32) - GREEN, axis=2)
    return dist > 55.0


def maximize_on_canvas(src: Path, dest: Path, tw: int = FW, th: int = FH, margin: float = 0.005) -> Path:
    im = Image.open(src).convert("RGB")
    arr = np.asarray(im)
    mask = subject_mask(arr)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError(f"no subject: {src}")
    pad = 4
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(im.width, int(xs.max()) + 1 + pad), min(im.height, int(ys.max()) + 1 + pad)
    crop = im.crop((l, t, r, b))
    # near-cover: fill vertical frame aggressively
    max_w, max_h = int(tw * (1 - 2 * margin)), int(th * (1 - 2 * margin))
    scale = max(max_w / crop.width, max_h / crop.height)
    cw, ch = max(1, int(crop.width * scale + 0.5)), max(1, int(crop.height * scale + 0.5))
    char = crop.resize((cw, ch), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (tw, th), (0, 177, 64))
    x, y = (tw - cw) // 2, (th - ch) // 2
    # if oversized, center-crop onto canvas via paste negative offsets
    canvas.paste(char, (x, y))
    a = np.asarray(canvas).astype(np.float32)
    d = np.linalg.norm(a - GREEN, axis=2)
    a[d < 50] = GREEN
    out = Image.fromarray(a.astype(np.uint8))
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG")
    occ = float((d >= 50).mean() * 100)
    print(f"  first_frame {dest.name} non_green≈{occ:.1f}% paste={cw}x{ch}", flush=True)
    return dest


def ensure_nude_ref(stem: str, force: bool = False) -> Path:
    REFS.mkdir(parents=True, exist_ok=True)
    ref = REFS / f"{stem}_shower_nude_ref.png"
    vid = m.SRC_DIR / f"{stem}_pifu03_shower_gs_h3.mp4"
    if force and ref.exists():
        ref.unlink()
    if not ref.exists() or ref.stat().st_size < 10_000:
        if not vid.exists():
            raise FileNotFoundError(vid)
        # pick least-white torso among late frames
        best = None
        best_score = 1e9
        tmp = REFS / f"_tmp_{stem}.png"
        for t in (4.5, 5.0, 5.3, 5.6):
            subprocess.run(
                [m.FFMPEG, "-y", "-ss", str(t), "-i", str(vid), "-frames:v", "1", "-update", "1", "-q:v", "2", str(tmp)],
                check=True,
                capture_output=True,
            )
            im = np.asarray(Image.open(tmp).convert("RGB")).astype(np.float32)
            h, w, _ = im.shape
            torso = im[int(h * 0.28) : int(h * 0.62), int(w * 0.25) : int(w * 0.75)]
            dist = np.linalg.norm(torso - GREEN, axis=2)
            px = torso[dist > 55]
            if len(px) < 50:
                continue
            white = float(
                ((px[:, 0] > 200) & (px[:, 1] > 200) & (px[:, 2] > 200) & (np.abs(px[:, 0] - px[:, 1]) < 18)).mean()
            )
            if white < best_score:
                best_score = white
                best = t
                Image.open(tmp).save(ref, "PNG")
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        if best is None:
            raise RuntimeError(f"failed to extract nude ref for {stem}")
        print(f"  nude_ref t={best} white={best_score:.3f}", flush=True)
    return ref


def build_idle_prompt(stem: str) -> str:
    identity = IDENTITIES[stem]
    extra = IDLE_EXTRA.get(stem, "keep cybernetic body parts from reference exactly")
    return f"""Professional film-set chroma key character plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution look.

FRAMING: character fills almost the ENTIRE vertical frame — MAXIMUM screen occupancy. Head near top edge, feet near bottom edge. Do not shrink the subject, no pull-out, no empty headroom, no letterboxing.

LOCKED identity from first frame: {identity}. Fully nude adult female anime character. {extra}.

CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. Framing identical throughout.

THIS IS NOT A SHOWER SCENE. No bathing action, no bathroom set.
ACTION timeline (~5 seconds), natural continuous motion:
[0.0-1.5s] She lowers and moves any shower head and hose completely out of frame; water spray, droplets streams, and steam STOP and disappear. She also discards ANY remaining towel / fabric / bodysuit / underwear so NOTHING fabric remains.
[1.5-3.5s] She settles into a natural relaxed standing IDLE pose: balanced stance, arms comfortably at sides or soft idle hand pose, calm neutral expression looking forward, normal blinking. Skin looks dry/clean (no active water streams). Body is FULLY NUDE.
[3.5-5.2s] Holds the nude idle pose with only subtle natural breathing and tiny body sway. Absolutely no shower head, no hose, no water, no towel, no mist, no clothes, no bodysuit, no logos.

CRITICAL: final frames must be completely nude — zero cloth coverage on chest/hips. Keep only mechanical prosthetics/boots/headset/ears/mask that are body parts.

Keep pure flat #00b140 green everywhere behind the subject: no floor, no tiles, no shadow catcher, no vignette. Ultra-detailed anime game art, sharp focus, no blur, clear anatomy.

Audio: soft room tone only, no water, no speech, no music.
"""


def deliverable_from_frame(frame: Path, dest: Path) -> Path:
    im = Image.open(frame).convert("RGB")
    arr = np.asarray(im)
    mask = subject_mask(arr)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError("empty subject in frame")
    pad = 2
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(im.width, int(xs.max()) + 1 + pad), min(im.height, int(ys.max()) + 1 + pad)
    crop = im.crop((l, t, r, b))
    # COVER fit: fill the entire 9:16 canvas (may crop edges slightly)
    scale = max(OW / crop.width, OH / crop.height)
    cw, ch = max(1, int(crop.width * scale + 0.5)), max(1, int(crop.height * scale + 0.5))
    char = crop.resize((cw, ch), Image.Resampling.LANCZOS)
    left, top = (cw - OW) // 2, (ch - OH) // 2
    # bias crop downward so feet stay in frame when tall
    if ch > OH:
        top = min(max(0, int(ch * 0.08)), ch - OH)
    canvas = char.crop((left, top, left + OW, top + OH))
    a = np.asarray(canvas).astype(np.float32)
    d = np.linalg.norm(a - GREEN, axis=2)
    a[d < 52] = GREEN
    out = Image.fromarray(a.astype(np.uint8))
    out = out.filter(ImageFilter.UnsharpMask(radius=1.1, percent=75, threshold=2))
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    # occupancy of non-green pixels
    occ = float((d >= 52).mean() * 100)
    print(f"  deliverable {dest.name} non_green≈{occ:.1f}%", flush=True)
    return dest


def shower_prop_score(frame: Path) -> float:
    """Heuristic: lower is better (less bright silver blob / cyan spray)."""
    im = np.asarray(Image.open(frame).convert("RGB")).astype(np.float32)
    # upper-right / upper-center often holds shower head
    h, w, _ = im.shape
    zone = im[: int(h * 0.45), int(w * 0.25) : int(w * 0.95)]
    # metallic bright
    bright = ((zone[:, :, 0] > 180) & (zone[:, :, 1] > 180) & (zone[:, :, 2] > 180)).mean()
    # water-ish cyan lines
    cyan = ((zone[:, :, 1] > zone[:, :, 0] + 20) & (zone[:, :, 2] > zone[:, :, 0] + 10) & (zone[:, :, 1] > 140)).mean()
    return float(bright * 2.0 + cyan * 3.0)


def process_one(stem: str, force_ref: bool = False) -> bool:
    print(f"=== {stem} {m.CHARACTERS[stem]['name']} ===", flush=True)
    ref = ensure_nude_ref(stem, force=force_ref)
    first = OUT_DIR / f"{stem}_luoti_first_h3.png"
    maximize_on_canvas(ref, first)
    input_name = m.upload_image(first)
    shutil.copy2(first, m.COMFY_INPUT / input_name)

    prompt = build_idle_prompt(stem)
    out_leaf = f"{stem}_luoti_idle_gs"
    out_prefix = f"video/{out_leaf}"
    final = OUT_DIR / f"{stem}_luoti_daiji.png"

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = 2026081510 + (hash(stem) % 50000) + attempt * 113
        print(f"[{stem}] attempt {attempt}/{MAX_ATTEMPTS} seed={seed}", flush=True)
        t0 = time.time()
        try:
            wf = m.build_workflow(input_name, out_prefix, prompt, seed)
            wf["104"]["inputs"]["length"] = LENGTH
            wf["104"]["inputs"]["width"] = FW
            wf["104"]["inputs"]["height"] = FH
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            pid = res["prompt_id"]
            print("  prompt_id", pid, flush=True)
            m.wait_prompt(pid)
            print(f"  done in {time.time()-t0:.1f}s", flush=True)
            mp4 = m.find_latest_output(out_leaf, t0)
            if mp4 is None:
                raise RuntimeError("mp4 missing")
            qa_dir = QA / stem
            candidates = []
            for t in (3.5, 4.2, 4.8, 5.0):
                fp = m.extract_frame(mp4, t, qa_dir / f"a{attempt}_t{int(t*10):02d}.png")
                g_ok, g_det = m.green_screen_ok(fp)
                score = shower_prop_score(fp)
                cloth = cloth_white_ratio(fp)
                candidates.append((cloth, score, g_ok, g_det, fp, t))
                print(
                    f"  frame t={t}: green={'PASS' if g_ok else 'FAIL'} cloth={cloth:.3f} prop={score:.3f} {g_det}",
                    flush=True,
                )
            good = [c for c in candidates if c[2] and c[0] < 0.18]
            pick = min(good or [c for c in candidates if c[2]] or candidates, key=lambda c: (c[0], c[1]))
            if not pick[2]:
                print("  REJECT green", flush=True)
                continue
            if pick[0] >= 0.18:
                print(f"  REJECT cloth={pick[0]:.3f} too high", flush=True)
                continue
            deliverable_from_frame(pick[4], final)
            shutil.copy2(pick[4], OUT_DIR / f"{stem}_luoti_daiji_srcframe.png")
            print(f"  ACCEPTED -> {final} (t={pick[5]} cloth={pick[0]:.3f})", flush=True)
            return True
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            time.sleep(3)
    return False


def cloth_white_ratio(frame: Path) -> float:
    im = np.asarray(Image.open(frame).convert("RGB")).astype(np.float32)
    h, w, _ = im.shape
    torso = im[int(h * 0.28) : int(h * 0.62), int(w * 0.25) : int(w * 0.75)]
    dist = np.linalg.norm(torso - GREEN, axis=2)
    px = torso[dist > 55]
    if len(px) < 50:
        return 1.0
    return float(
        ((px[:, 0] > 200) & (px[:, 1] > 200) & (px[:, 2] > 200) & (np.abs(px[:, 0] - px[:, 1]) < 18)).mean()
    )


def main() -> int:
    print("=== H3 nude IDLE stills batch (not shower) ===", flush=True)
    print("Decision: use MiniMax H3 (local inpaint unavailable / cloud nude blocked)", flush=True)
    m.api("/system_stats")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ok, fail = [], []
    skip_done = set()
    # Re-finish SSR05 deliverable if srcframe exists
    ssr05_src = OUT_DIR / "SSR05_1_luoti_daiji_srcframe.png"
    if ssr05_src.exists():
        deliverable_from_frame(ssr05_src, OUT_DIR / "SSR05_1_luoti_daiji.png")
        skip_done.add("SSR05_1")
        ok.append("SSR05_1")
        print("[SKIP OK] SSR05_1 already generated (repacked cover-fill)", flush=True)
    for stem in IDENTITIES:
        if stem in skip_done:
            continue
        if process_one(stem):
            ok.append(stem)
        else:
            fail.append(stem)
    report = {
        "ok": ok,
        "fail": fail,
        "method": "minimax_h3_i2v_then_still",
        "reason": "No local inpaint weights; cloud image APIs block nude; H3 locks likeness+GS",
    }
    (OUT_DIR / "_qa" / "luoti_idle_report.json").parent.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "_qa" / "luoti_idle_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("OK:", ", ".join(ok) or "(none)")
    print("FAIL:", ", ".join(fail) or "(none)")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
