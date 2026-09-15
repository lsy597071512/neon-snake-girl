"""Frame-accurate trim for pifu03 intimate webms -> post-towel loop clip.

The shipped `{stem}_pifu03.webm` (portraitLiveIntimate) is a full H3 clip:
  [0-1.5s] water on
  [1.5-3.5s] remove towel
  [3.5-end] bathing idle (loop target)

Stream copy (-c copy) is NOT frame-accurate on these VP9 webms (only 1 keyframe),
so we decode with libvpx-vp9 and re-encode with the same yuva420p / CRF settings
as scripts/chroma_key_lib.py. Pixels are taken directly from the full clip — no
re-chroma, no regeneration.

Backs up the full clip to `{stem}_pifu03_full.webm` before replacing shipped file.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg

from analyze_pifu03_towel_off import CHONGZAO, FPS, QA, analyze

FF = imageio_ffmpeg.get_ffmpeg_exe()
CRF = 20


def probe_frames(path: Path) -> int:
    out = subprocess.run(
        [FF, "-hide_banner", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    for line in (out.stderr or "").splitlines():
        if line.strip().startswith("frame="):
            parts = line.split()
            for i, p in enumerate(parts):
                if p == "frame=" and i + 1 < len(parts):
                    return int(parts[i + 1])
    raise RuntimeError(f"could not count frames: {path}")


def frame_trim(
    src: Path,
    dst: Path,
    *,
    start_frame: int,
    end_frame_exclusive: int,
    crf: int = CRF,
) -> None:
    """Inclusive start frame, exclusive end (ffmpeg trim end_frame)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    vf = f"trim=start_frame={start_frame}:end_frame={end_frame_exclusive},setpts=PTS-STARTPTS"
    cmd = [
        FF,
        "-y",
        "-c:v",
        "libvpx-vp9",
        "-i",
        str(src),
        "-vf",
        vf,
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-crf",
        str(crf),
        "-b:v",
        "0",
        "-row-mt",
        "1",
        str(dst),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def trim_stem(
    stem: str,
    *,
    force: bool,
    manual_start_s: float | None,
    manual_end_s: float | None,
    crf: int,
) -> dict:
    shipped = CHONGZAO / f"{stem}_pifu03.webm"
    full_backup = CHONGZAO / f"{stem}_pifu03_full.webm"
    if not full_backup.is_file():
        if not shipped.is_file():
            raise FileNotFoundError(shipped)
        shutil.copy2(shipped, full_backup)
    source_for_trim = full_backup

    info = analyze(source_for_trim, stem=stem)
    start_s = manual_start_s if manual_start_s is not None else info["towel_off_s"]
    end_s = manual_end_s if manual_end_s is not None else info["loop_end_s"]
    start_frame = int(round(start_s * FPS))
    end_frame_exclusive = int(round(end_s * FPS)) + 1

    out_qa = QA / stem / f"{stem}_pifu03_loop.webm"
    frame_trim(
        source_for_trim,
        out_qa,
        start_frame=start_frame,
        end_frame_exclusive=end_frame_exclusive,
        crf=crf,
    )
    before = probe_frames(source_for_trim)
    after = probe_frames(out_qa)
    expected = end_frame_exclusive - start_frame

    if force or shipped.resolve() != out_qa.resolve():
        shutil.copy2(out_qa, shipped)

    return {
        **info,
        "source_for_trim": str(source_for_trim),
        "trim_start_s": start_s,
        "trim_end_s": end_s,
        "trim_start_frame": start_frame,
        "trim_end_frame_exclusive": end_frame_exclusive,
        "expected_loop_frames": expected,
        "source_frames": before,
        "output_frames": after,
        "frame_match": after == expected,
        "encode_crf": crf,
        "shipped": str(shipped),
        "qa_out": str(out_qa),
        "backup_full": str(full_backup),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="SR01_2")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--start", type=float, default=None, help="override start seconds")
    ap.add_argument("--end", type=float, default=None, help="override end seconds")
    ap.add_argument("--crf", type=int, default=CRF)
    args = ap.parse_args()
    stems = sorted(p.stem.replace("_pifu03", "") for p in CHONGZAO.glob("*_pifu03.webm")) if args.all else [args.stem]
    report = []
    for stem in stems:
        if stem.endswith("_full"):
            continue
        print(f"=== trim {stem} ===", flush=True)
        result = trim_stem(
            stem,
            force=args.force,
            manual_start_s=args.start,
            manual_end_s=args.end,
            crf=args.crf,
        )
        report.append(result)
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    out = QA / "trim_loop_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
