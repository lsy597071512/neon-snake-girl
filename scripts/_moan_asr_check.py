# -*- coding: utf-8 -*-
"""用 faster-whisper 转写音频，判断 H3 娇喘里是否含可辨识中文/英文词句。"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel


def load_audio_16k(path: str) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as t:
        tmp = t.name
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000",
         "-f", "f32le", "-acodec", "pcm_f32le", tmp],
        check=True,
    )
    x = np.fromfile(tmp, dtype=np.float32)
    Path(tmp).unlink(missing_ok=True)
    return x


def main() -> None:
    path = sys.argv[1]
    audio = load_audio_16k(path)
    model = WhisperModel("tiny", device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio, language="zh", beam_size=5,
                                      condition_on_previous_text=False)
    print(f"detected language: {info.language} (p={info.language_probability:.2f})")
    n_chars = 0
    uniq: set[str] = set()
    for seg in segments:
        txt = seg.text.strip()
        print(f"[{seg.start:.1f}-{seg.end:.1f}] {txt}")
        n_chars += len(txt)
        uniq.update(txt)
    lexical = {c for c in uniq if '\u4e00' <= c <= '\u9fff' or c.isalpha()}
    print(f"TOTAL_CHARS: {n_chars} UNIQUE_LEXICAL: {len(lexical)}")
    # 娇喘会被逐字转写成重复的“啊”：看去重后的词形丰富度，而非总字数
    print("VERDICT:", "HAS_SPEECH" if len(lexical) >= 4 else "NO_SPEECH")


if __name__ == "__main__":
    main()
