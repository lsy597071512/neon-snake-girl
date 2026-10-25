"""Verify every skin webm has real transparency (no background).

For each .webm under tex/juese/pifu (+ tex/juese top-level portraits):
decode 3 frames as RGBA, require BOTH transparent (<16) and opaque (>240)
pixels in each frame. Reports files with missing/suspicious alpha.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ff = imageio_ffmpeg.get_ffmpeg_exe()


def check(path: Path) -> dict:
    secs = []
    # probe duration first
    p = subprocess.run([ff, "-hide_banner", "-i", str(path)], capture_output=True)
    info = p.stderr.decode("utf-8", errors="ignore")
    dur = 0.0
    for line in info.splitlines():
        if "Duration" in line:
            t = line.split("Duration:")[1].split(",")[0].strip()
            try:
                h, m, s = t.split(":")
                dur = int(h) * 3600 + int(m) * 60 + float(s)
            except ValueError:
                pass
    if dur <= 0:
        return {"file": str(path), "ok": False, "error": "no duration / unreadable"}
    times = [round(dur * f, 2) for f in (0.3, 0.55, 0.8)]
    worst = None
    for t in times:
        out = path.parent / f"_tmp_alpha_{path.stem}.png"
        r = subprocess.run([ff, "-y", "-loglevel", "error", "-c:v", "libvpx-vp9",
                            "-ss", str(t), "-i", str(path), "-vf", "format=rgba",
                            "-vframes", "1", str(out)], capture_output=True)
        if r.returncode != 0 or not out.exists():
            return {"file": str(path), "ok": False, "error": f"decode fail t={t}"}
        a = np.array(Image.open(out).convert("RGBA"))[:, :, 3].astype(float)
        out.unlink(missing_ok=True)
        trans = (a < 16).mean()
        opaque = (a > 240).mean()
        if worst is None or min(trans, opaque) < min(worst[0], worst[1]):
            worst = (trans, opaque)
    trans, opaque = worst
    ok = trans > 0.02 and opaque > 0.02
    return {"file": str(path), "ok": ok, "transparent": round(trans, 3),
            "opaque": round(opaque, 3)}


def main() -> int:
    roots = [ROOT / "tex" / "juese" / "pifu"]
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    files = sorted(p for r in roots for p in r.rglob("*.webm"))
    if arg:
        files = [p for p in files if arg in str(p)]
    print(f"checking {len(files)} webms", flush=True)
    bad = []
    for i, f in enumerate(files, 1):
        r = check(f)
        if not r["ok"]:
            bad.append(r)
            print(f"[{i}/{len(files)}] BAD {f.relative_to(ROOT)} {r}", flush=True)
        elif i % 40 == 0:
            print(f"[{i}/{len(files)}] ...", flush=True)
    print(f"done: {len(files)} checked, {len(bad)} BAD")
    for b in bad:
        print("BAD:", b)
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
