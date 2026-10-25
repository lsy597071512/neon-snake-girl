"""Extract 768x1344 first frames from SR01_2 pose webms into v4_stages/_src."""
from __future__ import annotations

import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SRC_ROOT = ROOT / "tex" / "juese" / "pifu" / "tiaojiao"
OUT = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "webm_tentacle_loop_v4_stages" / "_src" / "SR01_2"
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
    # Fit into 768x1344 on green
    scale = min(W / im.width, H / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (*GREEN, 255))
    x, y = (W - nw) // 2, (H - nh) // 2
    canvas.alpha_composite(im2, (x, y))
    # flatten on green
    bg = Image.new("RGB", (W, H), GREEN)
    bg.paste(canvas, mask=canvas.split()[-1])
    dest.parent.mkdir(parents=True, exist_ok=True)
    bg.save(dest, "PNG")
    tmp.unlink(missing_ok=True)
    print(f"OK {dest.name} from {webm.name} src={im.size} -> {W}x{H}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for i in (1, 2, 3):
        webm = SRC_ROOT / f"SR01_2_tiaojiao_{i}.webm"
        if not webm.exists():
            raise SystemExit(f"missing {webm}")
        extract_frame(webm, OUT / f"SR01_2_stage{i}_first.png")


if __name__ == "__main__":
    main()
