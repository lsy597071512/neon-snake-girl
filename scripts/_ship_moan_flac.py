# -*- coding: utf-8 -*-
"""把已验证无语音的 H3 flac 手动收货进 tex（批处理中途掉线时用），复用批处理脚本的后处理。"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from discipline_moan_roster import get_char  # noqa: E402
from run_minimax_h3_discipline_moan_batch import (  # noqa: E402
    make_loopable,
    out_dirs,
    probe_duration,
    write_meta,
)


def main() -> None:
    cid, stage, flac = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3])
    char = get_char(cid)
    base, _, src_dir, _ = out_dirs(cid)
    base.mkdir(parents=True, exist_ok=True)
    src_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(flac, src_dir / f"{cid}_moan_s{stage}_voice.flac")
    final = base / f"{cid}_moan_s{stage}_loop.wav"
    make_loopable(flac, final)
    d = probe_duration(final)
    write_meta(cid, [{
        "character_id": cid,
        "name_zh": char["name_zh"],
        "stem": char["stem"],
        "stage": stage,
        "file": str(final),
        "duration": d,
        "voice": char["voice"],
        "method": "h3_ref_audio_enrolled_voice",
    }])
    print(f"SHIP {final} {d:.2f}s", flush=True)


if __name__ == "__main__":
    main()
