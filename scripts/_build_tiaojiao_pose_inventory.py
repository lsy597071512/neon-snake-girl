"""Build multipose inventory from webm_tentacle_loop stills + POSE_MAP.

Writes:
  webm_tentacle_loop_v4_stages/_pose_inventory.json
  webm_tentacle_loop_v4_stages/_src/{CHAR}/p{N}_first.png  (greenscreen 768x1344)
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TENT = ROOT / "tex/juese/pifu/pifu_weizhi/webm_tentacle_loop"
OUT = ROOT / "tex/juese/pifu/pifu_weizhi/webm_tentacle_loop_v4_stages"
SRC = OUT / "_src"
W, H = 768, 1344
GREEN = (0, 177, 64)

# Primary poses (organize map) + extra stills in tentacle_loop for more variety.
POSE_MAP: dict[str, list[str]] = {
    "SR01_2": [],  # filled from tiaojiao beifen / existing if present
    "SR01_3": ["iqwg1bt7ia"],
    "SR02_1": [
        "tke_img_20260902_144342_105",
        "tke_img_20260902_171141_155",
    ],
    "SR03_1": ["sp164titla"],
    "SR04_1": ["Asset-r784i7h6kvf", "Asset-76udmt68h62", "Asset-uoweja3ypg"],
    "SR05_1": [
        "sopv1ct25ml",
        "Asset-l0ldiwfyulq",
        "renwu1",
        "renwu2",
        "renwu3",
        "renwu4",
        "renwu5",
        "renwu6",
    ],
    "SSR01_1": ["Asset-q89yzkf1om", "Asset-913ii31acd5"],
    "SSR02_1": ["Asset-id6vtc1gplr", "Asset-o4b5rhhvao"],
    "SSR03_1": ["Asset-vg4d7xo9kga", "Asset-zpagwkfriup"],
    "SSR04_1": ["Asset-5uryaef8x2c", "Asset-tcq8rkexfj"],
    "SSR05_1": ["Asset-cs6jwsnqieh", "Asset-ch5itwvskap"],
    "UR03_1": ["Asset-fq8nd5nfgxq", "Asset-isqd1ewqdu"],
    "UR04_1": ["UR04_1_pifu02", "Asset-oc5gzmfngxc", "Asset-p1uyha5rgz"],
}

# Reverse run order (last character first).
CHAR_ORDER_REVERSE = list(reversed(list(POSE_MAP.keys())))


def resolve_still(asset: str) -> Path | None:
    candidates = [
        TENT / f"{asset}_tentacle_first.png",
        TENT / f"{asset}.png",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def to_greenscreen(src: Path, dest: Path) -> None:
    im = Image.open(src).convert("RGBA")
    # Drop near-black / near-transparent as matte when source is black-bg
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 8 or (r < 14 and g < 14 and b < 14):
                px[x, y] = (0, 0, 0, 0)
    scale = min(W / im.width, H / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    im2 = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (*GREEN, 255))
    canvas.alpha_composite(im2, ((W - nw) // 2, (H - nh) // 2))
    bg = Image.new("RGB", (W, H), GREEN)
    bg.paste(canvas, mask=canvas.split()[-1])
    dest.parent.mkdir(parents=True, exist_ok=True)
    bg.save(dest, "PNG")


def sr01_2_poses() -> list[str]:
    """SR01_2 poses live under tiaojiao/beifen or already extracted src."""
    beifen = ROOT / "tex/juese/pifu/tiaojiao/beifen"
    found = []
    for i in (1, 2, 3, 4):
        w = beifen / f"SR01_2_tiaojiao_{i}.webm"
        if w.exists():
            found.append(f"beifen_pose{i}")
    return found or ["beifen_pose1"]


def extract_webm_first(webm: Path, dest: Path) -> None:
    import imageio_ffmpeg
    import subprocess

    ff = imageio_ffmpeg.get_ffmpeg_exe()
    tmp = dest.with_suffix(".tmp.png")
    subprocess.run([ff, "-y", "-i", str(webm), "-frames:v", "1", str(tmp)], check=True, capture_output=True)
    to_greenscreen(tmp, dest)
    tmp.unlink(missing_ok=True)


def main() -> None:
    inv: dict = {"order_reverse": CHAR_ORDER_REVERSE, "characters": {}}
    for char, assets in POSE_MAP.items():
        poses = []
        if char == "SR01_2" and not assets:
            tiao = ROOT / "tex/juese/pifu/tiaojiao"
            for i in (1, 2, 3, 4):
                w = tiao / f"SR01_2_tiaojiao_{i}.webm"
                if not w.exists():
                    w = tiao / "beifen" / f"SR01_2_tiaojiao_{i}.webm"
                if not w.exists():
                    continue
                dest = SRC / char / f"p{len(poses)+1}_first.png"
                extract_webm_first(w, dest)
                covered = SRC / char / f"p{len(poses)+1}_covered.png"
                shutil.copy2(dest, covered)
                poses.append(
                    {
                        "pose_idx": len(poses) + 1,
                        "asset": f"tiaojiao_{i}",
                        "still": str(dest.relative_to(OUT)).replace("\\", "/"),
                        "covered": str(covered.relative_to(OUT)).replace("\\", "/"),
                    }
                )
        else:
            for asset in assets:
                still = resolve_still(asset)
                if still is None:
                    print(f"MISSING still for {char}/{asset}", flush=True)
                    continue
                dest = SRC / char / f"p{len(poses)+1}_first.png"
                to_greenscreen(still, dest)
                # covered lock = same pose still (opaque lock enforced in prompt)
                covered = SRC / char / f"p{len(poses)+1}_covered.png"
                shutil.copy2(dest, covered)
                poses.append(
                    {
                        "pose_idx": len(poses) + 1,
                        "asset": asset,
                        "source_still": still.name,
                        "still": str(dest.relative_to(OUT)).replace("\\", "/"),
                        "covered": str(covered.relative_to(OUT)).replace("\\", "/"),
                    }
                )
        inv["characters"][char] = {
            "pose_count": len(poses),
            "jobs_estimate": len(poses) * 3,
            "poses": poses,
        }
        print(f"{char}: {len(poses)} poses → {len(poses)*3} jobs", flush=True)

    total = sum(c["jobs_estimate"] for c in inv["characters"].values())
    if total == 0:
        raise SystemExit(
            f"no pose sources found under {TENT}; refusing to create a runnable zero-job inventory"
        )
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "_pose_inventory.json"
    path.write_text(json.dumps(inv, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"TOTAL jobs={total} → {path}", flush=True)


if __name__ == "__main__":
    main()
