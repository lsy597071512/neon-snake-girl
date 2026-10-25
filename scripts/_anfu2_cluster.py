"""Self-cluster 99 keyed 安抚 clips into 13 identity groups (no reference needed).

Feature per clip: identity-pixel hue histograms (white outfit masked out) from
3 timestamps of the KEYED webm (transparent bg => clean mask) + vertical thirds
layout + mean identity colour. Greedy union-find clustering, threshold scanned
to yield ~13 clusters.
"""
from __future__ import annotations

import json
import re
import subprocess
from collections import Counter
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ANFU2 = ROOT / "tex" / "juese" / "pifu" / "anfu2"
CACHE = ANFU2 / "new" / "_probe" / "cluster"
CACHE.mkdir(parents=True, exist_ok=True)
ff = imageio_ffmpeg.get_ffmpeg_exe()


def ident_hist(rgb: np.ndarray, mask: np.ndarray, bins: int) -> np.ndarray:
    px = rgb[mask].astype(float) / 255.0
    if len(px) < 60:
        return np.zeros(bins)
    mx = px.max(axis=1)
    mn = px.min(axis=1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0)
    keep = (sat > 0.14) & (mx > 0.13)
    px, sat = px[keep], sat[keep]
    if len(px) < 40:
        return np.zeros(bins)
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    mx2 = np.maximum(np.maximum(r, g), b)
    mn2 = np.minimum(np.minimum(r, g), b)
    d = np.maximum(mx2 - mn2, 1e-9)
    hue = np.zeros_like(mx2)
    m = mx2 == r
    hue[m] = ((g[m] - b[m]) / d[m]) % 6
    m = mx2 == g
    hue[m] = (b[m] - r[m]) / d[m] + 2
    m = mx2 == b
    hue[m] = (r[m] - g[m]) / d[m] + 4
    hue = (hue / 6.0) % 1.0
    h, _ = np.histogram(hue, bins=bins, range=(0, 1), weights=sat)
    h = h.astype(float)
    s = h.sum()
    return h / s if s > 0 else h


def clip_feature(webm: Path, tag: str) -> np.ndarray:
    acc = []
    for j, t in enumerate((1.5, 3.5, 5.5)):
        png = CACHE / f"{tag}_{j}.png"
        if not png.exists():
            subprocess.run([ff, "-y", "-loglevel", "error", "-c:v", "libvpx-vp9",
                            "-ss", str(t), "-i", str(webm), "-vf", "format=rgba",
                            "-vframes", "1", str(png)], check=True)
        rgba = np.array(Image.open(png).convert("RGBA"))
        rgb, a = rgba[:, :, :3], rgba[:, :, 3]
        fg = a > 16
        ys, xs = np.where(fg)
        if len(ys) < 300:
            continue
        y0, y1 = ys.min(), ys.max()
        thirds = np.array_split(np.arange(y0, y1 + 1), 3)
        parts = [ident_hist(rgb, fg & (np.arange(rgb.shape[0])[:, None] >= t[0]) &
                            (np.arange(rgb.shape[0])[:, None] <= t[-1]), 8)
                 for t in thirds]
        whole = ident_hist(rgb, fg, 24)
        px = rgb[fg].astype(float) / 255.0
        mx = px.max(axis=1)
        mn = px.min(axis=1)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0)
        ident = px[(sat > 0.14) & (mx > 0.13)]
        mean_col = ident.mean(axis=0) if len(ident) else np.zeros(3)
        acc.append(np.concatenate(parts + [whole, mean_col * 2.0]))
    if not acc:
        return np.zeros(8 * 3 + 24 + 3)
    v = np.mean(acc, axis=0)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


def main() -> None:
    man = json.loads((ANFU2 / "anfu2_series_manifest.json").read_text(encoding="utf-8"))
    items = man["items"]
    feats = {}
    for it in items:
        n = int(it["series"].split("_")[-1].split(".")[0])
        feats[n] = clip_feature(ANFU2 / it["series"], f"s{n:03d}")
        if n % 20 == 0:
            print(f"feat {n}/{len(items)}", flush=True)

    ids = sorted(feats)
    # cosine distance matrix
    import math
    pairs = []
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            d = 1.0 - float(np.dot(feats[a], feats[b]))
            pairs.append((d, a, b))
    pairs.sort()

    def cluster_at(thr: float):
        parent = {i: i for i in ids}
        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x
        for d, a, b in pairs:
            if d > thr:
                break
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb
        groups: dict[int, list[int]] = {}
        for i in ids:
            groups.setdefault(find(i), []).append(i)
        return list(groups.values())

    print("thr -> n_clusters")
    for thr in (0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12, 0.15):
        print(f"  {thr:.2f} -> {len(cluster_at(thr))}")

    groups = cluster_at(0.06)
    # if not 13, pick threshold giving closest to 13
    best, best_thr = groups, 0.06
    for thr in [x / 100 for x in range(1, 30)]:
        g = cluster_at(thr)
        if abs(len(g) - 13) < abs(len(best) - 13):
            best, best_thr = g, thr
    print(f"\nchosen thr={best_thr:.2f} n={len(best)}")
    best.sort(key=len, reverse=True)
    for gi, g in enumerate(best):
        print(f"  G{gi:02d} n={len(g):2d} {sorted(g)[:14]}{'...' if len(g) > 14 else ''}")
    json.dump({"thr": best_thr, "groups": [sorted(g) for g in best]},
              open(CACHE / "groups.json", "w"), indent=1)
    # tag/pose distribution for the report
    stag = json.loads((ANFU2 / "new" / "_probe" / "staging_map.json").read_text(encoding="utf-8"))
    idx2src = {r["idx"]: r["source"] for r in stag["unique"]}
    tags = Counter()
    poses = Counter()
    for r in stag["unique"]:
        m = re.search(r"_(\d{5})_", r["source"])
        p = re.search(r"_(p\d+)-", r["source"])
        if m:
            tags[m.group(1)] += 1
        if p:
            poses[p.group(1)] += 1
    print("\ntag dist:", dict(sorted(tags.items())))
    print("pose dist:", dict(sorted(poses.items())))


if __name__ == "__main__":
    main()
