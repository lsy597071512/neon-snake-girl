#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download Fable Q4_K_M (non-MTP) and create Ollama model fable-q4."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO = "DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF"
FILE = "Qwen3.8-27B-TurboFCFusion-735-882-Here-Uncen-NEO-CODER-MAX-Q4_K_M.gguf"
OUT_DIR = Path(r"F:\Ollama\gguf\fable-q4")
ROOT = Path(__file__).resolve().parents[1]
MODEFILE = ROOT / "ollama" / "Modelfile.fable-q4"


def main() -> None:
    # 国内默认走镜像；可设 HF_ENDPOINT 覆盖
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUT_DIR / FILE
    if not dest.exists() or dest.stat().st_size < 1_000_000_000:
        print(f"==> Downloading {FILE} (~18GB) ...")
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(
            repo_id=REPO,
            filename=FILE,
            local_dir=str(OUT_DIR),
            local_dir_use_symlinks=False,
        )
        print("OK", path)
    else:
        gb = dest.stat().st_size / 1e9
        print(f"==> Already present: {dest} ({gb:.2f} GB)")

    print("==> ollama create fable-q4 ...")
    r = subprocess.run(
        ["ollama", "create", "fable-q4", "-f", str(MODEFILE)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    print(r.stdout)
    if r.returncode != 0:
        print(r.stderr)
        sys.exit(r.returncode)
    print("==> Done. Model: fable-q4:latest")


if __name__ == "__main__":
    main()
