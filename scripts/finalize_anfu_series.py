#!/usr/bin/env python3
"""Finalize 安抚 series batch: staging clipNNN -> neutral anfu_series_NNN names.

- Verifies all 99 staging webms exist (refuses otherwise).
- Copies to <anfu2>/anfu_series_NNN.webm + extracts transparent PNG poster.
- Writes anfu2_series_manifest.json (series name <-> source file trace).

Later, when the user supplies the character mapping, rename to
{Stem}_anfu_K.webm with the same manifest trace.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANFU2 = ROOT / "tex" / "juese" / "pifu" / "anfu2"
STAGE = ANFU2 / "new" / "_webm_out"
MAP = ANFU2 / "new" / "_probe" / "staging_map.json"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    rows = json.loads(MAP.read_text(encoding="utf-8"))["unique"]
    missing = [r for r in rows if not (STAGE / f"clip{r['idx']:03d}.webm").exists()]
    if missing:
        print(f"NOT READY: {len(missing)}/{len(rows)} missing, e.g. "
              f"{[r['idx'] for r in missing[:8]]}")
        return 1

    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()

    ANFU2.mkdir(parents=True, exist_ok=True)
    out_rows = []
    for r in rows:
        n = r["idx"]
        webm = ANFU2 / f"anfu_series_{n:03d}.webm"
        png = ANFU2 / f"anfu_series_{n:03d}.png"
        shutil.copyfile(STAGE / f"clip{n:03d}.webm", webm)
        subprocess.run([ff, "-y", "-loglevel", "error", "-c:v", "libvpx-vp9",
                        "-i", str(webm), "-vf", "format=rgba",
                        "-vframes", "1", str(png)], check=True)
        out_rows.append({"series": webm.name, "poster": png.name,
                         "staging": f"clip{n:03d}.webm", "source": r["source"]})
        print(f"[{n}/{len(rows)}] {webm.name}", flush=True)

    (ANFU2 / "anfu2_series_manifest.json").write_text(
        json.dumps({"dir": "tex/juese/pifu/anfu2", "pattern": "{Stem}_anfu_N (pending mapping)",
                    "items": out_rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"DONE {len(out_rows)} series files + posters in {ANFU2}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
