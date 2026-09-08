#!/usr/bin/env python3
"""Sandbox host for the FEG-provided game package.

Serves two DIFFERENT origins on two ports, mirroring the production topology
where the lobby and the game container are separate hosts:

    http://127.0.0.1:8090/   lobby   (prototype/, our code)
    http://127.0.0.1:8091/   game    (the provided bundle, served unmodified)

The bundle is read from an ignored path supplied by --bundle. It is never
copied into the repository and never modified: bytes are served exactly as
they are on disk.

Response headers imitate the production CDN observed on the live site:
long-lived immutable caching for versioned static assets, permissive CORS, and
no caching for HTML entry points. That makes local cold/warm measurement
comparable in kind to the production probe.

Usage:
    python3 tools/sandbox_server.py --bundle /path/to/empireofgold
    python3 tools/sandbox_server.py --bundle ... --throttle-kbps 12000
"""

from __future__ import annotations

import argparse
import os
import posixpath
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

# Extensions treated as immutable versioned static assets.
STATIC_SUFFIXES = frozenset({
    ".js", ".css", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ttf", ".woff",
    ".woff2", ".ogg", ".mp3", ".atlas", ".json", ".ts",
})

IMMUTABLE = "public, max-age=31536000, immutable"
NO_STORE = "no-cache, no-store, must-revalidate"


class SandboxHandler(SimpleHTTPRequestHandler):
    """Static handler with production-like caching and CORS headers."""

    def __init__(self, *args, directory: str, throttle_kbps: int = 0, **kwargs):
        self._throttle_kbps = throttle_kbps
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, fmt, *args):  # noqa: A003 - quiet by default
        if os.environ.get("SANDBOX_VERBOSE"):
            super().log_message(fmt, *args)

    def end_headers(self):
        path = urlparse(self.path).path
        suffix = Path(unquote(path)).suffix.lower()

        # Entry documents must not be cached, matching the live game-frame.
        if suffix in {".html", ""}:
            self.send_header("Cache-Control", NO_STORE)
        elif suffix in STATIC_SUFFIXES:
            self.send_header("Cache-Control", IMMUTABLE)

        # The production provider CDN sends ACAO *, which is what makes
        # parent-origin warming possible at all.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Timing-Allow-Origin", "*")
        super().end_headers()

    def copyfile(self, source, outputfile):
        """Copy with optional bandwidth throttling to imitate a real link."""
        if self._throttle_kbps <= 0:
            return super().copyfile(source, outputfile)

        chunk = 16 * 1024
        # Seconds each chunk should take at the requested rate.
        per_chunk = chunk / (self._throttle_kbps * 1024 / 8)
        while True:
            block = source.read(chunk)
            if not block:
                return
            outputfile.write(block)
            time.sleep(per_chunk)

    def translate_path(self, path):
        # Strip query strings (the bundle versions CSS with ?v=...) before
        # resolving, so those requests hit the real file.
        path = urlparse(path).path
        path = posixpath.normpath(unquote(path))
        parts = [p for p in path.split("/") if p and p not in (os.curdir, os.pardir)]
        resolved = Path(self.directory).joinpath(*parts)
        if resolved.is_dir():
            resolved = resolved / "index.html"
        return str(resolved)


def serve(directory: Path, port: int, throttle_kbps: int) -> ThreadingHTTPServer:
    handler = partial(SandboxHandler, directory=str(directory), throttle_kbps=throttle_kbps)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def resolve_bundle(bundle: Path) -> Path:
    """Accept either the bundle root or its parent wrapper directory."""
    if (bundle / "index.html").is_file():
        return bundle
    nested = bundle / bundle.name
    if (nested / "index.html").is_file():
        return nested
    for child in sorted(p for p in bundle.iterdir() if p.is_dir()):
        if (child / "index.html").is_file():
            return child
    raise SystemExit(f"no index.html found under {bundle}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path,
                        help="path to the provided game package (kept outside the repo)")
    parser.add_argument("--lobby-port", type=int, default=8090)
    parser.add_argument("--game-port", type=int, default=8091)
    parser.add_argument("--throttle-kbps", type=int, default=0,
                        help="throttle game-origin responses, e.g. 12000 for ~12 Mbps")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    lobby_dir = root / "prototype"
    game_dir = resolve_bundle(args.bundle.expanduser().resolve())

    serve(lobby_dir, args.lobby_port, 0)
    serve(game_dir, args.game_port, args.throttle_kbps)

    print(f"lobby  http://127.0.0.1:{args.lobby_port}/   ({lobby_dir})")
    print(f"game   http://127.0.0.1:{args.game_port}/    ({game_dir})")
    if args.throttle_kbps:
        print(f"game origin throttled to ~{args.throttle_kbps} kbps")
    print("Ctrl+C to stop.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
