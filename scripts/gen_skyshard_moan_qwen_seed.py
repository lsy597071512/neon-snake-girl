# -*- coding: utf-8 -*-
"""Generate skyshard (冰华·雫) pure-moan seed clips via Qwen VC voice.

These seeds lock the character's enrolled timbre for MiniMax H3 <Audio> reference,
and can also ship as fallback loopable moans if H3 AV audio is too noisy.
"""
from __future__ import annotations

import base64
import json
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY = (ROOT / ".dashscope_key").read_text(encoding="utf-8").strip()
URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
VOICE = "qwen-tts-vc-yinse_skyshard-voice-20260814110224868-a391"
MODEL = "qwen3-tts-vc-2026-01-22"

OUT = ROOT / "tex" / "audio" / "discipline-moan" / "skyshard" / "_seeds"
OUT.mkdir(parents=True, exist_ok=True)

# Non-lexical only: breathy moans / pants. Repeated to stretch duration.
STAGES = {
    1: {
        "label": "s1_light",
        "text": (
            "嗯……哈……嗯……啊……嗯嗯……哈啊……嗯……"
            "啊……嗯……哈……嗯啊……嗯……哈……嗯……"
            "啊……嗯嗯……哈……嗯……啊……嗯……哈啊……"
        ),
        "instruction": (
            "请用十八岁温软共情少女的嗓音，只发出轻轻的娇喘与喘息，不要说完整句子，"
            "不要念旁白，不要笑，不要哭喊；轻声、短促、可循环的气声娇喘。"
        ),
    },
    2: {
        "label": "s2_mid",
        "text": (
            "啊……嗯啊……哈啊……嗯……啊啊……哈……嗯嗯……"
            "啊……哈啊……嗯啊……啊……嗯……哈啊……啊嗯……"
            "哈……啊啊……嗯……哈啊……嗯啊……啊……哈……"
        ),
        "instruction": (
            "请用十八岁温软共情少女的嗓音，只发出中等强度的娇喘与急促喘息，"
            "不要说完整句子，不要念字词旁白；软、湿、压抑又忍不住，可循环。"
        ),
    },
    3: {
        "label": "s3_peak",
        "text": (
            "啊啊……哈啊……嗯啊啊……啊……哈……啊嗯……"
            "啊啊……哈啊啊……嗯……啊……哈啊……啊啊……"
            "嗯啊……啊……哈啊……啊嗯啊……哈……啊啊……"
        ),
        "instruction": (
            "请用十八岁温软共情少女的嗓音，只发出高强度连续娇喘与急喘，"
            "不要说完整句子，不要高潮尖叫到破音，不要旁白；高潮边缘的循环娇喘。"
        ),
    },
}


def synth_once(text: str) -> bytes:
    body = {
        "model": MODEL,
        "input": {
            "text": text,
            "voice": VOICE,
            "language_type": "Chinese",
        },
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
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
            url = "https://" + url[len("http://") :]
        with urllib.request.urlopen(url, timeout=90) as ar:
            return ar.read()
    raise RuntimeError("no audio in response")


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


def concat_loop(parts: list[Path], out: Path, min_sec: float = 6.2) -> Path:
    """Concatenate parts and pad by looping until >= min_sec, with short crossfade."""
    list_file = out.with_suffix(".txt")
    lines = []
    for p in parts:
        lines.append(f"file '{p.as_posix()}'")
    # estimate: keep stacking until likely enough
    total = sum(probe_duration(p) for p in parts)
    while total < min_sec + 0.5:
        for p in parts:
            lines.append(f"file '{p.as_posix()}'")
            total += probe_duration(p)
            if total >= min_sec + 0.5:
                break
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    raw = out.with_name(out.stem + "_raw.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", str(raw)],
        check=True,
        capture_output=True,
    )
    # soft edges for loopability
    dur = probe_duration(raw)
    fade = min(0.35, dur / 8)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(raw),
            "-af",
            f"afade=t=in:st=0:d={fade},afade=t=out:st={max(0, dur - fade)}:d={fade}",
            "-ar",
            "32000",
            "-ac",
            "1",
            str(out),
        ],
        check=True,
        capture_output=True,
    )
    raw.unlink(missing_ok=True)
    list_file.unlink(missing_ok=True)
    return out


def main() -> None:
    meta = []
    for stage, cfg in STAGES.items():
        parts: list[Path] = []
        # 2 takes per stage → concat/loop to ≥6.2s
        for i in range(1, 3):
            raw_bytes = synth_once(cfg["text"])
            part = OUT / f"{cfg['label']}_take{i}.wav"
            part.write_bytes(raw_bytes)
            # normalize container
            norm = OUT / f"{cfg['label']}_take{i}_n.wav"
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(part), "-ar", "32000", "-ac", "1", str(norm)],
                check=True,
                capture_output=True,
            )
            part.unlink(missing_ok=True)
            parts.append(norm)
            print(f"OK stage{stage} take{i} {probe_duration(norm):.2f}s", flush=True)

        looped = OUT / f"skyshard_moan_s{stage}_seed_loop.wav"
        concat_loop(parts, looped, min_sec=6.2)
        d = probe_duration(looped)
        print(f"LOOP stage{stage} {looped.name} {d:.2f}s", flush=True)
        meta.append({"stage": stage, "file": looped.name, "duration": d, "label": cfg["label"]})

    (OUT / "_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print("DONE", OUT)


if __name__ == "__main__":
    main()
