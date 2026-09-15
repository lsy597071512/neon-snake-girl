"""Chroma-key #00b140 greenscreen → VP9 WebM with alpha (game live portrait).

Important:
- Must encode libvpx-vp9 + yuva420p (alpha_mode=1).
- Transparent pixels should have RGB cleared (premultiply), otherwise Windows
  Explorer / some players show leftover green even when alpha=0.
- Verify with: ffmpeg -c:v libvpx-vp9 -i file.webm (native decoder hides alpha).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

try:
    import imageio_ffmpeg

    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = "ffmpeg"

KEY_HEX = "0x00B140"
# key → rgba → zero RGB where nearly transparent → yuva for VP9 alpha
DEFAULT_VF = (
    f"colorkey={KEY_HEX}:0.35:0.08,format=rgba,"
    "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
    "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
    "format=yuva420p"
)


def gs_mp4_to_webm(
    src_mp4: Path,
    dest_webm: Path,
    *,
    fps: float = 24.0,
    crf: int = 32,
    vf: str = DEFAULT_VF,
) -> Path:
    dest_webm.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest_webm.with_suffix(".tmp.webm")
    cmd = [
        FFMPEG,
        "-y",
        "-i",
        str(src_mp4),
        "-vf",
        vf,
        "-r",
        str(fps),
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
        "-an",
        str(tmp),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    tmp.replace(dest_webm)
    return dest_webm


def verify_has_alpha(webm: Path, *, min_zero_pct: float = 40.0) -> tuple[bool, str]:
    """Decode with libvpx (preserves alpha) and check transparent coverage."""
    from PIL import Image
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        png = Path(td) / "f.png"
        cmd = [
            FFMPEG,
            "-y",
            "-c:v",
            "libvpx-vp9",
            "-i",
            str(webm),
            "-vf",
            "format=rgba",
            "-frames:v",
            "1",
            "-update",
            "1",
            str(png),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        im = Image.open(png).convert("RGBA")
        a = list(im.getchannel("A").getdata())
        zero = 100.0 * sum(1 for x in a if x == 0) / len(a)
        tl = im.getpixel((5, 5))
        ok = zero >= min_zero_pct and tl[3] == 0
        return ok, f"alpha_zero%={zero:.1f} TL={tl}"
