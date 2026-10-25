"""Trim pifu08_2 undress loops from loop_windows.json -> {stem}_pifu08_2_loop.webm

Keeps original *_pifu08_2.webm as intro (full undress clip).
Loop is towel-off plateau only (excludes late rewrap when present).
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
ROOT = Path(__file__).resolve().parents[1]
CHONGZAO02 = ROOT / "tex" / "juese" / "pifu" / "chongzao02"
QA = CHONGZAO02 / "_trim_qa"
WINDOWS = QA / "loop_windows.json"
CRF = 20


def frame_trim(
    src: Path,
    dst: Path,
    *,
    start_frame: int,
    end_frame_exclusive: int,
    crf: int = CRF,
) -> None:
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
    return -1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    windows = json.loads(WINDOWS.read_text(encoding="utf-8"))
    if args.stem:
        windows = [w for w in windows if w["stem"] == args.stem]
    for w in windows:
        stem = w["stem"]
        src = CHONGZAO02 / f"{stem}_pifu08_2.webm"
        dst = CHONGZAO02 / f"{stem}_pifu08_2_loop.webm"
        if not src.is_file():
            print("MISSING", src)
            continue
        if dst.is_file() and not args.force:
            print("SKIP exists", dst.name)
            continue
        off = int(w["towel_off_frame"])
        end_ex = int(w["loop_end_frame_exclusive"])
        qa_dst = QA / stem / f"{stem}_pifu08_2_loop.webm"
        print(f"trim {stem}: f{off}..{end_ex} -> {dst.name}", flush=True)
        frame_trim(src, qa_dst, start_frame=off, end_frame_exclusive=end_ex)
        import shutil

        shutil.copy2(qa_dst, dst)
        n = probe_frames(dst)
        print(f"  ok frames={n} expected~{end_ex - off}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
