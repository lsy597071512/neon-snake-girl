"""Breath-only 4s sleep WebM from finished static sleep pose plates.

Skips morph. Uses `_qa_sleep` (or root) static blue plates as first frame.
Camera locked. VP9 alpha WebM. Rejects over-key vs static silhouette and regenerates.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

_spec = importlib.util.spec_from_file_location(
    "sleep_batch", SCRIPTS / "run_minimax_h3_pifu02_sleep_batch.py"
)
sb = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(sb)

from chroma_key_gs_video_webm import verify_has_alpha  # noqa: E402

SRC = sb.SRC_DIR
QA = sb.QA_DIR
KEY_RGB = sb.KEY_RGB
WIDTH, HEIGHT = sb.WIDTH, sb.HEIGHT
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

POSE_SOURCES: dict[str, Path] = {
    "SR01_2": QA / "SR01_2" / "SR01_2_pifu02_sleep_pose_gs.png",
    "SR01_3": SRC / "SR01_3_pifu02_sleep_pose_gs.png",
    "SR02_1": QA / "SR02_1" / "a4_morph_mid.png",
    "SR03_1": QA / "SR03_1" / "a4_morph_mid.png",
    "SR04_1": QA / "SR04_1" / "SR04_1_pifu02_sleep_pose_from_webm_first.png",
    "SR05_1": QA / "SR05_1" / "a3_morph_mid.png",
    "SSR01_1": QA / "SSR01_1" / "a7_morph_mid.png",
    "SSR02_1": QA / "SSR02_1" / "SSR02_1_pifu02_sleep_pose_2k.png",
    "SSR03_1": QA / "SSR03_1" / "a1_morph_mid.png",
    "SSR04_1": QA / "SSR04_1" / "SSR04_1_pifu02_sleep_pose_gs.png",
    "SSR05_1": QA / "SSR05_1" / "SSR05_1_pifu02_sleep_pose_gs.png",
    "UR03_1": QA / "UR03_1" / "UR03_1_pifu02_sleep_pose_gs.png",
    "UR04_1": QA / "UR04_1" / "UR04_1_pifu02_sleep_pose_2k.png",
}


def resolve_pose_source(stem: str) -> Path | None:
    """Prefer POSE_SOURCES entry; else best available under _qa_sleep/{stem}/."""
    preferred = POSE_SOURCES.get(stem)
    if preferred and preferred.exists():
        return preferred
    qa_stem = QA / stem
    if not qa_stem.is_dir():
        return preferred if preferred and preferred.exists() else None
    cands: list[Path] = []
    for pat in (
        f"{stem}_pifu02_sleep_pose_2k*.png",
        f"{stem}_pifu02_sleep_pose_gs.png",
        "*_sleep_pose*.png",
        "*morph_mid.png",
    ):
        cands.extend(sorted(qa_stem.glob(pat), key=lambda p: -p.stat().st_mtime))
    # de-dupe preserve order
    seen: set[Path] = set()
    for p in cands:
        if p in seen or not p.is_file():
            continue
        seen.add(p)
        return p
    root_gs = SRC / f"{stem}_pifu02_sleep_pose_gs.png"
    if root_gs.exists():
        return root_gs
    return None

# Blue/cyan hair eats blue chroma — use green screen for these stems.
BLUE_HAIR_STEMS = {"SSR03_1", "UR04_1"}
BLUE_KEY = (0, 102, 255)
BLUE_KEY_HEX = "0x0066FF"
GREEN_KEY = (0, 177, 64)  # #00B140
GREEN_KEY_HEX = "0x00B140"

def key_vf_ladder(hex_key: str) -> list[tuple[str, str]]:
    return [
        (
            "std",
            f"colorkey={hex_key}:0.28:0.06,format=rgba,"
            "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
            "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',format=yuva420p",
        ),
        (
            "soft",
            f"colorkey={hex_key}:0.22:0.04,format=rgba,"
            "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
            "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',format=yuva420p",
        ),
        (
            "safer",
            f"colorkey={hex_key}:0.18:0.03,format=rgba,"
            "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
            "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',format=yuva420p",
        ),
    ]

KEY_VF_LADDER = key_vf_ladder(BLUE_KEY_HEX)


def apply_key_profile(stem: str) -> tuple[str, str, tuple[int, int, int]]:
    """Set sb KEY globals for this stem; return (screen, hex, rgb)."""
    if stem in BLUE_HAIR_STEMS:
        key, hx, screen = GREEN_KEY, GREEN_KEY_HEX, "green"
    else:
        key, hx, screen = BLUE_KEY, BLUE_KEY_HEX, "blue"
    sb.KEY = key
    sb.KEY_RGB = np.array(key, dtype=np.float32)
    sb.KEY_HEX = hx
    global KEY_RGB
    KEY_RGB = sb.KEY_RGB
    return screen, hx, key


def subject_mask_rgb(path: Path, thresh: float = 70.0) -> np.ndarray:
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    return np.linalg.norm(rgb - KEY_RGB, axis=2) > thresh


def normalize_pose_plate(stem: str, src: Path, dest: Path) -> Path:
    """Build 768x1344 key plate. Blue-hair stems: cut on blue, composite onto green."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if stem in BLUE_HAIR_STEMS:
        # Source plates are usually on blue — cut with blue, paste onto green.
        prev_key, prev_rgb, prev_hex = sb.KEY, sb.KEY_RGB.copy(), sb.KEY_HEX
        sb.KEY = BLUE_KEY
        sb.KEY_RGB = np.array(BLUE_KEY, dtype=np.float32)
        sb.KEY_HEX = BLUE_KEY_HEX
        cut = sb.subject_cutout_rgba(src)
        # restore green profile for composite + later QA
        sb.KEY = GREEN_KEY
        sb.KEY_RGB = np.array(GREEN_KEY, dtype=np.float32)
        sb.KEY_HEX = GREEN_KEY_HEX
        global KEY_RGB
        KEY_RGB = sb.KEY_RGB
        a = np.asarray(cut)
        mask = a[:, :, 3] > 16
        ys, xs = np.where(mask)
        if len(xs) < 80:
            raise RuntimeError(f"empty cutout for blue-hair plate: {src}")
        pad = 8
        l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
        r, b = min(cut.width, int(xs.max()) + 1 + pad), min(cut.height, int(ys.max()) + 1 + pad)
        cut = cut.crop((l, t, r, b))
        margin = 0.02
        max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * (1 - 2 * margin))
        scale = min(max_w / cut.width, max_h / cut.height)
        cw, ch = max(1, int(cut.width * scale)), max(1, int(cut.height * scale))
        cut2 = cut.resize((cw, ch), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (WIDTH, HEIGHT), (*GREEN_KEY, 255))
        x, y = (WIDTH - cw) // 2, (HEIGHT - ch) // 2
        canvas.alpha_composite(cut2, (x, y))
        arr = np.asarray(canvas).astype(np.float32)
        alpha = arr[:, :, 3:4] / 255.0
        rgb = arr[:, :, :3]
        key = np.broadcast_to(sb.KEY_RGB, rgb.shape)
        out = rgb * alpha + key * (1.0 - alpha)
        Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").save(dest, "PNG")
        sb.m.COMFY_INPUT.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dest, sb.m.COMFY_INPUT / dest.name)
        print(f"  sleep-key GREEN {dest.name} scale={cw}x{ch} h%={ch / HEIGHT * 100:.1f}", flush=True)
    else:
        sb.frame_to_sleep_keyscreen(src, dest)
    ok_body, det_body = sb.body_complete_ok(dest)
    print(f"  pose_plate body: {'PASS' if ok_body else 'FAIL'} {det_body}", flush=True)
    if not ok_body:
        raise RuntimeError(f"pose plate body incomplete: {det_body}")
    qa_stem = QA / stem
    qa_stem.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, qa_stem / f"{stem}_pifu02_sleep_pose_gs.png")
    return dest


def overkey_vs_static_ok(
    static_gs: Path,
    keyed_rgba: Path,
    *,
    min_keep: float = 0.88,
    min_iou: float = 0.78,
) -> tuple[bool, str]:
    a = subject_mask_rgb(static_gs)
    b_im = Image.open(keyed_rgba).convert("RGBA")
    if b_im.size != (a.shape[1], a.shape[0]):
        b_im = b_im.resize((a.shape[1], a.shape[0]), Image.Resampling.NEAREST)
    b = np.asarray(b_im)[:, :, 3] >= 24
    area_a = float(a.mean())
    area_b = float(b.mean())
    if area_a < 1e-6:
        return False, "static_empty"
    keep = area_b / area_a
    inter = float((a & b).mean())
    union = float((a | b).mean())
    iou = inter / union if union > 1e-6 else 0.0

    def bbox_h(mask: np.ndarray) -> float:
        ys, _ = np.where(mask)
        if len(ys) < 50:
            return 0.0
        return float(ys.max() - ys.min() + 1) / mask.shape[0]

    ha, hb = bbox_h(a), bbox_h(b)
    h_ratio = hb / ha if ha > 1e-6 else 0.0
    ok = keep >= min_keep and iou >= min_iou and h_ratio >= 0.90
    return (
        ok,
        f"keep={keep:.3f} iou={iou:.3f} h_ratio={h_ratio:.3f} "
        f"area_a={area_a:.3f} area_b={area_b:.3f}",
    )




def cover_lock_vs_static_ok(static_gs: Path, frame_path: Path) -> tuple[bool, str]:
    """Reject undress / fabric thinning vs static plate (tight thresholds)."""
    _, ds = sb._bust_leak_score(static_gs)
    _, df = sb._bust_leak_score(frame_path)
    gs = sb._chest_cover_geometry(static_gs)
    gf = sb._chest_cover_geometry(frame_path)
    # White camisole fabric mass is small — allow at most ~15% relative drop or 0.008 abs
    fab_s, fab_f = float(ds["fab"]), float(df["fab"])
    fab_ok = fab_f + 0.008 >= fab_s * 0.85
    skin_ok = float(gf["skin_above_fab"]) <= float(gs["skin_above_fab"]) + 0.08
    gap_ok = float(gf["gap"]) <= float(gs["gap"]) + 0.015
    tip_ok = int(df["tip_max"]) <= max(int(ds["tip_max"]) + 40, int(ds["tip_max"]) * 1.15, 180)
    undress = (
        float(gf["skin_above_fab"]) > float(gs["skin_above_fab"]) + 0.08
        and fab_f + 0.01 < fab_s
    )
    thin = fab_f + 0.01 < fab_s * 0.75
    ok = bool(fab_ok and skin_ok and gap_ok and tip_ok and not undress and not thin)
    return ok, (
        f"fab {fab_s:.3f}->{fab_f:.3f} "
        f"skin_above {gs['skin_above_fab']:.3f}->{gf['skin_above_fab']:.3f} "
        f"gap {gs['gap']:.4f}->{gf['gap']:.4f} "
        f"tip {ds['tip_max']}->{df['tip_max']} "
        f"fab_ok={fab_ok} skin_ok={skin_ok} gap_ok={gap_ok} tip_ok={tip_ok} "
        f"undress={undress} thin={thin}"
    )

def decode_webm_frame(webm: Path, dest_png: Path, t: float = 0.3) -> Path:
    dest_png.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        FFMPEG,
        "-y",
        "-c:v",
        "libvpx-vp9",
        "-ss",
        str(t),
        "-i",
        str(webm),
        "-frames:v",
        "1",
        str(dest_png),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return dest_png


def process_from_pose(stem: str, force: bool = False) -> dict:
    meta = sb.CHARS[stem]
    name = meta["name"]
    src_pose = resolve_pose_source(stem)
    final_webm = SRC / f"{stem}_pifu02_sleep.webm"
    gs_mp4 = SRC / f"{stem}_pifu02_sleep_gs_h3.mp4"
    sleep_gs = SRC / f"{stem}_pifu02_sleep_pose_gs.png"
    stand_gs = SRC / f"{stem}_pifu02_sleep_stand_gs.png"
    result: dict = {
        "stem": stem,
        "name": name,
        "ok": False,
        "path": str(final_webm),
        "pose_src": str(src_pose) if src_pose else "",
        "attempts": [],
    }

    if src_pose is None or not src_pose.exists():
        result["error"] = f"missing pose for {stem}"
        print(f"[FAIL] {stem} missing pose (put plate under _qa_sleep/{stem}/)", flush=True)
        return result

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        print(f"[SKIP OK] {stem} {name} sleep webm exists", flush=True)
        result["ok"] = True
        result["skipped"] = True
        return result

    print(f"=== {stem} {name} from-pose ===", flush=True)
    print(f"  pose_src: {src_pose}", flush=True)
    screen, key_hex, key_rgb = apply_key_profile(stem)
    print(f"  chroma={screen} {key_hex} key={key_rgb}", flush=True)
    vf_ladder = key_vf_ladder(key_hex)
    qa_stem = QA / stem
    qa_stem.mkdir(parents=True, exist_ok=True)

    # Redo/force always rebuilds plate from source
    must_rebuild = force or stem in BLUE_HAIR_STEMS
    if (
        not must_rebuild
        and sleep_gs.exists()
        and sleep_gs.stat().st_size > 40_000
        and sleep_gs.stat().st_mtime >= src_pose.stat().st_mtime
    ):
        print(f"  reuse pose plate {sleep_gs.name}", flush=True)
    else:
        normalize_pose_plate(stem, src_pose, sleep_gs)

    # Hard gate: refuse exposed pose plates before any H3 breath call
    pifu = SRC / f"{stem}_pifu02.png"
    if pifu.exists():
        sb.make_keyscreen(pifu, stand_gs)
    elif not stand_gs.exists():
        shutil.copy2(sleep_gs, stand_gs)
    ok_nip, det_nip = sb.no_nipple_leak_ok(sleep_gs, stand_gs, after_chroma=True)
    print(f"  QA no_nipple_pose: {'PASS' if ok_nip else 'FAIL'} {det_nip}", flush=True)
    if not ok_nip:
        # Try automatic opacity harden on chest tip blobs, then re-check
        hardened = qa_stem / f"{stem}_pifu02_sleep_pose_hardened.png"
        _, hdet = sb.harden_sleepwear_opacity(sleep_gs, hardened)
        print(f"  harden opacity: {hdet}", flush=True)
        shutil.copy2(hardened, sleep_gs)
        shutil.copy2(sleep_gs, qa_stem / f"{stem}_pifu02_sleep_pose_gs.png")
        ok_nip2, det_nip2 = sb.no_nipple_leak_ok(sleep_gs, stand_gs, after_chroma=True)
        print(f"  QA no_nipple_pose(after harden): {'PASS' if ok_nip2 else 'FAIL'} {det_nip2}", flush=True)
        if not ok_nip2:
            shutil.copy2(sleep_gs, qa_stem / f"{stem}_nipple_reject_pose_gs.png")
            result["error"] = f"pose plate failed cover gate: {det_nip2}"
            print(f"[FAIL] {stem} pose plate still has show-through — replace plate then retry", flush=True)
            return result
    else:
        # Even on PASS, lightly harden to reduce residual tip shading before breath
        hardened = qa_stem / f"{stem}_pifu02_sleep_pose_hardened.png"
        _, hdet = sb.harden_sleepwear_opacity(sleep_gs, hardened)
        print(f"  harden opacity (preemptive): {hdet}", flush=True)
        shutil.copy2(hardened, sleep_gs)

    fabric = meta["fabric"]
    breath_prompt = sb.build_breath_prompt(meta["identity"], fabric, meta["pose"], screen=screen)

    sleep_input = sb.m.upload_image(sleep_gs)
    shutil.copy2(sleep_gs, sb.m.COMFY_INPUT / sleep_input)

    for attempt in range(1, sb.MAX_ATTEMPTS + 1):
        seed = 2026082112 + (hash(stem) % 100000) + attempt * 193
        print(
            f"[{stem}] breath attempt {attempt}/{sb.MAX_ATTEMPTS} seed={seed}",
            flush=True,
        )
        try:
            loop_leaf = f"{stem}_pifu02_sleep_gs"
            loop_mp4 = sb.run_h3(
                sleep_input,
                loop_leaf,
                breath_prompt,
                seed,
                length=sb.LENGTH,
                loop=True,
            )
            shutil.copy2(loop_mp4, qa_stem / f"b{attempt}_loop.mp4")
            shutil.copy2(loop_mp4, gs_mp4)

            # Slim QA: 2 sample frames (was 3×key/void/body + 3×cover)
            f0 = sb.m.extract_frame(loop_mp4, 0.4, qa_stem / f"b{attempt}_t040.png")
            f1 = sb.m.extract_frame(loop_mp4, 2.0, qa_stem / f"b{attempt}_t200.png")

            checks: list[tuple[str, bool, str]] = []
            for fp, label in ((f0, "t0.4"), (f1, "t2.0")):
                ok_k, det_k = sb.sleep_key_ok(fp)
                checks.append((f"key[{label}]", bool(ok_k), str(det_k)))
                ok_v, det_v = sb.sleep_void_ok(fp)
                checks.append((f"void[{label}]", bool(ok_v), str(det_v)))
                ok_b, det_b = sb.body_complete_ok(fp)
                checks.append((f"body[{label}]", bool(ok_b), str(det_b)))
            ok_l, det_l = sb.likeness_sleep_ok(sleep_gs, f0)
            checks.append(("likeness", bool(ok_l), str(det_l)))
            # Fabric lock vs sleep plate (not standing) — true identity reference
            ok_fab, det_fab = sb.fabric_lock_ok(sleep_gs, f1, fabric)
            checks.append(("fabric", bool(ok_fab), str(det_fab)))
            ok_c, det_c = cover_lock_vs_static_ok(sleep_gs, f1)
            checks.append(("cover[t2.0]", bool(ok_c), str(det_c)))
            # Video-frame 透点/露点 gate — reject and regenerate
            for fp, label in ((f0, "t0.4"), (f1, "t2.0")):
                ok_vnip, det_vnip = sb.no_nipple_leak_ok(
                    fp, stand_gs, video_frame=True
                )
                checks.append((f"opacity[{label}]", bool(ok_vnip), str(det_vnip)))
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if not all(ok for _, ok, _ in checks):
                # keep reject frames for audit
                for fp, tag in ((f0, "t040"), (f1, "t200")):
                    shutil.copy2(fp, qa_stem / f"b{attempt}_reject_{tag}.png")
                result["attempts"].append(
                    {
                        "attempt": attempt,
                        "seed": seed,
                        "ok": False,
                        "stage": "loop_qa",
                        "checks": checks,
                    }
                )
                print(f"  REJECT breath attempt {attempt} — opacity/cover/qa failed", flush=True)
                continue

            keyed_ok = False
            key_det = ""
            used_vf = ""
            # Prefer std key first; only try softer if over-key fails
            for vf_name, vf in vf_ladder:
                tmp_webm = qa_stem / f"b{attempt}_{vf_name}.webm"
                sb.gs_mp4_to_webm(gs_mp4, tmp_webm, fps=24.0, vf=vf)
                ok_a, det_a = verify_has_alpha(tmp_webm, min_zero_pct=25.0)
                print(
                    f"  QA alpha[{vf_name}]: {'PASS' if ok_a else 'FAIL'} {det_a}",
                    flush=True,
                )
                if not ok_a:
                    key_det = det_a
                    continue
                frame_rgba = qa_stem / f"b{attempt}_{vf_name}_rgba.png"
                decode_webm_frame(tmp_webm, frame_rgba, t=0.4)
                ok_o, det_o = overkey_vs_static_ok(sleep_gs, frame_rgba)
                print(
                    f"  QA overkey[{vf_name}]: {'PASS' if ok_o else 'FAIL'} {det_o}",
                    flush=True,
                )
                if ok_o:
                    shutil.copy2(tmp_webm, final_webm)
                    keyed_ok = True
                    used_vf = vf_name
                    key_det = det_o
                    break
                key_det = det_o

            if not keyed_ok:
                result["attempts"].append(
                    {
                        "attempt": attempt,
                        "seed": seed,
                        "ok": False,
                        "stage": "overkey",
                        "det": key_det,
                    }
                )
                print(f"  over-key vs static — regen breath ({key_det})", flush=True)
                continue

            bak = QA / "accepted"
            bak.mkdir(parents=True, exist_ok=True)
            shutil.copy2(final_webm, bak / final_webm.name)
            shutil.copy2(final_webm, qa_stem / f"{stem}_pifu02_sleep.webm.bak")
            result["ok"] = True
            result["attempts"].append(
                {
                    "attempt": attempt,
                    "seed": seed,
                    "ok": True,
                    "vf": used_vf,
                    "overkey": key_det,
                }
            )
            print(
                f"  ACCEPTED -> {final_webm} "
                f"({final_webm.stat().st_size // 1024} KB) vf={used_vf}",
                flush=True,
            )
            return result
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append(
                {"attempt": attempt, "seed": seed, "ok": False, "error": str(e)}
            )
            time.sleep(2)

    print(f"[FAIL] {stem} {name} after {sb.MAX_ATTEMPTS} attempts", flush=True)
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all", help="artStem or all")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    print("=== pifu02 sleep FROM-POSE breath batch (4s, camera locked, fast profile) ===", flush=True)
    print(f"SRC: {SRC}", flush=True)
    print(
        f"spec: {WIDTH}x{HEIGHT} loop={sb.LENGTH} steps={sb.STEPS} "
        f"max_attempts={sb.MAX_ATTEMPTS} (~4.0s)",
        flush=True,
    )
    sb.m.api("/system_stats")

    stems = (
        list(POSE_SOURCES.keys())
        if args.stem == "all"
        else [s.strip() for s in args.stem.replace(";", ",").split(",") if s.strip()]
    )
    unknown = [s for s in stems if s not in POSE_SOURCES]
    if unknown:
        print(f"unknown stem(s): {', '.join(unknown)}", file=sys.stderr)
        return 2

    missing = [s for s in stems if resolve_pose_source(s) is None]
    if missing:
        print("MISSING pose plates:", ", ".join(missing), flush=True)
        print("Put a sleep plate under _qa_sleep/{stem}/ then retry.", flush=True)
        # still process stems that have poses
        stems = [s for s in stems if s not in missing]
        if not stems:
            return 2

    results = []
    for stem in stems:
        r = process_from_pose(stem, force=args.force)
        results.append(r)
        if not r.get("skipped"):
            sb.free_comfy_vram()

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
    }

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

    report = QA / "pifu02_sleep_from_pose_report.json"
    report.write_text(
        json.dumps(
            {
                "summary": summary,
                "results": _jsonable(results),
                "sources": {k: str(v) for k, v in POSE_SOURCES.items()},
            },
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
