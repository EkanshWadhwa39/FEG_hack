#!/usr/bin/env python3
"""Original SIMULATED content; local test configuration, NOT production policy.

CLI: python tools/content_server.py --port 8092 --missing-thumbnail title-03
Prints one readiness JSON line (including the actual port when --port 0).
Python: serve(directory=Path('prototype'), port=0, missing_thumbnails=('title-03',))
returns a running ThreadingHTTPServer; callers must shutdown() and server_close().

Exactly 20 identities, build synthetic-v1, and the literal query ?v=1 are valid:
  /synthetic/{title-01..title-20}/synthetic-v1/thumbnail.svg?v=1
  /synthetic/{id}/synthetic-v1/{hr-HR|en}/{1x|0.5x}/{preloader|common|splash}.bin?v=1
fixture_manifest() exposes these same exact relative URLs to Python consumers.
No provider files are opened. Only source documents/modules beneath prototype/
are served from a pinned source-root descriptor, without symlinks (including
root ancestors), directory listings, path normalization or implicit redirects.

GET /health reports aggregate readiness (intentional missing thumbnails do not
make the host unready). GET /__metrics snapshots cumulative HTTP requests and
body bytes in successful complete writes, not wire bytes or browser cache hits.
A partially failed socket write has UNKNOWN delivered bytes and is not counted.
HEAD counts a request but zero body bytes. HTTP errors have independent
errors/errors_by_status counters;
by_title/by_type contain only fixed synthetic identities and allowlisted types.
Metrics never retain request paths, query strings, headers or client identities.
The metrics response describes the state BEFORE that metrics request is counted.
Optional safety routes: /__test/no-store and /__test/redirect -> /forbidden (403).

SandboxHandler supplies the HTTP substrate; its provider-oriented path, logging,
cache and throttling policies are deliberately replaced. No artificial delay.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import os
import stat
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import BinaryIO

try:  # Both `python tools/content_server.py` and `import tools.content_server`.
    from .sandbox_server import SandboxHandler
except ImportError:
    from sandbox_server import SandboxHandler

TITLE_IDS = tuple(f"title-{number:02d}" for number in range(1, 21))
BUILD = "synthetic-v1"
LOCALES = ("hr-HR", "en")
TIERS = ("1x", "0.5x")
ASSET_SIZES = {"preloader": 16384, "common": 32768, "splash": 65536}
IMMUTABLE = "public, max-age=3600, immutable"
NO_STORE = "no-store"
PROTOTYPE = Path(__file__).resolve().parent.parent / "prototype"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}
CSP = (
    "default-src 'none'; connect-src 'self'; img-src 'self'; frame-src 'self'; "
    "script-src 'self'; style-src 'self'; font-src 'self'; base-uri 'none'; "
    "object-src 'none'; form-action 'none'"
)
KINDS = ("thumbnail", *ASSET_SIZES, "static", "health", "metrics", "rejected",
         "test_no_store", "test_redirect")


def fixture_manifest(title_id: str, locale: str = "hr-HR", tier: str = "1x") -> dict:
    """Return original synthetic identities only; never normalize a cache key."""
    if title_id not in TITLE_IDS or locale not in LOCALES or tier not in TIERS:
        raise ValueError("unknown synthetic identity, locale or tier")
    base = f"/synthetic/{title_id}/{BUILD}"
    return {
        "classification": "SIMULATED", "id": title_id, "build": BUILD,
        "locale": locale, "tier": tier,
        "thumbnail": f"{base}/thumbnail.svg?v=1",
        "assets": [
            {"type": kind, "url": f"{base}/{locale}/{tier}/{kind}.bin?v=1",
             "bytes": size}
            for kind, size in ASSET_SIZES.items()
        ],
    }


def thumbnail_svg(title_id: str) -> bytes:
    """Generate a small distinct ORIGINAL icon, not provider artwork."""
    if title_id not in TITLE_IDS:
        raise ValueError("unknown synthetic identity")
    number = int(title_id[-2:])
    color = f"#{(number * 731791) % 0x1000000:06x}"
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" '
        f'viewBox="0 0 128 96" role="img" aria-label="SIMULATED title {number:02d}">'
        f'<title>SIMULATED title {number:02d}</title>'
        f'<rect width="128" height="96" rx="8" fill="{color}"/>'
        '<circle cx="64" cy="34" r="25" fill="white"/>'
        f'<text x="64" y="42" text-anchor="middle" font-size="24" fill="black">'
        f'{number:02d}</text><rect y="68" width="128" height="28" fill="white"/>'
        '<text x="64" y="86" text-anchor="middle" font-size="12" fill="black">'
        'SIMULATED</text></svg>'
    ).encode("utf-8")


def _counter() -> dict:
    return {"requests": 0, "body_bytes": 0, "errors": 0}


class Metrics:
    """Bounded aggregates, shared only by handlers of one server instance."""

    def __init__(self):
        self.lock = threading.Lock()
        self.data = {
            "classification": "MEASURED", "content_classification": "SIMULATED",
            "scope": "local synthetic server only",
            "body_bytes_semantics": ("HTTP body bytes in successful complete writes; excludes "
                                     "headers; partial failed writes unknown; not wire bytes"),
            **_counter(), "errors_by_status": {},
            "by_title": {
                title: {kind: _counter() for kind in ("thumbnail", *ASSET_SIZES)}
                for title in TITLE_IDS
            },
            "by_type": {kind: _counter() for kind in KINDS},
        }

    def _buckets(self, title, kind):
        buckets = [self.data, self.data["by_type"][kind]]
        if title is not None:
            buckets.append(self.data["by_title"][title][kind])
        return buckets

    def response(self, status, title, kind):
        with self.lock:
            for bucket in self._buckets(title, kind):
                bucket["requests"] += 1
                bucket["errors"] += int(status >= 400)
            if status >= 400:
                key = str(status)
                errors = self.data["errors_by_status"]
                errors[key] = errors.get(key, 0) + 1

    def write(self, output, block, title, kind):
        # Keep snapshot atomic with each successful socket write. A HEAD, or a
        # connection lost before a write succeeds, does not count planned bytes.
        with self.lock:
            output.write(block)
            for bucket in self._buckets(title, kind):
                bucket["body_bytes"] += len(block)

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.data)


class ContentHandler(SandboxHandler):
    """Conservative synthetic-only policy on the existing sandbox substrate."""

    server_version = "SyntheticContent/1"
    sys_version = ""

    def __init__(self, *args, directory: str, missing_thumbnails=(), metrics=None, **kwargs):
        self.missing_thumbnails = frozenset(missing_thumbnails)
        if not self.missing_thumbnails.issubset(TITLE_IDS):
            raise ValueError("unknown missing-thumbnail id")
        self.metrics = metrics if metrics is not None else Metrics()
        self._cache_policy = NO_STORE
        super().__init__(*args, directory=directory, throttle_kbps=0, **kwargs)

    def log_message(self, fmt, *args):
        """Never log raw request data, even with SANDBOX_VERBOSE configured."""

    def setup(self):
        super().setup()
        # Bound idle reads/writes on this loopback-only diagnostic host.
        self.connection.settimeout(5)

    def handle(self):
        try:
            super().handle()
        except (ConnectionError, TimeoutError):
            # Do not let stdlib print client addresses on a disconnected socket.
            self.close_connection = True

    def parse_request(self):
        if not super().parse_request():
            return False
        if self.request_version == "HTTP/0.9":
            self.send_error(505)
            return False
        # The stdlib silently rewrites leading // to /. Reject that spelling
        # instead of accepting a different exact URL after normalization.
        if self.requestline.split()[1] != self.path:
            self.send_error(400)
            return False
        return True

    def end_headers(self):
        self.send_header("Cache-Control", self._cache_policy)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Timing-Allow-Origin", "*")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Classification", "SIMULATED")
        # Bypass SandboxHandler's suffix-based caching, including on errors.
        SimpleHTTPRequestHandler.end_headers(self)

    def _respond(self, status, body=b"", *, content_type="application/json",
                 cache=NO_STORE, title=None, kind="rejected", location=None,
                 length=None):
        source = io.BytesIO(body) if isinstance(body, bytes) else body
        size = len(body) if isinstance(body, bytes) else length
        self._cache_policy = cache
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        if location is not None:
            self.send_header("Location", location)
        # Count before publishing headers: a HEAD client can immediately ask
        # for metrics once those headers arrive, without any body-write barrier.
        self.metrics.response(status, title, kind)
        self.end_headers()
        if self.command != "HEAD":
            try:
                remaining = size
                while remaining:
                    block = source.read(min(16384, remaining))
                    if not block:
                        # A developer may edit a source file during a request.
                        # Never write beyond the advertised Content-Length.
                        self.close_connection = True
                        break
                    self.metrics.write(self.wfile, block, title, kind)
                    remaining -= len(block)
            except OSError:
                self.close_connection = True

    def _json(self, value, *, kind):
        self._respond(200, json.dumps(value, sort_keys=True).encode(), kind=kind)

    def send_error(self, code, message=None, explain=None, *, title=None, kind="rejected"):
        # Ignore the base handler's messages: they may contain a request target.
        # Early parser errors retain the stdlib HTTP/0.9 default, which would
        # suppress ALL headers (including no-store). Always frame error replies.
        if self.request_version == "HTTP/0.9":
            self.request_version = "HTTP/1.0"
        body = json.dumps({"classification": "SIMULATED", "error": "request rejected",
                           "status": code}).encode()
        self.close_connection = True
        self._respond(code, body, title=title, kind=kind)

    def do_GET(self):  # noqa: N802 - stdlib handler API
        self._dispatch()

    def do_HEAD(self):  # noqa: N802 - stdlib handler API
        self._dispatch()

    def _dispatch(self):
        raw = self.path
        path, separator, query = raw.partition("?")
        # Strict canonical path spelling: no decoding or normalization can turn
        # an attacker target into a valid fixture or a confined static file.
        if (not path.startswith("/") or path.startswith("//") or
                any(ord(char) < 32 or ord(char) == 127 for char in raw) or
                any(char in path for char in ("%", "\\", "#")) or
                "#" in query or
                any(part.startswith(".") for part in path.split("/") if part)):
            self.send_error(400)
            return
        if path.startswith("/synthetic/"):
            self._synthetic(path, query if separator else "")
        elif path == "/health" and not separator:
            self._json({"classification": "SIMULATED", "ready": True,
                        "title_count": len(TITLE_IDS),
                        "thumbnail_ready_count": len(TITLE_IDS) - len(self.missing_thumbnails),
                        "missing_thumbnail_count": len(self.missing_thumbnails),
                        "binary_fixture_count": len(TITLE_IDS) * len(LOCALES) *
                        len(TIERS) * len(ASSET_SIZES)}, kind="health")
        elif path == "/__metrics" and not separator:
            self._json(self.metrics.snapshot(), kind="metrics")
        elif path == "/__test/no-store" and not separator:
            self._respond(200, b"SIMULATED no-store fixture\n",
                          content_type="text/plain", kind="test_no_store")
        elif path == "/__test/redirect" and not separator:
            self._respond(302, location="/forbidden", kind="test_redirect")
        elif path == "/forbidden":
            self.send_error(403)
        else:
            self._static(path)

    def _synthetic(self, path, query):
        parts = path.split("/")
        if (query != "v=1" or len(parts) not in (5, 7) or
                parts[2] not in TITLE_IDS or parts[3] != BUILD):
            self.send_error(404)
            return
        title = parts[2]
        if len(parts) == 5 and parts[4] == "thumbnail.svg":
            if title in self.missing_thumbnails:
                self.send_error(404, title=title, kind="thumbnail")
                return
            self._respond(200, thumbnail_svg(title), content_type="image/svg+xml",
                          cache=IMMUTABLE, title=title, kind="thumbnail")
            return
        if len(parts) == 7 and parts[4] in LOCALES and parts[5] in TIERS:
            kind = parts[6].removesuffix(".bin")
            if kind in ASSET_SIZES and parts[6] == f"{kind}.bin":
                seed = f"SIMULATED original fixture|{path}?v=1".encode()
                body = hashlib.shake_256(seed).digest(ASSET_SIZES[kind])
                self._respond(200, body, content_type="application/octet-stream",
                              cache=IMMUTABLE, title=title, kind=kind)
                return
        self.send_error(404)

    def _open_static(self, parts) -> BinaryIO:
        # Open relative to directory descriptors, refusing every symlink. This
        # also closes resolve-then-open traversal races on this Linux test host.
        directory = self.server.duplicate_source_root()
        try:
            for part in parts[:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=directory)
                os.close(directory)
                directory = child
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                                 dir_fd=directory)
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                os.close(descriptor)
                raise OSError("not a regular source file")
            return os.fdopen(descriptor, "rb")
        finally:
            os.close(directory)

    def _static(self, path):
        parts = ["index.html"] if path == "/" else path[1:].split("/")
        content_type = STATIC_TYPES.get(Path(parts[-1]).suffix)
        if not content_type or any(not part for part in parts):
            self.send_error(404)
            return
        try:
            source = self._open_static(parts)
        except (OSError, ValueError):
            self.send_error(404)
            return
        with source:
            self._respond(200, source, content_type=content_type, kind="static",
                          length=os.fstat(source.fileno()).st_size)

    # Never allow a future call to inherited send_head/translate_path to use
    # SandboxHandler's normalization, directory handling or provider policy.
    def send_head(self):
        raise NotImplementedError("use the confined synthetic dispatcher")

    def translate_path(self, path):
        raise NotImplementedError("use descriptor-relative source opening")


def _open_source_root(directory: Path) -> int:
    """Pin a Linux source directory without following even ancestor symlinks."""
    directory = directory.absolute()  # Does not resolve symlinks.
    if directory.name != "prototype" or ".." in directory.parts:
        raise ValueError("directory must be a non-symlink prototype/ source root")
    descriptor = None
    try:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        descriptor = os.open(directory.anchor, flags)
        for part in directory.parts[1:]:
            child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        raise ValueError("directory must be a non-symlink prototype/ source root") from error


class ContentServer(ThreadingHTTPServer):
    """Own the pinned root until close; request descriptors are independent."""

    def __init__(self, address, handler, *, source_root):
        self._source_lock = threading.Lock()
        self._source_root = source_root
        super().__init__(address, handler)

    def duplicate_source_root(self):
        with self._source_lock:
            if self._source_root is None:
                raise OSError("source root closed")
            return os.dup(self._source_root)

    def server_close(self):
        try:
            super().server_close()
        finally:
            with self._source_lock:
                if self._source_root is not None:
                    os.close(self._source_root)
                    self._source_root = None


def serve(directory: Path | None = None, port: int = 8092, *,
          missing_thumbnails=()) -> ThreadingHTTPServer:
    """Start on 127.0.0.1 only; port 0 requests an OS-assigned port.

    directory is a prototype/ root override for isolated source-only unit tests,
    not a provider bundle option. The CLI always uses this checkout's prototype/.
    Requires Linux descriptor-relative O_NOFOLLOW support; no unsafe fallback.
    Call shutdown() then server_close() to release the listener and source root.
    """
    directory = Path(directory) if directory is not None else PROTOTYPE
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("port must be between 0 and 65535")
    missing = frozenset(missing_thumbnails)
    if not missing.issubset(TITLE_IDS):
        raise ValueError("unknown missing-thumbnail id")
    metrics = Metrics()
    handler = partial(ContentHandler, directory=str(directory.absolute()),
                      missing_thumbnails=missing, metrics=metrics)
    # TCPServer closes itself on bind failure, releasing this descriptor too.
    server = ContentServer(("127.0.0.1", port), handler,
                           source_root=_open_source_root(directory))
    try:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    except Exception:
        server.server_close()
        raise
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8092)
    parser.add_argument("--missing-thumbnail", action="append", default=[], choices=TITLE_IDS)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    server = serve(port=args.port, missing_thumbnails=args.missing_thumbnail)
    port = server.server_address[1]
    print(json.dumps({"classification": "SIMULATED", "ready": True,
                      "host": "127.0.0.1", "port": port,
                      "origin": f"http://127.0.0.1:{port}"}), flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
