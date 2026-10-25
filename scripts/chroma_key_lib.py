"""Safe chroma-key → transparent VP9 WebM (any solid screen color).

Pipeline:
  rembg core (eroded) = force-keep subject
  soft chroma + rim refine + key-channel despill outside core
  integrity QA (never cut character) + spill QA (clean edges)
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import imageio_ffmpeg
import numpy as np
from PIL import Image

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SIM_LADDER = [0.18, 0.20, 0.22, 0.26, 0.30]
BLEND_LADDER = [0.12, 0.11, 0.10, 0.08, 0.06]
# Softer ladder: keep subject; allow more green fringe (prefer incomplete key over body holes)
SIM_LADDER_PRESERVE = [0.10, 0.12, 0.14, 0.16, 0.18]
BLEND_LADDER_PRESERVE = [0.16, 0.15, 0.14, 0.13, 0.12]
MIN_KEEP = 0.985
MIN_IOU = 0.90
MIN_H = 0.97
MAX_RIM_BAD = 0.12
MAX_RIM_SPILL = 5.5
# Preserve mode: almost never fail on spill; integrity still mandatory
MAX_RIM_BAD_PRESERVE = 0.45
MAX_RIM_SPILL_PRESERVE = 18.0
CRF = 20

KEY_PRESETS: dict[str, tuple[int, int, int]] = {
    "green": (0, 177, 64),   # #00b140
    "blue": (0, 102, 255),   # #0066ff
    "magenta": (255, 0, 255),
}


def key_dominant_channel(key: np.ndarray) -> int:
    return int(np.argmax(key))


def key_channel_excess(rgb: np.ndarray, key_dom: int) -> np.ndarray:
    f = rgb.astype(np.float32)
    dom = f[:, :, key_dom]
    others = [i for i in range(3) if i != key_dom]
    max_other = np.maximum(f[:, :, others[0]], f[:, :, others[1]])
    return np.maximum(0.0, dom - max_other)


def sample_key_rgb(png: Path, *, key_dom: int | None = None) -> tuple[int, int, int]:
    a = np.asarray(Image.open(png).convert("RGB"), dtype=np.float32)
    h, w, _ = a.shape
    patches = [
        a[:24, :24],
        a[:24, -24:],
        a[-24:, :24],
        a[-24:, -24:],
        a[h // 2 - 12 : h // 2 + 12, :24],
        a[h // 2 - 12 : h // 2 + 12, -24:],
    ]
    patch_centers = np.asarray([p.mean(axis=(0, 1)) for p in patches], dtype=np.float32)
    # Median resists a bright corner, compression block, or a prop touching one edge.
    sample = np.median(patch_centers, axis=0)
    all_px = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    dom = key_dom if key_dom is not None else key_dominant_channel(sample)
    others = [i for i in range(3) if i != dom]
    ex = all_px[:, dom] - np.maximum(all_px[:, others[0]], all_px[:, others[1]])
    pure = all_px[ex > 10]
    if len(pure) >= 12:
        # Median is deliberate: mean drifts badly on dark/gradient screens.
        sample = np.median(pure, axis=0)
    return int(sample[0]), int(sample[1]), int(sample[2])


def sample_key_palette(png: Path, *, max_colors: int = 6) -> np.ndarray:
    """Build a small background palette from the frame border.

    Near-solid generated screens often have lighting gradients. A single mean
    color makes the bright side opaque, so a border palette is safer than a
    more aggressive global similarity threshold.
    """
    a = np.asarray(Image.open(png).convert("RGB"), dtype=np.float32)
    h, w, _ = a.shape
    width = max(16, min(48, min(h, w) // 20))
    patches = [
        a[:width, :width],
        a[:width, -width:],
        a[-width:, :width],
        a[-width:, -width:],
    ]
    pixels = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    pixels = pixels[:: max(1, len(pixels) // 4000)]
    centers = pixels[np.linspace(0, len(pixels) - 1, max_colors, dtype=int)].copy()
    for _ in range(8):
        distances = ((pixels[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels = distances.argmin(axis=1)
        for i in range(max_colors):
            group = pixels[labels == i]
            if len(group):
                centers[i] = group.mean(axis=0)
    centers = np.clip(centers, 0, 255)
    # Border corners can contain a gray prop or a bright costume. Keep only
    # palette entries whose dominant channel agrees with the screen's dominant
    # channel; otherwise neutral foreground colors become false key colors.
    screen_dom = key_dominant_channel(np.median(centers, axis=0))
    valid: list[np.ndarray] = []
    for center in centers:
        dom = key_dominant_channel(center)
        others = [i for i in range(3) if i != dom]
        excess = float(center[dom] - max(center[others[0]], center[others[1]]))
        if dom == screen_dom and excess >= 8.0:
            valid.append(center)
    if valid:
        return np.asarray(valid, dtype=np.float32)
    return centers


def resolve_key_rgb(
    id_png: Path,
    *,
    key_rgb: tuple[int, int, int] | None = None,
    key_color: str = "auto",
) -> tuple[int, int, int]:
    if key_rgb is not None:
        return key_rgb
    preset = KEY_PRESETS.get(key_color.lower())
    if preset is not None:
        return preset
    dom = key_dominant_channel(np.array(KEY_PRESETS["green"], dtype=np.float32))
    if key_color.lower() == "auto":
        return tuple(int(v) for v in np.median(sample_key_palette(id_png), axis=0))
    return sample_key_rgb(id_png, key_dom=dom)


def rembg_mask(rgb: np.ndarray, session) -> np.ndarray:
    from rembg import remove

    rgba = remove(Image.fromarray(rgb, "RGB"), session=session)
    return np.asarray(rgba.convert("RGBA"))[:, :, 3] >= 24


def erode(mask: np.ndarray, px: int = 2) -> np.ndarray:
    if px <= 0:
        return mask
    from scipy import ndimage

    return ndimage.binary_erosion(mask, iterations=px)


def dilate(mask: np.ndarray, px: int = 4) -> np.ndarray:
    if px <= 0:
        return mask
    from scipy import ndimage

    return ndimage.binary_dilation(mask, iterations=px)


def chroma_alpha(
    rgb: np.ndarray, key: np.ndarray, sim: float, blend: float, key_dom: int
) -> np.ndarray:
    f = rgb.astype(np.float32)
    palette = np.asarray(key, dtype=np.float32).reshape(-1, 3)
    distances = np.linalg.norm(f[:, :, None, :] - palette[None, None, :, :], axis=3)
    dist = distances.min(axis=2)
    thr = 255.0 * sim
    soft = max(1.0, 255.0 * blend)
    a_dist = np.clip((dist - thr + soft) / soft, 0.0, 1.0)

    dom = f[:, :, key_dom]
    others = [i for i in range(3) if i != key_dom]
    max_other = np.maximum(f[:, :, others[0]], f[:, :, others[1]])
    key_dom_strength = np.clip((dom - max_other - 6.0) / 36.0, 0.0, 1.0)
    a = a_dist * (1.0 - key_dom_strength * 0.92)
    return np.clip(a, 0.0, 1.0)


def refine_alpha_rim(
    rgb: np.ndarray,
    alpha: np.ndarray,
    protect_core: np.ndarray,
    key: np.ndarray,
    sim: float,
    blend: float,
    key_dom: int,
) -> np.ndarray:
    a = alpha.astype(np.float32).copy()
    rim = ~protect_core
    if not rim.any():
        return np.clip(a, 0.0, 1.0)

    rim_a = chroma_alpha(rgb, key, sim * 1.12, blend * 0.72, key_dom)
    a = np.where(protect_core, a, np.minimum(a, rim_a))

    spill = key_channel_excess(rgb, key_dom)
    bad = rim & (spill > 10.0) & (a < 0.80) & (a > 0.02)
    shrink = np.clip((spill - 10.0) / 35.0, 0.0, 0.75) * (1.0 - a * 0.50)
    a = np.where(bad, a * (1.0 - shrink), a)
    return np.clip(a, 0.0, 1.0)


def edge_connected_screen(rgb: np.ndarray, key: np.ndarray, threshold: float = 92.0) -> np.ndarray:
    """Return only screen-colored regions connected to the image border.

    A global color key can delete a prop whose color resembles the screen. The
    background, however, is connected to the frame edge. Restricting removal to
    edge-connected screen pixels protects isolated character and prop pixels.
    """
    from scipy import ndimage

    palette = np.asarray(key, dtype=np.float32).reshape(-1, 3)
    distances = np.linalg.norm(
        rgb.astype(np.float32)[:, :, None, :] - palette[None, None, :, :], axis=3
    )
    screen_like = distances.min(axis=2) <= threshold
    labels, count = ndimage.label(screen_like, structure=np.ones((3, 3), dtype=np.uint8))
    if count == 0:
        return np.zeros(screen_like.shape, dtype=bool)
    border_labels = np.unique(
        np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    )
    border_labels = border_labels[border_labels != 0]
    return np.isin(labels, border_labels)


def internal_screen_holes(rgb: np.ndarray, key: np.ndarray) -> np.ndarray:
    """Find large, screen-colored pockets trapped inside a subject mask."""
    from scipy import ndimage

    palette = np.asarray(key, dtype=np.float32).reshape(-1, 3)
    distance = np.linalg.norm(
        rgb.astype(np.float32)[:, :, None, :] - palette[None, None, :, :], axis=3
    ).min(axis=2)
    screen_like = distance <= 72.0
    local_ratio = ndimage.uniform_filter(
        screen_like.astype(np.float32), size=9, mode="nearest"
    )
    candidates = screen_like & (local_ratio >= 0.58)
    labels, count = ndimage.label(candidates, structure=np.ones((3, 3), dtype=np.uint8))
    if count == 0:
        return np.zeros(candidates.shape, dtype=bool)
    sizes = np.bincount(labels.ravel())
    keep = sizes >= max(24, candidates.size // 25000)
    keep[0] = False
    return keep[labels]


def despill_advanced(
    rgb: np.ndarray, alpha: np.ndarray, protect_core: np.ndarray, key_dom: int
) -> np.ndarray:
    out = rgb.astype(np.float32).copy()
    spill = key_channel_excess(out, key_dom)
    a = np.clip(alpha, 0.0, 1.0)
    others = [i for i in range(3) if i != key_dom]

    rim = (~protect_core) & (a > 0.02)
    fringe = rim & (a < 0.88)
    hair = fringe & (spill > 4.0)

    other_min = np.minimum(out[:, :, others[0]], out[:, :, others[1]])
    other_avg = (out[:, :, others[0]] + out[:, :, others[1]]) * 0.5

    strength = np.zeros_like(a)
    strength[rim] = 0.55 + 0.45 * (1.0 - a[rim])
    strength[hair] = np.clip(0.75 + spill[hair] / 45.0, 0.75, 1.0)
    core_spill = protect_core & (spill > 12.0) & (a > 0.45)
    strength[core_spill] = np.clip((spill[core_spill] - 10.0) / 40.0, 0.40, 0.88)
    strength[protect_core & ~core_spill] = np.clip(
        spill[protect_core & ~core_spill] / 90.0, 0.0, 0.18
    )

    target_dom = np.where(hair | core_spill, other_min, other_avg)
    ch = out[:, :, key_dom]
    out[:, :, key_dom] = ch * (1.0 - strength) + target_dom * strength

    spillish = hair & (spill > 8.0)
    lum = 0.299 * out[:, :, 0] + 0.587 * out[:, :, 1] + 0.114 * out[:, :, 2]
    sat = np.where(spillish, 0.12 * (1.0 - a), 0.0)
    for c in range(3):
        out[:, :, c] = np.where(
            spillish, out[:, :, c] * (1.0 - sat) + lum * sat, out[:, :, c]
        )

    return np.clip(out, 0.0, 255.0)


def _dilate_px(mask: np.ndarray, px: int) -> np.ndarray:
    """Fast ~px radius dilation (5x5 struct halves the iteration count)."""
    from scipy import ndimage

    if px <= 0:
        return mask
    out = mask
    it, rem = divmod(px, 2)
    if it:
        out = ndimage.binary_dilation(
            out, structure=np.ones((5, 5), dtype=np.uint8), iterations=it
        )
    if rem:
        out = ndimage.binary_dilation(
            out, structure=np.ones((3, 3), dtype=np.uint8), iterations=rem
        )
    return out


def clean_isolated_speckles(
    alpha: np.ndarray, protect_core: np.ndarray, *, safe_dilate_px: int = 20
) -> np.ndarray:
    """Conservative background cleanup: never touch the subject.

    Only pixels FAR from the subject (outside the dilated protect mask) are
    processed, so dark clothing shadows, semi-transparent stockings and hair
    inside/adjacent to the subject keep alpha untouched. Removes:
      - weak haze pixels far away with no opaque neighbour (prop edges have
        strong neighbours within 9px and are therefore preserved);
      - small isolated opaque islands far away (compression dots / noise).
    Large far regions (chairs, robots, props) are kept by size check.
    """
    from scipy import ndimage

    a = alpha.astype(np.float32).copy()
    if not protect_core.any():
        return a
    near = _dilate_px(protect_core, safe_dilate_px)
    far = ~near
    if not far.any():
        return a

    strong = a >= 0.60
    density = ndimage.uniform_filter(strong.astype(np.float32), size=9, mode="nearest")

    # 1) weak haze in the far background, no opaque neighbour -> kill/soften
    far_weak = far & (a > 0.0) & (a < 0.22) & (density == 0)
    a = np.where(far_weak, 0.0, a)
    far_haze = far & (a >= 0.22) & (a < 0.50) & (density == 0)
    a = np.where(far_haze, a * 0.40, a)

    # 2) small isolated islands in the far background -> kill
    cand = far & (a >= 0.30)
    if cand.any():
        labels, count = ndimage.label(cand, structure=np.ones((3, 3), dtype=np.uint8))
        if count:
            sizes = np.bincount(labels.ravel())
            min_keep_px = max(120, cand.size // 12000)
            big = sizes >= min_keep_px
            try:
                neigh = ndimage.maximum(
                    density, labels, index=np.arange(1, count + 1)
                )
            except Exception:
                neigh = np.zeros(count, dtype=np.float32)
            kill = np.zeros(count + 1, dtype=bool)
            for lab in range(1, count + 1):
                if big[lab]:
                    continue
                if neigh[lab - 1] > 0:
                    continue
                kill[lab] = True
            if kill.any():
                a = np.where(kill[labels], 0.0, a)
    return np.clip(a, 0.0, 1.0)


def feather_rim(alpha: np.ndarray, protect_core: np.ndarray, *, radius: float = 0.8) -> np.ndarray:
    """1px-class gaussian feather on the rim only: kills锯齿感, keeps发丝."""
    from scipy import ndimage

    a = alpha.astype(np.float32)
    rim = (~protect_core) & (a > 0.02) & (a < 0.98)
    if not rim.any():
        return a
    blurred = ndimage.gaussian_filter(a, sigma=radius)
    return np.where(rim, blurred, a).astype(np.float32)


def local_plate_rgb(rgb: np.ndarray, plate_like: np.ndarray) -> np.ndarray:
    """Estimate the local plate colour for every pixel.

    The H3 plate is not flat - it carries a soft gradient / vignette, so a
    single global colour is wrong in the corners.  For every pixel we take the
    colour of the **nearest plate-like pixel**; because the search is confined
    to `plate_like`, a pixel inside an enclosed green pocket (plate seen
    between two hair strands) picks up the plate colour of *its own* pocket
    instead of the colour of a plate region on the other side of the subject.
    """
    from scipy import ndimage

    if not plate_like.any():
        return np.zeros_like(rgb)
    _, idx = ndimage.distance_transform_edt(~plate_like, return_indices=True)
    return rgb[idx[0], idx[1]]


def edge_matte_green_alpha(
    rgb: np.ndarray,
    *,
    hue_center: float = 150.0,
    hue_halfwidth: float = 70.0,
    hue_soft: float = 45.0,
    sat_lo: float = 0.18,
    sat_soft: float = 0.30,
    val_lo: float = 30.0,
    val_soft: float = 45.0,
    pocket_tol: float = 42.0,
) -> np.ndarray:
    """Analytic green matte for graded / off-colour H3 plates.

    A single-colour `colorkey` cannot clear these plates: the plate colour
    drifts across the frame (measured (0,120,48) .. (48,146,104) .. (80,196,146)),
    so a fixed #00b140 either leaves a halo or eats the body.

    This matte is hue-based instead of palette-based, which survives both the
    dark green and the mint/teal variants of the same plate:

    1. plate likelihood = green hue band x saturation x brightness, so skin
       (hue ~25 deg) and lavender/blue hair (hue ~220-280 deg) score 0.
    2. The plate colour is modelled **locally** (see `local_plate_rgb`), so
       enclosed green pockets between arm and hair are removed as well - a
       global colour check would leave them as green blobs.
    3. Pixels whose red channel reaches the green channel (`R >= G`) and
       near-neutral pixels are force-kept, so skin and white highlights can
       never be keyed.
    4. The matte boundary keeps a continuous alpha ramp, so hair edges stay
       soft instead of stair-stepped.
    """
    from scipy import ndimage

    f = rgb.astype(np.float32)
    r, g = f[:, :, 0], f[:, :, 1]

    hsv = np.asarray(Image.fromarray(rgb.astype(np.uint8)).convert("HSV"), dtype=np.float32)
    hue = hsv[:, :, 0] * (360.0 / 255.0)
    sat = hsv[:, :, 1] / 255.0
    val = hsv[:, :, 2]

    # 1) plate likelihood
    hue_score = np.clip((hue_halfwidth - np.abs(hue - hue_center)) / hue_soft, 0.0, 1.0)
    sat_score = np.clip((sat - sat_lo) / sat_soft, 0.0, 1.0)
    val_score = np.clip((val - val_lo) / val_soft, 0.0, 1.0)
    score = hue_score * sat_score * val_score

    # 2) seed = plate pixels that touch the frame border
    seed = score > 0.5
    if seed.any():
        labels, count = ndimage.label(seed, structure=np.ones((3, 3), dtype=np.uint8))
        if count:
            border = np.unique(
                np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
            )
            border = border[border != 0]
            seed = np.isin(labels, border)
        else:  # pragma: no cover - defensive
            seed = np.zeros(score.shape, dtype=bool)

    # 3) local plate colour model -> enclosed pockets that match it are plate too
    plate_rgb = local_plate_rgb(rgb, score > 0.35)
    dist = np.abs(rgb.astype(np.float32) - plate_rgb).sum(axis=2)
    pocket = (score > 0.35) & (dist < pocket_tol)

    alpha = np.where(pocket, 1.0 - score, 1.0).astype(np.float32)

    # 4) force-keep skin / neutrals: red reaching green means it is not plate
    protect = (r >= g - 2.0) | (sat < sat_lo)
    alpha = np.where(protect, 1.0, alpha)

    # 5) 1px feather on the matte boundary kills stair-step edges
    edge = (alpha > 0.02) & (alpha < 0.98)
    if edge.any():
        alpha = np.where(edge, ndimage.gaussian_filter(alpha, sigma=0.8), alpha)
    return np.clip(alpha, 0.0, 1.0)


def despill_green(rgb: np.ndarray, alpha: np.ndarray, *, strength: float = 1.0) -> np.ndarray:
    """Pull the green channel down to the other channels on semi-transparent rim."""
    out = rgb.astype(np.float32).copy()
    rim = (alpha > 0.02) & (alpha < 0.99)
    if rim.any():
        mx = np.maximum(out[:, :, 0], out[:, :, 2])
        excess = np.maximum(0.0, out[:, :, 1] - mx)
        out[:, :, 1] = np.where(rim, out[:, :, 1] - excess * strength, out[:, :, 1])
    return np.clip(out, 0.0, 255.0)


def subject_key_clash(
    rgb: np.ndarray, protect_core: np.ndarray, key: np.ndarray, *, thresh: float = 70.0
) -> bool:
    """True when the subject itself looks like the key color.

    Green costume on green screen is the classic failure: any color distance
    key eats the dress. Compare the median subject color against the palette;
    if they are close, the caller must skip color keying entirely and trust
    the rembg mask instead.
    """
    if not protect_core.any():
        return False
    sub = rgb[protect_core].astype(np.float32)
    sub = sub[:: max(1, len(sub) // 4000)]
    med = np.median(sub, axis=0)
    palette = np.asarray(key, dtype=np.float32).reshape(-1, 3)
    return bool((np.linalg.norm(palette - med, axis=1).min()) < thresh)


def compose(
    rgb: np.ndarray,
    protect_core: np.ndarray,
    key: np.ndarray,
    sim: float,
    blend: float,
    key_dom: int,
) -> np.ndarray:
    keyed = chroma_alpha(rgb, key, sim, blend, key_dom)
    if subject_key_clash(rgb, protect_core, key):
        # Subject wears the screen color: any color key eats the costume.
        # Trust the rembg subject mask; only the far background speckle pass
        # still runs afterwards (it never touches the subject neighbourhood).
        soft = _dilate_px(protect_core, 3).astype(np.float32)
        a = soft
    else:
        connected_screen = edge_connected_screen(rgb, key, threshold=92.0)
        internal_hole = internal_screen_holes(rgb, key)
        # Remove edge-connected screen and only large, strongly screen-colored
        # pockets. Isolated prop pixels remain opaque even when their color matches.
        removable_screen = connected_screen | internal_hole
        a = np.where(removable_screen, keyed, 1.0)
        a = np.where(protect_core & ~internal_hole, 1.0, a)
        refined = refine_alpha_rim(rgb, a, protect_core & ~internal_hole, key, sim, blend, key_dom)
        a = np.where(removable_screen, refined, 1.0)
    a = clean_isolated_speckles(a, protect_core)
    a = feather_rim(a, protect_core)
    rgb2 = despill_advanced(rgb, a, protect_core, key_dom)
    aa = np.clip(a * 255.0, 0, 255).astype(np.uint8)
    aa = np.where(aa < 16, 0, aa).astype(np.uint8)
    rgba = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    rgb_u8 = np.clip(rgb2, 0, 255).astype(np.uint8)
    transparent = aa < 8
    for c in range(3):
        ch = rgb_u8[:, :, c]
        rgba[:, :, c] = np.where(transparent, 0, ch)
    rgba[:, :, 3] = aa
    return rgba


def protect_masks(rembg: np.ndarray, *, erode_px: int = 2) -> tuple[np.ndarray, np.ndarray]:
    core = erode(rembg, erode_px) if erode_px > 0 else rembg
    if core.mean() < 0.02:
        core = rembg
    return core, dilate(rembg, 2)


def bbox_h(mask: np.ndarray) -> float:
    ys, _ = np.where(mask)
    if len(ys) < 40:
        return 0.0
    return float(ys.max() - ys.min() + 1) / mask.shape[0]


def spill_ok(
    protect_core: np.ndarray,
    rgba: np.ndarray,
    key_dom: int,
    *,
    max_rim_bad: float = MAX_RIM_BAD,
    max_rim_spill: float = MAX_RIM_SPILL,
) -> tuple[bool, str]:
    rgb = rgba[:, :, :3].astype(np.float32)
    a = rgba[:, :, 3].astype(np.float32)
    spill = key_channel_excess(rgb, key_dom)
    vis = a >= 24
    rim = vis & (~protect_core) & (a < 242)
    if not rim.any():
        return True, "rim=0"
    bad = rim & (spill > 12.0)
    bad_pct = float(bad.sum()) / float(rim.sum())
    mean_spill = float(spill[rim].mean())
    ok = bad_pct <= max_rim_bad and mean_spill <= max_rim_spill
    return ok, f"rim_bad%={bad_pct*100:.1f} mean_spill={mean_spill:.2f}"


def integrity_ok(
    protect: np.ndarray,
    rgba: np.ndarray,
    *,
    min_keep: float = MIN_KEEP,
    min_iou: float = MIN_IOU,
    min_h: float = MIN_H,
) -> tuple[bool, str]:
    keep = rgba[:, :, 3] >= 24
    area_p = float(protect.mean())
    if area_p < 1e-6:
        return False, "empty_protect"
    kept = float((protect & keep).mean()) / area_p
    inter = float((protect & keep).mean())
    union = float((protect | keep).mean())
    iou = inter / union if union > 1e-6 else 0.0
    hr = bbox_h(keep) / max(1e-6, bbox_h(protect))
    tl = int(rgba[4, 4, 3])
    ok = kept >= min_keep and iou >= min_iou and hr >= min_h and tl < 16
    return ok, f"keep={kept:.4f} iou={iou:.4f} h={hr:.4f} TL_a={tl}"


def extract_frames(mp4: Path, frame_dir: Path) -> list[Path]:
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [FFMPEG, "-y", "-i", str(mp4), "-vsync", "0", str(frame_dir / "f_%05d.png")],
        check=True,
        capture_output=True,
    )
    return sorted(frame_dir.glob("f_*.png"))


def encode_webm(
    keyed_dir: Path,
    out_webm: Path,
    fps: float = 24.0,
    crf: int = CRF,
    lossless: bool = False,
) -> None:
    out_webm.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_webm.with_suffix(".tmp.webm")
    cmd = [
        FFMPEG,
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(keyed_dir / "k_%05d.png"),
        "-c:v",
        "libvpx-vp9",
        "-pix_fmt",
        "yuva420p",
        "-auto-alt-ref",
        "0",
        "-crf",
        "0" if lossless else str(crf),
        "-b:v",
        "0",
        "-row-mt",
        "1",
    ]
    if lossless:
        cmd.extend(["-lossless", "1"])
    cmd.extend(["-an", str(tmp)])
    subprocess.run(cmd, check=True, capture_output=True)
    tmp.replace(out_webm)


def verify_webm_alpha(webm: Path) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory() as td:
        png = Path(td) / "v.png"
        subprocess.run(
            [
                FFMPEG,
                "-y",
                "-c:v",
                "libvpx-vp9",
                "-ss",
                "0.2",
                "-i",
                str(webm),
                "-frames:v",
                "1",
                "-update",
                "1",
                str(png),
            ],
            check=True,
            capture_output=True,
        )
        im = Image.open(png).convert("RGBA")
        a = np.asarray(im)[:, :, 3]
        zero = float((a == 0).mean()) * 100
        tl = im.getpixel((5, 5))
        return zero >= 25.0 and tl[3] < 16, f"alpha_zero%={zero:.1f} TL={tl}"


def ensure_id_frame(mp4: Path, frames_dir: Path, tag: str) -> Path:
    frames_dir.mkdir(parents=True, exist_ok=True)
    png = frames_dir / f"{tag}_f0.png"
    if not png.exists():
        subprocess.run(
            [FFMPEG, "-y", "-ss", "0.05", "-i", str(mp4), "-frames:v", "1", str(png)],
            check=True,
            capture_output=True,
        )
    return png


def process_video(
    mp4: Path,
    out_webm: Path,
    *,
    session,
    qa_dir: Path | None = None,
    qa_tag: str = "clip",
    ship_path: Path | None = None,
    key_rgb: tuple[int, int, int] | None = None,
    key_color: str = "auto",
    fps: float = 24.0,
    crf: int = CRF,
    lossless: bool = False,
    force: bool = False,
    backup_ship: bool = True,
    min_bbox_h: float = 0.55,
    preserve_subject: bool = False,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "input": str(mp4),
        "output": str(out_webm),
        "ok": False,
        "preserve_subject": preserve_subject,
    }
    if not mp4.exists():
        result["error"] = f"missing {mp4}"
        return result
    if out_webm.exists() and out_webm.stat().st_size > 80_000 and not force:
        result["ok"] = True
        result["skipped"] = True
        return result

    work = (qa_dir or out_webm.parent / "_key_qa") / qa_tag
    id_png = ensure_id_frame(mp4, work.parent / "_id_frames", qa_tag)
    key_t = resolve_key_rgb(id_png, key_rgb=key_rgb, key_color=key_color)
    use_palette = key_rgb is None and key_color.lower() == "auto"
    key_dom = key_dominant_channel(np.asarray(key_t, dtype=np.float32))
    if use_palette:
        palette = sample_key_palette(id_png)
        others = [i for i in range(3) if i != key_dom]
        dominance = palette[:, key_dom] - np.maximum(
            palette[:, others[0]], palette[:, others[1]]
        )
        # Neutral foreground props often occupy a corner. Keep only colors
        # that actually have the screen channel dominance; never key gray props
        # merely because they were sampled near a screen edge.
        screen_palette = palette[dominance >= 4.0]
        key = screen_palette if len(screen_palette) >= 2 else palette
    else:
        key = np.array(key_t, dtype=np.float32)
    result["key_rgb"] = key_t
    result["key_palette"] = np.asarray(key).round().astype(int).tolist() if use_palette else [key_t]
    result["key_dom"] = ["R", "G", "B"][key_dom]

    erode_px = 0 if preserve_subject else 2
    sim_ladder = SIM_LADDER_PRESERVE if preserve_subject else SIM_LADDER
    blend_ladder = BLEND_LADDER_PRESERVE if preserve_subject else BLEND_LADDER
    if preserve_subject:
        # Strongest-first: the old weakest-first order always stopped at
        # sim=0.10, leaving large background residue. Integrity gates below
        # are lenient, so the strongest *safe* key wins and the background
        # actually gets removed.
        sim_ladder = sim_ladder[::-1]
        blend_ladder = blend_ladder[::-1]
    max_rim_bad = MAX_RIM_BAD_PRESERVE if preserve_subject else MAX_RIM_BAD
    max_rim_spill = MAX_RIM_SPILL_PRESERVE if preserve_subject else MAX_RIM_SPILL
    # Preserve mode allows a small amount of deliberate hole cleanup while
    # retaining the subject silhouette and all isolated prop pixels.
    min_keep = 0.94 if preserve_subject else MIN_KEEP
    min_iou = 0.45 if preserve_subject else MIN_IOU
    min_h = 0.90 if preserve_subject else MIN_H

    rgb0 = np.asarray(Image.open(id_png).convert("RGB"))
    rem0 = rembg_mask(rgb0, session)
    if rem0.mean() < 0.05:
        result["error"] = "rembg empty"
        return result
    protect0, _ = protect_masks(rem0, erode_px=erode_px)
    h0 = bbox_h(protect0)
    result["integrity_plate"] = {"core": protect0.mean(), "rembg": rem0.mean(), "bbox_h": h0}
    # Standing plates usually fill ≥0.70 vertical; sleep/curled poses need a lower floor.
    if h0 < min_bbox_h:
        result["error"] = f"incomplete subject h={h0:.3f} (min={min_bbox_h:.3f})"
        return result

    frames = extract_frames(mp4, work / "raw")
    result["frames"] = len(frames)
    sample_idx = sorted(
        set([0, len(frames) // 2, len(frames) - 1] + list(range(0, len(frames), 12)))
    )

    protect_all: list[np.ndarray] = []
    for fp in frames:
        rgb = np.asarray(Image.open(fp).convert("RGB"))
        core, _ = protect_masks(rembg_mask(rgb, session), erode_px=erode_px)
        protect_all.append(core)

    accepted = None
    keyed_dir = work / "keyed"
    last_det = ""
    for sim, blend in zip(sim_ladder, blend_ladder):
        if keyed_dir.exists():
            shutil.rmtree(keyed_dir)
        keyed_dir.mkdir(parents=True)
        bad = False
        det = ""
        for i, fp in enumerate(frames):
            rgb = np.asarray(Image.open(fp).convert("RGB"))
            protect = protect_all[i]
            rgba = compose(rgb, protect, key, sim, blend, key_dom)
            if i in sample_idx:
                ok, det = integrity_ok(
                    protect, rgba, min_keep=min_keep, min_iou=min_iou, min_h=min_h
                )
                if not ok:
                    last_det = f"integrity {det}"
                    if not preserve_subject:
                        bad = True
                        break
                ok_s, det_s = spill_ok(
                    protect,
                    rgba,
                    key_dom,
                    max_rim_bad=max_rim_bad,
                    max_rim_spill=max_rim_spill,
                )
                if not ok_s:
                    last_det = f"spill {det_s}"
                    if not preserve_subject:
                        bad = True
                        break
                det = f"{det} | {det_s}"
            Image.fromarray(rgba, "RGBA").save(keyed_dir / f"k_{i+1:05d}.png")
        if bad:
            continue
        accepted = sim
        last_det = det
        break

    if accepted is None:
        if preserve_subject and keyed_dir.exists() and any(keyed_dir.glob("k_*.png")):
            accepted = sim_ladder[-1]
            last_det = f"accepted preserve fallback ({last_det})"
        else:
            result["error"] = f"all ladders failed ({last_det})"
            return result

    encode_webm(keyed_dir, out_webm, fps=fps, crf=crf, lossless=lossless)
    ok_a, det_a = verify_webm_alpha(out_webm)
    result["webm_verify"] = det_a
    if not ok_a:
        result["error"] = det_a
        return result

    preview = work / f"{qa_tag}_preview_rgba.png"
    shutil.copy2(keyed_dir / "k_00001.png", preview)
    result["preview"] = str(preview)

    if ship_path is not None:
        if backup_ship and ship_path.exists():
            bak = ship_path.with_suffix(ship_path.suffix + ".bak_before_key")
            if not bak.exists():
                shutil.copy2(ship_path, bak)
        ship_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(out_webm, ship_path)
        result["ship"] = str(ship_path)

    result["ok"] = True
    result["sim"] = accepted
    result["detail"] = last_det
    return result


def load_name_map(path: Path | None) -> dict[str, dict[str, str]]:
    if path is None or not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return data
    return {}
