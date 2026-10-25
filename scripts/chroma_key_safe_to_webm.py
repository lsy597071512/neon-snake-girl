#!/usr/bin/env python3
"""Generic safe chroma-key → transparent VP9 WebM batch tool.

Supports green / blue / magenta presets, manual --key-rgb, or auto sample from corners.

Examples:
  # Auto-detect key from corner pixels
  python scripts/chroma_key_safe_to_webm.py \\
    --input-dir tex/foo/new --output-dir tex/foo/new/_webm_out \\
    --glob "*.mp4" --output-template "{stem}.webm"

  # Blue screen preset
  python scripts/chroma_key_safe_to_webm.py \\
    --input path/to/clip.mp4 --output out.webm --key-color blue

  # Manual RGB + ship
  python scripts/chroma_key_safe_to_webm.py \\
    --input-dir clips --ship-dir tex/juese/pifu/foo \\
    --key-rgb 73,152,85 --name-map config/key_map.json --force
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.chroma_key_lib import (  # noqa: E402
    KEY_PRESETS,
    load_name_map,
    process_video,
)


def parse_key_rgb(s: str) -> tuple[int, int, int]:
    parts = [int(x.strip()) for x in s.split(",")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("key-rgb must be R,G,B")
    return parts[0], parts[1], parts[2]


def collect_inputs(args: argparse.Namespace) -> list[Path]:
    if args.input:
        return [Path(args.input)]
    d = Path(args.input_dir)
    return sorted(d.glob(args.glob))


def output_path_for(args: argparse.Namespace, src: Path, meta: dict) -> Path:
    stem = meta.get("stem") or src.stem
    name = args.output_template.format(stem=stem, name=meta.get("name", stem))
    if args.output and len(collect_inputs(args)) == 1:
        return Path(args.output)
    out_dir = Path(args.output_dir or src.parent / "_webm_out")
    return out_dir / name


def ship_path_for(args: argparse.Namespace, out_name: str) -> Path | None:
    if not args.ship_dir:
        return None
    return Path(args.ship_dir) / out_name


def main() -> int:
    ap = argparse.ArgumentParser(description="Safe chroma key → transparent VP9 WebM")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--input", help="Single input mp4/mov")
    src.add_argument("--input-dir", help="Directory of source videos")
    ap.add_argument("--glob", default="*.mp4", help="Glob under --input-dir (default: *.mp4)")
    ap.add_argument("--output", help="Output webm (single --input only)")
    ap.add_argument("--output-dir", help="Output directory for batch")
    ap.add_argument(
        "--output-template",
        default="{stem}.webm",
        help="Output filename template; vars: {stem} {name}",
    )
    ap.add_argument("--ship-dir", help="Copy final webm here (same filename)")
    ap.add_argument("--qa-dir", help="QA working dir (default: <output-dir>/../_key_qa)")
    ap.add_argument("--name-map", type=Path, help="JSON map: filename stem -> {stem,name}")
    ap.add_argument("--only", default="", help="Comma stems to process (uses name-map stem)")
    ap.add_argument("--key-color", default="auto", choices=["auto", *KEY_PRESETS.keys()])
    ap.add_argument("--key-rgb", type=parse_key_rgb, help="Manual key R,G,B (overrides --key-color)")
    ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--crf", type=int, default=20, help="VP9 quality; lower is better (default 20)")
    ap.add_argument(
        "--lossless",
        action="store_true",
        help="Use VP9 lossless mode; recommended when every RGB detail must be retained",
    )
    ap.add_argument(
        "--min-bbox-h",
        type=float,
        default=0.55,
        help="Min rembg vertical coverage (default 0.55; use ~0.55 for sleep/curled poses)",
    )
    ap.add_argument("--force", action="store_true")
    ap.add_argument(
        "--gpu",
        action="store_true",
        help="Use CUDAExecutionProvider when onnxruntime-gpu is installed",
    )
    ap.add_argument(
        "--preserve-subject",
        action="store_true",
        help="Softer key: keep subject / dark tentacles; allow more green fringe",
    )
    args = ap.parse_args()

    from rembg import new_session

    providers = None
    if args.gpu:
        import os
        import sysconfig

        site_root = Path(sysconfig.get_paths()["purelib"])
        dll_handles = []
        dll_dirs = [
            d
            for d in list(site_root.glob("nvidia/**/bin")) + list(site_root.glob("nvidia/**/bin/*"))
            if d.is_dir()
        ]
        os.environ["PATH"] = os.pathsep.join(str(d) for d in dll_dirs) + os.pathsep + os.environ.get("PATH", "")
        for dll_dir in dll_dirs:
            dll_handles.append(os.add_dll_directory(str(dll_dir)))

        import onnxruntime as ort

        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        elif "DmlExecutionProvider" in available:
            providers = ["DmlExecutionProvider", "CPUExecutionProvider"]
        else:
            raise RuntimeError(
                "--gpu requested, but CUDA/DirectML is unavailable; "
                f"available providers: {available}"
            )
        print(f"GPU inference enabled: {providers}", flush=True)
    session = new_session("u2net", providers=providers) if providers else new_session("u2net")
    name_map = load_name_map(args.name_map)
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    inputs = collect_inputs(args)
    if not inputs:
        print("No input files found", flush=True)
        return 1

    qa_root = Path(args.qa_dir) if args.qa_dir else None
    results = []
    for src in inputs:
        meta = name_map.get(src.stem, {})
        stem = meta.get("stem", src.stem)
        if only and stem not in only:
            continue
        out = output_path_for(args, src, meta)
        ship = ship_path_for(args, out.name)
        qa_dir = qa_root or out.parent.parent / "_key_qa"
        mode = "preserve" if args.preserve_subject else "default"
        print(f"=== {stem} <- {src.name} key_color={args.key_color} mode={mode} ===", flush=True)
        r = process_video(
            src,
            out,
            session=session,
            qa_dir=qa_dir,
            qa_tag=stem,
            ship_path=ship,
            key_rgb=args.key_rgb,
            key_color=args.key_color,
            fps=args.fps,
            crf=args.crf,
            lossless=args.lossless,
            force=args.force,
            min_bbox_h=args.min_bbox_h,
            preserve_subject=args.preserve_subject,
        )
        r["stem"] = stem
        status = "OK" if r.get("ok") else "FAIL"
        extra = r.get("detail") or r.get("error", "")
        print(f"  {status} {extra}", flush=True)
        results.append(r)

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
        "results": results,
    }
    if qa_root or results:
        dump_dir = qa_root or Path(results[0]["output"]).parent.parent / "_key_qa"
        dump_dir.mkdir(parents=True, exist_ok=True)
        (dump_dir / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print("SUMMARY", json.dumps({"ok": summary["ok"], "fail": summary["fail"]}), flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    sys.exit(main())
