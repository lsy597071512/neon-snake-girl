# -*- coding: utf-8 -*-
"""判断 H3 娇喘输出是否复读了 enrolled 说话参考（波形包络互相关 + 谱相似度）。"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


def to_mono16k(src: Path) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as t:
        tmp = t.name
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "16000",
         "-f", "f32le", "-acodec", "pcm_f32le", tmp],
        check=True,
    )
    x = np.fromfile(tmp, dtype=np.float32)
    Path(tmp).unlink(missing_ok=True)
    return x


def env_corr(a: np.ndarray, b: np.ndarray) -> float:
    w = 1600  # 100ms 包络
    ea = np.sqrt(np.convolve(a ** 2, np.ones(w) / w, mode="same"))
    eb = np.sqrt(np.convolve(b ** 2, np.ones(w) / w, mode="same"))
    ea = ea[::160]  # 降到100Hz
    eb = eb[::160]
    ea = (ea - ea.mean()) / (ea.std() + 1e-9)
    eb = (eb - eb.mean()) / (eb.std() + 1e-9)
    n = min(len(ea), len(eb))
    ea, eb = ea[:n], eb[:n]
    corr = np.correlate(ea, eb, mode="full") / n
    return float(np.max(np.abs(corr)))


def main() -> None:
    out = Path(sys.argv[1])
    ref = Path(sys.argv[2])
    a = to_mono16k(out)
    b = to_mono16k(ref)
    print(f"out {len(a)/16000:.2f}s ref {len(b)/16000:.2f}s")
    # ref 比 out 长：滑窗找最佳对齐段
    n = len(a)
    best = 0.0
    step = 16000  # 1s 步进
    for start in range(0, max(1, len(b) - n), step):
        seg = b[start:start + n]
        if len(seg) < n:
            break
        best = max(best, env_corr(a, seg))
    print(f"max envelope corr vs enrolled ref: {best:.3f}")
    print("VERDICT:", "LIKELY_PARROT" if best > 0.45 else ("SUSPECT" if best > 0.30 else "INDEPENDENT"))


if __name__ == "__main__":
    main()
