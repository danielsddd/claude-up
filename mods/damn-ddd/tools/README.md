# Tracing hand-drawn art into a backdrop

A Claude Code backdrop takes only pure vector SVG, at most 131,072 characters per drawing. These scripts turn cel-shaded character art into compact SVG paths that fit, for damn2's hero and evil token.

## Run it

```bash
uv venv .venv
uv pip install --python .venv -r requirements.txt
.venv/Scripts/python -I trace_damn2.py     # Windows; .venv/bin/python on macOS and Linux
```

It reads `source-art/`, writes `out/pieces.json` with the markup for each piece (`IDLE`, `BODY`, `WINGL`, `WINGR`) plus a PNG preview of each, and prints their sizes. Paste a piece's markup into the matching `g` field in `../hooks/art2.ts`, then run `claude plugin test ..` to check every frame still fits.

## The method

A straight trace of the art at this size comes out blobby: the colors melt together and the face disappears. Cel-shaded art reads as sharp because of its black ink lines, so the lines and the colors are traced apart:

1. **Cut out** the character: everything not joined to the image border through near-white pixels. Small white specks inside close up; big holes, like a torn cape, stay open.
2. **Remove what code draws better.** The sword is cut out along its axis, because the scene draws a clean vector blade there for a fraction of the size.
3. **Find the ink:** pixels that are very dark, or clearly darker than their surroundings, plus the outer contour. The relative test matters, because dark clothing would otherwise turn into solid ink.
4. **Pick a palette:** k-means in Lab color space, about 16-24 colors, with the face and emblem oversampled so their colors survive.
5. **Trace the colors as stacked layers,** biggest color first, each a solid shape that also covers every later color. That leaves no holes or seams. (vtracer's own color mode averages colors and can drop a whole cluster, which shows up as see-through holes.)
6. **Trace the ink on top,** on a finer grid, and finest of all where the eye looks: the face, the hair, the emblem, the token's eyes and teeth.
7. **Encode compactly:** relative coordinates, straight runs as `h`/`v`/`l`, smooth joins as SVG `s`, consecutive same-color shapes in one path. That saves about a fifth of the size.

The settings for each piece (palette size, smoothing, speckle filter, grid) were tuned by eye until each piece fit its share of a frame: about 84K characters for the hero and 33K for the token, leaving room for the scene's effects and the speech balloon.

## Files

| File | What it is |
| --- | --- |
| `cel_trace.py` | The tracer: cut-out, ink, palette, stacked layers, path encoding, preview |
| `trace_damn2.py` | Rebuilds the standing hero and the token with the settings used in the mod |
| `requirements.txt` | The pinned package versions |
| `source-art/` | The source images: the standing hero, the token, the lift-and-strike poses and the character sheet |

The standing hero and token in the mod come from this script; a rerun lands within 1% of the shipped sizes. The lift and strike poses in `art2.ts` came from an earlier, simpler pass of the same tracer that isn't kept here. To redo them, cut each pose out of `hero-lift-and-strike.webp` and run it through `cel_trace.build` the same way.

## Your own character

Use art with clean dark outlines on a white background: cel-shaded or comic styles trace best, and soft painted art traces worst. Replace the images in `source-art/`, then adjust in `trace_damn2.py` the crop and mirror, the box around the face (`pri`), and the sword axis (or drop that step).
