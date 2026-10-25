"""Extract 768x1344 stage stills + frontal covered_lock for v4_stages.

covered_lock prefers tiaojiao_1 (usually frontal, lace-covered) so S2/S3
do not invent bare breasts from a rear stage1 plate.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
TIAO = ROOT / "tex" / "juese" / "pifu" / "tiaojiao"
OUT_ROOT = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "webm_tentacle_loop_v4_stages" / "_src"
W, H = 768, 1344
GREEN = (0, 177, 64)


def extract_frame(webm: Path, dest: Path) -> None:
    tmp = dest.with_suffix(".tmp.png")
    subprocess.run(
        [FFMPEG, "-y", "-i", str(webm), "-frames:v", "1", str(tmp)],
        check=True,
        capture_output=True,
    )
    im = Image.open(tmp).convert("RGBA")
    scale = min(W / im.width, H / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (*GREEN, 255))
    x, y = (W - nw) // 2, (H - nh) // 2
    canvas.alpha_composite(im2, (x, y))
    bg = Image.new("RGB", (W, H), GREEN)
    bg.paste(canvas, mask=canvas.split()[-1])
    dest.parent.mkdir(parents=True, exist_ok=True)
    bg.save(dest, "PNG")
    tmp.unlink(missing_ok=True)
    print(f"OK {dest.name} from {webm.name} src={im.size} -> {W}x{H}", flush=True)


def resolve_pose_webm(char: str, pose_i: int) -> Path:
    webm = TIAO / f"{char}_tiaojiao_{pose_i}.webm"
    if webm.exists():
        return webm
    # fallback: idle plate
    idle = TIAO / f"{char}_tiaojiao.webm"
    if idle.exists():
        return idle
    raise SystemExit(f"missing {webm}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True, help="e.g. SSR05_1")
    ap.add_argument("--poses", default="1,2,3", help="pose indices mapped to stage1/2/3")
    ap.add_argument(
        "--covered-pose",
        type=int,
        default=1,
        help="pose index for frontal covered_lock (default 1)",
    )
    args = ap.parse_args()
    out = OUT_ROOT / args.char
    out.mkdir(parents=True, exist_ok=True)
    poses = [int(x.strip()) for x in args.poses.split(",") if x.strip()]
    if len(poses) != 3:
        raise SystemExit("need exactly 3 pose indices for stage1/2/3")
    for stage, pose_i in enumerate(poses, start=1):
        extract_frame(resolve_pose_webm(args.char, pose_i), out / f"{args.char}_stage{stage}_first.png")

    covered = out / f"{args.char}_covered_lock.png"
    extract_frame(resolve_pose_webm(args.char, args.covered_pose), covered)
    # Keep stage1 as a usable alias if covered missing in older runs
    stage1 = out / f"{args.char}_stage1_first.png"
    if not covered.exists() and stage1.exists():
        shutil.copy2(stage1, covered)
    print(f"covered_lock ready: {covered}", flush=True)


if __name__ == "__main__":
    main()
