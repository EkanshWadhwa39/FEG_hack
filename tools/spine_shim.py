#!/usr/bin/env python3
"""Supply spine atlas page textures that are absent from the provided package.

## Why this exists

The FEG-provided Empire of Gold package is internally inconsistent. Ten of its
Spine atlases declare page images that were never included in the ZIP:

    book.png  cards.png  jp_jackpots.png
    jakpots.png  jakpots_2.png ... jakpots_7.png

at both `@0.5x` and `@1x`. Every one of them 404s.

That is not a cosmetic gap. PixiJS loads Spine assets as a *bundle*, and a
bundle rejects as a unit: one missing page aborts the whole load with
`Error loading bundles`, the promise never resolves, and the game sits on its
preloader forever. The engine boots, the canvas is created, WebGL initialises —
and then nothing, because one texture out of 379 files is not there.

With those ten pages supplied, the same unmodified package runs to a playable
screen: intro, `Play game`, reels, balance, spin. It needs no backend at all
and makes zero external requests.

## What this does, precisely

For each missing page, it reads the size the package's *own* atlas declares
(`size:1981,803` on the line after the page name) and synthesizes a fully
transparent PNG of exactly those dimensions.

The declared size is what matters. Spine atlases address sub-regions by
absolute pixel bounds, so every other frame packed on that page is positioned
against the page dimensions. A placeholder of the wrong size would shift the
frames that *do* exist elsewhere on it; a correctly sized transparent one
leaves geometry untouched and simply renders those regions as nothing.

## What this is not

This does **not** modify the certified package. The bundle on disk stays
byte-identical; nothing is written into it, and nothing is rewritten on the way
out. This is the sandbox *origin* answering for a file the package asks for and
does not contain — the same thing a CDN would have to do.

It touches no game logic, no certified code, no mechanics and no payouts. It
supplies image bytes for image URLs.

Every shimmed response carries an `X-Sandbox-Shim: synthesized-placeholder`
header so it is identifiable on the wire, and the server prints the full list at
startup. Any measurement taken against this sandbox must disclose it.
"""

from __future__ import annotations

import io
import re
from pathlib import Path

from PIL import Image

#: Header stamped on every synthesized response, so a shimmed asset can never
#: be mistaken for a real one in a HAR, a DevTools trace, or a measurement run.
SHIM_HEADER = "X-Sandbox-Shim"
SHIM_VALUE = "synthesized-placeholder"

#: `size:W,H` as written in a Spine atlas header block.
_SIZE = re.compile(r"^\s*size:\s*(\d+)\s*,\s*(\d+)\s*$")

#: How far below a page name to look for its `size:` line. The header block is
#: name/size/format/filter/repeat, so a small window is enough and it stops a
#: malformed atlas from picking up the *next* page's dimensions.
_HEADER_WINDOW = 6


def declared_page_size(atlas: Path, page: str) -> tuple[int, int] | None:
    """Return the (width, height) `atlas` declares for page image `page`.

    Returns None if the atlas does not list that page, or lists it without a
    parseable size. Callers must treat None as "cannot shim this safely"
    rather than substituting a guess: a wrong page size silently misplaces
    every frame packed on it.
    """
    try:
        lines = atlas.read_text(errors="replace").splitlines()
    except OSError:
        return None

    for index, line in enumerate(lines):
        if line.strip() != page:
            continue
        for probe in lines[index + 1:index + _HEADER_WINDOW]:
            match = _SIZE.match(probe)
            if match:
                return int(match.group(1)), int(match.group(2))
    return None


def _pages_referenced(atlas: Path) -> list[str]:
    """Page image filenames an atlas refers to.

    A page name is a bare `*.png` on its own line. Region names inside the
    atlas never carry an extension, so this does not confuse the two.
    """
    try:
        lines = atlas.read_text(errors="replace").splitlines()
    except OSError:
        return []
    return [
        stripped for line in lines
        if (stripped := line.strip()).endswith(".png") and "/" not in stripped
    ]


def transparent_png(width: int, height: int) -> bytes:
    """A fully transparent PNG of exactly these dimensions."""
    buffer = io.BytesIO()
    Image.new("RGBA", (width, height), (0, 0, 0, 0)).save(buffer, "PNG")
    return buffer.getvalue()


def build_shims(bundle: Path) -> dict[str, bytes]:
    """Synthesize every atlas page the package references but does not ship.

    Returns a mapping of bundle-relative POSIX path -> PNG bytes. An empty
    mapping means the package is internally complete, which is the outcome to
    hope for: this whole module is a workaround for a defect, and it should
    quietly do nothing the day the package is fixed.
    """
    shims: dict[str, bytes] = {}
    for atlas in sorted(bundle.rglob("*.atlas")):
        for page in _pages_referenced(atlas):
            target = atlas.parent / page
            if target.exists():
                continue
            size = declared_page_size(atlas, page)
            if size is None:
                # No declared size: refuse rather than guess. The asset stays a
                # 404 and the failure remains visible.
                continue
            shims[target.relative_to(bundle).as_posix()] = transparent_png(*size)
    return shims


def describe(shims: dict[str, bytes]) -> str:
    """One-line-per-asset summary for the server's startup banner."""
    if not shims:
        return "package is internally complete; no shims needed"
    total = sum(len(body) for body in shims.values())
    listed = "\n".join(f"    {path}" for path in sorted(shims))
    return (
        f"{len(shims)} atlas page(s) missing from the package, "
        f"synthesized as transparent PNGs ({total / 1024:.0f} KB):\n{listed}"
    )
