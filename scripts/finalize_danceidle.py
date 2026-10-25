#!/usr/bin/env python3
"""Apply character names to danceidle staging clips (+PNG posters).

Mapping with confidence (see analysis):
  HIGH: D1 SR01_3 / D5 SR03_1 / D7 SR04_1 / D8 SSR02_1 / D10 SSR03_1
  MED:  D2 SSR01_1 / D6 UR03_1 / D9 SR01_2 / D11 UR04_1
  LOW:  D3 SR05_1 / D4 SR05_1(dup-take?) / D12 SSR05_1(twin-tail) / D13 UR04_1(dup-take?)
Target: tex/juese/pifu/danceidle/{Stem}_danceidle.webm + .png poster.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / "tex" / "juese" / "pifu" / "danceidle" / "new" / "_webm_out"
FINAL = ROOT / "tex" / "juese" / "pifu" / "danceidle"
ff = imageio_ffmpeg.get_ffmpeg_exe()

MAPPING = {
    1: ("SR01_3", "HIGH", "outfit 0.93/margin.13, silver hair ok"),
    2: ("SSR01_1", "MED", "outfit 0.99, hair black-group"),
    3: ("SR05_1", "LOW", "outfit 0.90 top; hair conflicts(black-group)"),
    4: ("SR05_1", "LOW", "dark clip; hair silver-group 0.99; maybe dup take of D3"),
    5: ("SR03_1", "HIGH", "outfit 0.88/margin.22, hair agrees"),
    6: ("UR03_1", "MED", "outfit 0.97; hair purple-confused with SSR03_1"),
    7: ("SR04_1", "HIGH", "outfit+hair agree"),
    8: ("SSR02_1", "HIGH", "outfit 0.99/margin.27, hair agrees, blue-wing ev"),
    9: ("SR01_2", "MED-LOW", "dark clip; gold hair + cyan mass(legs?); alt SR02_1"),
    10: ("SSR03_1", "MED-HIGH", "outfit 0.91/margin.17"),
    11: ("UR04_1", "MED", "outfit 0.96 top on green clip"),
    12: ("SSR05_1", "LOW", "twin-tail shape + orange-red; costume unlike dandu; alt SR01_3(hair)/SSR04_1(outfit.52)"),
    13: ("UR04_1", "LOW", "orange bob; maybe dup take of D11; alt none-clear"),
}


def main() -> None:
    FINAL.mkdir(parents=True, exist_ok=True)
    rows = []
    for idx, (stem, conf, ev) in MAPPING.items():
        src = STAGE / f"clip{idx:03d}.webm"
        assert src.exists(), src
        webm = FINAL / f"{stem}_danceidle.webm"
        png = FINAL / f"{stem}_danceidle.png"
        if webm.exists() and "dup" not in conf.lower() and list(MAPPING.values()).count(
                next(v for v in MAPPING.values() if v[0] == stem)) > 1:
            pass
        # duplicate stems (D3/D4, D11/D13): suffix _b for the second
        same = [i for i, v in MAPPING.items() if v[0] == stem]
        suffix = "" if same.index(idx) == 0 else "_b"
        webm = FINAL / f"{stem}_danceidle{suffix}.webm"
        png = FINAL / f"{stem}_danceidle{suffix}.png"
        shutil.copyfile(src, webm)
        subprocess.run([ff, "-y", "-loglevel", "error", "-c:v", "libvpx-vp9",
                        "-ss", "2.6", "-i", str(webm), "-vf", "format=rgba",
                        "-vframes", "1", str(png)], check=True)
        rows.append({"file": webm.name, "poster": png.name, "staging": src.name,
                     "stem": stem, "confidence": conf, "evidence": ev})
        print(f"D{idx} -> {webm.name} [{conf}]", flush=True)
    (FINAL / "danceidle_manifest.json").write_text(
        json.dumps({"dir": "tex/juese/pifu/danceidle", "pattern": "{Stem}_danceidle[_b]",
                    "note": "LOW entries need user verification via contact sheet",
                    "items": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("manifest written")


if __name__ == "__main__":
    raise SystemExit(main())
