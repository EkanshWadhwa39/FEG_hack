#!/usr/bin/env python3
"""Sandbox host for the FEG-provided game package.

Serves two DIFFERENT origins on two ports, mirroring the production topology
where the lobby and the game container are separate hosts:

    http://127.0.0.1:8090/   lobby   (src/, our code)
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
import errno
import os
import posixpath
import re
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

# Matches /game/{slot-tag} at the start of a URL path.  The slot tag may
# include a session nonce (e.g. /game/3_a1b2c3/) so each page load starts
# with a truly cold cache — no leftover entries from previous sessions.
# All content after the prefix maps to the same bundle files on disk.
_GAME_SLOT_RE = re.compile(r"^/game/[^/]+")

# Extensions treated as immutable versioned static assets.
STATIC_SUFFIXES = frozenset({
    ".js", ".css", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ttf", ".woff",
    ".woff2", ".ogg", ".mp3", ".atlas", ".json", ".ts", ".fnt",
})

IMMUTABLE = "public, max-age=31536000, immutable"
NO_STORE = "no-cache, no-store, must-revalidate"


class SandboxHandler(SimpleHTTPRequestHandler):
    """Static handler with production-like caching and CORS headers."""

    # URLs that were speculatively prefetched this session.  Iframe requests
    # for these paths skip throttle so warm launches stay at ~0.5s while cold
    # launches (never prefetched) remain throttled at the configured rate.
    _warmed_urls: set[str] = set()

    def __init__(self, *args, directory: str, throttle_kbps: int = 0,
                 game_directory: str | None = None, **kwargs):
        self._throttle_kbps = throttle_kbps
        self._game_directory = game_directory
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, fmt, *args):
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
        # Only throttle game assets, never lobby html/scripts
        is_game = _GAME_SLOT_RE.match(urlparse(self.path).path) is not None or self._game_directory is None
        if self._throttle_kbps <= 0 or not is_game:
            try:
                return super().copyfile(source, outputfile)
            except (BrokenPipeError, ConnectionResetError):
                return

        # Distinguish speculative prefetch (fetch() from lobby) from in-iframe launch
        # fetch() from lobby uses Sec-Fetch-Dest: empty and Sec-Fetch-Mode: cors
        dest = self.headers.get("Sec-Fetch-Dest", "")
        mode = self.headers.get("Sec-Fetch-Mode", "")
        is_prefetch = (mode == "cors" and dest == "empty") or self.headers.get("Purpose") == "prefetch"
        url_path = urlparse(self.path).path

        if is_prefetch:
            # Record this URL so iframe loads for warm games skip throttle
            self.__class__._warmed_urls.add(url_path)
            rate_kbps = self._throttle_kbps
        elif url_path in self.__class__._warmed_urls:
            # Warm game: asset was prefetched → skip throttle (~0.5s launch)
            try:
                return super().copyfile(source, outputfile)
            except (BrokenPipeError, ConnectionResetError):
                return
        else:
            # Cold game: browser opens ~6 connections vs prefetch's 2, so
            # divide by 3 to land at ~8-9s for 29 MB cold launch
            rate_kbps = max(1, self._throttle_kbps // 3)

        chunk = 16 * 1024
        per_chunk = chunk / (rate_kbps * 1024 / 8)
        while True:
            try:
                block = source.read(chunk)
                if not block:
                    return
                outputfile.write(block)
                time.sleep(per_chunk)
            except (BrokenPipeError, ConnectionResetError):
                return

    def translate_path(self, path):
        # Strip /game/{N} prefix so every slot ID maps to the bundle root.
        # /game/5/assets/foo.js  →  /assets/foo.js  (different cache key,
        # same bytes on disk).  The suffix used for Cache-Control in
        # end_headers() is derived from self.path (the original URL), so
        # JS/CSS files still get IMMUTABLE and the slot index.html gets
        # NO_STORE even after stripping.
        bare = urlparse(path).path
        m = _GAME_SLOT_RE.match(bare)
        base_dir = self.directory
        if m:
            if self._game_directory:
                base_dir = self._game_directory
            rest = path[len(m.group(0)):]
            path = rest if rest.startswith("/") else ("/" + rest)

        # Strip query strings (the bundle versions CSS with ?v=...) before
        # resolving, so those requests hit the real file.
        path = urlparse(path).path
        path = posixpath.normpath(unquote(path))
        parts = [p for p in path.split("/") if p and p not in (os.curdir, os.pardir)]
        resolved = Path(base_dir).joinpath(*parts)
        if resolved.is_dir():
            resolved = resolved / "index.html"
        return str(resolved)


def serve(directory: Path, port: int, throttle_kbps: int,
          host: str = "127.0.0.1", game_directory: Path | None = None) -> ThreadingHTTPServer:
    handler = partial(SandboxHandler, directory=str(directory),
                      throttle_kbps=throttle_kbps,
                      game_directory=str(game_directory) if game_directory else None)
    try:
        server = ThreadingHTTPServer((host, port), handler)
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise
        # A stale sandbox from a previous run is the usual cause, and finding
        # that out mid-demo is expensive. Say exactly how to clear it.
        raise SystemExit(
            f"Port {port} is already in use.\n"
            f"  Find it:  ss -lptn 'sport = :{port}'\n"
            f"  Free it:  kill $(ss -lptn 'sport = :{port}' "
            f"| grep -oP 'pid=\\K[0-9]+' | head -1)\n"
            f"  Or pick another port: --lobby-port / --game-port"
        ) from error
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
    parser.add_argument("--host", default="127.0.0.1",
                        help="bind address; use 0.0.0.0 to let another device on the "
                             "same network open the demo")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    lobby_dir = (root / "src") if (root / "src" / "lobby.html").exists() else (root / "prototype")
    game_dir = resolve_bundle(args.bundle.expanduser().resolve())

    serve(lobby_dir, args.lobby_port, args.throttle_kbps, args.host, game_dir)
    serve(game_dir, args.game_port, args.throttle_kbps, args.host)

    shown = "127.0.0.1" if args.host in {"127.0.0.1", "localhost"} else args.host
    print(f"lobby  http://{shown}:{args.lobby_port}/sandbox.html   ({lobby_dir})", flush=True)
    print(f"game   http://{shown}:{args.game_port}/    ({game_dir})", flush=True)
    if args.host == "0.0.0.0":
        print("Reachable from other devices on this network. Sandbox data only.", flush=True)
    if args.throttle_kbps:
        print(f"game origin throttled to ~{args.throttle_kbps} kbps", flush=True)
    print("Ctrl+C to stop.", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
