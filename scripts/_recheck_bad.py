"""Extract BAD list from verify run terminal log, re-check with fixed-time decode."""
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LOG = Path(r"C:\Users\LiSuYan\.cursor\projects\f-AI-neon-snake-girl-1-neon-snake-girl-neon-snake-girl\terminals\769307.txt")
ff = imageio_ffmpeg.get_ffmpeg_exe()

lines = LOG.read_text(encoding="utf-8", errors="ignore").splitlines()
pat = re.compile(r"BAD (tex\\juese\\pifu\\\S+?\.webm)")
bad = sorted({m.group(1).replace("\\", "/") for l in lines if (m := pat.search(l))})
print(f"{len(bad)} unique bad files")
(ROOT / "tex" / "juese" / "pifu" / "_verify_badlist.txt").write_text("\n".join(bad), encoding="utf-8")

real_bad = []
for i, rel in enumerate(bad, 1):
    p = ROOT / rel
    results = []
    for t in (1.0, 2.0, 3.0):
        out = p.parent / "_tmp_recheck.png"
        r = subprocess.run([ff, "-y", "-loglevel", "error", "-c:v", "libvpx-vp9",
                            "-ss", str(t), "-i", str(p), "-vf", "format=rgba",
                            "-vframes", "1", str(out)], capture_output=True)
        if r.returncode != 0 or not out.exists():
            results.append(None)
            continue
        a = np.array(Image.open(out).convert("RGBA"))[:, :, 3].astype(float)
        out.unlink(missing_ok=True)
        results.append(((a < 16).mean(), (a > 240).mean()))
    good = [x for x in results if x is not None]
    if not good:
        real_bad.append((rel, "UNDECODABLE at 1/2/3s"))
        print(f"[{i}/{len(bad)}] UNDECODABLE {rel}", flush=True)
        continue
    trans = min(x[0] for x in good)
    opaque = min(x[1] for x in good)
    ok = trans > 0.02 and opaque > 0.02
    if not ok:
        real_bad.append((rel, f"trans={trans:.3f} opaque={opaque:.3f}"))
        print(f"[{i}/{len(bad)}] REAL-BAD {rel} trans={trans:.3f} opaque={opaque:.3f}", flush=True)
    elif i % 20 == 0:
        print(f"[{i}/{len(bad)}] ...", flush=True)

print(f"\nrecheck done: {len(bad)} flagged, {len(real_bad)} REAL problems")
for rel, why in real_bad:
    print("REAL-BAD:", rel, why)
