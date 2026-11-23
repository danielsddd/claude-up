"""Rebuilds damn2's standing hero and evil token from source-art/ and prints their sizes.

    uv venv .venv && uv pip install --python .venv -r requirements.txt
    .venv/Scripts/python -I trace_damn2.py        (Windows; .venv/bin/python elsewhere)

Writes out/pieces.json ({"IDLE": markup, "BODY": ..., "WINGL": ..., "WINGR": ...}) and a
PNG preview of each. Paste a piece's markup into the matching `g` field in
../hooks/art2.ts. The art units and frame match art2.ts, so the blade and coin numbers
there still line up.
"""
import json
import os
import sys

import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # python -I leaves the script's folder off the path
import cel_trace as T  # noqa: E402
SRC = os.path.join(HERE, 'source-art')
OUT = os.path.join(HERE, 'out')

HERO_ART = 0.3804   # IDLE_ART in art2.ts: art units per source pixel for the standing pose
TOKEN_ART = 0.3     # TOKEN_ART in art2.ts
HERO_SCREEN = 0.79 / 0.62
TOKEN_SCREEN = 0.315 / 0.3


def hero():
    rgb = T.load(os.path.join(SRC, 'hero-standing.webp'))
    rgb, fg = T.crop(rgb, T.cutout(rgb), mirror=True)  # mirrored so he faces the token
    # Cut out the traced sword: the scene draws a clean vector blade along this axis
    # (IDLE_BLADE in art2.ts). Everything in a band around it, past the guard, goes.
    base, tip = np.array([604.5, 486.0]), np.array([873.6, 786.3])
    ax = (tip - base) / np.linalg.norm(tip - base)
    yy, xx = np.mgrid[0:fg.shape[0], 0:fg.shape[1]]
    t = (xx - base[0]) * ax[0] + (yy - base[1]) * ax[1]
    perp = np.abs((xx - base[0]) * ax[1] - (yy - base[1]) * ax[0])
    fg &= ~((t > 14) & (t < np.linalg.norm(tip - base) + 60) & (perp < 64))
    lab, n = ndi.label(fg)
    fg = lab == (np.argmax(ndi.sum(fg, lab, range(1, n + 1))) + 1)
    # Finer detail where the eye looks: hair and face, collar badge and chest emblem.
    pri = np.zeros_like(fg)
    pri[0:200, 330:500] = True
    pri[180:300, 370:480] = True
    pri = ndi.binary_dilation(pri, iterations=4)
    markup, _ = T.build(rgb, fg, scale=HERO_ART, priority=pri, grid=2, n_colors=24, mode_coarse=9, mode_fine=1,
                        speckle=14, length=8.0, ink_speckle=8, ink_length=6.0, pri_grid=4, pri_speckle=2,
                        pri_length=3.0, ink_dark=14, ink_rel=18)
    w, h = fg.shape[1], fg.shape[0]
    T.render(markup, round(w * HERO_ART * HERO_SCREEN), round(h * HERO_ART * HERO_SCREEN),
             os.path.join(OUT, 'hero.png'), HERO_SCREEN)
    return {'IDLE': markup}


def token():
    rgb = T.load(os.path.join(SRC, 'evil-token.webp'))
    rgb, fg = T.crop(rgb, T.cutout(rgb))
    h, w = fg.shape
    # COIN in art2.ts, in source pixels: the body is the coin, the wings the rest.
    cx, cy, rx, ry = 116.4 / TOKEN_ART, 96.0 / TOKEN_ART, 71.4 / TOKEN_ART, 86.1 / TOKEN_ART
    yy, xx = np.mgrid[0:h, 0:w]
    e = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    fg |= ndi.binary_fill_holes(fg) & (e <= 1.0)  # the coin's bright glow is art, not background
    body = fg & ((e <= 1.06) | ((np.abs(xx - cx) < rx * 0.5) & (yy > cy)))
    wings = fg & ~body
    pri = e <= 0.8
    pal = T.palette(rgb, fg, 16, weight=pri)
    red = fg & (rgb[..., 0] > 170) & (rgb[..., 1] < 90) & (rgb[..., 2] < 90)
    if red.sum() > 20:  # keep the red eyes' color in the palette
        pal = np.vstack([pal, np.round(rgb[red].mean(0)).astype(np.int16), np.array([255, 70, 50], np.int16)])
    opts = dict(scale=TOKEN_ART, pal=pal, grid=1, mode_coarse=11, mode_fine=3, speckle=10, length=6.5,
                ink_speckle=7, ink_length=6.5, pri_grid=2, pri_speckle=9, pri_length=7.0, ink_dark=18, ink_rel=16)
    none = np.zeros_like(fg)
    out = {
        'BODY': T.build(rgb, body, priority=pri, **opts)[0],
        'WINGL': T.build(rgb, wings & (xx < cx), priority=none, **opts)[0],
        'WINGR': T.build(rgb, wings & (xx >= cx), priority=none, **opts)[0],
    }
    T.render(out['WINGL'] + out['WINGR'] + out['BODY'], round(w * TOKEN_ART * TOKEN_SCREEN),
             round(h * TOKEN_ART * TOKEN_SCREEN), os.path.join(OUT, 'token.png'), TOKEN_SCREEN)
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    pieces = {**hero(), **token()}
    with open(os.path.join(OUT, 'pieces.json'), 'w', encoding='utf-8') as f:
        json.dump(pieces, f)
    for name, markup in pieces.items():
        print(f'{name}: {len(markup):,} characters')
