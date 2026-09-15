"""Rekey pifu05 tease webms that were damaged by aggressive colorkey fallback.

Uses rembg-protect path with slightly relaxed IOU (keep=1.0 already means
character was not cut; low iou is fringe, not holes).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import scripts.chroma_key_lib as ck
from rembg import new_session

# Prefer rembg-protect over destructive ffmpeg colorkey
ck.MIN_IOU = 0.74
ck.MIN_KEEP = 0.98
ck.MAX_RIM_BAD = 0.20
ck.MAX_RIM_SPILL = 8.0

DIR = ROOT / "tex" / "juese" / "pifu" / "teshufuzhuang01"
QA = DIR / "_qa_tease" / "_rekey"
STEMS = ["UR03_1", "SSR04_1", "SSR02_1"]


def main() -> int:
    QA.mkdir(parents=True, exist_ok=True)
    print("loading rembg u2net...", flush=True)
    session = new_session("u2net")
    print("session ready", flush=True)

    ok_list, fail_list = [], []
    for stem in STEMS:
        mp4 = DIR / f"{stem}_pifu05_tease_gs_h3.mp4"
        webm = DIR / f"{stem}_pifu05.webm"
        bak = DIR / f"{stem}_pifu05.webm.bak_bad_colorkey"
        if not mp4.exists():
            print(f"[SKIP] missing mp4 {mp4}", flush=True)
            fail_list.append(stem)
            continue
        if webm.exists() and not bak.exists():
            shutil.copy2(webm, bak)
            print(f"backed up {bak.name}", flush=True)
        out_tmp = QA / f"{stem}_pifu05.webm"
        print(f"=== rekey {stem} ===", flush=True)
        r = ck.process_video(
            mp4,
            out_tmp,
            session=session,
            qa_dir=QA,
            qa_tag=f"{stem}_pifu05",
            ship_path=webm,
            key_rgb=(0, 177, 64),
            key_color="green",
            force=True,
            backup_ship=False,
            min_bbox_h=0.55,
        )
        detail = r.get("detail") or r.get("error") or r.get("webm_verify") or ""
        print(f"{stem} ok={r.get('ok')} sim={r.get('sim')} {detail}", flush=True)
        (ok_list if r.get("ok") else fail_list).append(stem)

    print("=== DONE ===", flush=True)
    print(f"OK: {ok_list}", flush=True)
    print(f"FAIL: {fail_list}", flush=True)
    return 0 if not fail_list else 1


if __name__ == "__main__":
    raise SystemExit(main())
