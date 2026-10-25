# -*- coding: utf-8 -*-
"""仅登记娇喘管线各角色的锁音色参考（千问 TTS），不依赖 ComfyUI。

H3 跑图前必须先有 _timbre/{id}_enrolled_voice.wav；本脚本把这一步提前批量做完。
用法：
  python -u scripts/ensure_moan_timbres.py
  python -u scripts/ensure_moan_timbres.py --character frostline
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from discipline_moan_roster import get_char, list_ready  # noqa: E402
from run_minimax_h3_discipline_moan_batch import ensure_timbre  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Enroll moan timbre refs only (no ComfyUI)")
    ap.add_argument("--character", default="", help="characterId, empty=all ready")
    args = ap.parse_args()
    chars = [get_char(args.character)] if args.character else list_ready()
    print("queue:", ", ".join(c["character_id"] for c in chars), flush=True)
    for char in chars:
        out = ensure_timbre(char)
        print(f"OK [{char['character_id']}] {out} {out.stat().st_size}B", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
