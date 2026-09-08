"""Poster generation from the provided package.

These build a miniature stand-in package rather than requiring the real bundle,
so they run anywhere. What they pin down is the contract the lobby depends on:
posters are square, small, deterministic, and derived only from bytes that were
supplied to us.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

Image = pytest.importorskip("PIL.Image", reason="Pillow is not installed")

from poster_builder import (  # noqa: E402 - path set above
    BACKGROUND,
    build_poster,
    build_posters,
    _load_frames,
)


@pytest.fixture
def bundle(tmp_path: Path) -> Path:
    """A miniature package with the same shape as the provided one."""
    root = tmp_path / "package"
    (root / "assets" / "images" / "@1x").mkdir(parents=True)

    # Landscape background, like the real splash.
    Image.new("RGB", (960, 445), (90, 70, 30)).save(root / BACKGROUND)

    sheet = root / "assets" / "images" / "@1x" / "symbols.webp"
    atlas = Image.new("RGBA", (600, 400), (0, 0, 0, 0))
    # Two opaque sprites, and one sliver that must be ignored.
    atlas.paste(Image.new("RGBA", (200, 200), (200, 40, 40, 255)), (10, 10))
    atlas.paste(Image.new("RGBA", (180, 180), (40, 200, 90, 255)), (300, 10))
    atlas.save(sheet)
    (root / "assets" / "images" / "@1x" / "symbols.json").write_text(json.dumps({
        "frames": {
            "big": {"frame": {"x": 10, "y": 10, "w": 200, "h": 200}},
            "medium": {"frame": {"x": 300, "y": 10, "w": 180, "h": 180}},
            "sliver": {"frame": {"x": 0, "y": 380, "w": 600, "h": 8}},
        },
    }), encoding="utf-8")
    return root


def test_only_real_sprites_become_poster_foregrounds(bundle: Path) -> None:
    frames = _load_frames(bundle)
    # The sliver is UI furniture, not art, and must never front a poster.
    assert len(frames) == 2
    assert all(box[2] - box[0] >= 120 for _, box in frames)


def test_a_poster_is_square_and_small(bundle: Path) -> None:
    data = build_poster(bundle, 0, size=160)
    image = Image.open(io.BytesIO(data))

    assert image.size == (160, 160), "square, so the tile's layout box cannot shift"
    assert image.format == "WEBP"
    # A lobby renders dozens of these. The raw splash is 675 KB; this must not be.
    assert len(data) < 40_000


def test_posters_are_deterministic(bundle: Path) -> None:
    # A reload must not reshuffle the lobby, and caching must be meaningful.
    assert build_poster(bundle, 3, size=96) == build_poster(bundle, 3, size=96)


def test_consecutive_posters_differ(bundle: Path) -> None:
    # One package extrapolated into a grid is only convincing if the tiles are
    # actually distinguishable at thumbnail size.
    posters = [build_poster(bundle, index, size=96) for index in range(4)]
    assert len(set(posters)) == 4


def test_build_posters_keys_match_the_lobby_url_scheme(bundle: Path) -> None:
    posters = build_posters(bundle, 3, size=64)
    assert sorted(posters) == ["/posters/g1.webp", "/posters/g2.webp", "/posters/g3.webp"]
    assert all(isinstance(value, bytes) and value for value in posters.values())


def test_a_package_with_no_atlases_still_produces_posters(tmp_path: Path) -> None:
    root = tmp_path / "bare"
    (root / "assets" / "images" / "@1x").mkdir(parents=True)
    Image.new("RGB", (400, 200), (20, 20, 40)).save(root / BACKGROUND)

    data = build_poster(root, 0, size=64)
    assert Image.open(io.BytesIO(data)).size == (64, 64)


def test_a_corrupt_atlas_descriptor_is_skipped_not_fatal(bundle: Path) -> None:
    (bundle / "assets" / "images" / "@1x" / "symbols.json").write_text("{ not json",
                                                                      encoding="utf-8")
    assert _load_frames(bundle) == []
    assert build_poster(bundle, 0, size=64)


def test_build_posters_rejects_a_meaningless_count(bundle: Path) -> None:
    with pytest.raises(ValueError):
        build_posters(bundle, 0)
