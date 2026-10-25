"""Salvage one Comfy H3 mp4 into v4_stages webm + previews."""
from __future__ import annotations

import argparse
import importlib.util
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "scripts")]

from chroma_key_gs_video_webm import gs_mp4_to_webm

SOFT = (
    "colorkey=0x00B140:0.16:0.04,format=rgba,"
    "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
    "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
    "format=yuva420p"
)


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--stem", required=True, help="e.g. SR01_2_stage2")
    ap.add_argument("--qa-tag", default="")
    args = ap.parse_args()

    out = ROOT / "tex/juese/pifu/pifu_weizhi/webm_tentacle_loop_v4_stages"
    qa = out / "_qa" / f"{args.stem}_salvage"
    qa.mkdir(parents=True, exist_ok=True)
    raw_src = Path(args.raw)
    if not raw_src.exists():
        raise SystemExit(f"missing {raw_src}")

    tm = load("tent", ROOT / "scripts/run_minimax_h3_pifu_weizhi_tentacle_loop_batch.py")
    m = load("chongzao", ROOT / "scripts/run_minimax_h3_chongzao_shower_batch.py")
    tm.QA_DIR = out / "_qa"
    tm.OUT_DIR = out
    tm.CAMERA_CENTER_MAX_SHIFT = 0.12
    tm.CAMERA_SCALE_MAX_DELTA = 0.07

    raw = qa / "a1_raw6s.mp4"
    shutil.copy2(raw_src, raw)
    trimmed = qa / "a1.mp4"
    tm.trim_to_keep_frames(raw, trimmed, 120)

    for t, n in ((0.4, "t040"), (2.5, "t250"), (4.6, "t460")):
        fp = qa / f"a1_{n}.png"
        m.extract_frame(trimmed, t, fp)
        ok, det = tm.green_ok(fp)
        print(f"green[{n}] {ok} {det}", flush=True)

    cam_ok, cam_det, _ = tm.camera_lock_ok(trimmed)
    mot = tm.motion_profile(trimmed)
    print(f"camera {cam_ok} {cam_det}", flush=True)
    print(
        f"motion freeze={mot['freeze']} ratio={mot['ratio']:.2f} tail_r={mot['tail_ratio']:.2f}",
        flush=True,
    )
    if not cam_ok or mot["freeze"]:
        raise SystemExit("QA fail")

    looped = qa / "a1_loop.mp4"
    tm.make_loop_crossfade_mp4(trimmed, looped, blend=3)
    gs = out / f"{args.stem}_tentacle_loop_gs_h3.mp4"
    webm = out / f"{args.stem}_tentacle_loop.webm"
    shutil.copy2(looped, gs)
    gs_mp4_to_webm(gs, webm, fps=24.0, vf=SOFT)
    print(f"webm OK {webm.stat().st_size}", flush=True)

    prev = out / "_qa" / "_preview_salvage"
    prev.mkdir(parents=True, exist_ok=True)
    tag = args.qa_tag or args.stem
    for t in (0.5, 2.5, 4.5):
        m.extract_frame(gs, t, prev / f"{tag}_t{t}.jpg")
    print("previews ok", flush=True)


if __name__ == "__main__":
    main()
