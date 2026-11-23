"""Ink + flat-color tracer: turns cel-shaded character art into compact SVG paths.

Sharpness in cel-shaded art comes from its black ink lines, so the lines are traced on
their own at a fine grid and drawn on top, while the colors are quantized to a fixed
palette and traced coarser underneath, where the ink hides their soft edges.

Used by trace_damn2.py. Needs: pillow, numpy, scipy, vtracer (and resvg_py to preview).
"""
import io
import re

import numpy as np
import vtracer
from PIL import Image
from scipy import ndimage as ndi


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.int16)


def cutout(rgb, white=236, max_hole=400):
    """Foreground = everything not joined to the border through near-white pixels."""
    near = (rgb > white).all(axis=2)
    lab, _ = ndi.label(near)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    fg = ~np.isin(lab, border[border > 0])
    # Close small white specks inside the art; keep big holes (cape tears) open.
    holes = ndi.binary_fill_holes(fg) & ~fg
    hl, nh = ndi.label(holes)
    if nh:
        sizes = ndi.sum(holes, hl, range(1, nh + 1))
        fg |= np.isin(hl, np.nonzero(sizes <= max_hole)[0] + 1)
    fg = ndi.binary_opening(fg, iterations=1)
    lab, n = ndi.label(fg)
    if n > 1:
        sizes = ndi.sum(fg, lab, range(1, n + 1))
        fg = np.isin(lab, np.nonzero(sizes >= 60)[0] + 1)
    return fg


def crop(rgb, fg, mirror=False):
    ys, xs = np.nonzero(fg)
    rgb, fg = rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1], fg[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    if mirror:
        rgb, fg = rgb[:, ::-1], fg[:, ::-1]
    return rgb.copy(), fg.copy()


def lum(rgb):
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def ink_mask(rgb, fg, dark=28, rel=16):
    """Ink = very dark, or clearly darker than its surroundings, plus the outer contour.

    A relative test matters: dark clothing is darker than `dark` everywhere and would
    otherwise turn whole garments into ink.
    """
    L = lum(rgb.astype(np.float32))
    local = ndi.gaussian_filter(L, 2.5)
    ink = ((L < dark) | ((L < 110) & (L < local - rel))) & fg
    edge = fg & ~ndi.binary_erosion(fg, iterations=1)
    return ink | edge


def to_lab(rgb):
    c = rgb.astype(np.float32) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = c @ M.T / np.array([0.9505, 1.0, 1.089], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def palette(rgb, fg, n, weight=None, seed=1):
    """k-means in Lab; `weight` (a mask) oversamples regions whose colors must survive."""
    rng = np.random.default_rng(seed)
    px = rgb[fg]
    if weight is not None:
        px = np.concatenate([px] + [rgb[fg & weight]] * 4)
    if len(px) > 80000:
        px = px[rng.choice(len(px), 80000, replace=False)]
    X = to_lab(px)
    C = X[rng.integers(len(X))][None]
    for _ in range(1, n):
        d = ((X[:, None] - C[None]) ** 2).sum(-1).min(1)
        C = np.vstack([C, X[rng.choice(len(X), p=d / d.sum())]])
    for _ in range(20):
        a = ((X[:, None] - C[None]) ** 2).sum(-1).argmin(1)
        for k in range(n):
            if (a == k).any():
                C[k] = X[a == k].mean(0)
    a = ((X[:, None] - C[None]) ** 2).sum(-1).argmin(1)
    return np.round(np.array([px[a == k].mean(0) if (a == k).any() else px[0] for k in range(n)])).astype(np.int16)


def labels(rgb, pal):
    L, P = to_lab(rgb), to_lab(pal)
    return ((L[:, :, None, :] - P[None, None]) ** 2).sum(-1).argmin(-1)


def mode_filter(lab, fg, size, n):
    """Each pixel takes the commonest palette color around it: fewer, smoother shapes."""
    best = np.zeros(lab.shape, np.float32) - 1
    out = lab.copy()
    for k in range(n):
        m = ndi.uniform_filter(((lab == k) & fg).astype(np.float32), size)
        better = m > best
        out[better] = k
        best[better] = m[better]
    return out


def resize(mask, scale, thresh=127):
    h, w = mask.shape
    im = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8))
    return np.asarray(im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)) > thresh


# ---- path encoding: relative, implicit repeats, l/h/v for straight runs, s for smooth joins ----

PATH = re.compile(r'<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})" transform="translate\((-?\d+),(-?\d+)\)"/>')
TOK = re.compile(r'[MCLZ]|-?\d+(?:\.\d+)?')


def parse(svg):
    out = []
    for d, fill, tx, ty in PATH.findall(svg):
        tx, ty = int(tx), int(ty)
        toks, subs, cur, i = TOK.findall(d), [], None, 0
        while i < len(toks):
            t = toks[i]
            if t == 'M':
                cur = [('M', (int(toks[i + 1]) + tx, int(toks[i + 2]) + ty))]
                subs.append(cur)
                i += 3
            elif t == 'C':
                v = [int(float(x)) for x in toks[i + 1:i + 7]]
                cur.append(('C', (v[0] + tx, v[1] + ty, v[2] + tx, v[3] + ty, v[4] + tx, v[5] + ty)))
                i += 7
            elif t == 'L':
                cur.append(('L', (int(toks[i + 1]) + tx, int(toks[i + 2]) + ty)))
                i += 3
            else:
                i += 1
        out.append((fill.lower(), subs))
    return out


def _num(parts):
    s = ''
    for p in parts:
        t = str(p)
        if s and not t.startswith('-'):
            s += ' '
        s += t
    return s


def _near_line(p0, p1, c, tol=0.75):
    (x0, y0), (x1, y1), (cx, cy) = p0, p1, c
    dx, dy = x1 - x0, y1 - y0
    L = (dx * dx + dy * dy) ** 0.5
    if L < 1e-6:
        return abs(cx - x0) + abs(cy - y0) <= tol * 2
    return abs((cx - x0) * dy - (cy - y0) * dx) / L <= tol


def encode(subs):
    out, last, start_prev = [], '', None

    def emit(cmd, nums):
        nonlocal last
        if cmd == last:
            out.append(('' if str(nums[0]).startswith('-') else ' ') + _num(nums))
        else:
            out.append(cmd + _num(nums))
        last = cmd

    for sub in subs:
        mx, my = sub[0][1]
        out.append('M' + _num([mx, my]) if start_prev is None else 'm' + _num([mx - start_prev[0], my - start_prev[1]]))
        last, px, py, prev_c2 = 'm', mx, my, None
        for kind, v in sub[1:]:
            if kind == 'C':
                x1, y1, x2, y2, x, y = v
                if not (_near_line((px, py), (x, y), (x1, y1)) and _near_line((px, py), (x, y), (x2, y2))):
                    if prev_c2 is not None and x1 == 2 * px - prev_c2[0] and y1 == 2 * py - prev_c2[1]:
                        emit('s', [x2 - px, y2 - py, x - px, y - py])
                    else:
                        emit('c', [x1 - px, y1 - py, x2 - px, y2 - py, x - px, y - py])
                    prev_c2, px, py = (x2, y2), x, y
                    continue
                v = (x, y)
            x, y = v
            dx, dy = x - px, y - py
            if dx or dy:
                emit(*(('h', [dx]) if dy == 0 else ('v', [dy]) if dx == 0 else ('l', [dx, dy])))
                prev_c2, px, py = None, x, y
        out.append('z')
        last, start_prev = 'z', (mx, my)
    return ''.join(out)


def short_color(c):
    return '#' + c[1] + c[3] + c[5] if c[1] == c[2] and c[3] == c[4] and c[5] == c[6] else c


def paths(fill, subs, evenodd=True):
    rule = ' fill-rule="evenodd"' if evenodd else ''
    return f'<path fill="{short_color(fill)}"{rule} d="{encode(subs)}"/>' if subs else ''


def trace_mask(mask, speckle, length):
    """Traces one binary mask (True = shape) into vtracer path data."""
    h, w = mask.shape
    g = np.where(mask, 0, 255).astype(np.uint8).reshape(-1)
    return vtracer.convert_pixels_to_svg(
        [(int(v), int(v), int(v), 255) for v in g], size=(w, h), colormode='binary', mode='spline',
        filter_speckle=speckle, corner_threshold=60, length_threshold=length, max_iterations=10,
        splice_threshold=45, path_precision=0)


def layer(mask, scale, grid, fill, speckle, length, thresh=127):
    if not mask.any():
        return ''
    subs = [s for _, ss in parse(trace_mask(resize(mask, scale * grid, thresh), speckle, length)) for s in ss]
    body = paths(fill, subs)
    return body if grid == 1 else f'<g transform="scale({1 / grid:g})">{body}</g>'


def build(rgb, fg, *, scale, priority, grid=2, n_colors=24, mode_coarse=9, mode_fine=1, speckle=12,
          length=7.0, ink_speckle=8, ink_length=6.0, pri_grid=4, pri_speckle=2, pri_length=3.0,
          ink_dark=14, ink_rel=18, ink_color='#17120f', pal=None):
    """One piece as SVG markup in art units (source px * scale); returns (markup, palette).

    Colors are stacked exact-palette layers, biggest first, each a solid blob that also
    covers every later color, so there are no holes or seams. (vtracer's own color mode
    averages and drops clusters, which left see-through holes.) Ink goes on top; the
    `priority` mask (face, emblem, eyes) gets its ink on a finer grid.
    """
    if pal is None:
        pal = palette(rgb, fg, n_colors, weight=priority)
    ink = ink_mask(rgb, fg, ink_dark, ink_rel)
    lab = labels(rgb, pal)
    # Ink pixels take their nearest non-ink color, so fills run unbroken under the lines.
    _, (iy, ix) = ndi.distance_transform_edt(ink | ~fg, return_indices=True)
    lab = lab[iy, ix]
    coarse = mode_filter(lab, fg, mode_coarse, len(pal))
    fine = mode_filter(lab, fg, mode_fine, len(pal)) if mode_fine > 1 else lab
    lab = np.where(priority, fine, coarse)
    order = [int(k) for k in np.argsort(-np.bincount(lab[fg].ravel(), minlength=len(pal))) if (lab[fg] == k).any()]
    color = ''.join(
        layer(fg & np.isin(lab, order[i:]), scale, grid, '#%02x%02x%02x' % tuple(int(v) for v in pal[k]), speckle, length)
        for i, k in enumerate(order))
    # Ink thresholds a little lower when shrunk, so thin lines survive the resize.
    markup = color + layer(ink & ~priority, scale, grid, ink_color, ink_speckle, ink_length, 110)
    if pri_grid:
        markup += layer(ink & ndi.binary_dilation(priority, iterations=3), scale, pri_grid, ink_color, pri_speckle, pri_length, 110)
    return markup, pal


def render(markup, w, h, out_png, scale=1.0):
    """Previews a piece as a PNG on white."""
    import resvg_py
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
           f'<g transform="scale({scale:.4f})">{markup}</g></svg>')
    im = Image.open(io.BytesIO(bytes(resvg_py.svg_to_bytes(svg_string=doc)))).convert('RGBA')
    base = Image.new('RGBA', im.size, (255, 255, 255, 255))
    base.alpha_composite(im)
    base.convert('RGB').save(out_png)
