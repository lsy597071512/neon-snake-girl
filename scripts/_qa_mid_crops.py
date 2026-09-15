from pathlib import Path
from PIL import Image

qa = Path(r"f:\game\neon-snake-girl_zhen\neon-snake-girl_zhen\neon-snake-girl\tmp\cmd_discipline_p4_qa")
ll = Path(r"f:\game\neon-snake-girl_zhen\neon-snake-girl_zhen\neon-snake-girl\tmp\cmd_discipline_p4_lllite")
for name in ["SR01_2_P4-A_idleface_d80_s98401.png", "SR01_2_P4-A_idleface_d80_s98417.png", "SR01_2_P4-A_idleface_d70_s98417.png"]:
    p = ll / name
    if not p.exists():
        continue
    im = Image.open(p).convert("RGB")
    w, h = im.size
    tag = name.replace("SR01_2_P4-A_idleface_", "").replace(".png", "")
    im.crop((int(w * 0.22), int(h * 0.30), int(w * 0.78), int(h * 0.70))).resize((640, 720)).save(
        qa / f"qa_mid_{tag}.png"
    )
    print(tag)
