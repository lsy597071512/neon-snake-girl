# -*- coding: utf-8 -*-
"""冰华·雫 / SSR03：调教小黑屋三段娇喘。

与现有调教 MP4 同一条路：MiniMax H3 ImageToVideo（fl2va）。
画面和声音同一次采样，嘴怎么动，气声就怎么出。
不喂 TTS，不写「嗯啊哈」拟声字。

输出：
  tex/audio/discipline-moan/skyshard/skyshard_moan_s{1,2,3}_loop.wav  (≥6s)
  tex/audio/discipline-moan/skyshard/_src/skyshard_moan_s{n}_i2v.mp4
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = "http://127.0.0.1:8188"
COMFY_OUTPUT_VIDEO = Path(r"E:\MiniMaxH3\ComfyUI\output\video")
COMFY_OUTPUT_AUDIO = Path(r"E:\MiniMaxH3\ComfyUI\output\audio")

OUT_DIR = ROOT / "tex" / "audio" / "discipline-moan" / "skyshard"
SRC_DIR = OUT_DIR / "_src"
QA_DIR = OUT_DIR / "_qa"

WIDTH, HEIGHT = 768, 1344
LENGTH = 158  # 158 % 17 == 5 → 6.58s @24fps
STEPS = 24
SEED_BASE = 2026092118
H3_WAIT_TIMEOUT_S = 7200.0

STILL = {
    1: "SSR03_1_p1_s1_gs.png",
    2: "SSR03_1_p1_s2_gs.png",
    3: "SSR03_1_p1_s3_gs.png",
}

STAGE_VOCAL = {
    1: (
        "STAGE-1 VOCAL: very soft shy discipline breathing. Mostly warm air and quiet inhalations, "
        "with only a few restrained voiced sighs that slip out and get swallowed. Young adult woman, "
        "gentle and empathic, never childish, never a scream. Pitch drifts inside each breath."
    ),
    2: (
        "STAGE-2 VOCAL: heavier. She tries to stay quiet and fails. More frequent voiced moans mixed "
        "with wet breath, uneven gaps, some longer sighs, some short catches. Pitch lifts then falls "
        "inside a single moan. Still shy, not climax screaming, not words."
    ),
    3: (
        "STAGE-3 VOCAL: peak but still human. Continuous urgent moans and pants, overlapping breath, "
        "pitch sweeps upward on the strongest pulses then breaks into air. Irregular rhythm, no metronome, "
        "no shouted words, no broken scream. Emotion is overwhelmed pleasure she cannot hold in."
    ),
}


def prompt_for(stage: int) -> str:
    return f"""Professional film-set chroma key plate. Pure flat green screen (#00b140), zero shadows, subject isolated, no floor, no room.

LOCKED to the first frame: same girl, same hair, same outfit, same pose, same framing. Camera is a locked tripod. No zoom, no pan, no pull-back. Subject scale stays constant.

BODY (small, so the mouth can lead):
- Soft breathing chest rise and fall.
- Lips and jaw must move with every breath and every moan: part, tremble, almost close, part again. Mouth performance is mandatory and continuous through the last second.
- Tiny blush micro-acting. No big pose change, no tentacle travel, no cloth ripping, no extra characters.

AUDIO IS THE POINT OF THIS CLIP — generate it together with the mouth, not as added music:
- One close-mic female voice only: moans, pants, and breath from THIS girl's mouth.
- {STAGE_VOCAL[stage]}
- Timing is irregular and human. Each pulse has its own length, loudness, and pitch curve.
- HARD FORBIDDEN AUDIO: spoken words, names, Chinese or English syllables, counting, laughter, crying sentences, male voice, music, melody, drums, room-tone bed, ambience, cloth rustle, mechanical noise, water, footsteps, crowd.
- Dry vocal only. Start and end at a similar breath level so the clip can loop.

Keep pure flat #00b140 green everywhere behind the subject.
"""


def api(path: str, data=None, timeout: float = 600):
    if data is not None:
        req = urllib.request.Request(
            f"{HOST}{path}",
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
    else:
        req = urllib.request.Request(f"{HOST}{path}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def wait_ready(timeout_s: float = 120.0) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            api("/system_stats", timeout=5)
            print("ComfyUI ready", flush=True)
            return
        except Exception as e:
            print(f"  waiting ComfyUI… {e}", flush=True)
            time.sleep(4)
    raise TimeoutError("ComfyUI not ready")


def build_workflow(still_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    return {
        "6": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
                "weight_dtype": "default",
            },
        },
        "13": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                "type": "minimax",
                "device": "default",
            },
        },
        "11": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"},
        },
        "24": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"},
        },
        "114": {"class_type": "LoadImage", "inputs": {"image": still_name}},
        "200": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {"model": ["6", 0], "shift_video": 12.0, "shift_audio": 3.0},
        },
        "104": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["13", 0],
                "vae": ["11", 0],
                "prompt": prompt,
                "width": WIDTH,
                "height": HEIGHT,
                "length": LENGTH,
                "first_frame": ["114", 0],
            },
        },
        "15": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "17": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "9": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": ["200", 0],
                "scheduler": "simple",
                "steps": STEPS,
                "denoise": 1.0,
            },
        },
        "16": {
            "class_type": "BasicGuider",
            "inputs": {"model": ["200", 0], "conditioning": ["104", 0]},
        },
        "14": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["15", 0],
                "guider": ["16", 0],
                "sampler": ["17", 0],
                "sigmas": ["9", 0],
                "latent_image": ["104", 1],
            },
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["14", 0], "vae": ["11", 0]},
        },
        "23": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["14", 0], "vae": ["24", 0]},
        },
        "91": {
            "class_type": "CreateVideo",
            "inputs": {
                "images": ["10", 0],
                "fps": 24.0,
                "audio": ["23", 0],
                "bit_depth": 8,
            },
        },
        "92": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["91", 0],
                "filename_prefix": f"video/{out_prefix}",
                "format": "auto",
                "codec": "auto",
            },
        },
        "93": {
            "class_type": "SaveAudio",
            "inputs": {
                "audio": ["23", 0],
                "filename_prefix": f"audio/{out_prefix}",
            },
        },
    }


def wait_prompt(prompt_id: str, timeout_s: float = H3_WAIT_TIMEOUT_S) -> dict:
    t0 = time.time()
    empty_streak = 0
    while True:
        if time.time() - t0 > timeout_s:
            raise TimeoutError(f"prompt {prompt_id} timed out")
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status, ensure_ascii=False)[:4000])
            if status.get("completed") or entry.get("outputs"):
                return entry
        q = api("/queue")
        n_run = len(q.get("queue_running", []) or [])
        n_pend = len(q.get("queue_pending", []) or [])
        print(f"    t={time.time()-t0:.0f}s running={n_run} pending={n_pend}", flush=True)
        if n_run == 0 and n_pend == 0:
            empty_streak += 1
            if empty_streak >= 4:
                raise RuntimeError(f"prompt {prompt_id} missing from queue/history")
        else:
            empty_streak = 0
        time.sleep(8)


def probe_duration(path: Path) -> float:
    r = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=nw=1:nk=1",
            str(path),
        ],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip() or "0")


def find_latest(glob_dir: Path, pattern: str, after_ts: float) -> Path | None:
    cands = []
    if not glob_dir.exists():
        return None
    for p in glob_dir.glob(pattern):
        try:
            if p.stat().st_mtime >= after_ts - 2:
                cands.append(p)
        except OSError:
            continue
    if not cands:
        cands = list(glob_dir.glob(pattern))
    if not cands:
        return None
    return max(cands, key=lambda p: p.stat().st_mtime)


def make_loopable(src: Path, dst: Path) -> Path:
    """Mono 32 kHz, light highpass only. Short edge fades so it can loop. No loudness crush."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.wav")
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(src),
            "-vn", "-ac", "1", "-ar", "32000",
            "-af", "highpass=f=70",
            str(tmp),
        ],
        check=True, capture_output=True,
    )
    dur = probe_duration(tmp)
    if dur < 6.0:
        raise RuntimeError(f"audio shorter than 6s: {dur:.2f}s from {src}")
    fade = 0.22
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(tmp),
            "-af", f"afade=t=in:st=0:d={fade},afade=t=out:st={max(0, dur - fade)}:d={fade}",
            str(dst),
        ],
        check=True, capture_output=True,
    )
    tmp.unlink(missing_ok=True)
    return dst


def stage_job(stage: int) -> dict:
    still = STILL[stage]
    prefix = f"SSR03_1_discipline_moan_i2v_s{stage}"
    prompt = prompt_for(stage)
    seed = SEED_BASE + stage * 17
    QA_DIR.mkdir(parents=True, exist_ok=True)
    (QA_DIR / f"i2v_s{stage}_prompt.txt").write_text(prompt, encoding="utf-8")
    wf = build_workflow(still, prefix, prompt, seed)
    after = time.time()
    print(f"=== i2v stage {stage} still={still} seed={seed} ===", flush=True)
    res = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
    prompt_id = res["prompt_id"]
    print(f"queued {prompt_id}", flush=True)
    entry = wait_prompt(prompt_id)

    video_out = find_latest(COMFY_OUTPUT_VIDEO, f"{prefix}_*.mp4", after)
    audio_out = find_latest(COMFY_OUTPUT_AUDIO, f"{prefix}_*.flac", after) or find_latest(
        COMFY_OUTPUT_AUDIO, f"{prefix}_*.wav", after
    )
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    if video_out:
        shutil.copy2(video_out, SRC_DIR / f"skyshard_moan_s{stage}_i2v.mp4")
    src_audio = audio_out or video_out
    if not src_audio:
        raise RuntimeError(
            f"stage {stage}: no output; history keys={list(entry.get('outputs', {}))}"
        )
    final = OUT_DIR / f"skyshard_moan_s{stage}_loop.wav"
    make_loopable(src_audio, final)
    d = probe_duration(final)
    print(f"SHIP {final} {d:.2f}s", flush=True)
    return {
        "stage": stage,
        "file": str(final),
        "duration": d,
        "video": str(video_out) if video_out else None,
        "method": "minimax_h3_image_to_video",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, choices=[1, 2, 3], default=0)
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wait_ready()
    stages = [args.stage] if args.stage else [1, 2, 3]
    results = []
    for s in stages:
        results.append(stage_job(s))
    (OUT_DIR / "_i2v_trial_meta.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("DONE", json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
