"""Tests for the missing-atlas-page shim.

The risk this module carries is not that it fails loudly — it is that it
succeeds *wrongly*: a placeholder of the wrong size silently misplaces every
frame packed on that atlas page, and the game still runs, just visibly broken.
So the size assertions here matter more than the "does it return bytes" ones.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from spine_shim import (  # noqa: E402
    build_shims,
    declared_page_size,
    describe,
    transparent_png,
)

ATLAS = """book.png
size:1981,803
filter:Linear,Linear
scale:0.25
book/cover1
bounds:274,314,32,32
book/clasp
bounds:308,314,32,32
"""

TWO_PAGE_ATLAS = """jakpots.png
size:100,200
filter:Linear,Linear
scale:1
region_a
bounds:0,0,10,10
jakpots_2.png
size:300,400
filter:Linear,Linear
scale:1
region_b
bounds:0,0,10,10
"""


def write_atlas(directory: Path, name: str, body: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(body)
    return path


def test_reads_the_size_the_atlas_declares(tmp_path):
    atlas = write_atlas(tmp_path, "book.atlas", ATLAS)
    assert declared_page_size(atlas, "book.png") == (1981, 803)


def test_each_page_of_a_multi_page_atlas_gets_its_own_size(tmp_path):
    """The second page must not inherit the first page's dimensions."""
    atlas = write_atlas(tmp_path, "jakpots.atlas", TWO_PAGE_ATLAS)
    assert declared_page_size(atlas, "jakpots.png") == (100, 200)
    assert declared_page_size(atlas, "jakpots_2.png") == (300, 400)


def test_an_unknown_page_has_no_declared_size(tmp_path):
    atlas = write_atlas(tmp_path, "book.atlas", ATLAS)
    assert declared_page_size(atlas, "nothing.png") is None


def test_a_page_with_no_size_line_is_refused_rather_than_guessed(tmp_path):
    """No size means no shim. A guessed page size is worse than a 404."""
    atlas = write_atlas(tmp_path, "broken.atlas", "broken.png\nfilter:Linear,Linear\n")
    assert declared_page_size(atlas, "broken.png") is None
    assert build_shims(tmp_path) == {}


def test_a_size_line_further_down_belongs_to_another_page(tmp_path):
    """A `size:` beyond the header window is not this page's size."""
    body = "orphan.png\n" + "\n".join(f"pad_{i}" for i in range(10)) + "\nsize:64,64\n"
    atlas = write_atlas(tmp_path, "orphan.atlas", body)
    assert declared_page_size(atlas, "orphan.png") is None


def test_the_placeholder_is_exactly_the_declared_size_and_transparent():
    image = Image.open(io.BytesIO(transparent_png(1981, 803)))
    assert image.size == (1981, 803)
    assert image.mode == "RGBA"
    assert image.getextrema()[3] == (0, 0)  # alpha channel entirely zero


def test_only_missing_pages_are_shimmed(tmp_path):
    spines = tmp_path / "assets/spines/@1x"
    write_atlas(spines, "book.atlas", ATLAS)
    shims = build_shims(tmp_path)
    assert list(shims) == ["assets/spines/@1x/book.png"]

    # Once the package ships the real texture, the shim disappears entirely.
    (spines / "book.png").write_bytes(transparent_png(4, 4))
    assert build_shims(tmp_path) == {}


def test_a_complete_package_produces_no_shims(tmp_path):
    assert build_shims(tmp_path) == {}
    assert "internally complete" in describe({})


def test_region_names_are_never_mistaken_for_page_images(tmp_path):
    """Regions can be named like paths; only bare top-level names are pages."""
    body = "book.png\nsize:10,10\nfilter:Linear,Linear\nbook/flare_top/flare.png\nbounds:0,0,2,2\n"
    write_atlas(tmp_path, "book.atlas", body)
    assert list(build_shims(tmp_path)) == ["book.png"]


def test_the_summary_names_every_shimmed_asset(tmp_path):
    spines = tmp_path / "assets/spines/@1x"
    write_atlas(spines, "book.atlas", ATLAS)
    summary = describe(build_shims(tmp_path))
    assert "assets/spines/@1x/book.png" in summary
    assert "1 atlas page(s)" in summary


@pytest.mark.parametrize("resolution", ["@0.5x", "@1x"])
def test_both_resolution_tiers_are_covered(tmp_path, resolution):
    spines = tmp_path / f"assets/spines/{resolution}"
    write_atlas(spines, "book.atlas", ATLAS)
    assert f"assets/spines/{resolution}/book.png" in build_shims(tmp_path)
