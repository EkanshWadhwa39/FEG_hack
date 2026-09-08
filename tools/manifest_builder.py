#!/usr/bin/env python3
"""Build a staged warm manifest from a game package, without modifying it.

A real integration cannot hand-list assets per title. It needs a manifest
generated from the bundle, which is what this does: walk the package, classify
each file into the load stage it belongs to, and emit exact relative URLs.

Stages follow the load order established in CODE.md:

    PRELOADER  entry document, panel CSS, loader art, canvas entry script
    COMMON     engine and vendor bundles, fonts, locale data
    SPLASH     splash art shown while primary assets stream
    PRIMARY    spine textures, atlases and spritesheets the first screen needs
    SECONDARY  audio and everything safe to fetch after first interaction

Only PRELOADER, COMMON, SPLASH and critical PRIMARY are ever proactively warmed.
SECONDARY is deliberately excluded: it is large, it is mostly audio, and it is
not on the path to a visible game.
"""

from __future__ import annotations

import json
from pathlib import Path

PROACTIVE_STAGES = ("PRELOADER", "COMMON", "SPLASH", "PRIMARY")

# Files that never belong in a warm manifest.
SKIPPED_NAMES = frozenset({".DS_Store", "Thumbs.db"})
SKIPPED_SUFFIXES = frozenset({".br", ".gz", ".map"})


def classify(relative: str) -> str:
    """Classify one bundle-relative path into a load stage."""
    lower = relative.lower()
    name = lower.rsplit("/", 1)[-1]

    if lower.endswith(".mp3") or lower.endswith(".ogg") or "/sounds/" in lower:
        return "SECONDARY"
    if "splash" in lower:
        return "SPLASH"
    if lower == "index.html" or "/panel/css/" in lower or "index-canvas" in name:
        return "PRELOADER"
    if "loader" in name or "/images/" in lower and "splash" not in lower:
        return "PRELOADER"
    if ("vendor-" in name or "core-engine" in name or name.startswith("game-")
            or lower.endswith((".ttf", ".woff", ".woff2"))
            or "/locale/" in lower):
        return "COMMON"
    if "/spines/" in lower or lower.endswith(".atlas") or "spritesheet" in lower:
        return "PRIMARY"
    if lower.endswith((".js", ".css")):
        return "COMMON"
    return "SECONDARY"


def is_critical_primary(relative: str, size: int) -> bool:
    """A PRIMARY asset is critical only if the first screen cannot render without it.

    We approximate that with the reel and background art the game shows behind
    the splash, and exclude oversized celebration art such as big-win spines.
    """
    lower = relative.lower()
    if "bigwin" in lower or "/@1x/" in lower and size > 3_000_000:
        return False
    return any(token in lower for token in ("reels", "frame", "bg_", "symbol", "king_character"))


def build_manifest(bundle: Path, resolution: str = "@1x") -> dict:
    """Walk the package and emit a staged manifest of exact relative URLs."""
    entries = []
    for path in sorted(bundle.rglob("*")):
        if not path.is_file():
            continue
        if path.name in SKIPPED_NAMES or path.suffix.lower() in SKIPPED_SUFFIXES:
            continue

        relative = path.relative_to(bundle).as_posix()
        # Resolve the resolution branch before warming, never warm both tiers.
        if "/@0.5x/" in relative and resolution != "@0.5x":
            continue
        if "/@1x/" in relative and resolution != "@1x":
            continue

        size = path.stat().st_size
        stage = classify(relative)
        entry = {"url": relative, "stage": stage, "estimatedBytes": size}
        if stage == "PRIMARY":
            entry["critical"] = is_critical_primary(relative, size)
        entries.append(entry)

    proactive = [
        e for e in entries
        if e["stage"] in PROACTIVE_STAGES
        and (e["stage"] != "PRIMARY" or e.get("critical") is True)
    ]
    return {
        "resolution": resolution,
        "totalFiles": len(entries),
        "totalBytes": sum(e["estimatedBytes"] for e in entries),
        "warmFiles": len(proactive),
        "warmBytes": sum(e["estimatedBytes"] for e in proactive),
        "assets": proactive,
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--resolution", default="@1x", choices=["@1x", "@0.5x"])
    args = parser.parse_args()

    from sandbox_server import resolve_bundle

    manifest = build_manifest(resolve_bundle(args.bundle.expanduser().resolve()),
                              args.resolution)
    print(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
