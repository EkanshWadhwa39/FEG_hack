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
import errno
import os
import re
import posixpath
import threading
import time
import json
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


#: Path the game origin serves its generated warm manifest from.
MANIFEST_PATH = "/warm-manifest.json"

#: Virtual game prefix. /g1/..., /g2/... all serve the same provided package,
#: but under distinct URLs so each is a separate browser cache namespace.
#: Without this, warming one tile would warm every tile and the hit-rate story
#: would be a lie.
GAME_PREFIX = re.compile(r"^/g(\d+)(/.*)?$")


class SandboxHandler(SimpleHTTPRequestHandler):
    """Static handler with production-like caching and CORS headers."""

    def __init__(self, *args, directory: str, throttle_kbps: int = 0,
                 manifest: bytes | None = None, latency_ms: int = 0, **kwargs):
        self._throttle_kbps = throttle_kbps
        self._manifest = manifest
        self._latency_ms = latency_ms
        super().__init__(*args, directory=directory, **kwargs)

    def handle_one_request(self):
        # Per-request delay standing in for round-trip time. Loopback has none,
        # which makes an unlatenced sandbox systematically understate the value
        # of cache warming: a warm hit skips the round trip entirely.
        if self._latency_ms > 0:
            time.sleep(self._latency_ms / 1000)
        super().handle_one_request()

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler naming
        path = urlparse(self.path).path
        match = GAME_PREFIX.match(path)
        if self._manifest is not None and match and (match.group(2) or "/") == MANIFEST_PATH:
            return self._send_manifest()
        if self._manifest is not None and path == MANIFEST_PATH:
            return self._send_manifest()
        super().do_GET()

    def _send_manifest(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(self._manifest)))
        self.end_headers()
        self.wfile.write(self._manifest)

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
        # Map /gN/... onto the single package on disk. The URLs stay distinct,
        # so the browser caches each virtual game separately, but only one copy
        # of the package is ever stored.
        match = GAME_PREFIX.match(path)
        if match:
            path = match.group(2) or "/"
        path = posixpath.normpath(unquote(path))
        parts = [p for p in path.split("/") if p and p not in (os.curdir, os.pardir)]
        resolved = Path(self.directory).joinpath(*parts)
        if resolved.is_dir():
            resolved = resolved / "index.html"
        return str(resolved)


def serve(directory: Path, port: int, throttle_kbps: int,
          host: str = "127.0.0.1", manifest: bytes | None = None,
          latency_ms: int = 0) -> ThreadingHTTPServer:
    handler = partial(SandboxHandler, directory=str(directory),
                      throttle_kbps=throttle_kbps, manifest=manifest,
                      latency_ms=latency_ms)
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
    from manifest_builder import build_manifest  # noqa: PLC0415 - avoids a cycle

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path,
                        help="path to the provided game package (kept outside the repo)")
    parser.add_argument("--lobby-port", type=int, default=8090)
    parser.add_argument("--game-port", type=int, default=8091)
    parser.add_argument("--throttle-kbps", type=int, default=0,
                        help="throttle game-origin responses, e.g. 12000 for ~12 Mbps")
    parser.add_argument("--latency-ms", type=int, default=0,
                        help="per-request delay standing in for RTT, e.g. 40")
    parser.add_argument("--profile", default="blocking",
                        choices=["blocking", "critical", "all"],
                        help="how much to warm; blocking is the measured minimum")
    parser.add_argument("--resolution", default="@1x", choices=["@1x", "@0.5x"],
                        help="resolution tier to warm; the other branch is excluded")
    parser.add_argument("--host", default="127.0.0.1",
                        help="bind address; use 0.0.0.0 to let another device on the "
                             "same network open the demo")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    lobby_dir = root / "prototype"
    game_dir = resolve_bundle(args.bundle.expanduser().resolve())

    # Generate the warm manifest from the package itself. A real integration
    # cannot hand-list assets per title, so the sandbox does not either.
    manifest = build_manifest(game_dir, args.resolution, args.profile)
    manifest_bytes = json.dumps(manifest).encode("utf-8")

    serve(lobby_dir, args.lobby_port, 0, args.host)
    serve(game_dir, args.game_port, args.throttle_kbps, args.host, manifest_bytes,
          args.latency_ms)

    shown = "127.0.0.1" if args.host in {"127.0.0.1", "localhost"} else args.host
    print(f"lobby  http://{shown}:{args.lobby_port}/sandbox.html   ({lobby_dir})", flush=True)
    print(f"game   http://{shown}:{args.game_port}/    ({game_dir})", flush=True)
    print(f"manifest {MANIFEST_PATH} [{args.profile}]: {manifest['warmFiles']} files, "
          f"{manifest['warmBytes'] / 1048576:.1f} MB of "
          f"{manifest['totalBytes'] / 1048576:.1f} MB "
          f"({100 * manifest['warmBytes'] / manifest['totalBytes']:.0f}% of package)",
          flush=True)
    if args.host == "0.0.0.0":  # noqa: S104 - deliberate, demo on a local network
        print("Reachable from other devices on this network. Sandbox data only.", flush=True)
    if args.throttle_kbps:
        print(f"game origin throttled to ~{args.throttle_kbps} kbps", flush=True)
    if args.latency_ms:
        print(f"game origin latency ~{args.latency_ms} ms per request", flush=True)
    print("Ctrl+C to stop.", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
