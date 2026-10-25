#!/usr/bin/env python3
"""Recompress anfu2 series webms from CRF20 to CRF24 (VP9 + alpha).

Usage:
  python scripts/recompress_anfu2_crf24.py [--only 1,2,3] [--jobs 2] [--force]

Runs N parallel ffmpeg jobs (default 2; ffmpeg-only, no rembg, low memory).
Keeps originals as *.crf20.webm backup on first pass; verifies alpha survived.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANFU2 = ROOT / "tex" / "juese" / "pifu" / "anfu2"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()

    files = sorted(ANFU2.glob("anfu_series_*.webm"))
    files = [f for f in files if not f.name.endswith(".crf20.webm")]
    want = {int(v) for v in args.only.split(",") if v.strip().isdigit()}
    if want:
        files = [f for f in files
                 if int(f.stem.split("_")[-1]) in want]
    if not files:
        print("nothing selected")
        return 1

    def job(path: Path) -> dict:
        t0 = time.time()
        bak = path.with_suffix(".crf20.webm")
        if not bak.exists():
            path.rename(bak)
        else:
            bak = None  # already backed up; re-encode from backup
        src = bak if bak else path.with_suffix(".crf20.webm")
        if not args.force and path.exists() and path.stat().st_size > 10_000 and bak is None:
            # already recompressed (backup exists and current differs from backup)
            if path.stat().st_size != src.stat().st_size:
                return {"file": path.name, "ok": True, "skipped": True, "secs": 0}
        cmd = [ff, "-y", "-loglevel", "error", "-c:v", "libvpx-vp9", "-i", str(src),
               "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0",
               "-crf", "24", "-row-mt", "1", "-threads", "4", str(path)]
        r = subprocess.run(cmd)
        dt = time.time() - t0
        if r.returncode != 0 or not path.exists():
            return {"file": path.name, "ok": False, "error": f"rc={r.returncode}", "secs": round(dt, 1)}
        # verify alpha survived (VP9 stores it as ALPHA_MODE metadata, not pix_fmt)
        v = subprocess.run([ff, "-hide_banner", "-i", str(path)], capture_output=True)
        info = v.stderr.decode("utf-8", errors="ignore")
        alpha_ok = "ALPHA_MODE" in info.upper()
        return {"file": path.name, "ok": alpha_ok,
                "src_mb": round(src.stat().st_size / 1e6, 2),
                "dst_mb": round(path.stat().st_size / 1e6, 2),
                "secs": round(dt, 1)}

    t_all = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for res in ex.map(job, files):
            results.append(res)
            print(f"{res['file']}: {'OK' if res.get('ok') else 'FAIL'} "
                  f"{res.get('src_mb', '')}->{res.get('dst_mb', '')}MB "
                  f"{res.get('secs', '')}s {res.get('error', '')}", flush=True)

    ok = [r for r in results if r.get("ok") and not r.get("skipped")]
    fail = [r for r in results if not r.get("ok")]
    if ok:
        s0 = sum(r["src_mb"] for r in ok)
        s1 = sum(r["dst_mb"] for r in ok)
        avg = sum(r["secs"] for r in ok) / len(ok)
        print(f"OK={len(ok)} FAIL={len(fail)} SKIP={len(results)-len(ok)-len(fail)} "
              f"size {s0:.1f}->{s1:.1f}MB ({s1/s0*100:.0f}%) avg {avg:.0f}s/file/job "
              f"wall {time.time()-t_all:.0f}s")
    manifest = ANFU2 / "anfu2_crf24_manifest.json"
    manifest.write_text(json.dumps({"results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if not fail else 1


if __name__ == "__main__":
    raise SystemExit(main())
