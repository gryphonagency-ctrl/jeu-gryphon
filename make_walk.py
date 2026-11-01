import math, sys
import numpy as np
from PIL import Image

# nom -> (fichier source, hanche en fraction de hauteur)
CH = {
    'luffy': ('luffy-new.png', 0.52),
    'freezer': ('freezer-cut.png', 0.56),
    'beerus': ('beerus-cut.png', 0.56),
    'naruto': ('naruto-cut.png', 0.52),
    'sasuke': ('sasuke-cut.png', 0.52),
}
PAD = 0.3
RANGE = {'freezer': (100, 215), 'beerus': (0, 185)}
ANG = 11
N = 8


def split_x(a, hip, w, h):
    # colonne la moins remplie entre les jambes, sinon le centre
    lo, hi = int(h * 0.78), int(h * 0.97)
    cols = (a[lo:hi] > 20).sum(axis=0).astype(float)
    c0, c1 = int(w * 0.35), int(w * 0.65)
    seg = cols[c0:c1]
    m = seg.min()
    idx = np.where(seg == m)[0]
    return c0 + int(idx[len(idx) // 2]) if m < (hi - lo) * 0.4 else w // 2


for name, (src, hipf) in CH.items():
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    a = np.array(im)[:, :, 3]
    hip = int(h * hipf)
    sx = split_x(a, hip, w, h)
    padx = int(w * PAD)
    cw = w + 2 * padx
    top = Image.new('RGBA', (cw, h))
    top.paste(im.crop((0, 0, w, hip)), (padx, 0))
    ov = int(h * 0.04)
    legs = []
    lx0, lx1 = RANGE.get(name, (0, w))
    if name in RANGE:
        static = Image.new('RGBA', (cw, h))
        part = im.crop((0, hip, w, h)).copy()
        mask = Image.new('L', part.size, 255)
        mask.paste(0, (lx0, 0, lx1, part.size[1]))
        static.paste(part, (padx, hip), mask)
        top = Image.alpha_composite(static, top)
    for side in (0, 1):
        x0, x1 = (lx0, sx) if side == 0 else (sx, lx1)
        leg = Image.new('RGBA', (cw, h))
        leg.paste(im.crop((x0, hip - ov, x1, h)), (padx + x0, hip - ov))
        legs.append(leg)
    sheet = Image.new('RGBA', (cw * N, h * 2))
    pivot = (padx + sx, hip)
    for f in range(N):
        ph = 2 * math.pi * f / N
        frame = Image.new('RGBA', (cw, h))
        for side, leg in enumerate(legs):
            s = math.sin(ph + side * math.pi)
            c = math.cos(ph + side * math.pi)
            ang = ANG * s
            lifted = leg.rotate(ang, resample=Image.BICUBIC, center=pivot)
            lift = int(h * 0.035 * max(0, c))
            lay = Image.new('RGBA', (cw, h))
            lay.paste(lifted, (0, -lift))
            frame = Image.alpha_composite(frame, lay)
        bob = int(h * 0.012 * abs(math.sin(ph * 1)))
        tl = Image.new('RGBA', (cw, h))
        tl.paste(top, (0, bob))
        tl = tl.rotate(-1.5 * math.sin(ph), resample=Image.BICUBIC, center=pivot)
        frame = Image.alpha_composite(frame, tl)
        for row in range(2):
            sheet.paste(frame, (f * cw, row * h))
    out = name + '-walk.png'
    sheet.save(out)
    print(out, sheet.size, 'cell', cw, h, 'split', sx)
