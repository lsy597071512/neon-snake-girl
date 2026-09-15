"""Re-key existing _qa_tease2_from_pose H3 mp4 → {stem}_pifu05_2.webm.

Analyzes QA mp4 per character, keys with rembg + over-key gate vs pose plate.
If over-key eats silhouette → optional H3 regen (--regen-on-fail).

Usage:
  python scripts/run_pifu05_tease2_rekey_qa_batch.py --stem all --force
  python scripts/run_pifu05_tease2_rekey_qa_batch.py --stem SR02_1 --regen-on-fail
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

FP = ROOT / "scripts" / "run_pifu05_tease2_from_pose_batch.py"
_spec = importlib.util.spec_from_file_location("fp", FP)
fp = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(fp)

from chroma_key_gs_video_webm import gs_mp4_to_webm, verify_has_alpha  # noqa: E402

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
ALL_STEMS = list(fp.POSE_SOURCES.keys())


def mp4_probe(path: Path) -> dict:
    cmd = [
        FFMPEG,
        "-hide_banner",
        "-i",
        str(path),
        "-f",
        "null",
        "-",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    text = (p.stderr or "") + (p.stdout or "")
    dur = None
    for line in text.splitlines():
        if "Duration:" in line:
            part = line.split("Duration:", 1)[1].split(",", 1)[0].strip()
            try:
                h, m, s = part.split(":")
                dur = int(h) * 3600 + int(m) * 60 + float(s)
            except ValueError:
                pass
    return {"path": str(path), "size_kb": path.stat().st_size // 1024, "duration_s": dur}


def find_qa_mp4(stem: str) -> Path | None:
    qa = fp.QA_OUT / stem
    if not qa.is_dir():
        return None
    cands = sorted(qa.glob("a*.mp4"), key=lambda p: (-p.stat().st_mtime, -p.stat().st_size))
    if cands:
        return cands[0]
    alt = fp.SRC_DIR / f"{stem}_pifu05_tease2_from_pose_gs.mp4"
    return alt if alt.exists() else None


def ensure_pose_gs(stem: str) -> Path:
    src_pose = fp.resolve_pose_source(stem)
    if src_pose is None or not src_pose.exists():
        raise FileNotFoundError(f"missing pose for {stem}")
    pose_gs = fp.QA_OUT / stem / f"{stem}_tease2_from_pose_gs.png"
    if not pose_gs.exists() or pose_gs.stat().st_mtime < src_pose.stat().st_mtime:
        fp.normalize_pose_plate(stem, src_pose, pose_gs)
    return pose_gs


def analyze_folder(stem: str) -> dict:
    mp4 = find_qa_mp4(stem)
    info: dict = {"stem": stem, "mp4": mp4.name if mp4 else None, "has_webm": False}
    if mp4:
        info.update(mp4_probe(mp4))
    webm = fp.SRC_DIR / f"{stem}_pifu05_2.webm"
    if webm.exists() and webm.stat().st_size > 80_000:
        info["has_webm"] = True
        info["webm_kb"] = webm.stat().st_size // 1024
    return info


GREEN_HEX = "0x00B140"


def key_ladder_fallback(
    mp4: Path,
    pose_gs: Path,
    final_webm: Path,
    qa_stem: Path,
    stem: str,
) -> tuple[bool, str]:
    """Try softer colorkey ladder if rembg over-keyed."""
    ladder = [
        ("safer", f"colorkey={GREEN_HEX}:0.18:0.03,format=rgba,geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',format=yuva420p"),
        ("soft", f"colorkey={GREEN_HEX}:0.22:0.04,format=rgba,geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',format=yuva420p"),
        ("std", f"colorkey={GREEN_HEX}:0.28:0.06,format=rgba,geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',format=yuva420p"),
    ]
    fp.sfp.KEY_RGB = np.array(fp.GREEN_KEY, dtype=np.float32)
    for vf_name, vf in ladder:
        tmp = qa_stem / f"{stem}_fallback_{vf_name}.webm"
        gs_mp4_to_webm(mp4, tmp, fps=24.0, vf=vf)
        ok_a, det_a = verify_has_alpha(tmp, min_zero_pct=25.0)
        if not ok_a:
            print(f"  ladder[{vf_name}] alpha FAIL {det_a}", flush=True)
            continue
        frame = qa_stem / f"{stem}_fallback_{vf_name}_rgba.png"
        fp.sfp.decode_webm_frame(tmp, frame, t=0.35)
        ok_o, det_o = fp.sfp.overkey_vs_static_ok(pose_gs, frame)
        print(f"  ladder[{vf_name}] overkey {'PASS' if ok_o else 'FAIL'} {det_o}", flush=True)
        if ok_o:
            shutil.copy2(tmp, final_webm)
            return True, f"ladder_{vf_name} | {det_o}"
    return False, "all ladder failed"


def rekey_one(stem: str, *, force: bool = False, regen_on_fail: bool = False) -> dict:
    name = fp.t2.CHARACTERS.get(stem, {}).get("name", stem)
    final_webm = fp.SRC_DIR / f"{stem}_pifu05_2.webm"
    qa_stem = fp.QA_OUT / stem
    qa_stem.mkdir(parents=True, exist_ok=True)
    result: dict = {"stem": stem, "name": name, "ok": False, "path": str(final_webm)}

    if final_webm.exists() and final_webm.stat().st_size > 80_000 and not force:
        ok_o, det_o = _verify_existing_webm(stem, final_webm)
        result["ok"] = ok_o
        result["skipped"] = True
        result["detail"] = det_o
        print(f"[SKIP] {stem} webm exists overkey={'PASS' if ok_o else 'FAIL'} {det_o}", flush=True)
        if ok_o:
            return result
        print(f"  re-keying {stem} (existing webm failed overkey)", flush=True)

    mp4 = find_qa_mp4(stem)
    if mp4 is None:
        result["error"] = "no qa mp4"
        print(f"[FAIL] {stem} no mp4 in _qa_tease2_from_pose/{stem}/", flush=True)
        return result

    try:
        pose_gs = ensure_pose_gs(stem)
    except FileNotFoundError as e:
        result["error"] = str(e)
        print(f"[FAIL] {stem} {e}", flush=True)
        return result

    probe = mp4_probe(mp4)
    print(
        f"=== {stem} {name} REKEY === mp4={mp4.name} "
        f"{probe.get('size_kb')}KB dur={probe.get('duration_s')}s pose={pose_gs.name}",
        flush=True,
    )

    ok, det = fp.key_with_overkey_check(mp4, pose_gs, final_webm, qa_stem, f"{stem}_pifu05_2", 0)
    print(f"  rembg KEY {'PASS' if ok else 'FAIL'} {det}", flush=True)
    if not ok and "overkey" in det:
        ok2, det2 = key_ladder_fallback(mp4, pose_gs, final_webm, qa_stem, stem)
        if ok2:
            ok, det = ok2, det2
        else:
            det = f"{det}; {det2}"
    print(f"  KEY {'PASS' if ok else 'FAIL'} {det}", flush=True)
    if ok:
        result["ok"] = True
        result["mp4"] = str(mp4)
        result["detail"] = det
        result["webm_kb"] = final_webm.stat().st_size // 1024
        return result

    result["error"] = det
    result["mp4"] = str(mp4)
    if regen_on_fail and "overkey" in det:
        print(f"  over-key → H3 regen {stem} (skip nipple QA)", flush=True)
        regen = fp.process_one(stem, force=True, skip_nipple_qa=True)
        result["regen"] = regen
        result["ok"] = bool(regen.get("ok"))
    return result


def _verify_existing_webm(stem: str, webm: Path) -> tuple[bool, str]:
    try:
        pose_gs = ensure_pose_gs(stem)
    except FileNotFoundError as e:
        return False, str(e)
    frame = fp.QA_OUT / stem / f"{stem}_verify_rgba.png"
    fp.sfp.KEY_RGB = np.array(fp.GREEN_KEY, dtype=np.float32)
    fp.sfp.decode_webm_frame(webm, frame, t=0.35)
    ok_a, det_a = verify_has_alpha(webm, min_zero_pct=25.0)
    if not ok_a:
        return False, det_a
    ok_o, det_o = fp.sfp.overkey_vs_static_ok(pose_gs, frame)
    return ok_o, f"alpha {det_a} | {det_o}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all")
    ap.add_argument("--force", action="store_true", help="re-key even if webm exists")
    ap.add_argument("--regen-on-fail", action="store_true", help="H3 regen when over-key fails")
    ap.add_argument("--analyze-only", action="store_true")
    args = ap.parse_args()

    stems = ALL_STEMS if args.stem == "all" else [
        s.strip() for s in args.stem.replace(";", ",").split(",") if s.strip()
    ]

    print("=== tease2 QA mp4 analysis ===", flush=True)
    analysis = [analyze_folder(s) for s in stems]
    for a in analysis:
        print(
            f"  {a['stem']}: mp4={a.get('mp4')} "
            f"dur={a.get('duration_s')}s size={a.get('size_kb')}KB "
            f"webm={'yes' if a.get('has_webm') else 'no'}",
            flush=True,
        )

    report = fp.QA_OUT / "rekey_analysis.json"
    report.write_text(json.dumps({"analysis": analysis}, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.analyze_only:
        print("report:", report, flush=True)
        return 0

    results = [
        rekey_one(s, force=args.force, regen_on_fail=args.regen_on_fail) for s in stems
    ]
    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
    }
    out = fp.QA_OUT / "rekey_batch_report.json"
    out.write_text(
        json.dumps({"summary": summary, "analysis": analysis, "results": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("=== REKEY SUMMARY ===", flush=True)
    print("OK:", ", ".join(summary["ok"]) or "(none)", flush=True)
    print("FAIL:", ", ".join(summary["fail"]) or "(none)", flush=True)
    print("report:", out, flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
