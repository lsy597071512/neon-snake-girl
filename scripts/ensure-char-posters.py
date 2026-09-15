from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance

root = Path(r'e:\AIgame\Aigame\neon-snake-girl\neon-snake-girl\neon-snake-girl')
out = root / 'tex' / 'storyboards' / 'char-posters'
out.mkdir(parents=True, exist_ok=True)
juese = root / 'tex' / 'juese'
sb = root / 'tex' / 'storyboards'
beijing = root / 'tex' / 'beijing01.png'

chars = {
    'ashcrow': ('SR01_2.png', '01-ashcrow-charge.png'),
    'heartforge': ('SR02_1.png', '02-heartforge-guard.png'),
    'mirror': ('SR03_1.png', '03-mirror-scout.png'),
    'neoncoil': ('SR01_3.png', None),
    'prismrift': ('SR04_1.png', None),
    'wireguard': ('SR05_1.png', '04-wireguard-campfire.png'),
    'frostline': ('SSR01_1.png', '05-frostline-ambush.png'),
    'pulse': ('SSR02_1.png', None),
    'dustblade': ('SSR04_1.png', '07-dustblade-hunt.png'),
    'ironrain': ('SSR05_1.png', '08-ironrain-workshop.png'),
    'skyshard': ('SSR03_1.png', '11-skyshard-iceguard.png'),
    'stellar': ('UR03_1.png', '09-stellar-judgment.png'),
    'outercore': ('UR04_1.png', '10-outercore-sync.png'),
}

PORTRAIT = (1024, 1536)
LANDSCAPE = (1536, 1024)


def cover(img: Image.Image, size):
    tw, th = size
    iw, ih = img.size
    scale = max(tw / iw, th / ih)
    nw, nh = int(iw * scale), int(ih * scale)
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def contain_on_blur(src: Image.Image, size, bg_src: Image.Image | None = None):
    tw, th = size
    if bg_src is not None:
        canvas = cover(bg_src.convert('RGB'), size)
        canvas = canvas.filter(ImageFilter.GaussianBlur(28))
        canvas = ImageEnhance.Brightness(canvas).enhance(0.45)
    else:
        base = cover(src.convert('RGB'), size)
        canvas = base.filter(ImageFilter.GaussianBlur(36))
        canvas = ImageEnhance.Brightness(canvas).enhance(0.35)
    iw, ih = src.size
    scale = min(tw / iw, th / ih) * 0.92
    nw, nh = max(1, int(iw * scale)), max(1, int(ih * scale))
    fg = src.convert('RGBA').resize((nw, nh), Image.Resampling.LANCZOS)
    x = (tw - nw) // 2
    y = (th - nh) // 2
    canvas = canvas.convert('RGBA')
    canvas.alpha_composite(fg, (x, y))
    return canvas.convert('RGB')


def char_on_bg(char_path: Path, size, bg_path: Path):
    char = Image.open(char_path).convert('RGBA')
    bg = Image.open(bg_path).convert('RGB')
    canvas = cover(bg, size)
    canvas = canvas.filter(ImageFilter.GaussianBlur(18))
    canvas = ImageEnhance.Brightness(canvas).enhance(0.42)
    canvas = ImageEnhance.Color(canvas).enhance(0.9)
    tw, th = size
    cw, ch = char.size
    scale = (th * 0.82) / ch
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    if nw > tw * 0.95:
        scale = (tw * 0.95) / cw
        nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    fg = char.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (tw - nw) // 2
    y = th - nh - int(th * 0.04)
    out_img = canvas.convert('RGBA')
    out_img.alpha_composite(fg, (x, y))
    return out_img.convert('RGB')


made = []
for cid, (jfile, sbfile) in chars.items():
    p_path = out / f'{cid}-portrait.png'
    l_path = out / f'{cid}-landscape.png'
    jpath = juese / jfile
    sbpath = (sb / sbfile) if sbfile else None

    if not l_path.exists():
        if sbpath and sbpath.exists():
            img = Image.open(sbpath).convert('RGB')
            cover(img, LANDSCAPE).save(l_path, 'PNG', optimize=True)
            made.append(f'L from storyboard {cid}')
        else:
            char_on_bg(jpath, LANDSCAPE, beijing).save(l_path, 'PNG', optimize=True)
            made.append(f'L from juese {cid}')

    if not p_path.exists():
        land = Image.open(l_path).convert('RGB')
        base = contain_on_blur(
            land,
            PORTRAIT,
            Image.open(beijing).convert('RGB') if beijing.exists() else None,
        )
        if jpath.exists():
            char = Image.open(jpath).convert('RGBA')
            tw, th = PORTRAIT
            cw, ch = char.size
            scale = (th * 0.72) / ch
            nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
            if nw > tw * 0.92:
                scale = (tw * 0.92) / cw
                nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
            fg = char.resize((nw, nh), Image.Resampling.LANCZOS)
            x = (tw - nw) // 2
            y = th - nh - int(th * 0.02)
            base = base.convert('RGBA')
            shade = Image.new('RGBA', PORTRAIT, (0, 0, 0, 70))
            base.alpha_composite(shade)
            base.alpha_composite(fg, (x, y))
            base = base.convert('RGB')
        base.save(p_path, 'PNG', optimize=True)
        made.append(f'P synthesized {cid}')

print('done')
for m in made:
    print(m)
print('--- files ---')
for f in sorted(out.glob('*.png')):
    im = Image.open(f)
    print(f'{f.name}: {im.size[0]}x{im.size[1]}')
