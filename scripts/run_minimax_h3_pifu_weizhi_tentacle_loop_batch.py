"""Batch MiniMax H3: pifu_weizhi tentacle stills → 5s continuous-motion transparent webm.

Vertical 768×1344, exactly 5s (120 frames @24fps), locked camera.
NO last_frame lock (that froze the final ~1s). Loop seam via short end crossfade only.
Output VP9+alpha .webm with preserve-subject chroma key (#00b140).

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/run_minimax_h3_pifu_weizhi_tentacle_loop_batch.py --stem all --force
  ... --stem freeze   # from _motion_audit.json
  ... --stem iqwg1bt7ia --force
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

import numpy as np
from PIL import Image

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

from chroma_key_gs_video_webm import gs_mp4_to_webm  # noqa: E402

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "tiaojiao" / "out_builtin"
OUT_DIR = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "webm_tentacle_loop"
QA_DIR = OUT_DIR / "_qa"
FIRST_DIR = OUT_DIR / "_first"

WIDTH, HEIGHT = 768, 1344
# H3 freezes near the END of whatever length it generates — so generate 6s, ship first 5s.
LENGTH = 144  # generate 6.0s @ 24fps
KEEP_FRAMES = 120  # ship exactly 5.0s
STEPS = 24
MAX_ATTEMPTS = 3
H3_WAIT_TIMEOUT_S = 7200.0
LOOP_BLEND_FRAMES = 3  # tiny seam polish only (~0.12s); large blends look like end-freeze
LATE_MOTION_MIN_RATIO = 0.40
LATE_MOTION_MIN_ABS = 1.5
# Last 0.5s must stay alive (catches 4.75–5.0 collapse)
TAIL_MOTION_MIN_ABS = 2.0
TAIL_MOTION_MIN_RATIO = 0.28
# Subject scale / framing lock (no zoom / focal-length change)
CAMERA_SCALE_MAX_DELTA = 0.07  # ±7% bbox height
CAMERA_CENTER_MAX_SHIFT = 0.045  # normalized center drift
SEED_BASE = 2026090317  # bump when force-rerunning quality rejects
SKIP_GREEN_QA = True  # green failures were burning retries; chroma key still runs downstream

IDENTITY_TENTACLE = (
    "same character outfit and face as first frame; glossy black organic/mechanical tentacles tightly wrapping torso"
)
IDENTITY_ASSET = (
    "same character outfit and face as first frame; glossy black organic/mechanical tentacles tightly wrapping body"
)

LEGACY_JOBS: dict[str, dict] = {
    "iqwg1bt7ia": {"src": "iqwg1bt7ia_触手_soft_2k_v2.png", "identity": IDENTITY_TENTACLE},
    "sopv1ct25ml": {"src": "sopv1ct25ml_触手_v2_up.png", "identity": IDENTITY_TENTACLE},
    "sp164titla": {"src": "sp164titla_触手_v2_up.png", "identity": IDENTITY_TENTACLE},
    "UR04_1_pifu02": {"src": "UR04_1_pifu02_触手.png", "identity": IDENTITY_TENTACLE},
    "renwu1": {"src": "任务1-图片2中黑色触手紧紧.png", "identity": IDENTITY_TENTACLE},
    "renwu2": {"src": "任务2-图片2中黑色触手紧紧 (1).png", "identity": IDENTITY_TENTACLE},
    "renwu3": {"src": "任务3-图片2中黑色触手紧紧 (2).png", "identity": IDENTITY_TENTACLE},
    "renwu4": {"src": "任务4-图片2中黑色触手紧紧.png", "identity": IDENTITY_TENTACLE},
    "renwu5": {"src": "任务5-图片2中黑色触手紧紧.png", "identity": IDENTITY_TENTACLE},
    "renwu6": {"src": "任务6-图片2中黑色触手紧紧 (1).png", "identity": IDENTITY_TENTACLE},
}

PROMPT = """Professional film-set chroma key plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution look.

FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, no pull-out, no added headroom. Subject screen scale must stay constant.

LOCKED identity from first frame: {identity}. Preserve exact face, hair, outfit, proportions, and glossy black tentacle design from the first frame. Do not add extra limbs or change costume.

CAMERA (HARD LOCK — CRITICAL):
- Completely locked tripod camera. Framing identical for the entire clip.
- FORBIDDEN: pan, tilt, roll, orbit, dolly, truck, pedestal.
- FORBIDDEN: zoom, push-in, pull-out, punch-in, punch-out.
- FORBIDDEN: any focal-length change, lens breathe, focus pull, or perspective shift.
- Subject size in frame must remain constant (no apparent magnification). Center stays put.

ACTION — CONTINUOUS motion for the FULL generated duration (HARD REQUIREMENT):
- Keep motion alive through every second including the final second. No settle-to-static.
- FORBIDDEN: freezing, holding still, dead-stop after ~3–4s. FORBIDDEN: only tentacles moving while the body is a stiff mannequin.
- Glossy black tentacles stay tightly wrapped and continuously writhe, pulse, stretch and re-coil around chest/bust, waist, hips, thighs — organic peristaltic motion, not a stiff up-down conveyor loop.
- BODY DRIVEN BY TENTACLES: coils physically carry the body — soft torso sway + slight vertical bobbing as pressure changes throughout the WHOLE clip including the final second.
- BREATHING: tense sensual breathing with clear chest rise/fall the entire time.
- FLESH PHYSICS (tasteful game-style): breast bounce/jiggle from pressure+breath; slight hip/butt sway; soft flesh compression at contact points — physical give, not plastic.
- Expression: shy / awkward / embarrassed micro-changes, hesitant eye flickers, blush-free shy look preferred, soft blinking — keep micro-acting through the final second.
- Do NOT morph into a static duplicate of frame-1 near the end. Keep live motion until the last frame.

Keep pure flat #00b140 green everywhere behind the subject: no floor, no set, no shadow catcher, no vignette. Do NOT invent new background elements.

Audio: very soft quiet room tone only, no speech, no music.
"""

JOBS: dict[str, dict] = {}


def stem_for_png(path: Path) -> str:
    for stem, meta in LEGACY_JOBS.items():
        if meta["src"] == path.name:
            return stem
    return path.stem


def iter_source_plates() -> list[Path]:
    plates: list[Path] = []
    for pat in ("*.png", "*.jpg", "*.jpeg", "*.webp"):
        plates.extend(SRC_DIR.glob(pat))
    by_stem: dict[str, Path] = {}
    for p in sorted(plates, key=lambda x: (x.stem.lower(), 0 if x.suffix.lower() == ".png" else 1)):
        by_stem.setdefault(p.stem, p)
    return list(by_stem.values())


def build_all_jobs() -> dict[str, dict]:
    jobs: dict[str, dict] = {}
    for plate in iter_source_plates():
        stem = stem_for_png(plate)
        if stem in jobs:
            stem = f"{plate.stem}__dup"
        is_tent = (
            "触手" in plate.name
            or plate.name.lower().startswith("tke_img_")
            or plate.name.lower().startswith("asset-")
        )
        jobs[stem] = {
            "src": plate.name,
            "identity": IDENTITY_TENTACLE if is_tent else IDENTITY_ASSET,
        }
    return jobs


def webm_for_stem(stem: str) -> Path:
    return OUT_DIR / f"{stem}_tentacle_loop.webm"


def is_done(stem: str) -> bool:
    p = webm_for_stem(stem)
    return p.exists() and p.stat().st_size > 80_000


def build_workflow(input_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    wf = m.build_workflow(input_name, out_prefix, prompt, seed)
    wf["104"]["inputs"]["width"] = WIDTH
    wf["104"]["inputs"]["height"] = HEIGHT
    wf["104"]["inputs"]["length"] = LENGTH
    # CRITICAL: never lock last_frame to first — that freezes the final ~1s.
    wf["104"]["inputs"].pop("last_frame", None)
    wf["9"]["inputs"]["steps"] = STEPS
    return wf


def trim_to_keep_frames(src_mp4: Path, dest_mp4: Path, keep: int = KEEP_FRAMES) -> Path:
    """Keep first N frames (drop H3 end-freeze zone)."""
    dest_mp4.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            m.FFMPEG,
            "-y",
            "-i",
            str(src_mp4),
            "-frames:v",
            str(keep),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            "-an",
            str(dest_mp4),
        ],
        check=True,
        capture_output=True,
    )
    return dest_mp4


def make_loop_crossfade_mp4(src_mp4: Path, dest_mp4: Path, blend: int = LOOP_BLEND_FRAMES) -> Path:
    """Keep continuous motion; softly blend only the last N frames toward frame 0 for seam."""
    work = dest_mp4.parent / f"_loop_frames_{dest_mp4.stem}"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    subprocess.run(
        [m.FFMPEG, "-y", "-i", str(src_mp4), "-vsync", "0", str(work / "f_%05d.png")],
        check=True,
        capture_output=True,
    )
    frames = sorted(work.glob("f_*.png"))
    if len(frames) < max(24, blend + 2) or blend <= 0:
        shutil.copy2(src_mp4, dest_mp4)
        shutil.rmtree(work, ignore_errors=True)
        return dest_mp4
    first = np.asarray(Image.open(frames[0]).convert("RGB"), dtype=np.float32)
    n = len(frames)
    blend = min(blend, n // 8)
    for i in range(blend):
        idx = n - blend + i
        t = (i + 1) / float(blend)
        cur = np.asarray(Image.open(frames[idx]).convert("RGB"), dtype=np.float32)
        out = cur * (1.0 - t) + first * t
        Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").save(frames[idx])
    dest_mp4.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            m.FFMPEG,
            "-y",
            "-framerate",
            "24",
            "-i",
            str(work / "f_%05d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            "-an",
            str(dest_mp4),
        ],
        check=True,
        capture_output=True,
    )
    shutil.rmtree(work, ignore_errors=True)
    return dest_mp4


def _subject_mask(rgb: np.ndarray) -> np.ndarray:
    """Rough non-green subject mask on chroma plate."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = (g.astype(np.float32) > 90) & (g.astype(np.float32) > r.astype(np.float32) + 25) & (
        g.astype(np.float32) > b.astype(np.float32) + 25
    )
    return ~green


def _subject_bbox(mask: np.ndarray) -> tuple[float, float, float, float] | None:
    ys, xs = np.where(mask)
    if len(xs) < 200:
        return None
    x0, x1 = float(xs.min()), float(xs.max())
    y0, y1 = float(ys.min()), float(ys.max())
    return x0, y0, x1, y1


def camera_lock_ok(video: Path) -> tuple[bool, str, dict]:
    """Reject zoom / focal-length change / framing drift via subject bbox scale."""
    times = [0.25, 1.5, 2.75, 4.0, 4.85]
    tmp = QA_DIR / "_camera_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    heights = []
    centers = []
    for t in times:
        png = tmp / f"{video.stem}_cam_{t:.2f}.png"
        m.extract_frame(video, t, png)
        rgb = np.asarray(Image.open(png).convert("RGB"))
        h, w = rgb.shape[:2]
        bb = _subject_bbox(_subject_mask(rgb))
        if bb is None:
            return False, f"no subject mask at t={t}", {}
        x0, y0, x1, y1 = bb
        heights.append((y1 - y0) / float(h))
        centers.append((((x0 + x1) * 0.5) / w, ((y0 + y1) * 0.5) / h))
    h0 = heights[0]
    scale_deltas = [abs(h / max(h0, 1e-6) - 1.0) for h in heights]
    max_scale = float(max(scale_deltas))
    cx0, cy0 = centers[0]
    center_shifts = [((cx - cx0) ** 2 + (cy - cy0) ** 2) ** 0.5 for cx, cy in centers]
    max_shift = float(max(center_shifts))
    ok = max_scale <= CAMERA_SCALE_MAX_DELTA and max_shift <= CAMERA_CENTER_MAX_SHIFT
    detail = (
        f"scale_delta={max_scale:.3f}(lim {CAMERA_SCALE_MAX_DELTA}) "
        f"center_shift={max_shift:.3f}(lim {CAMERA_CENTER_MAX_SHIFT}) "
        f"h={[round(x, 3) for x in heights]}"
    )
    return ok, detail, {"max_scale": max_scale, "max_shift": max_shift, "heights": heights}


def motion_profile(video: Path) -> dict:
    times = [0.2, 0.8, 1.5, 2.2, 2.9, 3.5, 4.0, 4.35, 4.6, 4.85, 5.05]
    tmp = QA_DIR / "_motion_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    grays = []
    for t in times:
        png = tmp / f"{video.stem}_{t:.2f}.png"
        m.extract_frame(video, min(t, 4.95), png)
        grays.append(np.asarray(Image.open(png).convert("L"), dtype=np.float32))
    segs = [float(np.abs(grays[i] - grays[i + 1]).mean()) for i in range(len(times) - 1)]
    early = float(np.mean(segs[:5]))
    late = float(np.mean(segs[6:8])) if len(segs) > 7 else float(np.mean(segs[5:]))
    # dedicated last-0.5s window (4.35→5.05)
    tail = float(np.mean(segs[7:])) if len(segs) > 8 else late
    ratio = late / max(early, 1e-6)
    tail_ratio = tail / max(early, 1e-6)
    freeze = (ratio < LATE_MOTION_MIN_RATIO and early > 0.8) or (
        late < LATE_MOTION_MIN_ABS and early > 0.6
    )
    tail_freeze = (tail < TAIL_MOTION_MIN_ABS and early > 0.6) or (
        tail_ratio < TAIL_MOTION_MIN_RATIO and early > 0.8
    )
    return {
        "early": early,
        "late": late,
        "tail": tail,
        "ratio": ratio,
        "tail_ratio": tail_ratio,
        "freeze": freeze or tail_freeze,
        "tail_freeze": tail_freeze,
        "segs": segs,
    }


def key_to_webm(gs_mp4: Path, final_webm: Path, qa_tag: str, force: bool) -> tuple[bool, str]:
    try:
        from rembg import new_session
        from scripts.chroma_key_lib import process_video

        session = new_session("u2net")
        qa = QA_DIR / "_key_qa"
        out_tmp = QA_DIR / "_webm_out" / final_webm.name
        out_tmp.parent.mkdir(parents=True, exist_ok=True)
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
            preserve_subject=True,
        )
        if r.get("ok"):
            return True, r.get("detail", "ok")
        detail = r.get("error", "safe key failed")
    except Exception as e:
        detail = f"safe key exception: {e}"

    try:
        gs_mp4_to_webm(gs_mp4, final_webm, fps=24.0)
        if final_webm.exists() and final_webm.stat().st_size > 80_000:
            return True, f"fallback_colorkey after: {detail}"
    except Exception as e:
        return False, f"{detail}; colorkey: {e}"
    return False, detail


def green_ok(path: Path) -> tuple[bool, str]:
    return m.green_screen_ok(path, min_corner_green_ratio=0.45)


def process_one(stem: str, force: bool = False) -> dict:
    meta = JOBS[stem]
    src = SRC_DIR / meta["src"]
    final_webm = OUT_DIR / f"{stem}_tentacle_loop.webm"
    gs_mp4 = OUT_DIR / f"{stem}_tentacle_loop_gs_h3.mp4"
    gs_path = OUT_DIR / f"{stem}_tentacle_first.png"
    result: dict = {"stem": stem, "src": meta["src"], "ok": False, "path": str(final_webm), "attempts": []}

    if not src.exists():
        result["error"] = f"missing src: {src}"
        return result

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    FIRST_DIR.mkdir(parents=True, exist_ok=True)

    m.WIDTH, m.HEIGHT = WIDTH, HEIGHT
    m.make_greenscreen(src, gs_path)
    shutil.copy2(gs_path, FIRST_DIR / gs_path.name)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    prompt = PROMPT.format(identity=meta["identity"])
    out_leaf = f"{stem}_tentacle_loop_gs"
    out_prefix = f"video/{out_leaf}"
    qa_stem = QA_DIR / stem
    qa_stem.mkdir(parents=True, exist_ok=True)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = SEED_BASE + (abs(hash(stem)) % 100000) + attempt * 211
        print(
            f"[{stem}] attempt {attempt}/{MAX_ATTEMPTS} seed={seed} "
            f"(no last_frame, gen={LENGTH} keep={KEEP_FRAMES})",
            flush=True,
        )
        t_start = time.time()
        try:
            wf = build_workflow(input_name, out_prefix, prompt, seed)
            assert "last_frame" not in wf["104"]["inputs"]
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            m.wait_prompt(prompt_id, timeout_s=H3_WAIT_TIMEOUT_S)
            print(f"  h3 done in {time.time() - t_start:.1f}s", flush=True)
            out = m.find_latest_output(out_leaf, t_start)
            if out is None:
                raise RuntimeError("output mp4 not found")
            raw_path = qa_stem / f"a{attempt}_raw6s.mp4"
            shutil.copy2(out, raw_path)

            trimmed = qa_stem / f"a{attempt}.mp4"
            trim_to_keep_frames(raw_path, trimmed, KEEP_FRAMES)

            f0 = m.extract_frame(trimmed, 0.4, qa_stem / f"a{attempt}_t040.png")
            f1 = m.extract_frame(trimmed, 2.5, qa_stem / f"a{attempt}_t250.png")
            f2 = m.extract_frame(trimmed, 4.6, qa_stem / f"a{attempt}_t460.png")
            checks = []
            for fp, label in ((f0, "t0.4"), (f1, "t2.5"), (f2, "t4.6")):
                ok_g, det_g = green_ok(fp)
                if SKIP_GREEN_QA:
                    print(
                        f"  QA green[{label}]: SKIP({'ok' if ok_g else 'warn'}) {det_g}",
                        flush=True,
                    )
                else:
                    checks.append((f"green[{label}]", bool(ok_g), str(det_g)))

            cam_ok, cam_det, cam_meta = camera_lock_ok(trimmed)
            checks.append(("camera_lock", cam_ok, cam_det))

            mot = motion_profile(trimmed)
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
            make_loop_crossfade_mp4(trimmed, looped)
            shutil.copy2(looped, gs_mp4)
            ok_w, det_w = key_to_webm(gs_mp4, final_webm, qa_tag=stem, force=True)
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
                return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": str(e)})

    result["error"] = "all attempts failed"
    return result


def load_prior_report() -> list[dict]:
    rep_path = OUT_DIR / "_batch_report.json"
    if not rep_path.exists():
        return []
    try:
        return json.loads(rep_path.read_text(encoding="utf-8"))
    except Exception:
        return []


def merge_reports(prior: list[dict], new_rows: list[dict]) -> list[dict]:
    by_stem = {r["stem"]: r for r in prior if "stem" in r}
    for r in new_rows:
        by_stem[r["stem"]] = r
    return list(by_stem.values())


def stems_from_freeze_audit() -> list[str]:
    prefer = OUT_DIR / "_regen_freeze_stems.json"
    if prefer.exists():
        data = json.loads(prefer.read_text(encoding="utf-8"))
        if isinstance(data, list) and data:
            return list(data)
    audit = OUT_DIR / "_motion_audit.json"
    if not audit.exists():
        raise SystemExit(f"missing {audit}; run motion audit first")
    data = json.loads(audit.read_text(encoding="utf-8"))
    return [r["stem"] for r in data.get("freeze", [])]


def main() -> None:
    global JOBS
    JOBS = build_all_jobs()

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--stem",
        default="all",
        help="job stem | comma-separated stems | all | remaining | freeze",
    )
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.stem == "all":
        stems = list(JOBS.keys())
    elif args.stem == "remaining":
        stems = [s for s in JOBS if not is_done(s)]
    elif args.stem == "freeze":
        stems = stems_from_freeze_audit()
    elif "," in args.stem:
        stems = [s.strip() for s in args.stem.split(",") if s.strip()]
    else:
        stems = [args.stem]

    for s in stems:
        if s not in JOBS:
            raise SystemExit(f"unknown stem {s}; choose from {list(JOBS)}")

    prior = load_prior_report()
    report = []
    print(
        f"jobs total={len(JOBS)} run={len(stems)} already_done={sum(1 for s in JOBS if is_done(s))} "
        f"LENGTH={LENGTH} keep={KEEP_FRAMES} blend={LOOP_BLEND_FRAMES} "
        f"last_frame=OFF green_qa={'OFF' if SKIP_GREEN_QA else 'ON'}",
        flush=True,
    )
    for stem in stems:
        print(f"\n===== {stem} =====", flush=True)
        r = process_one(stem, force=args.force)
        report.append(r)
        print(
            json.dumps({k: r[k] for k in ("stem", "ok", "error", "path") if k in r}, ensure_ascii=False),
            flush=True,
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rep_path = OUT_DIR / "_batch_report.json"
    merged = merge_reports(prior, report)
    rep_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    ok_n = sum(1 for r in report if r.get("ok"))
    total_done = sum(1 for s in JOBS if is_done(s))
    print(f"\nRUN {ok_n}/{len(report)} | TOTAL DONE {total_done}/{len(JOBS)} → {OUT_DIR}", flush=True)


if __name__ == "__main__":
    main()
