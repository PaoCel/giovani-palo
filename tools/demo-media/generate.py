#!/usr/bin/env python3
"""Illustrazioni sintetiche per la galleria del palo demo (tools/lib/demoData.mjs).

Solo paesaggi e oggetti del campo, nessuna persona: la galleria demo non mostra
mai volti (docs/KIT_DEMO.md, sezione 2). Deterministico: stesso script, stessi file.

    python3 tools/demo-media/generate.py      # scrive *.jpg e *-thumb.jpg qui accanto
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent
W, H = 1600, 1066
THUMB_W = 480


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(img, stops, top=0, bottom=None):
    bottom = H if bottom is None else bottom
    draw = ImageDraw.Draw(img)
    for y in range(top, bottom):
        t = (y - top) / max(1, bottom - top - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                draw.line([(0, y), (W, y)], fill=lerp(c0, c1, (t - p0) / max(1e-6, p1 - p0)))
                break


def ridge(rng, base, amp, rough, step=8):
    points = []
    phase = [rng.uniform(0, 6.28) for _ in range(4)]
    for x in range(0, W + step, step):
        y = base
        y -= amp * math.sin(x / (W / 2.2) + phase[0])
        y -= amp * 0.5 * math.sin(x / (W / 5.5) + phase[1])
        y -= amp * 0.25 * math.sin(x / (W / 13) + phase[2])
        y -= rough * rng.uniform(-1, 1)
        points.append((x, y))
    return points + [(W, H), (0, H)]


def glow(img, center, radius, color, strength=0.55):
    layer = Image.new("RGB", img.size, (0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius], fill=color
    )
    layer = layer.filter(ImageFilter.GaussianBlur(radius / 2.2))
    return Image.blend(img, Image.composite(layer, img, layer.convert("L")), strength)


def stars(draw, rng, count, max_y, bright=(255, 250, 235)):
    for _ in range(count):
        x, y = rng.uniform(0, W), rng.uniform(0, max_y) ** 1.08
        r = rng.choice([0.8, 1, 1, 1.4, 2])
        tone = lerp((150, 160, 190), bright, rng.random())
        draw.ellipse([x - r, y - r, x + r, y + r], fill=tone)


def pine(draw, x, ground, height, color):
    trunk = height * 0.12
    draw.rectangle([x - height * 0.03, ground - trunk, x + height * 0.03, ground], fill=lerp(color, (30, 20, 15), 0.5))
    tiers = 4
    for i in range(tiers):
        t = i / tiers
        width = height * (0.42 - 0.09 * i)
        bottom = ground - trunk - height * 0.2 * i
        top = bottom - height * 0.38
        draw.polygon([(x - width, bottom), (x + width, bottom), (x, top)], fill=color)
    _ = t


def tent(draw, x, ground, size, body, shade, door):
    left, right, apex = (x - size, ground), (x + size, ground), (x + size * 0.1, ground - size * 1.05)
    draw.polygon([left, apex, (x + size * 0.1, ground)], fill=shade)
    draw.polygon([(x + size * 0.1, ground), apex, right], fill=body)
    draw.polygon([(x - size * 0.08, ground), (x + size * 0.1, ground - size * 0.62), (x + size * 0.3, ground)], fill=door)


def scene_alba(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (44, 62, 110)), (0.45, (238, 150, 110)), (0.7, (252, 214, 150)), (1, (252, 230, 190))])
    img = glow(img, (W * 0.62, H * 0.56), 170, (255, 236, 180), 0.8)
    draw = ImageDraw.Draw(img)
    draw.ellipse([W * 0.62 - 60, H * 0.56 - 60, W * 0.62 + 60, H * 0.56 + 60], fill=(255, 244, 214))
    for i, color in enumerate([(176, 120, 132), (128, 88, 112), (84, 62, 92), (46, 40, 64)]):
        draw.polygon(ridge(rng, H * (0.58 + 0.1 * i), 60 - 8 * i, 6 + 4 * i), fill=color)
    return img


def scene_lago(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (120, 176, 214)), (1, (214, 234, 240))], 0, int(H * 0.55))
    gradient(img, [(0, (70, 120, 140)), (1, (26, 60, 78))], int(H * 0.55), H)
    draw = ImageDraw.Draw(img)
    for i, color in enumerate([(150, 178, 196), (98, 136, 150), (54, 92, 84)]):
        pts = ridge(rng, H * (0.38 + 0.07 * i), 90 - 20 * i, 8)
        draw.polygon([(x, min(y, H * 0.55)) for x, y in pts[:-2]] + [(W, H * 0.55), (0, H * 0.55)], fill=color)
        mirrored = [(x, H * 1.1 - y * 1.0) for x, y in pts[:-2]]
        draw.polygon([(x, max(y, H * 0.55)) for x, y in mirrored] + [(W, H * 0.55), (0, H * 0.55)], fill=lerp(color, (40, 80, 100), 0.55))
    for _ in range(140):
        y = rng.uniform(H * 0.56, H)
        x = rng.uniform(0, W)
        length = rng.uniform(20, 120)
        draw.line([(x, y), (x + length, y)], fill=(170, 206, 214), width=1)
    for x in range(0, W, 46):
        pine(draw, x + rng.uniform(-10, 10), H * 0.56, rng.uniform(70, 120), (30, 66, 52))
    return img


def scene_tende(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (52, 56, 112)), (0.5, (214, 120, 106)), (1, (246, 186, 128))], 0, int(H * 0.62))
    gradient(img, [(0, (92, 116, 64)), (1, (44, 70, 40))], int(H * 0.62), H)
    draw = ImageDraw.Draw(img)
    draw.polygon(ridge(rng, H * 0.6, 40, 4), fill=(70, 70, 96))
    gradient_ground = ridge(rng, H * 0.66, 18, 2)
    draw.polygon(gradient_ground, fill=(78, 104, 58))
    for x in range(-20, W, 70):
        pine(draw, x + rng.uniform(-14, 14), H * 0.63, rng.uniform(90, 150), (34, 50, 44))
    for x, size, body in [(340, 150, (232, 140, 64)), (760, 190, (60, 132, 160)), (1210, 140, (214, 92, 76))]:
        tent(draw, x, H * 0.86, size, body, lerp(body, (20, 20, 30), 0.35), (30, 26, 34))
    return img


def scene_falo(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (10, 14, 36)), (1, (36, 30, 58))], 0, int(H * 0.7))
    gradient(img, [(0, (40, 30, 30)), (1, (16, 12, 14))], int(H * 0.7), H)
    draw = ImageDraw.Draw(img)
    stars(draw, rng, 380, H * 0.6)
    for x in range(-30, W, 64):
        pine(draw, x + rng.uniform(-12, 12), H * 0.72, rng.uniform(140, 230), (12, 18, 24))
    cx, cy = W * 0.5, H * 0.8
    img = glow(img, (cx, cy - 40), 360, (255, 140, 50), 0.6)
    draw = ImageDraw.Draw(img)
    for angle in (-0.5, 0.5, 0.0):
        dx, dy = 150 * math.cos(angle), 40 * math.sin(angle)
        draw.line([(cx - dx, cy + 30 + dy), (cx + dx, cy + 30 - dy)], fill=(80, 46, 30), width=26)
    for color, scale in [((214, 64, 30), 1.0), ((250, 140, 40), 0.72), ((255, 214, 110), 0.42)]:
        flame = []
        for i in range(25):
            t = i / 24
            w = 110 * scale * math.sin(math.pi * t) * (1 - 0.4 * t)
            flame.append((cx - w + rng.uniform(-6, 6), cy + 20 - 260 * scale * t))
        flame += [(cx + 110 * scale * math.sin(math.pi * (i / 24)) * (1 - 0.4 * i / 24) + rng.uniform(-6, 6), cy + 20 - 260 * scale * i / 24) for i in range(24, -1, -1)]
        draw.polygon(flame, fill=color)
    for _ in range(60):
        x, y = cx + rng.uniform(-200, 200), cy - rng.uniform(220, 520)
        draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(255, 190, 90))
    return img


def scene_bosco(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (196, 222, 196)), (1, (110, 150, 104))])
    draw = ImageDraw.Draw(img)
    layers = [(0.5, (150, 184, 144), 40), (0.68, (98, 138, 96), 30), (0.86, (58, 96, 62), 22), (1.04, (30, 58, 40), 16)]
    for base, color, gap in layers:
        for x in range(-40, W + 40, gap * 4):
            pine(draw, x + rng.uniform(-20, 20), H * base, rng.uniform(220, 340) * base, color)
    rays = Image.new("RGB", img.size, (0, 0, 0))
    rd = ImageDraw.Draw(rays)
    for i in range(6):
        x0 = W * 0.15 + i * 150
        rd.polygon([(x0, 0), (x0 + 70, 0), (x0 + 420, H), (x0 + 260, H)], fill=(255, 246, 200))
    rays = rays.filter(ImageFilter.GaussianBlur(40))
    return Image.blend(img, Image.composite(rays, img, rays.convert("L")), 0.32)


def scene_stelle(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (6, 10, 30)), (0.7, (30, 36, 80)), (1, (64, 60, 104))])
    band = Image.new("RGB", img.size, (0, 0, 0))
    bd = ImageDraw.Draw(band)
    for i in range(40):
        t = i / 39
        x, y = W * (0.1 + 0.8 * t), H * (0.75 - 0.6 * t)
        bd.ellipse([x - 160, y - 70, x + 160, y + 70], fill=(120, 110, 170))
    band = band.filter(ImageFilter.GaussianBlur(70))
    img = Image.blend(img, Image.composite(band, img, band.convert("L")), 0.5)
    draw = ImageDraw.Draw(img)
    stars(draw, rng, 900, H * 0.85)
    draw.polygon(ridge(rng, H * 0.86, 50, 3), fill=(10, 12, 22))
    tent(draw, W * 0.7, H * 0.95, 110, (60, 50, 70), (40, 34, 52), (250, 190, 100))
    return img


def scene_sentiero(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (150, 198, 230)), (1, (236, 240, 226))], 0, int(H * 0.5))
    gradient(img, [(0, (152, 182, 92)), (1, (88, 128, 60))], int(H * 0.5), H)
    draw = ImageDraw.Draw(img)
    draw.polygon(ridge(rng, H * 0.5, 70, 6), fill=(130, 156, 170))
    draw.polygon(ridge(rng, H * 0.56, 30, 3), fill=(124, 160, 84))
    draw.polygon([(W * 0.47, H * 0.56), (W * 0.53, H * 0.56), (W * 0.82, H), (W * 0.22, H)], fill=(206, 182, 134))
    for _ in range(260):
        x, y = rng.uniform(0, W), rng.uniform(H * 0.6, H)
        r = rng.uniform(2, 5)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=rng.choice([(246, 220, 90), (236, 236, 240), (214, 120, 170)]))
    px, py = W * 0.2, H * 0.84
    draw.rectangle([px - 8, py - 260, px + 8, py], fill=(110, 76, 44))
    draw.polygon([(px, py - 250), (px + 180, py - 250), (px + 210, py - 222), (px + 180, py - 194), (px, py - 194)], fill=(214, 70, 60))
    draw.polygon([(px, py - 180), (px - 170, py - 180), (px - 200, py - 152), (px - 170, py - 124), (px, py - 124)], fill=(240, 240, 236))
    return img


def scene_bandiere(rng):
    img = Image.new("RGB", (W, H))
    gradient(img, [(0, (98, 150, 206)), (0.6, (180, 214, 236)), (1, (232, 240, 236))], 0, int(H * 0.64))
    gradient(img, [(0, (112, 150, 74)), (1, (68, 104, 50))], int(H * 0.64), H)
    draw = ImageDraw.Draw(img)
    for _ in range(5):
        cx, cy, s = rng.uniform(0, W), rng.uniform(60, 300), rng.uniform(60, 110)
        for dx in (-1.2, -0.4, 0.4, 1.2):
            draw.ellipse([cx + dx * s - s, cy - s * 0.6, cx + dx * s + s, cy + s * 0.6], fill=(250, 252, 255))
    draw.polygon(ridge(rng, H * 0.64, 26, 3), fill=(96, 136, 66))
    y0 = H * 0.4
    draw.line([(80, y0 + 40), (W - 80, y0 + 40)], fill=(90, 70, 50), width=4)
    colors = [(232, 140, 64), (60, 132, 160), (214, 92, 76), (246, 206, 86), (98, 168, 110)]
    for i, x in enumerate(range(110, W - 120, 96)):
        sag = 70 * math.sin(math.pi * (x - 80) / (W - 160))
        draw.polygon([(x, y0 + 40 + sag), (x + 70, y0 + 40 + sag), (x + 35, y0 + 140 + sag)], fill=colors[i % len(colors)])
    for x in (80, W - 80):
        draw.rectangle([x - 7, y0 + 30, x + 7, H * 0.9], fill=(110, 76, 44))
    return img


SCENES = [
    ("alba-sul-campo", scene_alba),
    ("lago-al-mattino", scene_lago),
    ("le-tende", scene_tende),
    ("serata-al-fuoco", scene_falo),
    ("bosco-di-pini", scene_bosco),
    ("cielo-stellato", scene_stelle),
    ("sentiero-del-gioco", scene_sentiero),
    ("bandierine-del-campo", scene_bandiere),
]


def main():
    for index, (name, painter) in enumerate(SCENES):
        image = painter(random.Random(1000 + index)).filter(ImageFilter.SMOOTH)
        image.save(OUT / f"{name}.jpg", "JPEG", quality=84, optimize=True, progressive=True)
        thumb = image.resize((THUMB_W, round(H * THUMB_W / W)), Image.LANCZOS)
        thumb.save(OUT / f"{name}-thumb.jpg", "JPEG", quality=80, optimize=True)
        print(name)


if __name__ == "__main__":
    main()
