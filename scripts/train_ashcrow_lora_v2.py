"""重训 ashcrow LoRA v2：修正 caption 后 + rank 32 + 3000 步。

只做训练与安装，不做生成。旧 LoRA 自动备份为 *_v1.safetensors。
用法：python scripts/train_ashcrow_lora_v2.py [--steps 3000] [--rank 32]
"""
from __future__ import annotations

import argparse
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from train_ashcrow_anima16_lora import (  # noqa: E402
    COMFY_LORA,
    api,
    ensure_folder_visible,
    find_latest_lora,
    install_lora,
    wait,
    wf_train_clean,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--rank", type=int, default=32)
    ap.add_argument("--lr", type=float, default=0.0002)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    api("/system_stats")
    print("ComfyUI OK", flush=True)

    # 备份旧 LoRA
    old = COMFY_LORA / "ashcrow_sr012_anima16.safetensors"
    if old.exists():
        bak = COMFY_LORA / "ashcrow_sr012_anima16_v1.safetensors"
        if not bak.exists():
            shutil.copy2(old, bak)
            print(f"backup old lora -> {bak}", flush=True)

    folder = ensure_folder_visible()
    print(f"dataset folder: {folder}", flush=True)

    print(
        f"=== TRAIN v2 steps={args.steps} rank={args.rank} lr={args.lr} ===",
        flush=True,
    )
    import time

    t0 = time.time()
    wf = wf_train_clean(args.steps, args.rank, args.lr, args.seed)
    pid = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})["prompt_id"]
    print(f"queued train {pid}", flush=True)
    wait(pid, timeout=14400)
    print(f"train finished in {(time.time()-t0)/60:.1f} min", flush=True)

    src = find_latest_lora()
    print(f"latest lora artifact: {src}", flush=True)
    install_lora(src)
    api("/object_info/LoraLoaderModelOnly")
    print("ALL DONE (train+install)", flush=True)


if __name__ == "__main__":
    main()
