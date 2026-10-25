# -*- coding: utf-8 -*-
"""调教小黑屋 · 分角色娇喘批处理（音色锁定）。

流程文档：docs/discipline-moan-pipeline.md
花名册：scripts/discipline_moan_roster.py

用法：
  python -u scripts/run_minimax_h3_discipline_moan_batch.py --character frostline
  python -u scripts/run_minimax_h3_discipline_moan_batch.py --character frostline --stage 2
  python -u scripts/run_minimax_h3_discipline_moan_batch.py --all --skip-done
  python -u scripts/run_minimax_h3_discipline_moan_batch.py --all --skip-done --force-stage 2
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from discipline_moan_roster import CHARACTERS, ROSTER_ORDER, MoanChar, get_char, list_ready  # noqa: E402

HOST = "http://127.0.0.1:8188"
COMFY_INPUT = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUTPUT_VIDEO = Path(r"E:\MiniMaxH3\ComfyUI\output\video")
COMFY_OUTPUT_AUDIO = Path(r"E:\MiniMaxH3\ComfyUI\output\audio")
OUT_ROOT = ROOT / "tex" / "audio" / "discipline-moan"

TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
TTS_VC = "qwen3-tts-vc-2026-01-22"
TTS_INSTRUCT = "qwen3-tts-instruct-flash"
TTS_FLASH = "qwen3-tts-flash"

WIDTH, HEIGHT = 768, 1344
LENGTH = 158
STEPS = 24
SEED_BASE = 2026092122
H3_WAIT_TIMEOUT_S = 7200.0

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
        "then breaks into air. Overwhelmed, still one soft young woman, not a scream."
    ),
}


def out_dirs(cid: str) -> tuple[Path, Path, Path, Path]:
    base = OUT_ROOT / cid
    return base, base / "_timbre", base / "_src", base / "_qa"


def still_name(stem: str, stage: int) -> str:
    return f"{stem}_p1_s{stage}_gs.png"


def prompt_for(stage: int, name_zh: str) -> str:
    return f"""Professional film-set chroma key plate. Pure flat green screen (#00b140), zero shadows, subject isolated.

IMAGE:
- <Picture 1> locks this exact girl ({name_zh}), outfit, pose, and framing. Locked camera. No zoom. Tiny breathing only.
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


def api(path: str, data=None, timeout: float = 600, retries: int = 8):
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
            time.sleep(5)
    raise last


def wait_comfy(timeout_s: float = 180.0) -> None:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            api("/system_stats", timeout=8)
            print("ComfyUI ready", flush=True)
            return
        except Exception as e:
            print(f"  waiting ComfyUI… {e}", flush=True)
            time.sleep(5)
    raise TimeoutError("ComfyUI not ready")


def dashscope_key() -> str:
    p = ROOT / ".dashscope_key"
    if not p.exists():
        raise SystemExit("missing .dashscope_key")
    return p.read_text(encoding="utf-8").strip()


def synth_line(char: MoanChar, text: str, key: str) -> bytes:
    path = char["tts_path"]
    if path == "vc":
        body = {
            "model": TTS_VC,
            "input": {"text": text, "voice": char["voice"], "language_type": "Chinese"},
        }
    elif path == "instruct":
        body = {
            "model": TTS_INSTRUCT,
            "input": {
                "text": text,
                "voice": char["voice"],
                "language_type": "Chinese",
                "instructions": char["instruction"],
                "optimize_instructions": False,
            },
        }
    else:
        body = {
            "model": TTS_FLASH,
            "input": {"text": text, "voice": char["voice"], "language_type": "Chinese"},
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


def ensure_timbre(char: MoanChar) -> Path:
    cid = char["character_id"]
    _, timbre_dir, _, _ = out_dirs(cid)
    timbre_dir.mkdir(parents=True, exist_ok=True)
    out = timbre_dir / f"{cid}_enrolled_voice.wav"
    if out.exists() and out.stat().st_size > 8000:
        print(f"[{cid}] timbre exists {out.name}", flush=True)
        return out
    key = dashscope_key()
    parts: list[Path] = []
    for i, line in enumerate(char["timbre_lines"], 1):
        raw = timbre_dir / f"line{i}.bin"
        raw.write_bytes(synth_line(char, line, key))
        wav = timbre_dir / f"line{i}.wav"
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw), "-ar", "32000", "-ac", "1", str(wav)],
            check=True, capture_output=True,
        )
        raw.unlink(missing_ok=True)
        parts.append(wav)
        print(f"[{cid}] timbre line {i} ok", flush=True)
    lst = timbre_dir / "concat.txt"
    lst.write_text("\n".join(f"file '{p.as_posix()}'" for p in parts) + "\n", encoding="utf-8")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)],
        check=True, capture_output=True,
    )
    print(f"[{cid}] timbre {out}", flush=True)
    return out


def build_workflow(still: str, audio: str, prefix: str, prompt: str, seed: int) -> dict:
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
        "114": {"class_type": "LoadImage", "inputs": {"image": still}},
        "115": {"class_type": "LoadAudio", "inputs": {"audio": audio}},
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
            "inputs": {
                "video": ["91", 0],
                "filename_prefix": f"video/{prefix}",
                "format": "auto",
                "codec": "auto",
            },
        },
        "93": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["23", 0], "filename_prefix": f"audio/{prefix}"},
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


def stage_done(cid: str, stage: int) -> bool:
    base, _, _, _ = out_dirs(cid)
    p = base / f"{cid}_moan_s{stage}_loop.wav"
    if not p.exists() or p.stat().st_size < 5000:
        return False
    try:
        return probe_duration(p) >= 6.0
    except Exception:
        return False


def char_seed(cid: str) -> int:
    # stable per character
    h = sum(ord(c) for c in cid) * 97
    return SEED_BASE + (h % 10000)


def run_stage(char: MoanChar, stage: int, audio_in_name: str) -> dict:
    cid = char["character_id"]
    stem = char["stem"]
    still = still_name(stem, stage)
    if not (COMFY_INPUT / still).exists():
        raise SystemExit(f"[{cid}] missing still in Comfy input: {still}")
    base, _, src_dir, qa_dir = out_dirs(cid)
    base.mkdir(parents=True, exist_ok=True)
    qa_dir.mkdir(parents=True, exist_ok=True)
    src_dir.mkdir(parents=True, exist_ok=True)

    prefix = f"{stem}_discipline_moan_voice_s{stage}"
    prompt = prompt_for(stage, char["name_zh"])
    (qa_dir / f"voice_s{stage}_prompt.txt").write_text(prompt, encoding="utf-8")
    seed = char_seed(cid) + stage * 17
    wf = build_workflow(still, audio_in_name, prefix, prompt, seed)
    after = time.time()
    print(f"=== [{cid}/{char['name_zh']}] stage {stage} still={still} seed={seed} ===", flush=True)
    res = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
    prompt_id = res["prompt_id"]
    print(f"queued {prompt_id}", flush=True)
    entry = wait_prompt(prompt_id)

    video_out = find_latest(COMFY_OUTPUT_VIDEO, f"{prefix}_*.mp4", after)
    audio_out = find_latest(COMFY_OUTPUT_AUDIO, f"{prefix}_*.flac", after) or find_latest(
        COMFY_OUTPUT_AUDIO, f"{prefix}_*.wav", after
    )
    if video_out:
        shutil.copy2(video_out, src_dir / f"{cid}_moan_s{stage}_voice.mp4")
    src_audio = audio_out or video_out
    if not src_audio:
        raise RuntimeError(f"[{cid}] stage {stage}: no output; keys={list(entry.get('outputs', {}))}")
    final = base / f"{cid}_moan_s{stage}_loop.wav"
    make_loopable(src_audio, final)
    d = probe_duration(final)
    print(f"SHIP {final} {d:.2f}s", flush=True)
    return {
        "character_id": cid,
        "name_zh": char["name_zh"],
        "stem": stem,
        "stage": stage,
        "file": str(final),
        "duration": d,
        "voice": char["voice"],
        "method": "h3_ref_audio_enrolled_voice",
    }


def write_meta(cid: str, rows: list[dict]) -> None:
    base, _, _, _ = out_dirs(cid)
    path = base / "_voice_trial_meta.json"
    prior: list[dict] = []
    if path.exists():
        try:
            prior = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(prior, list):
                prior = []
        except Exception:
            prior = []
    stages = {r["stage"] for r in rows}
    prior = [p for p in prior if p.get("stage") not in stages]
    path.write_text(json.dumps(prior + rows, ensure_ascii=False, indent=2), encoding="utf-8")


def process_character(char: MoanChar, stages: list[int], force: bool) -> list[dict]:
    cid = char["character_id"]
    if not char["stills_ready"]:
        print(f"SKIP [{cid}] stills not ready", flush=True)
        return []
    timbre = ensure_timbre(char)
    audio_in = f"{cid}_enrolled_voice.wav"
    shutil.copy2(timbre, COMFY_INPUT / audio_in)
    # refresh LoadAudio options by touching file; Comfy scans input/
    results = []
    for stage in stages:
        if not force and stage_done(cid, stage):
            print(f"SKIP [{cid}] stage {stage} already done", flush=True)
            continue
        results.append(run_stage(char, stage, audio_in))
        write_meta(cid, results)
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description="Discipline moan batch (voice-locked MiniMax H3)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--character", help="characterId, e.g. frostline")
    g.add_argument("--all", action="store_true", help="all stills_ready characters in ROSTER_ORDER")
    ap.add_argument("--stage", type=int, choices=[1, 2, 3], default=0, help="0=all stages")
    ap.add_argument("--skip-done", action="store_true", help="skip existing ≥6s wav")
    ap.add_argument("--force", action="store_true", help="regenerate even if done")
    ap.add_argument("--skip", nargs="*", default=[], help="characterIds to skip")
    args = ap.parse_args()

    wait_comfy()
    stages = [args.stage] if args.stage else [1, 2, 3]
    use_force = bool(args.force)

    if args.character:
        chars = [get_char(args.character)]
    else:
        skip = set(args.skip)
        chars = list_ready(skip_ids=skip)

    print(
        "queue:",
        ", ".join(f"{c['character_id']}({c['name_zh']})" for c in chars) or "(empty)",
        flush=True,
    )
    if not use_force and not args.skip_done and args.all:
        # --all without flags：默认跳过已完成，避免误重跑
        args.skip_done = True
        print("note: --all defaults to --skip-done (pass --force to redo)", flush=True)

    all_rows: list[dict] = []
    for char in chars:
        rows = process_character(char, stages, force=use_force)
        all_rows.extend(rows)

    summary = OUT_ROOT / "_batch_summary.json"
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    prev = []
    if summary.exists():
        try:
            prev = json.loads(summary.read_text(encoding="utf-8"))
            if not isinstance(prev, list):
                prev = []
        except Exception:
            prev = []
    # replace same character+stage
    keys = {(r["character_id"], r["stage"]) for r in all_rows}
    prev = [p for p in prev if (p.get("character_id"), p.get("stage")) not in keys]
    summary.write_text(json.dumps(prev + all_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE", json.dumps(all_rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
