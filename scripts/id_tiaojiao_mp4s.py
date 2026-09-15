"""Extract frames, near-dup check, identify character vs shuiyi pifu02."""
from __future__ import annotations

import json
import subprocess
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

FFMPEG = Path(r"E:\MiniMaxH3\venv\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe")
DIR = Path(r"D:\ruanjian\neon-snake-girl\neon-snake-girl\tex\juese\pifu\tiaojiao")
SHUIYI = Path(r"D:\ruanjian\neon-snake-girl\neon-snake-girl\tex\juese\pifu\shuiyi")
QA = DIR / "_qa" / "id_frames"
QA.mkdir(parents=True, exist_ok=True)

STEMS = [
    "SR01_2", "SR01_3", "SR02_1", "SR03_1", "SR04_1", "SR05_1",
    "SSR01_1", "SSR02_1", "SSR03_1", "SSR04_1", "SSR05_1",
    "UR03_1", "UR04_1",
]

NAMES = {
    "SR01_2": "苍羽·澪",
    "SR01_3": "苍斩·凛",
    "SR02_1": "白楯·芹奈",
    "SR03_1": "银绯·玲",
    "SR04_1": "焰甲·朱里",
    "SR05_1": "黄狐·萤",
    "SSR01_1": "夜爪·黑织",
    "SSR02_1": "翠翼·铃",
    "SSR03_1": "冰华·雫",
    "SSR04_1": "绯尾·椿",
    "SSR05_1": "橙铠·琥珀",
    "UR03_1": "光轮·天音",
    "UR04_1": "橙兔·美羽",
}


def extract_frames() -> list[tuple[Path, Path]]:
    pairs = []
    for i, mp4 in enumerate(sorted(DIR.glob("Asset-*.mp4")), 1):
        out = QA / f"{i:02d}_{mp4.stem}.png"
        if not out.exists() or out.stat().st_size < 1000:
            subprocess.run(
                [str(FFMPEG), "-y", "-hide_banner", "-loglevel", "error",
                 "-ss", "0.25", "-i", str(mp4), "-frames:v", "1", "-q:v", "2", str(out)],
                check=False,
            )
        pairs.append((mp4, out))
        print(f"{'ok' if out.exists() else 'FAIL'} {i} {mp4.name}", flush=True)
    return pairs


def ahash(path: Path, size: int = 16) -> str:
    im = Image.open(path).convert("L").resize((size, size))
    px = list(im.getdata())
    avg = sum(px) / len(px)
    return "".join("1" if v >= avg else "0" for v in px)


def ham(a: str, b: str) -> int:
    return sum(x != y for x, y in zip(a, b))


def head_crop(im: Image.Image) -> Image.Image:
    w, h = im.size
    # upper-center face band
    return im.crop((int(w * 0.25), int(h * 0.02), int(w * 0.75), int(h * 0.28))).convert("RGB").resize((96, 96))


def color_sig(im: Image.Image) -> np.ndarray:
    arr = np.asarray(im).astype(np.float32)
    # mean RGB + hist coarse
    mean = arr.reshape(-1, 3).mean(axis=0)
    hist = []
    for c in range(3):
        h, _ = np.histogram(arr[:, :, c], bins=8, range=(0, 255), density=True)
        hist.append(h)
    return np.concatenate([mean / 255.0, np.concatenate(hist)])


def load_refs() -> dict[str, np.ndarray]:
    refs = {}
    for stem in STEMS:
        p = SHUIYI / f"{stem}_pifu02.png"
        if not p.exists():
            continue
        im = Image.open(p).convert("RGBA")
        # composite on green-ish neutral then head crop
        bg = Image.new("RGBA", im.size, (0, 177, 64, 255))
        bg.alpha_composite(im)
        refs[stem] = color_sig(head_crop(bg.convert("RGB")))
    return refs


def identify(frame: Path, refs: dict[str, np.ndarray]) -> list[tuple[str, float]]:
    if not frame.exists():
        return []
    sig = color_sig(head_crop(Image.open(frame).convert("RGB")))
    scored = []
    for stem, rsig in refs.items():
        d = float(np.linalg.norm(sig - rsig))
        scored.append((stem, d))
    scored.sort(key=lambda x: x[1])
    return scored


def main() -> None:
    pairs = extract_frames()
    # near-dups
    hashes = [(mp4, fr, ahash(fr) if fr.exists() else "") for mp4, fr in pairs]
    print("\n=== near-duplicate frame pairs (hamming<=10) ===", flush=True)
    found = 0
    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            if not hashes[i][2] or not hashes[j][2]:
                continue
            d = ham(hashes[i][2], hashes[j][2])
            if d <= 10:
                found += 1
                print(f"d={d}  {hashes[i][0].name}  ~  {hashes[j][0].name}", flush=True)
    if not found:
        print("none", flush=True)

    refs = load_refs()
    print(f"\nrefs loaded: {len(refs)}", flush=True)
    mapping = []
    by_stem: dict[str, list] = defaultdict(list)
    for mp4, fr in pairs:
        scored = identify(fr, refs)
        top3 = scored[:3]
        best = top3[0][0] if top3 else "?"
        conf = top3[0][1] if top3 else 999
        second = top3[1][1] if len(top3) > 1 else 999
        margin = second - conf
        row = {
            "file": mp4.name,
            "frame": fr.name if fr.exists() else None,
            "bytes": mp4.stat().st_size,
            "best": best,
            "name": NAMES.get(best, "?"),
            "dist": round(conf, 4),
            "margin": round(margin, 4),
            "top3": [(s, round(d, 3), NAMES.get(s, s)) for s, d in top3],
        }
        mapping.append(row)
        by_stem[best].append(row)
        print(
            f"{mp4.name} -> {best} {NAMES.get(best,'?')} dist={conf:.3f} margin={margin:.3f} "
            f"top3={[x[0] for x in top3]}",
            flush=True,
        )

    print("\n=== per-character counts ===", flush=True)
    missing = []
    for stem in STEMS:
        n = len(by_stem.get(stem, []))
        flag = "OK" if n >= 1 else "MISSING"
        if n < 1:
            missing.append(stem)
        print(f"{flag} {stem} {NAMES[stem]}: {n}", flush=True)
    extras = [k for k in by_stem if k not in STEMS]
    if extras:
        print("extras:", extras, flush=True)

    report = {
        "mp4_count": len(pairs),
        "exact_sha_dups": "none (checked earlier)",
        "characters_present": sorted(by_stem.keys()),
        "missing_stems": missing,
        "per_stem": {k: [r["file"] for r in v] for k, v in by_stem.items()},
        "mapping": mapping,
    }
    out_json = DIR / "_qa" / "tiaojiao_id_report.json"
    out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nreport -> {out_json}", flush=True)


if __name__ == "__main__":
    main()
