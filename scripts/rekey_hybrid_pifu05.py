"""Hybrid rembg + chroma key for pifu05 tease clips when rembg ladder fails on IOU."""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import scripts.chroma_key_lib as ck

GREEN = np.array([0, 177, 64], dtype=np.float32)
KEY_DOM = 1


def hybrid_compose(rgb: np.ndarray, rem: np.ndarray, key: np.ndarray, key_dom: int) -> np.ndarray:
    core, soft = ck.protect_masks(rem)
    a = ck.chroma_alpha(rgb, key, sim=0.28, blend=0.10, key_dom=key_dom)
    a = np.where(soft, np.maximum(a, 0.92), a)
    a = np.where(core, 1.0, a)
    greenish = (
        (rgb[:, :, 1] > rgb[:, :, 0] * 1.05)
        & (rgb[:, :, 1] > rgb[:, :, 2] * 1.05)
        & (a < 0.5)
    )
    a = np.where(greenish & ~core, np.minimum(a, 0.02), a)
    rgb2 = ck.despill_advanced(rgb, a, core, key_dom)
    aa = np.clip(a * 255.0, 0, 255).astype(np.uint8)
    aa = np.where(aa < 16, 0, aa).astype(np.uint8)
    rgba = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    rgb_u8 = np.clip(rgb2, 0, 255).astype(np.uint8)
    transparent = aa < 8
    for c in range(3):
        rgba[:, :, c] = np.where(transparent, 0, rgb_u8[:, :, c])
    rgba[:, :, 3] = aa
    return rgba


def process(mp4: Path, webm: Path, qa_dir: Path, stem: str, session) -> bool:
    frames = ck.extract_frames(mp4, qa_dir / stem / "raw")
    keyed = qa_dir / stem / "keyed"
    if keyed.exists():
        shutil.rmtree(keyed)
    keyed.mkdir(parents=True)
    key = GREEN
    print(f"  frames={len(frames)}", flush=True)
    for i, fp in enumerate(frames):
        rgb = np.asarray(Image.open(fp).convert("RGB"))
        rem = np.asarray(remove(rgb, session=session, only_mask=True))
        if rem.ndim == 3:
            rem = rem[:, :, 0]
        rem = rem.astype(np.float32) / 255.0
        rgba = hybrid_compose(rgb.astype(np.float32), rem, key, KEY_DOM)
        Image.fromarray(rgba, "RGBA").save(keyed / f"k_{i + 1:05d}.png")
        if i % 20 == 0:
            keep = float(rgba[:, :, 3].mean() / 255.0)
            print(f"  frame {i + 1}/{len(frames)} keep={keep:.3f}", flush=True)
    ck.encode_webm(keyed, webm)
    ok, det = ck.verify_webm_alpha(webm)
    print(f"  webm_verify ok={ok} {det}", flush=True)
    if webm.exists():
        kb = webm.stat().st_size // 1024
        print(f"  shipped {webm} ({kb} KB)", flush=True)
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", required=True)
    ap.add_argument("--attempt", type=int, default=None, help="QA attempt number e.g. 5 uses a5.mp4")
    args = ap.parse_args()
    stem = args.stem
    base = ROOT / "tex" / "juese" / "pifu" / "teshufuzhuang01"
    qa = base / "_qa_tease" / "_rekey_hybrid"
    qa.mkdir(parents=True, exist_ok=True)
    if args.attempt:
        mp4 = base / "_qa_tease" / stem / f"a{args.attempt}.mp4"
    else:
        mp4 = base / f"{stem}_pifu05_tease_gs_h3.mp4"
    webm = base / f"{stem}_pifu05.webm"
    bak = base / f"{stem}_pifu05.webm.bak_before_face_regen"
    if not mp4.exists():
        print(f"missing {mp4}", flush=True)
        return 1
    if webm.exists() and not bak.exists():
        shutil.copy2(webm, bak)
    ship_mp4 = base / f"{stem}_pifu05_tease_gs_h3.mp4"
    shutil.copy2(mp4, ship_mp4)
    print(f"=== hybrid {stem} from {mp4.name} ===", flush=True)
    session = new_session("u2net")
    out_tmp = qa / f"{stem}_pifu05.webm"
    ok = process(mp4, out_tmp, qa, stem, session)
    if ok:
        shutil.copy2(out_tmp, webm)
    print(f"DONE ok={ok}", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
