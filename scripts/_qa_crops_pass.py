from pathlib import Path
from PIL import Image

qa = Path(r"f:\game\neon-snake-girl_zhen\neon-snake-girl_zhen\neon-snake-girl\tmp\cmd_discipline_p4_qa")
desk = Path.home() / "Desktop"
paths = [
    desk / "SR01_2_P4-A_PASS_1_id0.979_off0.832.png",
    Path(
        r"f:\game\neon-snake-girl_zhen\neon-snake-girl_zhen\neon-snake-girl\tmp\cmd_discipline_p4_lllite\SR01_2_P4-A_idleface_d57_s98117.png"
    ),
]
for p in paths:
    im = Image.open(p).convert("RGB")
    w, h = im.size
    tag = p.stem[-16:]
    im.crop((int(w * 0.25), int(h * 0.30), int(w * 0.75), int(h * 0.55))).resize((512, 480)).save(
        qa / f"qa_chest_{tag}.png"
    )
    im.crop((int(w * 0.20), int(h * 0.48), int(w * 0.80), int(h * 0.85))).resize((512, 640)).save(
        qa / f"qa_crotch_{tag}.png"
    )
    im.crop((int(w * 0.22), int(h * 0.02), int(w * 0.78), int(h * 0.34))).resize((512, 512)).save(
        qa / f"qa_face_{tag}.png"
    )
    print("ok", tag)
