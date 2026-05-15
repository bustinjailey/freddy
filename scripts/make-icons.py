#!/usr/bin/env python3
"""Generate Freddy's icons. Pure-PIL, supersampled for smooth edges.

PWA — outputs into ../static/:
  icon-192.png, icon-512.png        — purpose "any" (full-bleed, OS rounds it)
  icon-512-maskable.png             — purpose "maskable" (content in safe zone)
  apple-touch-icon.png (180x180)    — iOS home screen (no transparency)
  badge-96.png                      — Android notification badge (white silhouette, transparent)
  favicon.png (64x64)

Native Android wrapper — outputs into ../android/app/src/main/res/mipmap-*:
  ic_launcher.png                   — legacy square icon (pre-Android 8)
  ic_launcher_round.png             — legacy round icon (pre-Android 8)
  ic_launcher_foreground.png        — adaptive icon foreground (transparent, safe zone)
"""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "static"))
ANDROID_RES = os.path.normpath(os.path.join(HERE, "..", "android", "app", "src", "main", "res"))

SS = 4  # supersample factor

AMBER_TOP = (246, 183, 51)     # #f6b733
AMBER_BOT = (231, 140, 24)     # #e78c18
CREAM = (253, 248, 238)        # bottle body
CREAM_DK = (236, 224, 200)     # subtle shading


def vgradient(size, top, bot):
    img = Image.new("RGB", (1, size), top)
    for y in range(size):
        t = y / max(1, size - 1)
        img.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img.resize((size, size))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_bottle(draw, cx, cy, w, h, fill, shade=None):
    """A simple baby-bottle silhouette centred on (cx, cy) within a w x h box."""
    # vertical bands of the bottle, top -> bottom
    nipple_h = h * 0.18
    collar_h = h * 0.12
    body_top = cy - h / 2 + nipple_h + collar_h
    body_bot = cy + h / 2
    body_w = w
    collar_w = w * 0.78
    teat_w = w * 0.34

    # body (rounded rectangle)
    draw.rounded_rectangle(
        [cx - body_w / 2, body_top, cx + body_w / 2, body_bot],
        radius=body_w * 0.30,
        fill=fill,
    )
    # collar / cap ring
    draw.rounded_rectangle(
        [cx - collar_w / 2, body_top - collar_h * 0.7, cx + collar_w / 2, body_top + collar_h * 0.45],
        radius=collar_h * 0.45,
        fill=fill,
    )
    # teat (dome)
    teat_top = cy - h / 2
    draw.rounded_rectangle(
        [cx - teat_w / 2, teat_top, cx + teat_w / 2, body_top - collar_h * 0.3],
        radius=teat_w * 0.5,
        fill=fill,
    )
    draw.ellipse(
        [cx - teat_w / 2, teat_top - teat_w * 0.18, cx + teat_w / 2, teat_top + teat_w * 0.7],
        fill=fill,
    )

    if shade is not None:
        # measurement ticks + a "milk line" — only the ticks, kept subtle
        for i, frac in enumerate((0.30, 0.45, 0.60, 0.75)):
            y = body_top + (body_bot - body_top) * frac
            x0 = cx + body_w / 2 - body_w * 0.22
            draw.rounded_rectangle([x0, y - h * 0.012, x0 + body_w * 0.13, y + h * 0.012],
                                   radius=h * 0.012, fill=shade)
        # a soft highlight stripe on the left
        draw.rounded_rectangle(
            [cx - body_w / 2 + body_w * 0.13, body_top + (body_bot - body_top) * 0.16,
             cx - body_w / 2 + body_w * 0.24, body_bot - (body_bot - body_top) * 0.12],
            radius=body_w * 0.06, fill=shade,
        )


def make_icon(px, *, maskable=False, transparent=False, mono=False, circle=False):
    n = px * SS
    if transparent:
        base = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    else:
        base = vgradient(n, AMBER_TOP, AMBER_BOT).convert("RGBA")

    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # content scale: smaller for maskable (safe zone) and badge (tight)
    if mono:
        scale = 0.74
    elif maskable:
        scale = 0.52
    else:
        scale = 0.62
    bw = n * scale * 0.62
    bh = n * scale
    fill = (255, 255, 255, 255) if (mono or True) else CREAM
    # bottle in cream on coloured bg; pure white for the mono badge
    fill = (255, 255, 255, 255) if mono else CREAM + (255,)
    shade = None if mono else CREAM_DK + (255,)
    # slight drop shadow for the coloured icons
    if not mono and not transparent:
        sh = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        draw_bottle(sd, n / 2, n / 2 + n * 0.012, bw, bh, (0, 0, 0, 70))
        from PIL import ImageFilter
        sh = sh.filter(ImageFilter.GaussianBlur(n * 0.012))
        base = Image.alpha_composite(base, sh)

    draw_bottle(d, n / 2, n / 2, bw, bh, fill, shade)
    out = Image.alpha_composite(base, layer)

    if circle:
        # circular mask for Android legacy ic_launcher_round
        m = Image.new("L", (n, n), 0)
        ImageDraw.Draw(m).ellipse([0, 0, n - 1, n - 1], fill=255)
        clipped = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        clipped.paste(out, (0, 0), m)
        out = clipped
    elif not transparent and not maskable:
        # round the corners a touch (iOS/Android will round further; this just softens "any" use)
        r = int(n * 0.20)
        m = rounded_mask(n, r)
        rounded = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        rounded.paste(out, (0, 0), m)
        out = rounded

    return out.resize((px, px), Image.LANCZOS)


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, "PNG")
    print("wrote", os.path.relpath(path, os.path.join(HERE, "..")), img.size)


ANDROID_DENSITIES = (
    # (dir suffix, legacy px, foreground px)
    ("mdpi", 48, 108),
    ("hdpi", 72, 162),
    ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi", 192, 432),
)


def save_to(img, path):
    img.save(path, "PNG")
    print("wrote", os.path.relpath(path, os.path.join(HERE, "..")), img.size)


def main():
    os.makedirs(OUT, exist_ok=True)
    save(make_icon(192), "icon-192.png")
    save(make_icon(512), "icon-512.png")
    save(make_icon(512, maskable=True), "icon-512-maskable.png")
    # apple-touch-icon: must be opaque (iOS renders transparency as black)
    ati = make_icon(180)
    bg = Image.new("RGB", ati.size, AMBER_BOT)
    bg.paste(ati.convert("RGBA"), (0, 0), ati.convert("RGBA"))
    bg.save(os.path.join(OUT, "apple-touch-icon.png"), "PNG")
    print("wrote static/apple-touch-icon.png", bg.size)
    save(make_icon(96, transparent=True, mono=True), "badge-96.png")
    save(make_icon(64), "favicon.png")

    # Native Android launcher icons. Adaptive foreground is transparent + safe-zone
    # so it composes over the @color/ic_launcher_background defined in res/values.
    for suffix, legacy_px, fg_px in ANDROID_DENSITIES:
        d = os.path.join(ANDROID_RES, f"mipmap-{suffix}")
        if not os.path.isdir(d):
            continue
        save_to(make_icon(legacy_px), os.path.join(d, "ic_launcher.png"))
        save_to(make_icon(legacy_px, circle=True), os.path.join(d, "ic_launcher_round.png"))
        save_to(make_icon(fg_px, transparent=True, maskable=True),
                os.path.join(d, "ic_launcher_foreground.png"))


if __name__ == "__main__":
    main()
