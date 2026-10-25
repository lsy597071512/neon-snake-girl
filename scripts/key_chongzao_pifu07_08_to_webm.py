"""Chongzao01 (pifu07) + Chongzao02 (pifu08) greenscreen MP4 → transparent VP9 WebM.

规范对齐 docs/chroma-key-to-webm.md / key_huanzhuang_h3_to_webm.py：
- 默认软 colorkey #00b140 similarity=0.16 blend=0.04（保主体/半透明巾）
- QA 四角不透时可 --mode dual / green_dom
- 输出同目录 {stem}.webm；QA 进 _webm_qa/

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/key_chongzao_pifu07_08_to_webm.py --force
  ... --set pifu07 --force
  ... --set pifu08 --stem SR01_2 --force --mode green_dom
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from chroma_key_gs_video_webm import FFMPEG, gs_mp4_to_webm, verify_has_alpha  # noqa: E402
from key_huanzhuang_h3_to_webm import (  # noqa: E402
    HUANZHUANG_SAFE_VF,
    auto_dual_key_vf,
    encode_green_dom_webm,
)

SETS = {
    "pifu07": {
        "dir": ROOT / "tex" / "juese" / "pifu" / "chongzao01",
        "label": "给指挥官冲澡",
        # only idle clips: {Stem}_pifu07.mp4
        "glob": "*_pifu07.mp4",
    },
    "pifu08": {
        "dir": ROOT / "tex" / "juese" / "pifu" / "chongzao02",
        "label": "与指挥官泡澡",
        # idle + interactions: {Stem}_pifu08.mp4 / _1 / _2
        "glob": "*_pifu08*.mp4",
    },
}


def list_jobs(set_id: str, stem_filter: set[str] | None) -> list[Path]:
    cfg = SETS[set_id]
    files = sorted(cfg["dir"].glob(cfg["glob"]))
    # exclude accidental nested
    files = [p for p in files if p.is_file() and p.suffix.lower() == ".mp4"]
    if stem_filter:
        out = []
        for p in files:
            # SR01_2_pifu07 / SR01_2_pifu08_1 → stem = before _pifu
            name = p.stem
            idx = name.find("_pifu")
            art = name[:idx] if idx > 0 else name
            if art in stem_filter:
                out.append(p)
        return out
    return files


def preview_png(webm: Path, dest: Path, ss: str = "1.0") -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-c:v",
            "libvpx-vp9",
            "-ss",
            ss,
            "-i",
            str(webm),
            "-frames:v",
            "1",
            "-update",
            "1",
            str(dest),
        ],
        check=False,
        capture_output=True,
    )


def sample_corners(src_mp4: Path) -> list[tuple[int, int, int]]:
    """只采顶角：泡澡片底角常是浴缸金属，不能拿来判幕色。"""
    with tempfile.TemporaryDirectory() as td:
        png = Path(td) / "f.png"
        subprocess.run(
            [FFMPEG, "-y", "-ss", "0.8", "-i", str(src_mp4), "-frames:v", "1", "-update", "1", str(png)],
            check=True,
            capture_output=True,
        )
        rgb = np.asarray(Image.open(png).convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    cs = max(12, min(h, w) // 20)
    patches = [rgb[:cs, :cs], rgb[:cs, -cs:]]
    return [tuple(int(round(x)) for x in p.reshape(-1, 3).mean(0)) for p in patches]


def corner_far_from_key(corners: list[tuple[int, int, int]], key=(0, 177, 64), max_dist=55.0) -> bool:
    """仅当顶角落点仍偏绿且离 #00b140 较远时，才升档 green_dom。"""

    def dist(c: tuple[int, int, int]) -> float:
        return float(np.linalg.norm(np.array(c, dtype=np.float32) - np.array(key, dtype=np.float32)))

    greenish = [c for c in corners if c[1] > c[0] + 12 and c[1] > c[2] + 8 and c[1] > 55]
    if not greenish:
        return False
    return all(dist(c) > max_dist for c in greenish)


def convert_one(
    src: Path,
    *,
    mode: str,
    force: bool,
    crf: int,
    qa_dir: Path,
) -> dict:
    out = src.with_suffix(".webm")
    row: dict = {"src": src.name, "out": out.name, "ok": False}
    if out.exists() and out.stat().st_size > 50_000 and not force:
        row["ok"] = True
        row["skipped"] = True
        print(f"[SKIP] {src.name}", flush=True)
        return row

    use_mode = mode
    corners = sample_corners(src)
    row["corners"] = corners
    if mode == "auto":
        use_mode = "green_dom" if corner_far_from_key(corners) else "safe"
    row["mode"] = use_mode
    print(
        f"=== {src.name} ({src.stat().st_size // 1024} KB) mode={use_mode} corners={corners} ===",
        flush=True,
    )

    try:
        if use_mode == "green_dom":
            encode_green_dom_webm(src, out, fps=24.0, crf=crf)
        elif use_mode == "dual":
            gs_mp4_to_webm(src, out, fps=24.0, crf=crf, vf=auto_dual_key_vf(src))
        else:
            gs_mp4_to_webm(src, out, fps=24.0, crf=crf, vf=HUANZHUANG_SAFE_VF)

        ok_a, det_a = verify_has_alpha(out, min_zero_pct=8.0)
        row["alpha"] = det_a
        if not ok_a and use_mode == "safe":
            print(f"  RETRY dual after weak alpha {det_a}", flush=True)
            gs_mp4_to_webm(src, out, fps=24.0, crf=crf, vf=auto_dual_key_vf(src))
            ok_a, det_a = verify_has_alpha(out, min_zero_pct=8.0)
            row["mode"] = "dual"
            row["alpha"] = det_a
        if not ok_a and row["mode"] != "green_dom":
            print(f"  RETRY green_dom after weak alpha {det_a}", flush=True)
            encode_green_dom_webm(src, out, fps=24.0, crf=crf)
            ok_a, det_a = verify_has_alpha(out, min_zero_pct=8.0)
            row["mode"] = "green_dom"
            row["alpha"] = det_a

        preview_png(out, qa_dir / f"{src.stem}_preview.png")
        row["ok"] = bool(ok_a) or out.stat().st_size > 50_000
        row["bytes"] = out.stat().st_size
        flag = "OK" if ok_a else "WARN"
        print(f"  {flag} -> {out.name} ({row['bytes'] // 1024} KB) {det_a}", flush=True)
        if not ok_a:
            row["warn"] = det_a
    except Exception as e:
        row["error"] = str(e)
        print(f"  FAIL {e}", flush=True)
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=["all", "pifu07", "pifu08"], default="all")
    ap.add_argument("--stem", default="all", help="comma stems or all")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--crf", type=int, default=28)
    ap.add_argument("--mode", default="auto", choices=["auto", "safe", "dual", "green_dom"])
    args = ap.parse_args()

    stem_filter = None if args.stem == "all" else {s.strip() for s in args.stem.split(",") if s.strip()}
    set_ids = ["pifu07", "pifu08"] if args.set == "all" else [args.set]

    all_results: list[dict] = []
    for set_id in set_ids:
        cfg = SETS[set_id]
        qa_dir = cfg["dir"] / "_webm_qa"
        qa_dir.mkdir(parents=True, exist_ok=True)
        jobs = list_jobs(set_id, stem_filter)
        print(f"\n## {set_id} {cfg['label']} · {len(jobs)} clips", flush=True)
        for src in jobs:
            row = convert_one(src, mode=args.mode, force=args.force, crf=args.crf, qa_dir=qa_dir)
            row["set"] = set_id
            all_results.append(row)
        summary = {
            "set": set_id,
            "ok": [r["src"] for r in all_results if r.get("set") == set_id and r.get("ok")],
            "fail": [r["src"] for r in all_results if r.get("set") == set_id and not r.get("ok")],
            "results": [r for r in all_results if r.get("set") == set_id],
        }
        (qa_dir / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    fails = [r["src"] for r in all_results if not r.get("ok")]
    oks = [r["src"] for r in all_results if r.get("ok")]
    print("\nSUMMARY", json.dumps({"ok": len(oks), "fail": fails}, ensure_ascii=False), flush=True)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
