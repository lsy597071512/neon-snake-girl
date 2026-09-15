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
    mean = np.mean([p.mean(axis=(0, 1)) for p in patches], axis=0)
    all_px = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    dom = key_dom if key_dom is not None else key_dominant_channel(mean)
    others = [i for i in range(3) if i != dom]
    ex = all_px[:, dom] - np.maximum(all_px[:, others[0]], all_px[:, others[1]])
    pure = all_px[ex > 28]
    if len(pure) >= 12:
        mean = pure.mean(axis=0)
    return int(mean[0]), int(mean[1]), int(mean[2])


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
        return sample_key_rgb(id_png)
    # auto with hint from preset name fallback
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
    dist = np.linalg.norm(f - key.reshape(1, 1, 3), axis=2)
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


def compose(
    rgb: np.ndarray,
    protect_core: np.ndarray,
    key: np.ndarray,
    sim: float,
    blend: float,
    key_dom: int,
) -> np.ndarray:
    a = chroma_alpha(rgb, key, sim, blend, key_dom)
    a = np.where(protect_core, 1.0, a)
    a = refine_alpha_rim(rgb, a, protect_core, key, sim, blend, key_dom)
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


def encode_webm(keyed_dir: Path, out_webm: Path, fps: float = 24.0, crf: int = CRF) -> None:
    out_webm.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_webm.with_suffix(".tmp.webm")
    subprocess.run(
        [
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
            str(crf),
            "-b:v",
            "0",
            "-row-mt",
            "1",
            "-an",
            str(tmp),
        ],
        check=True,
        capture_output=True,
    )
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
    force: bool = False,
    backup_ship: bool = True,
    min_bbox_h: float = 0.70,
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
    key = np.array(key_t, dtype=np.float32)
    key_dom = key_dominant_channel(key)
    result["key_rgb"] = key_t
    result["key_dom"] = ["R", "G", "B"][key_dom]

    erode_px = 0 if preserve_subject else 2
    sim_ladder = SIM_LADDER_PRESERVE if preserve_subject else SIM_LADDER
    blend_ladder = BLEND_LADDER_PRESERVE if preserve_subject else BLEND_LADDER
    max_rim_bad = MAX_RIM_BAD_PRESERVE if preserve_subject else MAX_RIM_BAD
    max_rim_spill = MAX_RIM_SPILL_PRESERVE if preserve_subject else MAX_RIM_SPILL
    # Preserve: rembg core must stay; IoU can be lower because we intentionally keep green fringe
    min_iou = 0.62 if preserve_subject else MIN_IOU
    min_h = 0.92 if preserve_subject else MIN_H

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
                    protect, rgba, min_iou=min_iou, min_h=min_h
                )
                if not ok:
                    bad = True
                    last_det = f"integrity {det}"
                    break
                ok_s, det_s = spill_ok(
                    protect,
                    rgba,
                    key_dom,
                    max_rim_bad=max_rim_bad,
                    max_rim_spill=max_rim_spill,
                )
                if not ok_s:
                    bad = True
                    last_det = f"spill {det_s}"
                    break
                det = f"{det} | {det_s}"
            Image.fromarray(rgba, "RGBA").save(keyed_dir / f"k_{i+1:05d}.png")
        if bad:
            continue
        accepted = sim
        last_det = det
        break

    if accepted is None:
        result["error"] = f"all ladders failed ({last_det})"
        return result

    encode_webm(keyed_dir, out_webm, fps=fps, crf=crf)
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
