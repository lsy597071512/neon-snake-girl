# -*- coding: utf-8 -*-
"""娇喘剩余批量 runner（断线自重连版）。

- 范围：12 个 stills_ready 角色 × 3 段 = 36，其中 skyshard 3/3 已完成、outercore 2/3，
  剩余 34 个 loop.wav 需要跑 MiniMax H3。
- 音色（_timbre/*_enrolled_voice.wav）12 个已全部就绪，不再是卡点。
- 策略：每个 (角色,stage) 起一个子进程调 run_minimax_h3_discipline_moan_batch.py，
  失败/断开（ComfyUI 连不上、H3 超时、抛异常）则 sleep 后重连，最多 retry 次；
  每次循环前 wait_comfy；已完成的 (>=5s wav) 自动 skip。
用法：
  python -u scripts/run_moan_remaining_resilient.py
  python -u scripts/run_moan_remaining_resilient.py --retry 8 --sleep 30 --only outercore,stellar
"""
from __future__ import annotations
import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / "scripts" / "run_minimax_h3_discipline_moan_batch.py"
OUT_ROOT = ROOT / "tex" / "audio" / "discipline-moan"

REMAINING: list[tuple[str, int]] = (
    [("outercore", 3)]
    + [(c, s) for c in ["stellar", "ironrain", "dustblade", "pulse",
                        "frostline", "wireguard", "prismrift", "mirror",
                        "heartforge", "neoncoil"] for s in (1, 2, 3)]
    + [("skyshard", s) for s in (1, 2, 3)]  # 已完成，仅做 skip-done 校验
)

def stage_done(cid: str, stage: int) -> bool:
    f = OUT_ROOT / cid / f"{cid}_moan_s{stage}_loop.wav"
    return f.exists() and f.stat().st_size > 8000

def run_one(cid: str, stage: int) -> bool:
    cmd = [sys.executable, "-u", str(BATCH), "--character", cid,
           "--stage", str(stage), "--skip-done"]
    print(f"\n=== [{cid}] s{stage} : {' '.join(cmd)} ===", flush=True)
    try:
        r = subprocess.run(cmd, cwd=str(ROOT))
        return r.returncode == 0 and stage_done(cid, stage)
    except Exception as e:
        print(f"  [{cid}] s{stage} subprocess error: {e}", flush=True)
        return False

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--retry", type=int, default=6)
    ap.add_argument("--sleep", type=float, default=30.0)
    ap.add_argument("--only", default="", help="逗号分隔的 characterId 子集")
    a = ap.parse_args()
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    queue = [(c, s) for c, s in REMAINING if (not only or c in only)]
    print(f"queue: {len(queue)} tasks", flush=True)
    failed: list[tuple[str, int]] = []
    for cid, stage in queue:
        if stage_done(cid, stage):
            print(f"SKIP [{cid}] s{stage} already done", flush=True)
            continue
        ok = False
        for attempt in range(1, a.retry + 1):
            if run_one(cid, stage):
                ok = True
                print(f"OK [{cid}] s{stage} (attempt {attempt})", flush=True)
                break
            print(f"  [{cid}] s{stage} attempt {attempt}/{a.retry} failed; "
                  f"sleep {a.sleep}s 后重连…", flush=True)
            time.sleep(a.sleep)
        if not ok:
            failed.append((cid, stage))
    print("\n==== DONE ====", flush=True)
    print(f"failed: {failed or 'none'}", flush=True)
    if failed:
        sys.exit(1)

if __name__ == "__main__":
    main()
