#!/usr/bin/env python3
"""Sample corner RGB of each YZ climax source to pick the key mode."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
NEW = ROOT / "tex" / "juese" / "pifu" / "tiaojiao" / "new"
QA = NEW / "_key_qa"


def main() -> None:
    QA.mkdir(parents=True, exist_ok=True)
    for src in sorted(NEW.glob("YZ-H3-*.mp4")):
        probe = QA / "_corner_sample.png"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-frames:v", "1", str(probe)],
            check=True,
        )
        img = cv2.cvtColor(cv2.imread(str(probe)), cv2.COLOR_BGR2RGB)
        h, w = img.shape[:2]
        b = 20
        patches = {
            "TL": img[0:b, 0:b].reshape(-1, 3).mean(0),
            "TR": img[0:b, w - b:w].reshape(-1, 3).mean(0),
            "BL": img[h - b:h, 0:b].reshape(-1, 3).mean(0),
            "BR": img[h - b:h, w - b:w].reshape(-1, 3).mean(0),
        }
        print(src.name[-30:])
        for k, v in patches.items():
            print(f"  {k} RGB=({v[0]:.0f},{v[1]:.0f},{v[2]:.0f})")


if __name__ == "__main__":
    sys.exit(main())
