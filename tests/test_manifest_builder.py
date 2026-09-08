"""Tests for staged warm-manifest generation from a game package."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from manifest_builder import build_manifest, classify, is_critical_primary  # noqa: E402


def test_stages_follow_the_documented_load_order():
    assert classify("index.html") == "PRELOADER"
    assert classify("assets/panel/css/common.css") == "PRELOADER"
    assert classify("assets/index-canvas-abc.js") == "PRELOADER"
    assert classify("assets/vendor-pixi-abc.js") == "COMMON"
    assert classify("assets/core-engine-abc.js") == "COMMON"
    assert classify("assets/fonts/Mulish.ttf") == "COMMON"
    assert classify("assets/locale/hr/gameContent.json") == "COMMON"
    assert classify("assets/images/splashBG.jpg") == "SPLASH"
    assert classify("assets/spines/@1x/reels_frame.png") == "PRIMARY"
    assert classify("assets/spines/@1x/king.atlas") == "PRIMARY"


def test_audio_is_always_secondary_and_never_proactively_warmed():
    # Audio is 42% of this package and is not on the path to a visible game.
    assert classify("assets/sounds/mp3/FBGM.mp3") == "SECONDARY"
    assert classify("assets/sounds/ogg/BBGM.ogg") == "SECONDARY"
    # Even audio whose path would otherwise look primary.
    assert classify("assets/spines/@1x/reels.mp3") == "SECONDARY"


def test_only_critical_primary_qualifies():
    assert is_critical_primary("assets/spines/@1x/reels_frame.png", 100) is True
    assert is_critical_primary("assets/spines/@1x/king_character.png", 100) is True
    # Celebration art is not needed for the first screen.
    assert is_critical_primary("assets/spines/@1x/bigwins.png", 100) is False
    assert is_critical_primary("assets/spines/@1x/decorative.png", 100) is False


def make_package(root: Path) -> Path:
    files = {
        "index.html": 100,
        "assets/panel/css/common.css": 200,
        "assets/vendor-pixi-abc.js": 5_000,
        "assets/images/splashBG.jpg": 3_000,
        "assets/spines/@1x/reels_frame.png": 4_000,
        "assets/spines/@0.5x/reels_frame.png": 2_000,
        "assets/spines/@1x/bigwins.png": 9_000,
        "assets/sounds/mp3/FBGM.mp3": 50_000,
        "index.html.gz": 40,
        ".DS_Store": 10,
    }
    for name, size in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * size)
    return root


def test_manifest_warms_only_the_critical_head(tmp_path):
    manifest = build_manifest(make_package(tmp_path), "@1x")
    urls = {a["url"] for a in manifest["assets"]}

    assert "index.html" in urls
    assert "assets/vendor-pixi-abc.js" in urls
    assert "assets/images/splashBG.jpg" in urls
    assert "assets/spines/@1x/reels_frame.png" in urls
    # Excluded: audio, non-critical primary, the other resolution branch.
    assert "assets/sounds/mp3/FBGM.mp3" not in urls
    assert "assets/spines/@1x/bigwins.png" not in urls
    assert "assets/spines/@0.5x/reels_frame.png" not in urls


def test_only_one_resolution_branch_is_ever_warmed(tmp_path):
    package = make_package(tmp_path)
    for resolution, present, absent in (
        ("@1x", "assets/spines/@1x/reels_frame.png", "assets/spines/@0.5x/reels_frame.png"),
        ("@0.5x", "assets/spines/@0.5x/reels_frame.png", "assets/spines/@1x/reels_frame.png"),
    ):
        urls = {a["url"] for a in build_manifest(package, resolution)["assets"]}
        assert present in urls
        assert absent not in urls


def test_compressed_variants_and_os_cruft_are_never_listed(tmp_path):
    manifest = build_manifest(make_package(tmp_path), "@1x")
    urls = {a["url"] for a in manifest["assets"]}
    # The origin negotiates encoding; warming .gz by URL would miss the cache key.
    assert "index.html.gz" not in urls
    assert ".DS_Store" not in urls


def test_manifest_reports_what_it_warms_against_the_whole_package(tmp_path):
    manifest = build_manifest(make_package(tmp_path), "@1x")
    assert manifest["warmBytes"] < manifest["totalBytes"]
    assert manifest["warmFiles"] == len(manifest["assets"])
    for asset in manifest["assets"]:
        assert asset["estimatedBytes"] > 0
        if asset["stage"] == "PRIMARY":
            # The warmer rejects a PRIMARY asset not proven critical.
            assert asset["critical"] is True
