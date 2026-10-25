# -*- coding: utf-8 -*-
"""MiniMax H3: discipline-room pure moan loops for one trial character (skyshard / SSR03_1).

Uses H3 strongest speech path = Audio VAE + ReferenceToVideo <Audio j> timbre lock
(from Qwen VC seed moans), Image stills for stage body language.

Outputs:
  tex/audio/discipline-moan/skyshard/skyshard_moan_s{1,2,3}_loop.wav  (≥6s, loop fades)
  tex/audio/discipline-moan/skyshard/_src/*.mp4  (AV source; video discarded for gameplay)

Usage:
  python -u scripts/run_minimax_h3_discipline_moan_trial_skyshard.py
  python -u scripts/run_minimax_h3_discipline_moan_trial_skyshard.py --stage 1
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
COMFY_INPUT = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUTPUT = Path(r"E:\MiniMaxH3\ComfyUI\output")
COMFY_OUTPUT_AUDIO = COMFY_OUTPUT / "audio"
COMFY_OUTPUT_VIDEO = COMFY_OUTPUT / "video"

OUT_DIR = ROOT / "tex" / "audio" / "discipline-moan" / "skyshard"
SEED_DIR = OUT_DIR / "_seeds"
SRC_DIR = OUT_DIR / "_src"
QA_DIR = OUT_DIR / "_qa"

WIDTH, HEIGHT = 768, 1344
LENGTH = 158  # align_frame_count → ≥6.5s @24fps (17k+5 grid)
STEPS = 24
SEED_BASE = 2026092111
H3_WAIT_TIMEOUT_S = 7200.0

# Stage stills already in Comfy input (discipline intensity plates)
STILL = {
    1: "SSR03_1_p1_s1_gs.png",
    2: "SSR03_1_p1_s2_gs.png",
    3: "SSR03_1_p1_s3_gs.png",
}

SEED_WAV = {
    1: "skyshard_moan_s1_seed_loop.wav",
    2: "skyshard_moan_s2_seed_loop.wav",
    3: "skyshard_moan_s3_seed_loop.wav",
}


def audio_prompt(stage: int) -> str:
    intensity = {
        1: (
            "SOFT STAGE-1 moans only: quiet breathy female whimpers and soft pants, "
            "gentle shy moans, low volume, spaced softly, never screaming."
        ),
        2: (
            "MID STAGE-2 moans only: warmer wetter female moans and quicker pants, "
            "clear erotic whimpering, still controlled, no shout climax."
        ),
        3: (
            "PEAK STAGE-3 moans only: continuous intense female moans and urgent pants, "
            "edge-of-climax whimpering, high arousal but no broken scream, no dirty talk."
        ),
    }[stage]
    return f"""Professional film-set chroma key plate. Pure green screen (#00b140), zero shadows, subject isolated.

IMAGE ROLE:
- <Picture 1> locks identity, wardrobe, pose, framing. Keep the same girl on flat green. Minimal body motion: soft breathing chest heave and tiny shy micro-acting only. Camera locked. Do not change outfit or background.

AUDIO ROLE (CRITICAL — this job is for AUDIO):
- <Audio 1> is the EXACT voice timbre / mouth character of this girl. Match her voice identity closely.
- Generate ONLY continuous loopable female erotic moaning / panting / soft whimpers for the full clip.
- {intensity}
- HARD FORBIDDEN AUDIO: music, BGM, room tone beds, water, cloth rustle, tentacle SFX, mechanical noise, footsteps, speech words, dialogue, English, Chinese vocabulary, laughter, crying sobs, male voice, crowd.
- Dry intimate close-mic vocal only. Seamless energy from start to end so the clip can loop.

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


def wait_ready(timeout_s: float = 600.0) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            api("/system_stats", timeout=5)
            print("ComfyUI ready", flush=True)
            return
        except Exception as e:
            print(f"  waiting ComfyUI… {e}", flush=True)
            time.sleep(5)
    raise TimeoutError("ComfyUI not ready")


def build_workflow(still_name: str, audio_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    """ref2va: Picture1 + Audio1 → AV latent → SaveVideo + SaveAudio."""
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
        "115": {"class_type": "LoadAudio", "inputs": {"audio": audio_name}},
        "200": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {"model": ["6", 0], "shift_video": 12.0, "shift_audio": 3.0},
        },
        "104": {
            "class_type": "MiniMaxH3ReferenceToVideo",
            "inputs": {
                "clip": ["13", 0],
                "vae": ["11", 0],
                "audio_vae": ["24", 0],
                "prompt": prompt,
                "width": WIDTH,
                "height": HEIGHT,
                "length": LENGTH,
                "ref_image_size": "match",
                # Autogrow V3 API: dotted paths; 0-based slots map to <Picture 1>/<Audio 1>
                "ref_images.ref_image_0": ["114", 0],
                "ref_audios.ref_audio_0": ["115", 0],
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
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(r.stdout.strip() or "0")


def find_latest(glob_dir: Path, pattern: str, after_ts: float) -> Path | None:
    cands = []
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


def make_loopable(src: Path, dst: Path, min_sec: float = 6.0) -> Path:
    """Extract/normalize mono wav + edge fades for looping. Pad by self-concat if short."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.wav")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(src),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "32000",
            "-af",
            "highpass=f=80,lowpass=f=12000,dynaudnorm=f=75:g=15",
            str(tmp),
        ],
        check=True,
        capture_output=True,
    )
    dur = probe_duration(tmp)
    if dur < min_sec:
        # self-loop concat
        lst = dst.with_suffix(".txt")
        n = int(min_sec / max(dur, 0.1)) + 1
        lst.write_text("\n".join([f"file '{tmp.as_posix()}'"] * n) + "\n", encoding="utf-8")
        cat = dst.with_suffix(".cat.wav")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(cat)],
            check=True,
            capture_output=True,
        )
        tmp.unlink(missing_ok=True)
        lst.unlink(missing_ok=True)
        tmp = cat
        dur = probe_duration(tmp)
    fade = min(0.4, dur / 10)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(tmp),
            "-af",
            f"afade=t=in:st=0:d={fade},afade=t=out:st={max(0, dur - fade)}:d={fade}",
            "-t",
            f"{max(min_sec, dur):.3f}",
            str(dst),
        ],
        check=True,
        capture_output=True,
    )
    tmp.unlink(missing_ok=True)
    return dst


def stage_job(stage: int) -> dict:
    still = STILL[stage]
    seed_name = SEED_WAV[stage]
    seed_src = SEED_DIR / seed_name
    if not seed_src.exists():
        raise SystemExit(f"missing seed {seed_src}; run scripts/gen_skyshard_moan_qwen_seed.py first")
    if not (COMFY_INPUT / still).exists():
        raise SystemExit(f"missing still in Comfy input: {still}")

    # copy seed into Comfy input with stable name
    audio_in = f"skyshard_moan_s{stage}_seed_ref.wav"
    shutil.copy2(seed_src, COMFY_INPUT / audio_in)

    prefix = f"SSR03_1_discipline_moan_s{stage}"
    prompt = audio_prompt(stage)
    seed = SEED_BASE + stage * 17
    wf = build_workflow(still, audio_in, prefix, prompt, seed)

    (QA_DIR).mkdir(parents=True, exist_ok=True)
    (QA_DIR / f"s{stage}_prompt.txt").write_text(prompt, encoding="utf-8")

    after = time.time()
    print(f"=== stage {stage} still={still} audio={audio_in} seed={seed} ===", flush=True)
    res = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
    prompt_id = res["prompt_id"]
    print(f"queued {prompt_id}", flush=True)
    entry = wait_prompt(prompt_id)

    # prefer SaveAudio output; fallback extract from video
    audio_out = find_latest(COMFY_OUTPUT_AUDIO, f"{prefix}_*.flac", after) or find_latest(
        COMFY_OUTPUT_AUDIO, f"{prefix}_*.wav", after
    )
    video_out = find_latest(COMFY_OUTPUT_VIDEO, f"{prefix}_*.mp4", after)
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    if video_out:
        shutil.copy2(video_out, SRC_DIR / f"skyshard_moan_s{stage}_h3.mp4")
    src_audio = audio_out
    if not src_audio and video_out:
        src_audio = video_out
    if not src_audio:
        raise RuntimeError(f"stage {stage}: no audio/video output found; history keys={list(entry.get('outputs', {}))}")

    final = OUT_DIR / f"skyshard_moan_s{stage}_loop.wav"
    make_loopable(src_audio, final, min_sec=6.0)
    d = probe_duration(final)
    print(f"SHIP {final} {d:.2f}s", flush=True)
    return {"stage": stage, "file": str(final), "duration": d, "video": str(video_out) if video_out else None}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, choices=[1, 2, 3], default=0, help="0=all")
    args = ap.parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wait_ready()
    stages = [args.stage] if args.stage else [1, 2, 3]
    results = []
    for s in stages:
        results.append(stage_job(s))
    (OUT_DIR / "_trial_meta.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE", json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
