#!/usr/bin/env python3
"""Move finished gongwu clips to gongwu/ root + posters + manifest."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
GWROOT = ROOT / "tex" / "juese" / "pifu" / "gongwu"
STAGE = GWROOT / "new" / "_webm_out"
FINAL = GWROOT / "new" / "_webm_final"
ff = imageio_ffmpeg.get_ffmpeg_exe()


def main() -> None:
    rows = []
    for w in sorted(STAGE.glob("*_gongwu.webm")):
        src = FINAL / w.name if (FINAL / w.name).exists() else w
        dst = GWROOT / w.name
        shutil.copyfile(src, dst)
        png = GWROOT / f"{w.stem}.png"
        subprocess.run([ff, "-y", "-loglevel", "error", "-c:v", "libvpx-vp9",
                        "-ss", "3.6", "-i", str(dst), "-vf", "format=rgba",
                        "-vframes", "1", str(png)], check=True)
        rows.append({"file": dst.name, "poster": png.name,
                     "mb": round(dst.stat().st_size / 1e6, 2),
                     "keyed": "rekeyed" if src.parent == FINAL else "as-staged"})
        print(dst.name, rows[-1]["mb"], rows[-1]["keyed"], flush=True)
    (GWROOT / "gongwu_manifest.json").write_text(
        json.dumps({"dir": "tex/juese/pifu/gongwu", "naming": "user-renamed 2026-10-16",
                    "items": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"gongwu root done: {len(rows)}")


if __name__ == "__main__":
    raise SystemExit(main())
