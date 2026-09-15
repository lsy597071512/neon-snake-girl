"""Batch MiniMax H3: all chongzao (pifu03) shower greenscreen clips.

Vertical 768x1344, ~6s (158 frames @24fps), fixed camera, max occupancy.
Retries when Comfy errors, output missing, or green-screen QA fails.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import imageio_ffmpeg

    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = "ffmpeg"

HOST = "http://127.0.0.1:8188"
COMFY_INPUT = Path(r"E:\MiniMaxH3\ComfyUI\input")
COMFY_OUTPUT_VIDEO = Path(r"E:\MiniMaxH3\ComfyUI\output\video")
SRC_DIR = Path(r"d:\neon-snake-girl\neon-snake-girl\tex\juese\pifu\chongzao")
WIDTH, HEIGHT = 768, 1344
LENGTH = 158  # ~6.58s @24fps, 17k+5 grid
STEPS = 20
MAX_ATTEMPTS = 3
GREEN = (0, 177, 64)  # #00b140
GREEN_RGB = np.array(GREEN, dtype=np.float32)

# artStem -> locked identity + name for logs
CHARACTERS: dict[str, dict[str, str]] = {
    "SR01_2": {
        "name": "苍羽·澪",
        "identity": (
            "ash-blonde high ponytail with metallic white wing-fin hair clips, light blue eyes, "
            "pale skin, white textured bath towel with subtle Z logos, dark gray cybernetic right arm "
            "with gold accents, white/gray cybernetic right leg prosthetic and matching left cyber boot, "
            "holding a modern silver shower head with braided hose"
        ),
    },
    "SR01_3": {
        "name": "苍斩·凛",
        "identity": (
            "messy short silver-white hair with red headband, pale blue eyes, pale skin torso, "
            "glossy white mecha arms and legs with black joints and red accents, red fin-like mechanical heels, "
            "short white bath towel, holding a circular metallic shower head with hose"
        ),
    },
    "SR02_1": {
        "name": "白楯·芹奈",
        "identity": (
            "long wavy ash-blonde hair, teal aquamarine eyes, translucent glowing halo headset with ear modules, "
            "grey-gold mechanical collar, white/grey/gold mechanical right arm, partial thigh/shin armor plates, "
            "matching mechanical high-heel boots, white textured bath towel, chrome shower head with hose"
        ),
    },
    "SR03_1": {
        "name": "银绯·玲",
        "identity": (
            "very long straight silver-grey hair with darker charcoal bang streak on one side, glowing amber-orange eyes, "
            "bulky mechanical headset with sharp yellow-tipped blade antenna, faint glowing shoulder mark, "
            "thin black cyber line on thigh, wet white strapless towel, barefoot, silver shower head with hose"
        ),
    },
    "SR04_1": {
        "name": "焰甲·朱里",
        "identity": (
            "long jet-black high ponytail, amber-orange eyes, white/orange/dark cybernetic arm plating with "
            "orange shoulder plate marked MB-02, elaborate white-orange-charcoal mechanical legs, "
            "thin white towel held at chest, metallic shower head spraying water"
        ),
    },
    "SR05_1": {
        "name": "黄狐·萤",
        "identity": (
            "long wet white hair, large white feline ears with yellow-black mechanical accents, amber-gold eyes, "
            "black/yellow cybernetic respirator covering lower face, white-silver mechanical hands and feet "
            "with yellow accents and panel lines, short wet white towel with thigh slit, silver shower head"
        ),
    },
    "SSR01_1": {
        "name": "夜爪·黑织",
        "identity": (
            "long straight jet-black hair with two small glowing cyan-green triangular clips, glowing crimson eyes, "
            "black choker, matte black left arm prosthetic with green light panels, olive/charcoal mechanical "
            "right lower leg with cyan accents, translucent pinkish heels, white towel, chrome shower head"
        ),
    },
    "SSR02_1": {
        "name": "翠翼·铃",
        "identity": (
            "long silver-grey hair with tech hair plates, luminous green eyes, silver/white cybernetic armor plates "
            "on shoulders arms and legs with glowing green accents, pointed cybernetic heel boots, "
            "wet white towel, metallic shower head overhead"
        ),
    },
    "SSR03_1": {
        "name": "冰华·雫",
        "identity": (
            "long voluminous wavy pastel blue-lavender hair, soft pink eyes, glossy white mechanical bodysuit shell "
            "with gold joints and lower-back teardrop cutout, white towel draped over shoulder, "
            "white-gold mechanical boots with red heel glow, looking back over shoulder, silver shower head"
        ),
    },
    "SSR04_1": {
        "name": "绯尾·椿",
        "identity": (
            "dusty pink/mauve hair with long bangs, reddish-pink eyes, large glossy black angular robotic ears/horns, "
            "polished black left arm prosthetic with red accents, black robotic glove on right hand, "
            "glossy black/red cybernetic legs with heel structure, white bath towel, silver shower head"
        ),
    },
    "SSR05_1": {
        "name": "橙铠·琥珀",
        "identity": (
            "orange twin-tail anime girl with amber eyes, teal forehead accessory, white textured bath towel, "
            "white glossy mechanical thigh-high boots with red/blue accents, silver arm band, "
            "holding a modern silver shower head with hose"
        ),
    },
    "UR03_1": {
        "name": "光轮·天音",
        "identity": (
            "long straight black hair with vivid pink underside/bangs highlights, reddish-brown eyes, "
            "large metallic tech headphones and thick mechanical collar, transparent glass-shell left leg "
            "prosthetic revealing golden gears with green glow accents, white towel, silver shower head overhead"
        ),
    },
    "UR04_1": {
        "name": "橙兔·美羽",
        "identity": (
            "short messy light-blue hair with pink highlights, light-blue headband with pink flower, black X hairpins, "
            "purple-pink eyes, large white-pink bunny ears, white-silver mechanical legs from mid-thigh with "
            "orange heart/diamond accents, silver left bicep band, white towel with orange RABBIT bunny logo, "
            "metallic shower head"
        ),
    },
}


def api(path: str, data=None, timeout: int = 600):
    if data is not None:
        req = urllib.request.Request(
            f"{HOST}{path}",
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
    else:
        req = urllib.request.Request(f"{HOST}{path}")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def upload_image(path: Path) -> str:
    """Upload PNG to ComfyUI input; return filename used by LoadImage."""
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="image"; filename="{path.name}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode()
    body += path.read_bytes()
    body += f"\r\n--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{HOST}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        info = json.load(resp)
    name = info.get("name") or path.name
    print(f"  uploaded {name}", flush=True)
    return name


def make_greenscreen(src: Path, dest: Path) -> Path:
    char = Image.open(src).convert("RGBA")
    a = np.asarray(char)
    mask = a[:, :, 3] > 16
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError(f"no opaque pixels: {src}")
    pad = 4
    l, t = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    r, b = min(char.width, int(xs.max()) + 1 + pad), min(char.height, int(ys.max()) + 1 + pad)
    char = char.crop((l, t, r, b))

    margin = 0.02
    max_w, max_h = int(WIDTH * (1 - 2 * margin)), int(HEIGHT * (1 - 2 * margin))
    scale = min(max_w / char.width, max_h / char.height)
    cw, ch = max(1, int(char.width * scale)), max(1, int(char.height * scale))
    char2 = char.resize((cw, ch), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (*GREEN, 255))
    x, y = (WIDTH - cw) // 2, (HEIGHT - ch) // 2
    canvas.alpha_composite(char2, (x, y))

    arr = np.asarray(canvas).astype(np.float32)
    alpha = arr[:, :, 3:4] / 255.0
    rgb = arr[:, :, :3]
    green = np.broadcast_to(GREEN_RGB, rgb.shape)
    out = rgb * alpha + green * (1.0 - alpha)
    out_img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    out_img.save(dest, "PNG")
    # also copy into Comfy input folder
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, COMFY_INPUT / dest.name)
    print(f"  greenscreen {dest.name} scale={cw}x{ch} h%={ch/HEIGHT*100:.1f}", flush=True)
    return dest


def build_prompt_text(identity: str) -> str:
    return f"""Professional film-set chroma key action plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution look.

FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, no pull-out, no added headroom.

LOCKED identity from first frame: {identity}.

CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. Framing identical throughout.

ACTION timeline (~6 seconds), natural continuous motion:
[0.0-1.5s] She raises the shower head slightly and turns the water ON; clear water spray starts from the shower head.
[1.5-3.5s] She loosens and removes the white bath towel with her free hand (set towel aside / drop out of primary hold), beginning to bathe under the spray; keep tasteful game-style bathing, steam and water droplets; preserve all cybernetic limbs, boots, hair, eyes, and accessories exactly.
[3.5-6.5s] Continues showering with natural idle bathing motion under running water; soft body sway and hair wet by mist; relaxed enjoying expression with soft pleasure and comfort, normal blinking; hair and hose move lightly with water.

Keep pure flat #00b140 green everywhere behind the subject: no bathroom set, no floor, no tiles, no shadow catcher, no vignette. Do not change hair color, face design, cybernetics, or boot design.

Audio: shower water spray and soft room tone only, no speech, no music.
"""


def build_workflow(input_name: str, out_prefix: str, prompt: str, seed: int) -> dict:
    return {
        "6": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
                "weight_dtype": "default",
            },
        },
        "13": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
                "type": "minimax",
                "device": "default",
            },
        },
        "11": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"},
        },
        "24": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"},
        },
        "114": {"class_type": "LoadImage", "inputs": {"image": input_name}},
        "200": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {"model": ["6", 0], "shift_video": 12.0, "shift_audio": 3.0},
        },
        "104": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["13", 0],
                "vae": ["11", 0],
                "prompt": prompt,
                "width": WIDTH,
                "height": HEIGHT,
                "length": LENGTH,
                "first_frame": ["114", 0],
            },
        },
        "15": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "17": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "9": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": ["200", 0],
                "scheduler": "simple",
                "steps": STEPS,
                "denoise": 1.0,
            },
        },
        "16": {
            "class_type": "BasicGuider",
            "inputs": {"model": ["200", 0], "conditioning": ["104", 0]},
        },
        "14": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["15", 0],
                "guider": ["16", 0],
                "sampler": ["17", 0],
                "sigmas": ["9", 0],
                "latent_image": ["104", 1],
            },
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["14", 0], "vae": ["11", 0]},
        },
        "23": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["14", 0], "vae": ["24", 0]},
        },
        "91": {
            "class_type": "CreateVideo",
            "inputs": {
                "images": ["10", 0],
                "fps": 24.0,
                "audio": ["23", 0],
                "bit_depth": 8,
            },
        },
        "92": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["91", 0],
                "filename_prefix": out_prefix,
                "format": "auto",
                "codec": "auto",
            },
        },
    }


def wait_prompt(prompt_id: str, timeout_s: float = 2400.0) -> dict:
    t0 = time.time()
    empty_streak = 0
    while True:
        if time.time() - t0 > timeout_s:
            raise TimeoutError(f"prompt {prompt_id} timed out")
        hist = api(f"/history/{prompt_id}")
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(json.dumps(status, ensure_ascii=False)[:4000])
            if status.get("completed") or entry.get("outputs"):
                return entry
        q = api("/queue")
        n_run = len(q.get("queue_running", []) or [])
        n_pend = len(q.get("queue_pending", []) or [])
        print(
            f"    t={time.time()-t0:.0f}s running={n_run} pending={n_pend}",
            flush=True,
        )
        # Job vanished from queue without history entry (interrupt/clear) — don't hang 40min
        if n_run == 0 and n_pend == 0:
            empty_streak += 1
            if empty_streak >= 4:
                raise RuntimeError(
                    f"prompt {prompt_id} missing from queue/history (likely interrupted)"
                )
        else:
            empty_streak = 0
        time.sleep(8)


def find_latest_output(prefix_leaf: str, after_ts: float) -> Path | None:
    """prefix_leaf like SSR05_1_pifu03_shower_gs (without video/)."""
    candidates = []
    for p in COMFY_OUTPUT_VIDEO.glob(f"{prefix_leaf}_*.mp4"):
        try:
            if p.stat().st_mtime >= after_ts - 2:
                candidates.append(p)
        except OSError:
            continue
    if not candidates:
        # fallback: any matching name, newest
        candidates = list(COMFY_OUTPUT_VIDEO.glob(f"{prefix_leaf}_*.mp4"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def extract_frame(video: Path, t_sec: float, out_png: Path) -> Path:
    out_png.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        FFMPEG,
        "-y",
        "-ss",
        str(t_sec),
        "-i",
        str(video),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(out_png),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_png


def green_screen_ok(frame_path: Path, min_corner_green_ratio: float = 0.62) -> tuple[bool, str]:
    """Check corner patches are chroma green (ignore edge mist/hair from max occupancy)."""
    im = Image.open(frame_path).convert("RGB")
    arr = np.asarray(im).astype(np.float32)
    h, w, _ = arr.shape
    # small corner squares — water spray often hits mid-edges when subject is large
    cs = max(16, min(h, w) // 12)
    corners = [
        arr[:cs, :cs, :],
        arr[:cs, -cs:, :],
        arr[-cs:, :cs, :],
        arr[-cs:, -cs:, :],
    ]
    corner_px = np.concatenate([c.reshape(-1, 3) for c in corners], axis=0)
    dist = np.linalg.norm(corner_px - GREEN_RGB, axis=1)
    # looser for spray mist / compression; still require green dominance
    green_mask = dist < 80.0
    ratio = float(green_mask.mean())
    mean = corner_px.mean(axis=0)
    g_dom = mean[1] > mean[0] + 20 and mean[1] > mean[2] + 20 and mean[1] > 120
    # reject obvious non-green sets (bathroom etc.)
    not_scene = mean[1] > 100
    ok = ratio >= min_corner_green_ratio and g_dom and not_scene
    detail = f"corner_green={ratio:.3f} meanRGB=({mean[0]:.0f},{mean[1]:.0f},{mean[2]:.0f}) g_dom={g_dom}"
    return ok, detail


def likeness_ok(src_gs: Path, frame_path: Path) -> tuple[bool, str]:
    """Rough non-green subject color consistency vs first-frame greenscreen."""
    a = np.asarray(Image.open(src_gs).convert("RGB")).astype(np.float32)
    b = np.asarray(Image.open(frame_path).convert("RGB")).astype(np.float32)
    if a.shape != b.shape:
        b_img = Image.open(frame_path).convert("RGB").resize((a.shape[1], a.shape[0]), Image.Resampling.BILINEAR)
        b = np.asarray(b_img).astype(np.float32)

    def subject_mask(rgb: np.ndarray) -> np.ndarray:
        dist = np.linalg.norm(rgb - GREEN_RGB, axis=2)
        return dist > 70.0

    ma, mb = subject_mask(a), subject_mask(b)
    # subject should still occupy meaningful area
    area_a, area_b = float(ma.mean()), float(mb.mean())
    if area_b < 0.12:
        return False, f"subject_too_small area_b={area_b:.3f}"
    if abs(area_b - area_a) > 0.35:
        return False, f"occupancy_shift a={area_a:.3f} b={area_b:.3f}"

    # compare mean color of subject pixels
    if ma.sum() < 100 or mb.sum() < 100:
        return False, "too_few_subject_pixels"
    ca = a[ma].mean(axis=0)
    cb = b[mb].mean(axis=0)
    d = float(np.linalg.norm(ca - cb))
    ok = d < 55.0
    return ok, f"subj_mean_dist={d:.1f} area_a={area_a:.3f} area_b={area_b:.3f}"


def process_one(stem: str, meta: dict, force: bool = False) -> dict:
    name = meta["name"]
    src = SRC_DIR / f"{stem}_pifu03.png"
    final_mp4 = SRC_DIR / f"{stem}_pifu03_shower_gs_h3.mp4"
    gs_path = SRC_DIR / f"{stem}_pifu03_greenscreen_first.png"
    result = {"stem": stem, "name": name, "ok": False, "path": str(final_mp4), "attempts": []}

    if final_mp4.exists() and not force:
        # validate existing
        try:
            qa_dir = SRC_DIR / "_qa" / stem
            f0 = extract_frame(final_mp4, 0.3, qa_dir / "exist_t03.png")
            f1 = extract_frame(final_mp4, 3.0, qa_dir / "exist_t30.png")
            if not gs_path.exists():
                make_greenscreen(src, gs_path)
            g_ok, g_detail = green_screen_ok(f0)
            g_ok2, g_detail2 = green_screen_ok(f1)
            l_ok, l_detail = likeness_ok(gs_path, f0)
            if g_ok and g_ok2 and l_ok:
                print(f"[SKIP OK] {stem} {name} already valid", flush=True)
                result["ok"] = True
                result["skipped"] = True
                return result
            print(f"[REDO] {stem} existing failed QA g={g_detail}|{g_detail2} l={l_detail}", flush=True)
        except Exception as e:
            print(f"[REDO] {stem} existing QA error: {e}", flush=True)

    make_greenscreen(src, gs_path)
    input_name = upload_image(gs_path)
    # also ensure filename matches LoadImage if upload renames
    shutil.copy2(gs_path, COMFY_INPUT / input_name)

    prompt = build_prompt_text(meta["identity"])
    out_leaf = f"{stem}_pifu03_shower_gs"
    out_prefix = f"video/{out_leaf}"

    for attempt in range(1, MAX_ATTEMPTS + 1):
        seed = 2026081400 + hash(stem) % 100000 + attempt * 97
        print(f"[{stem}] {name} attempt {attempt}/{MAX_ATTEMPTS} seed={seed}", flush=True)
        t_start = time.time()
        try:
            wf = build_workflow(input_name, out_prefix, prompt, seed)
            res = api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            entry = wait_prompt(prompt_id)
            elapsed = time.time() - t_start
            print(f"  done in {elapsed:.1f}s", flush=True)
            out = find_latest_output(out_leaf, t_start)
            if out is None:
                raise RuntimeError("output mp4 not found")
            qa_dir = SRC_DIR / "_qa" / stem
            f0 = extract_frame(out, 0.4, qa_dir / f"a{attempt}_t04.png")
            f1 = extract_frame(out, 3.2, qa_dir / f"a{attempt}_t32.png")
            f2 = extract_frame(out, 5.5, qa_dir / f"a{attempt}_t55.png")
            checks = []
            for fp, label in ((f0, "t0.4"), (f1, "t3.2"), (f2, "t5.5")):
                ok_g, det_g = green_screen_ok(fp)
                checks.append((f"green[{label}]", ok_g, det_g))
            ok_l, det_l = likeness_ok(gs_path, f0)
            checks.append(("likeness", ok_l, det_l))
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if all(ok for _, ok, _ in checks):
                shutil.copy2(out, final_mp4)
                result["ok"] = True
                result["attempts"].append({"attempt": attempt, "seed": seed, "ok": True, "src": str(out)})
                print(f"  ACCEPTED -> {final_mp4}", flush=True)
                return result
            result["attempts"].append(
                {"attempt": attempt, "seed": seed, "ok": False, "checks": [(a, b, c) for a, b, c in checks]}
            )
            print("  REJECTED, will retry", flush=True)
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            result["attempts"].append({"attempt": attempt, "seed": seed, "ok": False, "error": str(e)})
            time.sleep(5)

    print(f"[FAIL] {stem} {name} after {MAX_ATTEMPTS} attempts", flush=True)
    return result


def main():
    print("=== chongzao shower H3 batch ===", flush=True)
    print(f"characters: {len(CHARACTERS)}", flush=True)
    api("/system_stats")  # connectivity check
    results = []
    for stem, meta in CHARACTERS.items():
        src = SRC_DIR / f"{stem}_pifu03.png"
        if not src.exists():
            print(f"[MISS] {src}", flush=True)
            results.append({"stem": stem, "ok": False, "error": "missing png"})
            continue
        results.append(process_one(stem, meta, force=False))

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
    }
    report = SRC_DIR / "_qa" / "shower_batch_report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=== SUMMARY ===", flush=True)
    print("OK:", ", ".join(summary["ok"]) or "(none)", flush=True)
    print("FAIL:", ", ".join(summary["fail"]) or "(none)", flush=True)
    print("report:", report, flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
