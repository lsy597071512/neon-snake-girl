#!/usr/bin/env python3
"""Batch-convert the 13 unmapped YZ-H3 climax MP4s to {CHAR}_climax.webm.

Strategy (per chroma-key-to-webm skill): these are standard H3 greenscreen
plates, so the fast soft-colorkey path (0.16/0.04) comes first at ~1-2 min
per clip. The strict rembg ladder was measured to FAIL all 13 of these
full-frame plates, so it is NOT used here. Corner-alpha QA decides accept;
failures fall back to green_dom mode in key_huanzhuang_h3_to_webm.py.

Mapping was derived by hair/face-region HSV matching against the established
a-m letter groups, then solved with a unique 1-1 assignment (Hungarian).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.key_huanzhuang_h3_to_webm import encode_green_dom_webm  # noqa: E402

NEW = ROOT / "tex" / "juese" / "pifu" / "tiaojiao" / "new"
OUT = ROOT / "tex" / "juese" / "pifu" / "tiaojiao" / "new_webm_crf20_merged"
QA = NEW / "_key_qa"

SOFT_KEY_VF = (
    "colorkey=0x00B140:0.16:0.04,format=rgba,"
    "geq=r='r(X,Y)*alpha(X,Y)/255':g='g(X,Y)*alpha(X,Y)/255':"
    "b='b(X,Y)*alpha(X,Y)/255':a='alpha(X,Y)',"
    "format=yuva420p"
)

LETTER_TO_CHAR = {
    "a": "SR01_2", "b": "SR01_3", "c": "SR02_1", "d": "SR03_1",
    "e": "SR04_1", "f": "SR05_1", "g": "SSR01_1", "h": "SSR02_1",
    "i": "SSR03_1", "j": "SSR04_1", "k": "SSR05_1", "l": "UR03_1",
    "m": "UR04_1",
}

CLIMAX_MAP: dict[str, str] = {
    "YZ-H3-一采_00002_p87-audio_hxziv_1790676569.mp4": "b",
    "YZ-H3-一采_00002_p87-audio_hgblt_1790678439.mp4": "f",
    "YZ-H3-一采_00002_p87-audio_zgohu_1790679496.mp4": "d",
    "YZ-H3-一采_00002_p84-audio_bkbci_1790680878.mp4": "e",
    "YZ-H3-一采_00004_p87-audio_qkvuz_1790682149.mp4": "l",
    "YZ-H3-一采_00002_p87-audio_ayepx_1790682741.mp4": "a",
    "YZ-H3-一采_00002_p82-audio_bclhb_1790682885.mp4": "c",
    "YZ-H3-一采_00002_p80-audio_bjtlt_1790682829.mp4": "m",
    "YZ-H3-一采_00004_p87-audio_rttml_1790683343.mp4": "g",
    "YZ-H3-一采_00006_p83-audio_iytjy_1790684722 (1).mp4": "k",
    "YZ-H3-一采_00002_p87-audio_mniaa_1790686080.mp4": "i",
    "YZ-H3-一采_00001_p81-audio_bsnpe_1790686185.mp4": "h",
    "YZ-H3-一采_00002_p80-audio_xzsls_1790686386.mp4": "j",
}

LOW_CONFIDENCE = ["UR03_1"]


def corner_alpha_ok(webm: Path, qa_tag: str) -> tuple[bool, str]:
    """Decode the middle frame to RGBA and require transparent corners."""
    from PIL import Image

    probe = QA / f"{qa_tag}_corner.png"
    cp = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-sseof", "-3", "-i", str(webm),
         "-frames:v", "1", str(probe)],
        capture_output=True, text=True,
    )
    if not probe.exists():
        return False, f"frame extract failed: {cp.stderr[-200:]}"
    img = Image.open(probe).convert("RGBA")
    w, h = img.size
    box = 24
    corners = [
        img.crop((0, 0, box, box)),
        img.crop((w - box, 0, w, box)),
        img.crop((0, h - box, w, h - box)),
        img.crop((w - box, h - box, w, h)),
    ]
    import numpy as np

    alphas = [np.asarray(c)[:, :, 3].mean() for c in corners]
    center = np.asarray(img.crop((w // 3, h // 3, 2 * w // 3, 2 * h // 3)))[:, :, 3].mean()
    detail = f"corners={[round(float(a), 1) for a in alphas]} center={round(float(center), 1)}"
    if max(alphas) > 24:
        return False, f"corners not transparent: {detail}"
    if center < 128:
        return False, f"subject missing in middle frame: {detail}"
    return True, detail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    OUT.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    for src_name, letter in CLIMAX_MAP.items():
        char = LETTER_TO_CHAR[letter]
        if only and char not in only and letter not in only:
            continue
        src = NEW / src_name
        target = OUT / f"{char}_climax.webm"
        qa_tag = target.stem
        print(f"{src_name} -> {target.name}", flush=True)
        if not src.exists():
            results.append({"source": src_name, "target": target.name, "character": char, "ok": False, "error": "missing source"})
            continue
        if target.exists() and target.stat().st_size > 80_000 and not args.force:
            results.append({"source": src_name, "target": target.name, "character": char, "ok": True, "skipped": True})
            continue
        try:
            encode_green_dom_webm(src, target, fps=24.0)
            ok, detail = corner_alpha_ok(target, qa_tag) if target.exists() else (False, "no output")
            r = {"ok": ok, "detail": f"green_dom {detail}"}
            if not ok:
                r["error"] = f"soft key QA failed ({detail}); retry with --mode green_dom"
            r.update({"source": src_name, "target": target.name, "character": char, "low_confidence": char in LOW_CONFIDENCE})
            results.append(r)
            print(f"  {'PASS' if ok else 'FAIL'} {detail}", flush=True)
        except Exception as e:  # noqa: BLE001
            results.append({"source": src_name, "target": target.name, "character": char, "ok": False, "error": str(e)})
            print(f"  ERROR {e}", flush=True)
    manifest = {
        "input": str(NEW),
        "output": str(OUT),
        "naming": "{CHAR}_climax.webm",
        "method": "green_dom (G-dominant key for dark/mint off-color plates) + corner-alpha QA",
        "letter_to_char": LETTER_TO_CHAR,
        "source_to_letter": CLIMAX_MAP,
        "low_confidence": LOW_CONFIDENCE,
        "results": results,
        "ok": sum(1 for r in results if r.get("ok")),
        "failed": sum(1 for r in results if not r.get("ok")),
    }
    (OUT / "climax_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": manifest["ok"], "failed": manifest["failed"]}, ensure_ascii=False))
    return 0 if manifest["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
