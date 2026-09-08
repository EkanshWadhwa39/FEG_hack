#!/usr/bin/env python3
"""Generate lobby poster tiles from the provided game package.

The sandbox has one real game and needs a lobby that looks like a lobby. Rather
than shipping invented artwork -- or, worse, copying PSK's or another provider's
real thumbnails -- every poster is derived from the *provided package's own art*:
a square crop of its splash background, colour-graded to a per-tile accent, with
one of its own slot symbols composited on top.

The symbols are lifted through the package's own atlas descriptors
(`symbols.json`, `splashAssets.json`), not guessed by scanning for opaque pixels,
so each poster carries a single clean sprite rather than a slab of texture sheet.

That keeps the whole demo self-contained and honest. One sample game,
extrapolated into a grid, using only bytes FEG supplied.

Three things the output deliberately gets right, because a lobby's posters are
themselves a load-time problem:

  * **Small.** 320x320 WebP at quality 78 lands around 12-25 KB. A real lobby
    renders 60+ of these; at 675 KB each (the raw splash) that is a 40 MB lobby
    before a single game is touched.
  * **Square.** The production tile is `aspect-ratio: 1/1` (measured from
    casino.psk.hr's own stylesheet), so the intrinsic size matches the layout box
    and the grid cannot shift as images arrive.
  * **Deterministic.** The same tile index always produces the same poster, so a
    reload does not reshuffle the lobby and browser caching is meaningful.

Usage:
    python3 tools/poster_builder.py --bundle /path/to/empireofgold --out /tmp/posters
"""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

#: Rendered poster edge, in CSS pixels x2 for high-density screens.
POSTER_SIZE = 320

#: WebP quality. 78 is the knee of the size/appearance curve for this artwork.
POSTER_QUALITY = 78

#: Background art. Landscape, so each tile takes a different square window.
BACKGROUND = "assets/images/@1x/splashBG.jpg"

#: Atlases the package ships with a frame descriptor beside them. Every sprite
#: named in these is a candidate poster foreground.
ATLASES = (
    ("assets/images/@1x/symbols.webp", "assets/images/@1x/symbols.json"),
    ("assets/images/@1x/splashAssets.webp", "assets/images/@1x/splashAssets.json"),
)

#: Sprites that are UI furniture rather than art, so they never front a poster.
EXCLUDED_SPRITES = frozenset({"splashBtn"})

#: Per-tile accent, cycled. Chosen to read as distinct casino themes at thumbnail
#: size while staying dark enough for white overlay text.
ACCENTS = (
    (212, 160, 23),   # gold
    (176, 38, 42),    # crimson
    (28, 122, 138),   # teal
    (108, 58, 168),   # violet
    (30, 122, 58),    # emerald
    (198, 96, 24),    # amber
    (36, 82, 178),    # PSK blue
    (168, 44, 120),   # magenta
)


def _load_frames(bundle: Path) -> list[tuple[Path, tuple[int, int, int, int]]]:
    """Every named sprite the package describes, as (sheet, box) pairs."""
    frames: list[tuple[Path, tuple[int, int, int, int]]] = []
    for sheet_name, descriptor_name in ATLASES:
        sheet = bundle / sheet_name
        descriptor = bundle / descriptor_name
        if not sheet.is_file() or not descriptor.is_file():
            continue
        try:
            data = json.loads(descriptor.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for name, entry in sorted((data.get("frames") or {}).items()):
            box = entry.get("frame") if isinstance(entry, dict) else None
            if not isinstance(box, dict) or name in EXCLUDED_SPRITES:
                continue
            try:
                left, top = int(box["x"]), int(box["y"])
                width, height = int(box["w"]), int(box["h"])
            except (KeyError, TypeError, ValueError):
                continue
            # Ignore slivers: a poster foreground needs to be a real picture.
            if width < 120 or height < 120:
                continue
            frames.append((sheet, (left, top, left + width, top + height)))
    return frames


def _square_window(image: Image.Image, index: int) -> Image.Image:
    """Take a different square window of a landscape image for each index.

    Windows walk left to right and wrap, so consecutive tiles never share a
    crop and the whole background gets used rather than only its centre.
    """
    width, height = image.size
    edge = min(width, height)
    travel = max(1, width - edge)
    # A prime stride keeps consecutive tiles far apart in the frame.
    left = (index * 137) % travel
    return image.crop((left, 0, left + edge, edge))


def _grade(image: Image.Image, accent: tuple[int, int, int]) -> Image.Image:
    """Colour-grade toward an accent, keeping the artwork's own luminance.

    A plain hue rotation turns this package's gold interior into a set of garish
    primaries. Grading against a neutral version keeps the original lighting and
    only moves the colour, which is what makes twelve tiles look like twelve
    games rather than twelve filters.
    """
    neutral = ImageEnhance.Color(image).enhance(0.25)
    wash = Image.new("RGB", image.size, accent)
    graded = Image.blend(neutral, Image.blend(neutral, wash, 0.55), 0.85)
    return ImageEnhance.Contrast(graded).enhance(1.12)


def _scrim(size: int) -> Image.Image:
    """A bottom-weighted darkening mask, so overlaid titles stay legible."""
    column = Image.new("L", (1, size))
    for y in range(size):
        depth = max(0.0, (y - size * 0.5) / (size * 0.5))
        column.putpixel((0, y), int(205 * depth * depth))
    return column


def build_poster(bundle: Path, index: int, size: int = POSTER_SIZE,
                 frames: list | None = None) -> bytes:
    """Render one poster as WebP bytes."""
    if frames is None:
        frames = _load_frames(bundle)

    background = Image.open(bundle / BACKGROUND).convert("RGB")
    window = _square_window(background, index).resize((size, size), Image.LANCZOS)
    window = _grade(window, ACCENTS[index % len(ACCENTS)])
    window = ImageEnhance.Brightness(window).enhance(0.78)
    window = window.filter(ImageFilter.GaussianBlur(radius=size / 85))

    if frames:
        sheet_path, box = frames[index % len(frames)]
        sprite = Image.open(sheet_path).convert("RGBA").crop(box)
        alpha = sprite.getchannel("A").getbbox()
        if alpha is not None:
            sprite = sprite.crop(alpha)
        sprite.thumbnail((int(size * 0.66), int(size * 0.66)), Image.LANCZOS)
        # The sprite keeps its own colours: a recognisable symbol on a graded
        # ground is what a real tile looks like, and it is what makes the tiles
        # distinguishable at 160 px.
        window.paste(sprite, ((size - sprite.width) // 2,
                              int(size * 0.44) - sprite.height // 2), sprite)

    window = Image.composite(
        Image.new("RGB", window.size, (8, 8, 12)),
        window,
        _scrim(size).resize(window.size),
    )

    buffer = io.BytesIO()
    window.save(buffer, format="WEBP", quality=POSTER_QUALITY, method=4)
    return buffer.getvalue()


def build_posters(bundle: Path, count: int, size: int = POSTER_SIZE) -> dict[str, bytes]:
    """Render `count` posters, keyed by the path the lobby serves them from."""
    if count < 1:
        raise ValueError("count must be at least 1")
    frames = _load_frames(bundle)
    return {
        f"/posters/g{index + 1}.webp": build_poster(bundle, index, size, frames)
        for index in range(count)
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--count", type=int, default=24)
    parser.add_argument("--size", type=int, default=POSTER_SIZE)
    args = parser.parse_args()

    bundle = args.bundle.expanduser().resolve()
    if not (bundle / BACKGROUND).is_file():
        nested = bundle / bundle.name
        if (nested / BACKGROUND).is_file():
            bundle = nested
        else:
            raise SystemExit(f"{BACKGROUND} not found under {bundle}")

    args.out.mkdir(parents=True, exist_ok=True)
    total = 0
    for path, data in build_posters(bundle, args.count, args.size).items():
        (args.out / Path(path).name).write_bytes(data)
        total += len(data)
    print(f"{args.count} posters, {total / 1024:.0f} KB total, "
          f"{total / args.count / 1024:.1f} KB each -> {args.out}")


if __name__ == "__main__":
    main()
