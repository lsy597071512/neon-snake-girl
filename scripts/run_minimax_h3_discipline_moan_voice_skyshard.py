# -*- coding: utf-8 -*-
"""冰华·雫娇喘：用她已登记的千问复刻音色锁嗓音，再由 MiniMax H3 表演。

音色源（不是新训练）：
  qwen-tts-vc-yinse_skyshard-voice-20260814110224868-a391
先合成她本人的说话，只作为 <Audio 1> 的嗓音参考。
H3 ReferenceToVideo 必须借这副嗓子演娇喘，禁止念参考句，也禁止念「嗯啊哈」。

输出覆盖：
  tex/audio/discipline-moan/skyshard/skyshard_moan_s{1,2,3}_loop.wav
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST = "http://127.0.0.1:8188"
COMFY_INPUT = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUTPUT_VIDEO = Path(r"E:\MiniMaxH3\ComfyUI\output\video")
COMFY_OUTPUT_AUDIO = Path(r"E:\MiniMaxH3\ComfyUI\output\audio")

OUT_DIR = ROOT / "tex" / "audio" / "discipline-moan" / "skyshard"
TIMBRE_DIR = OUT_DIR / "_timbre"
SRC_DIR = OUT_DIR / "_src"
QA_DIR = OUT_DIR / "_qa"

VOICE = "qwen-tts-vc-yinse_skyshard-voice-20260814110224868-a391"
TTS_MODEL = "qwen3-tts-vc-2026-01-22"
TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

# 她的原声线台词，只用来锁音色，不作为娇喘文本。
TIMBRE_LINES = [
    "好……你还好吗？手冻吗？我坐你旁边就好。",
    "还好吗？冷的话，靠过来一点。我在。",
    "一起就好。你不用一个人忍。",
]

WIDTH, HEIGHT = 768, 1344
LENGTH = 158
STEPS = 24
SEED_BASE = 2026092122
H3_WAIT_TIMEOUT_S = 7200.0

STILL = {
    1: "SSR03_1_p1_s1_gs.png",
    2: "SSR03_1_p1_s2_gs.png",
    3: "SSR03_1_p1_s3_gs.png",
}

STAGE_VOCAL = {
    1: (
        "STAGE-1: very soft shy breaths and a few swallowed sighs. Mostly air. "
        "Quiet, warm, young-adult, never childish."
    ),
    2: (
        "STAGE-2: short, tight moans. Each voiced pulse lasts under about half a second, then a brief gap. "
        "Breaths are quick catches of air, never a long dragging inhale or a held exhale. "
        "No sustained sigh, no stretched humming, no slow breath that fills the silence. "
        "Pitch still lifts and falls inside each short moan. Uneven rhythm, but every sound stays short."
    ),
    3: (
        "STAGE-3: continuous urgent moans and pants. Pitch sweeps up on the strong pulses, "
        "then breaks into air. Overwhelmed, still one soft girl, not a scream."
    ),
}


def prompt_for(stage: int) -> str:
    return f"""Professional film-set chroma key plate. Pure flat green screen (#00b140), zero shadows, subject isolated.

IMAGE:
- <Picture 1> locks this exact girl, outfit, pose, and framing. Locked camera. No zoom. Tiny breathing only.
- Her lips and jaw must move with every breath and moan, through the last second.

VOICE LOCK (CRITICAL):
- <Audio 1> is this girl's real enrolled voice. Copy ONLY her timbre: pitch center, softness, breathiness, age, mouth color.
- Do NOT speak, quote, translate, or rhythm-copy anything said in <Audio 1>.
- Do NOT say names, questions, or any words from that clip.
- The new audio is a different performance in the SAME voice.

NEW AUDIO — moans only, synced to her mouth:
- {STAGE_VOCAL[stage]}
- Irregular human timing. Each pulse has its own length, loudness, and pitch curve. Not a metronome.
- HARD FORBIDDEN: spoken words, Chinese or English syllables, the reference sentence, counting, laughter, crying speech, male voice, music, room-tone bed, cloth, mechanical noise, water.
- Dry close-mic vocal only. Similar breath level at start and end so it can loop.

Keep pure flat #00b140 green everywhere behind the subject.
"""


def api(path: str, data=None, timeout: float = 600, retries: int = 6):
    last = None
    for i in range(retries):
        try:
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
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            print(f"  api retry {i+1}/{retries}: {e}", flush=True)
            time.sleep(4)
    raise last


def synth_line(text: str, key: str) -> bytes:
    body = {
        "model": TTS_MODEL,
        "input": {"text": text, "voice": VOICE, "language_type": "Chinese"},
    }
    req = urllib.request.Request(
        TTS_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("code"):
        raise RuntimeError(data.get("message") or data)
    audio = (data.get("output") or {}).get("audio") or {}
    if audio.get("data"):
        return base64.b64decode(audio["data"])
    if audio.get("url"):
        url = audio["url"]
        if url.startswith("http://"):
            url = "https://" + url[len("http://"):]
        with urllib.request.urlopen(url, timeout=90) as ar:
            return ar.read()
    raise RuntimeError("no audio in TTS response")


def ensure_timbre() -> Path:
    TIMBRE_DIR.mkdir(parents=True, exist_ok=True)
    out = TIMBRE_DIR / "skyshard_enrolled_voice.wav"
    if out.exists() and out.stat().st_size > 10000:
        print(f"timbre exists {out}", flush=True)
        return out
    key = (ROOT / ".dashscope_key").read_text(encoding="utf-8").strip()
    parts = []
    for i, line in enumerate(TIMBRE_LINES, 1):
        raw = TIMBRE_DIR / f"line{i}.bin"
        raw.write_bytes(synth_line(line, key))
        wav = TIMBRE_DIR / f"line{i}.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw), "-ar", "32000", "-ac", "1", str(wav)],
            check=True, capture_output=True,
        )
        raw.unlink(missing_ok=True)
        parts.append(wav)
        print(f"timbre line {i} ok", flush=True)
    lst = TIMBRE_DIR / "concat.txt"
    lst.write_text("\n".join(f"file '{p.as_posix()}'" for p in parts) + "\n", encoding="utf-8")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)],
        check=True, capture_output=True,
    )
    print(f"timbre {out}", flush=True)
    return out


def build_workflow(still_name: str, audio_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
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
        "11": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"}},
        "24": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"}},
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
                "ref_images.ref_image_0": ["114", 0],
                "ref_audios.ref_audio_0": ["115", 0],
            },
        },
        "15": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "17": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "9": {
            "class_type": "BasicScheduler",
            "inputs": {"model": ["200", 0], "scheduler": "simple", "steps": STEPS, "denoise": 1.0},
        },
        "16": {"class_type": "BasicGuider", "inputs": {"model": ["200", 0], "conditioning": ["104", 0]}},
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
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0], "vae": ["11", 0]}},
        "23": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["14", 0], "vae": ["24", 0]}},
        "91": {
            "class_type": "CreateVideo",
            "inputs": {"images": ["10", 0], "fps": 24.0, "audio": ["23", 0], "bit_depth": 8},
        },
        "92": {
            "class_type": "SaveVideo",
            "inputs": {"video": ["91", 0], "filename_prefix": f"video/{out_prefix}", "format": "auto", "codec": "auto"},
        },
        "93": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["23", 0], "filename_prefix": f"audio/{out_prefix}"},
        },
    }


def wait_prompt(prompt_id: str) -> dict:
    t0 = time.time()
    empty_streak = 0
    while True:
        if time.time() - t0 > H3_WAIT_TIMEOUT_S:
            raise TimeoutError(f"prompt {prompt_id} timed out")
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status, ensure_ascii=False)[:2500])
            if status.get("completed") or entry.get("outputs"):
                return entry
        q = api("/queue")
        n_run = len(q.get("queue_running", []) or [])
        n_pend = len(q.get("queue_pending", []) or [])
        print(f"    t={time.time()-t0:.0f}s running={n_run} pending={n_pend}", flush=True)
        if n_run == 0 and n_pend == 0:
            empty_streak += 1
            if empty_streak >= 6:
                raise RuntimeError(f"prompt {prompt_id} missing from queue/history")
        else:
            empty_streak = 0
        time.sleep(8)


def probe_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(r.stdout.strip() or "0")


def find_latest(glob_dir: Path, pattern: str, after_ts: float) -> Path | None:
    if not glob_dir.exists():
        return None
    cands = [p for p in glob_dir.glob(pattern) if p.stat().st_mtime >= after_ts - 2]
    if not cands:
        cands = list(glob_dir.glob(pattern))
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def make_loopable(src: Path, dst: Path) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "32000", "-af", "highpass=f=70", str(tmp)],
        check=True, capture_output=True,
    )
    dur = probe_duration(tmp)
    if dur < 6.0:
        raise RuntimeError(f"audio shorter than 6s: {dur:.2f}s")
    fade = 0.22
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(tmp), "-af", f"afade=t=in:st=0:d={fade},afade=t=out:st={max(0, dur-fade)}:d={fade}", str(dst)],
        check=True, capture_output=True,
    )
    tmp.unlink(missing_ok=True)
    return dst


def stage_job(stage: int, audio_name: str) -> dict:
    prefix = f"SSR03_1_discipline_moan_voice_s{stage}"
    prompt = prompt_for(stage)
    seed = SEED_BASE + stage * 17
    QA_DIR.mkdir(parents=True, exist_ok=True)
    (QA_DIR / f"voice_s{stage}_prompt.txt").write_text(prompt, encoding="utf-8")
    wf = build_workflow(STILL[stage], audio_name, prefix, prompt, seed)
    after = time.time()
    print(f"=== voice-locked stage {stage} seed={seed} ===", flush=True)
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
        shutil.copy2(video_out, SRC_DIR / f"skyshard_moan_s{stage}_voice.mp4")
    src_audio = audio_out or video_out
    if not src_audio:
        raise RuntimeError(f"stage {stage}: no output; keys={list(entry.get('outputs', {}))}")
    final = OUT_DIR / f"skyshard_moan_s{stage}_loop.wav"
    make_loopable(src_audio, final)
    d = probe_duration(final)
    print(f"SHIP {final} {d:.2f}s", flush=True)
    return {"stage": stage, "file": str(final), "duration": d, "voice": VOICE, "method": "h3_ref_audio_enrolled_voice"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", type=int, choices=[1, 2, 3], default=0)
    args = ap.parse_args()
    timbre = ensure_timbre()
    audio_name = "skyshard_enrolled_voice.wav"
    shutil.copy2(timbre, COMFY_INPUT / audio_name)
    api("/system_stats", timeout=8)
    print("ComfyUI ready", flush=True)
    stages = [args.stage] if args.stage else [1, 2, 3]
    results = [stage_job(s, audio_name) for s in stages]
    meta_path = OUT_DIR / "_voice_trial_meta.json"
    prior = []
    if meta_path.exists() and args.stage:
        try:
            prior = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            prior = []
        if isinstance(prior, list):
            prior = [row for row in prior if row.get("stage") != args.stage]
        else:
            prior = []
    merged = prior + results
    meta_path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE", json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
