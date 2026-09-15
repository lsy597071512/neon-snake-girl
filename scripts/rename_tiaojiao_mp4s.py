"""Rename tiaojiao Asset-*.mp4 → {stem}_tiaojiao_{n}.mp4 from visual ID map."""
from __future__ import annotations

import json
import shutil
from collections import defaultdict
from pathlib import Path

DIR = Path(r"D:\ruanjian\neon-snake-girl\neon-snake-girl\tex\juese\pifu\tiaojiao")
QA = DIR / "_qa"
QA.mkdir(parents=True, exist_ok=True)

# frame_index (01..32) / Asset basename → stem (visual ID)
MAP: dict[str, str] = {
    "Asset-00q8v0180v3yl": "SR02_1",
    "Asset-1vhy4pvh85b": "SR05_1",
    "Asset-25w06n99v7y": "UR03_1",
    "Asset-351kfxuln0s": "UR04_1",
    "Asset-3d86aq3i3ab": "SR01_2",
    "Asset-3yfrx0ubbss": "SR05_1",
    "Asset-4fadydqfoyt": "SR01_2",
    "Asset-4zn47s20lxg": "UR04_1",
    "Asset-6xvzbr5owpr": "SR01_3",
    "Asset-75p6nh8a4m3": "SR04_1",
    "Asset-9dfai2cpz9s": "SR02_1",
    "Asset-9ua5okcdr5h": "UR03_1",
    "Asset-aj135sjzmat": "SR01_2",
    "Asset-anmd5fhiz8": "SSR04_1",
    "Asset-c7vmisidls6": "UR03_1",
    "Asset-e3x8i6bu8n": "SSR04_1",
    "Asset-e8ue5cjjnb6": "SR02_1",
    "Asset-ecvzvxowl1i": "SSR01_1",
    "Asset-fdw7f2yg1ig": "SR03_1",
    "Asset-habfai57c8n": "SSR02_1",
    "Asset-iki5gkq3wci": "SR02_1",
    "Asset-iqvpb5p5d38": "SR01_2",
    "Asset-mzumpw0vukp": "SSR05_1",
    "Asset-pc670uwm3j": "SSR03_1",
    "Asset-q35pq7z63lo": "SSR03_1",
    "Asset-rnjtupx48lc": "SR01_3",
    "Asset-rpspwvcdf5l": "SSR05_1",
    "Asset-tiioqzc7jxp": "SSR03_1",
    "Asset-vgvlqo9j5ji": "SR03_1",
    "Asset-xwllgszijwl": "UR04_1",
    "Asset-y26svjmcau": "SSR05_1",
    "Asset-ydg52vnnqms": "SSR04_1",
}

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

NEAR_DUP_GROUPS = [
    {"note": "SR02_1 蹲姿回眸近重复", "files": ["Asset-00q8v0180v3yl", "Asset-9dfai2cpz9s", "Asset-iki5gkq3wci"]},
    {"note": "SR05_1 站姿近重复", "files": ["Asset-1vhy4pvh85b", "Asset-3yfrx0ubbss"]},
    {"note": "UR04_1 翘腿手托头近重复", "files": ["Asset-351kfxuln0s", "Asset-4zn47s20lxg", "Asset-xwllgszijwl"]},
    {"note": "UR03_1 站姿近重复", "files": ["Asset-25w06n99v7y", "Asset-c7vmisidls6", "Asset-9ua5okcdr5h"]},
    {"note": "SR01_2 站姿近重复", "files": ["Asset-4fadydqfoyt", "Asset-aj135sjzmat", "Asset-iqvpb5p5d38"]},
    {"note": "SSR04_1 跪姿近重复", "files": ["Asset-anmd5fhiz8", "Asset-e3x8i6bu8n", "Asset-ydg52vnnqms"]},
    {"note": "SR03_1 悬吊近重复", "files": ["Asset-fdw7f2yg1ig", "Asset-vgvlqo9j5ji"]},
    {"note": "SSR05_1 悬吊近重复", "files": ["Asset-mzumpw0vukp", "Asset-rpspwvcdf5l", "Asset-y26svjmcau"]},
    {"note": "SSR03_1 跪姿近重复(不含背姿)", "files": ["Asset-q35pq7z63lo", "Asset-tiioqzc7jxp"]},
]


def main() -> None:
    by_stem: dict[str, list[Path]] = defaultdict(list)
    missing_src = []
    for stem_key, stem in MAP.items():
        src = DIR / f"{stem_key}.mp4"
        if not src.exists():
            missing_src.append(stem_key)
            continue
        by_stem[stem].append(src)

    # stable order within stem by original Asset name
    renames = []
    for stem in sorted(by_stem.keys(), key=lambda s: list(NAMES.keys()).index(s) if s in NAMES else 99):
        files = sorted(by_stem[stem], key=lambda p: p.name)
        for i, src in enumerate(files, 1):
            dest = DIR / f"{stem}_tiaojiao_{i}.mp4"
            renames.append((src, dest, stem, i))

    # two-phase rename via temp to avoid collisions
    temps = []
    for src, dest, stem, i in renames:
        tmp = DIR / f"__tmp_{stem}_tiaojiao_{i}.mp4"
        print(f"TMP {src.name} -> {tmp.name}", flush=True)
        src.rename(tmp)
        temps.append((tmp, dest, stem, i))

    mapping_out = []
    for tmp, dest, stem, i in temps:
        print(f"REN {tmp.name} -> {dest.name}  ({NAMES.get(stem, stem)})", flush=True)
        tmp.rename(dest)
        mapping_out.append(
            {
                "new": dest.name,
                "stem": stem,
                "name": NAMES.get(stem, stem),
                "index": i,
            }
        )

    report = {
        "total_mp4": len(renames),
        "characters": {s: len(by_stem[s]) for s in NAMES},
        "all_13_present": all(len(by_stem.get(s, [])) >= 1 for s in NAMES),
        "exact_sha_duplicates": "none",
        "near_duplicate_groups": NEAR_DUP_GROUPS,
        "missing_source": missing_src,
        "renames": mapping_out,
    }
    (QA / "tiaojiao_rename_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("\n=== counts ===", flush=True)
    for s, n in NAMES.items():
        print(f"  {s} {n}: {len(by_stem.get(s, []))}", flush=True)
    print(f"all_13_present={report['all_13_present']}", flush=True)
    print(f"report -> {QA / 'tiaojiao_rename_report.json'}", flush=True)


if __name__ == "__main__":
    main()
