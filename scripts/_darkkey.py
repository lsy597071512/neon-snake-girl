"""Key black-background clips with rembg subject mask only (no chroma key).

Black studio bg: border palette ~= subject's dark hair, so chroma distance
fails. u2net segments the person directly; keep largest component, feather.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes, gaussian_filter, label

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"F:\AI\wudao")
OUT = ROOT / "tex" / "juese" / "pifu" / "danceidle" / "new" / "_webm_out"
QA = ROOT / "tex" / "juese" / "pifu" / "danceidle" / "new" / "_key_qa"
ff = imageio_ffmpeg.get_ffmpeg_exe()


def main() -> int:
    only = [int(v) for v in sys.argv[1].split(",")] if len(sys.argv) > 1 else [4, 9]
    files = sorted(SRC.glob("*.mp4"))
    from rembg import new_session, remove

    session = new_session("u2net")
    for idx in only:
        src = files[idx - 1]
        tag = f"clip{idx:03d}"
        print(f"[{idx}] {src.name} -> {tag}.webm (darkkey)", flush=True)
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(src),
                            str(tmpd / "f%04d.png")], check=True)
            frames = sorted(tmpd.glob("f*.png"))
            print(f"  {len(frames)} frames", flush=True)
            alphas = []
            outs = []
            for k, fp in enumerate(frames):
                img = Image.open(fp).convert("RGB")
                mask_img = remove(img, session=session, only_mask=True)
                m = (np.array(mask_img).astype(float) / 255.0) > 0.5
                m = binary_fill_holes(m)
                lab, n = label(m)
                if n > 1:
                    sizes = [(lab == i).sum() for i in range(1, n + 1)]
                    m = lab == (int(np.argmax(sizes)) + 1)
                a = gaussian_filter(m.astype(float), 1.0)
                alphas.append(a)
                rgba = np.dstack([np.array(img), (a * 255).astype(np.uint8)])
                outs.append(tmpd / f"a{k:04d}.png")
                Image.fromarray(rgba).save(outs[-1])
                if (k + 1) % 40 == 0:
                    print(f"  mask {k+1}/{len(frames)}", flush=True)
            A = np.stack(alphas)
            h, w = A.shape[1], A.shape[2]
            border = np.concatenate([A[:, :4, :].reshape(len(A), -1),
                                     A[:, -4:, :].reshape(len(A), -1),
                                     A[:, :, :4].reshape(len(A), -1),
                                     A[:, :, -4:].reshape(len(A), -1)], axis=1)
            print(f"  border_alpha_mean={border.mean():.4f} "
                  f"subject_frac={(A > 0.5).mean():.3f}", flush=True)
            qadir = QA / tag
            qadir.mkdir(parents=True, exist_ok=True)
            mid = Image.open(outs[len(outs) // 2])
            mid.save(qadir / f"{tag}_darkkey_preview.png")
            target = OUT / f"{tag}.webm"
            subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", "24",
                            "-i", str(tmpd / "a%04d.png"), "-c:v", "libvpx-vp9",
                            "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "20",
                            "-row-mt", "1", str(target)], check=True)
            print(f"  wrote {target.name} {target.stat().st_size/1e6:.2f}MB", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
