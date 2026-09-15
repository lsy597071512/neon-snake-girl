"""Regen 冰华·雫 (SSR03_1) shower: remove ALL clothing then bathe. Same H3 greenscreen specs."""
from __future__ import annotations

import importlib.util
import shutil
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / "scripts" / "run_minimax_h3_chongzao_shower_batch.py"

spec = importlib.util.spec_from_file_location("chongzao_batch", BATCH)
m = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(m)

STEM = "SSR03_1"
IDENTITY = (
    "long voluminous wavy pastel blue-lavender hair, soft pink eyes, pale skin, "
    "starting clothed in a glossy white mechanical bodysuit shell with gold joints "
    "and lower-back teardrop cutout plus a white towel draped over the shoulder, "
    "white-gold mechanical boots with red heel glow, looking back over shoulder, "
    "silver shower head in hand"
)

PROMPT = f"""Professional film-set chroma key action plate. Uniform chroma key background, pure green screen (#00b140), studio lighting with zero shadows, seamless matte color, no texture or reflection, subject isolated on solid green, professional film set standard, 8K resolution look.

FRAMING: character fills almost the entire vertical frame — keep MAXIMUM screen occupancy. Do not shrink the subject, no pull-out, no added headroom.

LOCKED identity from first frame: {IDENTITY}.

CAMERA: completely locked tripod. No pan, tilt, zoom, push-in, pull-out, or drift. Framing identical throughout.

ACTION timeline (~6 seconds), natural continuous motion:
[0.0-1.5s] She raises the shower head slightly and turns the water ON; clear water spray starts from the shower head.
[1.5-3.5s] She completely undresses for the shower: removes the white towel AND peels off / strips away ALL remaining clothing including the glossy white bodysuit and any pants or undergarments, dropping everything aside so she is fully nude under the spray (keep only her white-gold mechanical boots / integrated cybernetic leg shells if they are prosthetic body parts). Tasteful game-style bathing, steam and water droplets; preserve hair color, face, pink eyes, and boot design exactly.
[3.5-6.5s] Continues showering fully nude with natural idle bathing motion under running water; soft body sway and hair wet by mist; relaxed enjoying expression with soft pleasure and comfort, normal blinking; hair and hose move lightly with water. She must stay completely nude — no towel, no bodysuit, no pants, no underwear reappearing.

Keep pure flat #00b140 green everywhere behind the subject: no bathroom set, no floor, no tiles, no shadow catcher, no vignette. Do not change hair color, face design, or boot design.

Audio: shower water spray and soft room tone only, no speech, no music.
"""


def main() -> int:
    src = m.SRC_DIR / f"{STEM}_pifu03.png"
    final_mp4 = m.SRC_DIR / f"{STEM}_pifu03_shower_gs_h3.mp4"
    gs_path = m.SRC_DIR / f"{STEM}_pifu03_greenscreen_first.png"
    out_leaf = f"{STEM}_pifu03_shower_gs"
    out_prefix = f"video/{out_leaf}"

    print(f"=== regen {STEM} 冰华·雫 full-undress shower ===", flush=True)
    m.api("/system_stats")
    m.make_greenscreen(src, gs_path)
    input_name = m.upload_image(gs_path)
    shutil.copy2(gs_path, m.COMFY_INPUT / input_name)

    for attempt in range(1, m.MAX_ATTEMPTS + 1):
        seed = 2026081501 + attempt * 131
        print(f"[{STEM}] attempt {attempt}/{m.MAX_ATTEMPTS} seed={seed}", flush=True)
        t_start = time.time()
        try:
            wf = m.build_workflow(input_name, out_prefix, PROMPT, seed)
            res = m.api("/prompt", {"prompt": wf, "client_id": str(uuid.uuid4())})
            prompt_id = res["prompt_id"]
            print(f"  prompt_id {prompt_id}", flush=True)
            m.wait_prompt(prompt_id)
            print(f"  done in {time.time() - t_start:.1f}s", flush=True)
            out = m.find_latest_output(out_leaf, t_start)
            if out is None:
                raise RuntimeError("output mp4 not found")

            qa_dir = m.SRC_DIR / "_qa" / f"{STEM}_nude"
            f0 = m.extract_frame(out, 0.4, qa_dir / f"a{attempt}_t04.png")
            f1 = m.extract_frame(out, 3.2, qa_dir / f"a{attempt}_t32.png")
            f2 = m.extract_frame(out, 5.5, qa_dir / f"a{attempt}_t55.png")
            checks = []
            for fp, label in ((f0, "t0.4"), (f1, "t3.2"), (f2, "t5.5")):
                ok_g, det_g = m.green_screen_ok(fp)
                checks.append((f"green[{label}]", ok_g, det_g))
            ok_l, det_l = m.likeness_ok(gs_path, f0)
            checks.append(("likeness", ok_l, det_l))
            for label, ok, det in checks:
                print(f"  QA {label}: {'PASS' if ok else 'FAIL'} {det}", flush=True)
            if all(ok for _, ok, _ in checks):
                shutil.copy2(out, final_mp4)
                print(f"  ACCEPTED -> {final_mp4}", flush=True)
                return 0
            print("  REJECTED, will retry", flush=True)
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            time.sleep(5)

    print(f"[FAIL] {STEM} after {m.MAX_ATTEMPTS} attempts", flush=True)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
