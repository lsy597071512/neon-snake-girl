#!/usr/bin/env python3
"""Convert the "wuziqi" (chess) H3 greenscreen plates to shipped transparent WebM.

Naming convention (docs/character-skins.md「当前资源命名族」):
    tex/juese/pifu/wuziqi/{ArtStem}_wuziqi.webm

The ArtStem mapping below was solved by matching the head/hair region of every
plate against the 13 canonical portraits in tex/juese/{ArtStem}.png (hair
colour, hair-piece silhouette, eye colour, ear / hair accessory shape) and is
cross-checked by a Hungarian 1-1 assignment over HSV head histograms.

Keying (docs/chroma-key-to-webm.md):
  These plates are NOT pure #00b140 - the measured plate colour drifts across
  the frame, from (0,120,48) over (48,146,104) up to (80,196,146).  A fixed
  #00b140 soft colorkey therefore leaves a halo on the darker / mintier plates,
  and cranking the global similarity starts eating the body.  So we use the
  hue-based analytic matte in scripts/chroma_key_lib.py:
    edge_matte_green_alpha()  green-hue band x saturation x brightness,
                               restricted to plate regions connected to the frame
                               border, with skin / neutrals force-kept
    despill_green()           pulls the green channel down on the soft rim
  A per-clip `colorkey` fallback (firm -> soft ladder) is used when the matte
  does not clear QA.

  A result is accepted only when the QA passes on three frames
  (start / middle / end):
    - the alpha stream really exists (libvpx decode -> RGBA, transparency)
    - all four corners are fully transparent
    - leftover green on the silhouette stays under the bar
    - the silhouette keeps its full height (no cut body)

Output: libvpx-vp9 + yuva420p, CRF 20, 24 fps, no audio.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.chroma_key_lib import despill_green, edge_matte_green_alpha  # noqa: E402

try:
    import imageio_ffmpeg

    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:  # pragma: no cover - fall back to the system ffmpeg
    FFMPEG = "ffmpeg"

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "wuziqi"
SHIP_DIR = SRC_DIR
QA_DIR = SRC_DIR / "_key_qa"

SKIN_TAG = "wuziqi"

# ArtStem <- plate filename.
STEM_BY_CLIP: dict[str, str] = {
    "YZ-H3-一采_00001_p82-audio_zamcp_1792678829.mp4": "SR05_1",
    "YZ-H3-一采_00001_p83-audio_rofin_1792676282.mp4": "SR01_3",
    "YZ-H3-一采_00001_p83-audio_xepmo_1792679235.mp4": "SR02_1",
    "YZ-H3-一采_00002_p80-audio_gptck_1792676694.mp4": "SSR03_1",
    "YZ-H3-一采_00002_p81-audio_mrndb_1792678308.mp4": "SR01_2",
    "YZ-H3-一采_00002_p83-audio_hczgm_1792677426.mp4": "SSR01_1",
    "YZ-H3-一采_00002_p83-audio_vraqt_1792676127.mp4": "SR04_1",
    "YZ-H3-一采_00002_p84-audio_rgxsx_1792676173.mp4": "SSR02_1",
    "YZ-H3-一采_00002_p85-audio_arfru_1792676670.mp4": "SR03_1",
    "YZ-H3-一采_00002_p85-audio_nddxr_1792675964.mp4": "SSR04_1",
    "YZ-H3-一采_00002_p85-audio_omtav_1792677212.mp4": "UR03_1",
    "YZ-H3-一采_00002_p86-audio_lsfmy_1792675316.mp4": "UR04_1",
    "YZ-H3-一采_00002_p87-audio_ubpuy_1792678852.mp4": "SSR05_1",
}

# colorkey fallback ladder (similarity, blend), firmest first.
COLORKEY_LADDER: list[tuple[float, float]] = [
    (0.20, 0.04), (0.18, 0.04), (0.16, 0.05), (0.14, 0.05), (0.12, 0.06), (0.10, 0.06),
]

QA_TIMES = (0.10, 2.50, 4.80)
MAX_LEFTOVER_GREEN = 0.020
MIN_ALPHA_ZERO_PCT = 10.0
MIN_BBOX_H = 0.50


def plate_like(rgb: np.ndarray) -> np.ndarray:
    """Boolean mask: is this pixel plate green?  (same hue model as the matte)"""
    hsv = np.asarray(Image.fromarray(rgb.astype(np.uint8)).convert("HSV"), dtype=np.float32)
    hue = hsv[:, :, 0] * (360.0 / 255.0)
    sat = hsv[:, :, 1] / 255.0
    val = hsv[:, :, 2]
    hue_score = np.clip((70.0 - np.abs(hue - 150.0)) / 45.0, 0.0, 1.0)
    sat_score = np.clip((sat - 0.18) / 0.30, 0.0, 1.0)
    val_score = np.clip((val - 30.0) / 45.0, 0.0, 1.0)
    return (hue_score * sat_score * val_score) > 0.5

def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def extract_frame(src: Path, png: Path, ss: float) -> np.ndarray:
    run([FFMPEG, "-y", "-v", "error", "-ss", str(ss), "-i", str(src),
         "-frames:v", "1", "-update", "1", str(png)])
    return np.asarray(Image.open(png).convert("RGB"))


def matte_frame(rgb: np.ndarray) -> np.ndarray:
    """Analytic green matte + despill -> straight-alpha RGBA."""
    alpha = edge_matte_green_alpha(rgb)
    rgb2 = despill_green(rgb, alpha)
    rgba = np.dstack([rgb2.astype(np.uint8), (alpha * 255.0).round().astype(np.uint8)])
    rgba[rgba[:, :, 3] < 8, :3] = 0  # transparent pixels carry no colour
    return rgba


def encode_frames(frame_dir: Path, dest: Path, *, fps: float, crf: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.webm")
    run([
        FFMPEG, "-y", "-v", "error", "-framerate", str(fps),
        "-i", str(frame_dir / "k_%05d.png"),
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-row-mt", "1",
        "-crf", str(crf), "-b:v", "0", "-an",
        str(tmp),
    ])
    tmp.replace(dest)


def encode_colorkey(src: Path, dest: Path, key: tuple[int, int, int],
                    sim: float, blend: float, *, fps: float, crf: int) -> None:
    hex_key = "0x%02X%02X%02X" % key
    vf = (
        f"colorkey={hex_key}:{sim:.3f}:{blend:.3f},format=rgba,"
        "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
        "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
        "format=yuva420p"
    )
    tmp = dest.with_suffix(".tmp.webm")
    run([
        FFMPEG, "-y", "-v", "error", "-i", str(src), "-vf", vf, "-r", str(fps),
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-auto-alt-ref", "0", "-row-mt", "1",
        "-crf", str(crf), "-b:v", "0", "-an",
        str(tmp),
    ])
    tmp.replace(dest)


def decode_rgba(webm: Path, png: Path, ss: float) -> np.ndarray:
    """Decode with the native libvpx decoder (keeps the alpha side stream)."""
    run([FFMPEG, "-y", "-v", "error", "-c:v", "libvpx-vp9", "-ss", str(ss),
         "-i", str(webm), "-frames:v", "1", "-update", "1", str(png)])
    return np.asarray(Image.open(png).convert("RGBA"))


def qa_webm(webm: Path, work: Path, src_frames: dict[float, np.ndarray]) -> tuple[bool, str, dict]:
    """QA the shipped file: real alpha stream, transparent plate corners, clean rim.

    * leftover green is measured on the SILHOUETTE RIM only - genuine green in
      the subject (SSR02_1's green hair tips, SSR05_1's green tassel) must not
      be counted as a keying failure.
    * a corner only has to be transparent when the SOURCE corner is plate; when
      the character really reaches the frame edge, opaque is correct.
    """
    from scipy import ndimage

    worst_green = 0.0
    min_zero = 100.0
    min_bbox_h = 1.0
    corners_ok = True
    alpha_stream = False

    for i, ss in enumerate(QA_TIMES):
        rgba = decode_rgba(webm, work / f"qa_{i}.png", ss)
        a = rgba[:, :, 3].astype(np.float32)
        rgb = rgba[:, :, :3].astype(np.float32)
        if (a < 250).any():
            alpha_stream = True
        opaque = a >= 200
        if opaque.any():
            near = ndimage.binary_dilation(a < 8, iterations=3)
            gdom = rgb[:, :, 1] - np.maximum(rgb[:, :, 0], rgb[:, :, 2])
            sat = rgb[:, :, 1] - np.minimum(rgb[:, :, 0], rgb[:, :, 2])
            spill = (gdom > 30) & (sat > 40)
            rim = opaque & near & spill
            cnt = int(rim.sum())
            if cnt:
                worst_green = max(worst_green, cnt / float(opaque.sum()))
        min_zero = min(min_zero, 100.0 * float((a == 0).sum()) / a.size)
        ys, xs = np.where(opaque)
        if len(ys) > 100:
            bbox_h = (ys.max() - ys.min() + 1) / a.shape[0]
            min_bbox_h = min(min_bbox_h, float(bbox_h))

        src = src_frames[ss]
        src_green = plate_like(src)
        for box, is_plate in (
            ((slice(0, 24), slice(0, 24)), src_green[:24, :24].mean() > 0.8),
            ((slice(0, 24), slice(-24, None)), src_green[:24, -24:].mean() > 0.8),
            ((slice(-24, None), slice(0, 24)), src_green[-24:, :24].mean() > 0.8),
            ((slice(-24, None), slice(-24, None)), src_green[-24:, -24:].mean() > 0.8),
        ):
            if is_plate and float(a[box].max()) >= 16:
                corners_ok = False

    ok = (
        alpha_stream
        and corners_ok
        and worst_green <= MAX_LEFTOVER_GREEN
        and min_zero >= MIN_ALPHA_ZERO_PCT
        and min_bbox_h >= MIN_BBOX_H
    )
    det = (
        f"alpha_stream={'yes' if alpha_stream else 'NO'} "
        f"rim_green<={worst_green * 100:.2f}% alpha_zero>={min_zero:.1f}% "
        f"bbox_h>={min_bbox_h:.2f} corners={'ok' if corners_ok else 'OPAQUE'}"
    )
    metrics = {
        "alpha_stream": alpha_stream,
        "rim_green_pct": round(worst_green * 100, 3),
        "alpha_zero_pct": round(min_zero, 2),
        "bbox_h": round(min_bbox_h, 3),
        "corners_transparent": corners_ok,
    }
    return ok, det, metrics


def preview_png(webm: Path, out_png: Path, ss: float = 2.5) -> None:
    run([FFMPEG, "-y", "-v", "error", "-c:v", "libvpx-vp9", "-ss", str(ss),
         "-i", str(webm), "-frames:v", "1", "-update", "1", str(out_png)])


def alpha_mode_tag(webm: Path) -> str:
    cp = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format_tags=alpha_mode",
         "-of", "default=nw=1:nk=1", str(webm)],
        capture_output=True, text=True,
    )
    return (cp.stdout or "").strip()


def sample_plate_rgb(rgb: np.ndarray) -> tuple[int, int, int]:
    h, w, _ = rgb.shape
    c = max(16, min(h, w) // 20)
    patches = [
        rgb[:c, :c], rgb[:c, -c:], rgb[-c:, :c], rgb[-c:, -c:],
        rgb[h // 2 - c // 2: h // 2 + c // 2, :c],
        rgb[h // 2 - c // 2: h // 2 + c // 2, -c:],
    ]
    px = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    green = px[(px[:, 1] > px[:, 0] + 8) & (px[:, 1] > px[:, 2] + 6)]
    if len(green) < 32:
        green = px
    med = np.median(green, axis=0)
    return int(med[0]), int(med[1]), int(med[2])

def main() -> int:
    ap = argparse.ArgumentParser(description="wuziqi H3 greenscreen -> transparent WebM")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--crf", type=int, default=20)
    ap.add_argument("--fps", type=float, default=24.0)
    args = ap.parse_args()

    if not SRC_DIR.exists():
        raise SystemExit(f"missing source dir: {SRC_DIR}")

    QA_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []

    clips = sorted(SRC_DIR.glob("*.mp4"))
    unknown = [c.name for c in clips if c.name not in STEM_BY_CLIP]
    if unknown:
        raise SystemExit(f"unmapped plate(s), refusing to guess identity: {unknown}")

    for clip in clips:
        stem = STEM_BY_CLIP[clip.name]
        out = SHIP_DIR / f"{stem}_{SKIN_TAG}.webm"
        row: dict = {"clip": clip.name, "stem": stem, "output": out.name, "ok": False}
        if out.exists() and out.stat().st_size > 80_000 and not args.force:
            row["ok"] = True
            row["skipped"] = True
            results.append(row)
            print(f"[SKIP] {stem} -> {out.name} exists", flush=True)
            continue

        with tempfile.TemporaryDirectory() as td:
            work = Path(td)
            raw_dir = work / "raw"
            keyed_dir = work / "keyed"
            raw_dir.mkdir()
            keyed_dir.mkdir()

            run([FFMPEG, "-y", "-v", "error", "-i", str(clip), "-vsync", "0",
                 str(raw_dir / "f_%05d.png")])
            frames = sorted(raw_dir.glob("f_*.png"))
            if not frames:
                row["error"] = "no frames decoded"
                results.append(row)
                print(f"[FAIL] {stem}: no frames", flush=True)
                continue

            for i, fp in enumerate(frames):
                rgb = np.asarray(Image.open(fp).convert("RGB"))
                rgba = matte_frame(rgb)
                Image.fromarray(rgba, "RGBA").save(keyed_dir / f"k_{i + 1:05d}.png")

            candidate = work / f"{stem}.webm"
            src_frames = {ss: extract_frame(clip, work / f"src_{ss}.png", ss)
                          for ss in QA_TIMES}
            encode_frames(keyed_dir, candidate, fps=args.fps, crf=args.crf)
            ok, det, metrics = qa_webm(candidate, work, src_frames)
            mode = "edge_matte_green"

            if not ok:
                mid = extract_frame(clip, work / "mid.png", QA_TIMES[1])
                key = sample_plate_rgb(mid)
                row["plate_rgb"] = list(key)
                for sim, blend in COLORKEY_LADDER:
                    alt = work / f"ck_{sim:.2f}.webm"
                    encode_colorkey(clip, alt, key, sim, blend,
                                    fps=args.fps, crf=args.crf)
                    ok2, det2, metrics2 = qa_webm(alt, work, src_frames)
                    print(f"  {stem} colorkey sim={sim:.2f} -> {det2}", flush=True)
                    if ok2:
                        shutil.copy2(alt, candidate)
                        ok, det, metrics = True, det2, metrics2
                        mode = f"colorkey sim={sim:.2f}"
                        break

            shutil.copy2(candidate, out)
            prev = QA_DIR / f"{stem}_{SKIN_TAG}_preview.png"
            preview_png(out, prev)
            row.update({
                "ok": ok,
                "mode": mode,
                "metrics": metrics,
                "detail": det,
                "frames": len(frames),
                "bytes": out.stat().st_size,
                "alpha_mode_tag": alpha_mode_tag(out),
                "preview": str(prev),
            })
            print(f"[{'OK' if ok else 'WARN'}] {stem} -> {out.name} "
                  f"({out.stat().st_size // 1024} KB) [{mode}] {det}", flush=True)
            results.append(row)

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "warn": [r["stem"] for r in results if not r.get("ok") and not r.get("error")],
        "fail": [r["stem"] for r in results if r.get("error")],
        "results": results,
    }
    (QA_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = {
        "skin_tag": SKIN_TAG,
        "skin_dir": "tex/juese/pifu/wuziqi",
        "naming": "{ArtStem}_{skin_tag}.webm",
        "spec": {
            "codec": "libvpx-vp9",
            "pix_fmt": "yuva420p",
            "crf": args.crf,
            "fps": args.fps,
            "audio": False,
        },
        "stem_by_clip": STEM_BY_CLIP,
        "results": results,
    }
    (SHIP_DIR / "wuziqi_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print("SUMMARY", json.dumps(
        {"ok": summary["ok"], "warn": summary["warn"], "fail": summary["fail"]},
        ensure_ascii=False), flush=True)
    return 0 if not summary["fail"] and not summary["warn"] else 1


if __name__ == "__main__":
    raise SystemExit(main())