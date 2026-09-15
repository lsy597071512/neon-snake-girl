"""Organize pifu_weizhi idle + tentacle webms into tex/juese/pifu/tiaojiao/.

Game expects: {Stem}_tiaojiao.webm (idle) + {Stem}_tiaojiao_1..N.webm (poses).
Old assets live in tiaojiao/beifen/ (do not use).

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/organize_tiaojiao_webm_from_weizhi.py
  ... --dry-run
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDLE_DIR = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "webm_idle"
TENT_DIR = ROOT / "tex" / "juese" / "pifu" / "pifu_weizhi" / "webm_tentacle_loop"
OUT_DIR = ROOT / "tex" / "juese" / "pifu" / "tiaojiao"
BEIFEN = OUT_DIR / "beifen"

# characterId / name for report
META = {
    "SR01_2": ("ashcrow", "苍羽·澪"),
    "SR01_3": ("neoncoil", "苍斩·凛"),
    "SR02_1": ("heartforge", "白楯·芹奈"),
    "SR03_1": ("mirror", "银绯·玲"),
    "SR04_1": ("prismrift", "焰甲·朱里"),
    "SR05_1": ("wireguard", "黄狐·萤"),
    "SSR01_1": ("frostline", "夜爪·黑织"),
    "SSR02_1": ("pulse", "翠翼·铃"),
    "SSR03_1": ("skyshard", "冰华·雫"),
    "SSR04_1": ("dustblade", "绯尾·椿"),
    "SSR05_1": ("ironrain", "橙铠·琥珀"),
    "UR03_1": ("stellar", "光轮·天音"),
    "UR04_1": ("outercore", "橙兔·美羽"),
}

# idle: stem -> filename under webm_idle (resolved by prefix)
IDLE_PREFIX = {
    "SR01_3": "iqwg1bt7ia",
    "SR03_1": "sp164titla",
    "SR04_1": "o3olk3s2lgq",
    "SR05_1": "sopv1ct25ml",
    "SSR01_1": "SSR01_1_pifu02",
    "SSR02_1": "SSR02_1_pifu02",
    "SSR03_1": "SSR03_1_pifu02",
    "SSR04_1": "SSR04_1_pifu02",
    "SSR05_1": "SSR05_1_pifu02",
    "UR03_1": "UR03_1_pifu02",
    "UR04_1": "UR04_1_pifu02",
    # SR02_1: no pure idle plate — standing tentacle loop doubles as discipline idle
    # (docs: idle already has light mechanical-tentacle restraint)
    "SR02_1": None,
}

# poses: ordered list of tentacle_loop stems (without _tentacle_loop.webm)
POSE_MAP: dict[str, list[str]] = {
    "SR01_2": [],  # no new assets; fallback from beifen below
    "SR01_3": ["iqwg1bt7ia"],
    "SR02_1": [
        "tke_img_20260902_144342_105",  # also used as idle source
        "tke_img_20260902_171141_155",
    ],
    "SR03_1": ["sp164titla"],
    "SR04_1": ["Asset-r784i7h6kvf", "Asset-76udmt68h62", "Asset-uoweja3ypg"],
    "SR05_1": ["sopv1ct25ml", "Asset-l0ldiwfyulq", "renwu1"],
    "SSR01_1": ["Asset-q89yzkf1om", "Asset-913ii31acd5"],
    "SSR02_1": ["Asset-id6vtc1gplr", "Asset-o4b5rhhvao"],
    "SSR03_1": ["Asset-vg4d7xo9kga", "Asset-zpagwkfriup"],
    "SSR04_1": ["Asset-5uryaef8x2c", "Asset-tcq8rkexfj"],
    "SSR05_1": ["Asset-cs6jwsnqieh", "Asset-ch5itwvskap"],
    "UR03_1": ["Asset-fq8nd5nfgxq", "Asset-isqd1ewqdu"],
    "UR04_1": ["UR04_1_pifu02", "Asset-oc5gzmfngxc", "Asset-p1uyha5rgz"],
}

# Extra unused tentacles kept in source dirs (not shipped to tiaojiao names)
# documented in report only.


def find_idle_webm(prefix: str) -> Path | None:
    for p in IDLE_DIR.glob("*.webm"):
        if p.name.startswith(prefix):
            return p
    return None


def tent_webm(stem: str) -> Path:
    return TENT_DIR / f"{stem}_tentacle_loop.webm"


def copy_file(src: Path, dest: Path, dry: bool) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dry:
        print(f"  DRY {src.name} -> {dest.name}")
        return
    shutil.copy2(src, dest)
    print(f"  OK {src.name} -> {dest.name} ({dest.stat().st_size // 1024} KB)")


def clear_active_tiaojiao(dry: bool) -> None:
    """Remove old active webm/mp4 at tiaojiao root (keep beifen/)."""
    if not OUT_DIR.exists():
        return
    for p in OUT_DIR.iterdir():
        if p.name == "beifen" or p.is_dir():
            continue
        if p.suffix.lower() in {".webm", ".mp4"}:
            print(f"  remove active {p.name}")
            if not dry:
                p.unlink()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dry = args.dry_run

    report: dict = {"idle": {}, "poses": {}, "fallback_beifen": [], "missing": [], "unused_tentacles": []}

    print("== clear active tiaojiao (keep beifen) ==")
    clear_active_tiaojiao(dry)

    print("== idle ==")
    for stem, prefix in IDLE_PREFIX.items():
        dest = OUT_DIR / f"{stem}_tiaojiao.webm"
        if prefix is None:
            # SR02_1: first pose standing plate as idle
            src = tent_webm(POSE_MAP[stem][0])
            note = "idle_from_standing_tentacle"
        else:
            src = find_idle_webm(prefix)
            note = "idle_from_webm_idle"
        if src is None or not src.exists():
            report["missing"].append({"stem": stem, "kind": "idle", "prefix": prefix})
            print(f"  MISS idle {stem}")
            continue
        copy_file(src, dest, dry)
        report["idle"][stem] = {"src": str(src), "dest": str(dest), "note": note}

    # SR01_2 idle from beifen fallback
    if not (OUT_DIR / "SR01_2_tiaojiao.webm").exists() or dry:
        fb = BEIFEN / "SR01_2_tiaojiao.webm"
        if fb.exists():
            copy_file(fb, OUT_DIR / "SR01_2_tiaojiao.webm", dry)
            report["fallback_beifen"].append("SR01_2 idle")
            report["idle"]["SR01_2"] = {"src": str(fb), "dest": str(OUT_DIR / "SR01_2_tiaojiao.webm"), "note": "fallback_beifen"}

    print("== poses ==")
    for stem, poses in POSE_MAP.items():
        cid, name = META[stem]
        used = []
        if not poses:
            # SR01_2: copy beifen poses _1.._3
            for i in range(1, 4):
                fb = BEIFEN / f"SR01_2_tiaojiao_{i}.webm"
                if fb.exists():
                    copy_file(fb, OUT_DIR / f"SR01_2_tiaojiao_{i}.webm", dry)
                    used.append(str(fb))
                    report["fallback_beifen"].append(f"SR01_2 pose_{i}")
            report["poses"][stem] = {"characterId": cid, "name": name, "count": len(used), "sources": used}
            continue

        # SR02_1: idle already uses pose[0]; poses start from same files as _1,_2
        for i, pstem in enumerate(poses, start=1):
            src = tent_webm(pstem)
            if not src.exists():
                report["missing"].append({"stem": stem, "kind": f"pose_{i}", "src": pstem})
                print(f"  MISS {stem} pose {i} {pstem}")
                continue
            dest = OUT_DIR / f"{stem}_tiaojiao_{i}.webm"
            copy_file(src, dest, dry)
            used.append(str(src))
        report["poses"][stem] = {"characterId": cid, "name": name, "count": len(used), "sources": used}

    # unused tentacles inventory
    used_stems = set()
    for poses in POSE_MAP.values():
        used_stems.update(poses)
    used_stems.add("tke_img_20260902_144342_105")  # idle for SR02
    for p in sorted(TENT_DIR.glob("*_tentacle_loop.webm")):
        stem = p.name.replace("_tentacle_loop.webm", "")
        if stem not in used_stems:
            report["unused_tentacles"].append(stem)

    # secondary counts for characterSkins sync
    report["secondary_counts"] = {
        stem: (report["poses"].get(stem) or {}).get("count", 0) for stem in META
    }

    out_json = OUT_DIR / "_organize_map.json"
    if not dry:
        out_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nreport -> {out_json}")
    print("secondary_counts:", json.dumps(report["secondary_counts"], ensure_ascii=False))
    print("fallback_beifen:", report["fallback_beifen"])
    print("missing:", report["missing"])
    print("unused_tentacles:", len(report["unused_tentacles"]))


if __name__ == "__main__":
    main()
