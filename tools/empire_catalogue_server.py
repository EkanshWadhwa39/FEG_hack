#!/usr/bin/env python3
"""Loopback-only, unchanged-ZIP Empire sandbox; stdlib only, not production proof.

Run with --zip PRIVATE.zip (default lobby 8100; twenty game origins 8101..8120).
CLI requires --expected-archive-sha256 for the reviewed release and the fixed
lobby 8100 / games 8101..8120 mapping. It refuses startup outside a non-root Linux
network namespace with only loopback, no external routes and port 8121 blocked.
No environment variable disables this guard; --help needs no isolation.
Python API: EmpireCatalogueServer(...).start(), .close(), or a context manager.
Only constructor callers testing SYNTHETIC bytes may set synthetic_fixture=True
for unconfined ephemeral-port fixtures. Never use this option for provider bytes.
The default constructor enforces the same confinement and release pin as the CLI.

Release contract: freeze (origin, archive SHA-256, serving policy) for the lifetime
of any browser cache. Reusing an origin for a different archive requires new ports
or completely fresh browser profiles, NOT a query rewrite. Pin reviewed releases
with the required --expected-archive-sha256; a mismatch fails before any provider
listener opens. Runtime
archive replacement/modification fails closed. Across-process origin ownership is
an operator responsibility; this server writes no registry or archive copies.
Restart each measurement arm, using cache/no-store here, not browser route hacks.

The default eight PRELOADER+COMMON manifest sizes/hashes describe raw archive
entries, not wire savings (STATICALLY-INFERRED: 523940 bytes/title for the audited
supplied release).
SPLASH remains foreground-only; an optional profile needs an explicit budget/benefit
decision, not silent inclusion in the conservative default.
The 10 MiB budget is a total session ceiling for the caller, not a per-title grant.
Only the en/1x subset is declared: callers must resolve the actual provider variant
before speculative requests. This server does not force provider device selection.
HTTP compression is deliberately not negotiated: identity bytes only, no Vary.
Provider HTML, wrappers, configuration, statistics and ALL errors are no-store.
Other static responses have a one-hour sandbox cache policy. Provider query strings
(e.g. the supplied CSS ?v=...) remain in browser URLs: no redirects or rewriting.

Stats count socket-accepted encoded body bytes, excluding headers (not a claim
that a peer consumed them). Short sends count only the bytes send() returned;
failed sends do not charge the remaining response. Statuses are server response
decisions, and requests include failed provider routes, not wrapper/config traffic.
Counters can be in-flight snapshots; restart to reset. No raw request logging.
Early indexes count only exact configured origin-form targets, not query/path aliases.
They include error bodies and are NOT browser cache-hit or consumed-body counters.

All listeners are loopback-only. Do not publish/tunnel/reverse-proxy this private
provider server. Browser request metadata is checked when present; it is not auth.
CSP restricts external subresources; explicit HTTP connect sources exclude ws/wss,
and response-header sandboxing blocks popups and ancestor navigation. CSP cannot
provide complete network confinement (e.g. self-navigation, DNS/speculation and
browser-internal traffic; HTTP source matching also permits HTTPS upgrades). Run
the measurement browser under independent network isolation allowing ONLY these
21 loopback ports, with proxies and external egress denied. Do not use Playwright
routing/interception: it changes HTTP-cache behavior and invalidates this proof.

The ZIP is read in place, never extracted/patched. Only index.html and assets/
are exposed. Missing late textures remain 404s. Missing SECONDARY book.png alone
does NOT establish an unplayable base game: all gameplay readiness is UNKNOWN.
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import mimetypes
import os
import re
import signal
import socket
import stat
import sys
import threading
import zlib
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zipfile import BadZipFile, ZipFile

LOOPBACK = "127.0.0.1"
APPROVED_PORTS = tuple(range(8100, 8121))
# Reviewed release already pinned by the isolated runner; not caller-selected trust.
REVIEWED_ARCHIVE_SHA256 = "f0b4947f9d703af9c99419418293ac518189afe3c8dabfc9781f9558a9dacdba"
DENIED_PORT = 8121
BYTE_BUDGET = 10 * 1024 * 1024
MAX_MEMBER_BYTES = 128 * 1024 * 1024
CHUNK_BYTES = 64 * 1024
ARCHIVE_PREFIX = "empireofgold/"
# Audited order: descriptor dependencies are included, bootstrap JS is not.
EARLY_ASSETS = (
    ("PRELOADER", "assets/locale/en/gameContent.json"),
    ("PRELOADER", "assets/locale/en/commonContent.json"),
    ("PRELOADER", "assets/fonts/en/Mulish.ttf"),
    ("PRELOADER", "assets/images/@1x/brandLogo.png"),
    ("COMMON", "assets/fonts/en/NewRocker-Regular.ttf"),
    ("COMMON", "assets/fonts/en/Oswald-Bold.ttf"),
    ("COMMON", "assets/images/@1x/controlPanelPrimaryAssets.json"),
    ("COMMON", "assets/images/@1x/controlPanelPrimaryAssets.webp"),
)
MODULES = (
    "empire-demo", "empire-catalogue", "empire-milestone", "catalogue", "drawer",
    "candidate-policy", "content-adapters", "bounded-browser-requester",
    "content-loader", "manifest", "warmer", "governor", "catalogue-bindings",
    "content-demo-policy", "content-demo-scheduler",
)
LOBBY_FILES = {
    "/": "empire-demo.html",
    "/empire-demo.html": "empire-demo.html",
    "/styles/content-demo.css": "styles/content-demo.css",
    **{f"/src/{name}.js": f"src/{name}.js" for name in MODULES},
}
WRAPPER_FILES = {
    "/__vault/player.html": "empire-player.html",
    "/__vault/player.js": "src/empire-player.js",
}
EARLY_INDEX = {"/" + path: index for index, (_, path) in enumerate(EARLY_ASSETS)}


class ArchiveUnavailable(Exception):
    """Sanitized archive failure; underlying provider errors are never sent/logged."""


class ConfinementError(RuntimeError):
    """Fail closed without including host, archive or caller-provided details."""


@dataclass(frozen=True)
class ConfinementSnapshot:
    """Injectable kernel observations; validation itself performs no I/O."""

    platform: str
    uids: tuple[int, int, int]
    namespace: str
    reference_namespace: str
    interfaces: tuple[str, ...]
    status: str
    ipv4_routes: str
    ipv6_routes: str


def _proc_fields(text):
    """Reject duplicate kernel status fields rather than silently taking the last."""
    fields = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        name, value = line.split(":", 1)
        if name in fields:
            raise ValueError("Duplicate kernel status field")
        fields[name] = value
    return fields


def validate_confinement(snapshot):
    """Require a separate, unprivileged, loopback-only Linux network namespace.

    Missing/malformed procfs information is not evidence of isolation. IPv6's
    kernel unreachable default entries (RTF_REJECT) are safe; usable defaults,
    gateways, non-loopback interfaces and non-host IPv6 routes are not.
    """
    try:
        if snapshot.platform != "linux" or len(snapshot.uids) != 3 or any(
                type(uid) is not int or uid <= 0 for uid in snapshot.uids):
            raise ValueError
        namespaces = (snapshot.namespace, snapshot.reference_namespace)
        if (any(not re.fullmatch(r"net:\[[1-9][0-9]*\]", ns) for ns in namespaces)
                or namespaces[0] == namespaces[1] or snapshot.interfaces != ("lo",)):
            raise ValueError
        fields = _proc_fields(snapshot.status)
        for name in ("CapInh", "CapPrm", "CapEff", "CapAmb"):
            if not re.fullmatch(r"\s*[0-9a-fA-F]{16}\s*", fields[name]) or int(fields[name], 16):
                raise ValueError
        rows = snapshot.ipv4_routes.splitlines()
        if not rows or rows[0].split() != [
                "Iface", "Destination", "Gateway", "Flags", "RefCnt", "Use", "Metric",
                "Mask", "MTU", "Window", "IRTT"]:
            raise ValueError
        for row in rows[1:]:
            parts = row.split()
            if len(parts) != 11 or parts[0] != "lo":
                raise ValueError
            if (any(not re.fullmatch(r"[0-9a-fA-F]{8}", parts[index])
                    for index in (1, 2, 7))
                    or not re.fullmatch(r"[0-9a-fA-F]{4,8}", parts[3])
                    or any(not re.fullmatch(r"[0-9]+", parts[index])
                           for index in (4, 5, 6, 8, 9, 10))):
                raise ValueError
            destination, gateway, mask = (int(parts[index], 16) for index in (1, 2, 7))
            network_mask = int.from_bytes(mask.to_bytes(4, "little"), "big")
            inverse_mask = network_mask ^ 0xffffffff
            if inverse_mask & (inverse_mask + 1):
                raise ValueError
            # /proc/net/route uses little-endian IPv4 hex. Every usable prefix
            # must be wholly within 127/8; even a default on lo is rejected.
            if gateway or destination & 255 != 127 or mask & 255 != 255:
                raise ValueError
        for row in snapshot.ipv6_routes.splitlines():
            parts = row.split()
            if len(parts) != 10 or parts[9] != "lo":
                raise ValueError
            widths = (32, 2, 32, 2, 32, 8, 8, 8, 8)
            if any(not re.fullmatch(rf"[0-9a-fA-F]{{{width}}}", part)
                   for part, width in zip(parts[:9], widths)):
                raise ValueError
            values = [int(part, 16) for part in parts[:9]]
            destination, prefix, source, source_prefix, gateway, *_, flags = values
            if gateway or source or source_prefix:
                raise ValueError
            if not ((destination == 1 and prefix == 128)
                    or (destination == 0 and prefix == 0 and flags & 0x200)):
                raise ValueError
    except (ValueError, KeyError, TypeError, AttributeError):
        raise ConfinementError("Unverified Linux network confinement") from None


def _reference_namespace(current):
    """Compare with PID 1 or an outside ancestor, without privileged procfs reads.

    Linux may deny a dropped user's readlink of root-owned PID 1. The invoking
    non-root shell is an equivalent reference for sudo unshare/runuser launchers.
    No visible outside reference means refusal, never an isolation assertion.
    """
    pid = 1
    seen = set()
    while pid not in seen:
        seen.add(pid)
        try:
            namespace = os.readlink(f"/proc/{pid}/ns/net")
        except PermissionError:
            namespace = current
        # Some procfs security layers return an empty readlink instead of EACCES.
        # It is not an outside namespace; continue to a readable ancestor.
        if namespace and namespace != current:
            return namespace
        if pid == 1:
            pid = os.getpid()
        else:
            fields = _proc_fields(Path(f"/proc/{pid}/status").read_text())
            parent = fields["PPid"].strip()
            if not re.fullmatch(r"[0-9]+", parent):
                raise ValueError("Malformed parent process")
            pid = int(parent)
            if pid <= 0:
                break
    raise ConfinementError("No separate ancestor network namespace verified")


def inspect_confinement():
    """Read the current process namespace, not environment assertions or sysfs."""
    if sys.platform != "linux":
        raise ConfinementError("Linux network confinement required")
    try:
        namespace = os.readlink("/proc/self/ns/net")
        return ConfinementSnapshot(
            platform=sys.platform, uids=os.getresuid(),
            namespace=namespace, reference_namespace=_reference_namespace(namespace),
            interfaces=tuple(name for _, name in socket.if_nameindex()),
            status=Path("/proc/self/status").read_text(),
            ipv4_routes=Path("/proc/self/net/route").read_text(),
            ipv6_routes=Path("/proc/self/net/ipv6_route").read_text(),
        )
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise ConfinementError("Unable to inspect network confinement") from None


def probe_denied_loopback_port():
    """Bounded numeric-loopback probe only: no DNS, provider or external traffic.

    ECONNREFUSED is NOT a firewall proof (an ordinary closed host port does that).
    Accept DROP timeout or explicit administrative denial only. No listener opens.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.25)
        try:
            return probe.connect_ex((LOOPBACK, DENIED_PORT))
        except TimeoutError:
            return errno.ETIMEDOUT


def require_confinement(*, inspect=None, probe=None):
    """Guard before archive access and again before binding; dependencies are testable.

    This checks launcher preconditions, not a hostile root administrator. Keep the
    browser in this same namespace; the server cannot confine a remote browser.
    """
    try:
        validate_confinement((inspect or inspect_confinement)())
        outcome = (probe or probe_denied_loopback_port)()
        if type(outcome) is not int or outcome not in {
                errno.EAGAIN, errno.ETIMEDOUT, errno.EACCES, errno.EPERM}:
            raise ConfinementError("Unapproved loopback port is not denied")
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise ConfinementError("Unable to verify network confinement") from None


def validate_provider_configuration(ports, expected_sha256):
    """Pure fixed release/origin policy; CLI arguments cannot expand the allowlist."""
    if tuple(ports) != APPROVED_PORTS:
        raise ConfinementError("Provider origins must use fixed ports 8100..8120")
    if expected_sha256 != REVIEWED_ARCHIVE_SHA256:
        raise ConfinementError("The reviewed archive SHA-256 pin is required")


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _open_file_beneath(root: Path, relative: str):
    """Race-resistant openat walk; reject symlinks in every path component."""
    parts = root.absolute().parts + tuple(relative.split("/"))
    descriptor = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts[1:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                              dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_fd
        result = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=descriptor)
        if not stat.S_ISREG(os.fstat(result).st_mode):
            os.close(result)
            raise OSError("Not a regular file")
        return os.fdopen(result, "rb")
    finally:
        os.close(descriptor)


def safe_path(target: str) -> str | None:
    """Validate origin-form request target; decode path only, never rewrite URLs."""
    if not target.startswith("/") or target.startswith("//"):
        return None
    if any(ord(char) < 32 or ord(char) == 127 for char in target) or "#" in target:
        return None
    try:
        raw_path = urlsplit(target).path
        if re.search(r"%(?![0-9a-fA-F]{2})", raw_path):
            return None
        path = unquote(raw_path, errors="strict")
    except (ValueError, UnicodeError):
        return None
    if "\\" in path or "%" in path or "//" in path:
        return None
    if any(ord(char) < 32 or ord(char) == 127 for char in path):
        return None
    if any(part.startswith(".") for part in path.split("/") if part):
        return None
    return path


class _Archive:
    def __init__(self, path, expected_sha256=None, *, synthetic_fixture=False):
        self.path = Path(path).absolute()
        self.lock = threading.Lock()
        self.failed = False
        self.file = _open_file_beneath(self.path.parent, self.path.name)
        self.zip = None
        try:
            self.signature = _signature(os.fstat(self.file.fileno()))
            digest = hashlib.sha256()
            while chunk := self.file.read(1024 * 1024):
                digest.update(chunk)
            self.sha256 = digest.hexdigest()
            # Fixture opt-out must never expose the pinned provider archive, even
            # when the caller omitted its expected pin. Check before ZIP parsing.
            if expected_sha256 is not None and expected_sha256 != self.sha256:
                raise ValueError("Archive release pin mismatch")
            self.file.seek(0)
            self.zip = ZipFile(self.file)
            self.members = {}
            for entry in self.zip.infolist():
                if entry.is_dir() or not entry.filename.startswith(ARCHIVE_PREFIX):
                    continue
                relative = entry.filename[len(ARCHIVE_PREFIX):]
                # Metadata is never public. Unsafe names anywhere are never mapped.
                if relative != "index.html" and not relative.startswith("assets/"):
                    continue
                if safe_path("/" + relative) != "/" + relative:
                    raise ValueError("Unsafe archive member")
                file_type = stat.S_IFMT(entry.external_attr >> 16)
                if file_type not in {0, stat.S_IFREG}:
                    raise ValueError("Nonregular archive members are forbidden")
                if relative in self.members:
                    raise ValueError("Duplicate archive member")
                if entry.file_size > MAX_MEMBER_BYTES or entry.flag_bits & 1:
                    raise ValueError("Unsupported archive member")
                self.members[relative] = entry
            if "index.html" not in self.members:
                raise ValueError("Missing provider entry document")
            if any(relative not in self.members for _, relative in EARLY_ASSETS):
                raise ValueError("Missing required early manifest entry")
            # Reject an over-budget manifest before inflating any of its objects.
            if sum(self.members[relative].file_size for _, relative in EARLY_ASSETS) > BYTE_BUDGET:
                raise ValueError("Early manifest exceeds byte budget")
            self.manifest = []
            for stage, relative in EARLY_ASSETS:
                payload = self.read(relative)
                self.manifest.append({
                    "stage": stage,
                    "estimatedBytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                })
            if sum(asset["estimatedBytes"] for asset in self.manifest) > BYTE_BUDGET:
                raise ValueError("Early manifest exceeds byte budget")
        except Exception:
            self.close()
            raise

    def check(self):
        try:
            unchanged = (
                _signature(os.fstat(self.file.fileno())) == self.signature
                and _signature(self.path.stat(follow_symlinks=False)) == self.signature
            )
        except (OSError, ValueError):
            unchanged = False
        if self.failed or not unchanged:
            self.failed = True
            raise ArchiveUnavailable("Archive release unavailable")

    def read(self, relative):
        with self.lock:
            self.check()
            entry = self.members.get(relative)
            if entry is None:
                return None
            try:
                payload = self.zip.read(entry)
                self.check()
                if len(payload) != entry.file_size:
                    raise ArchiveUnavailable("Archive release unavailable")
                return payload
            except (OSError, BadZipFile, RuntimeError, EOFError, ValueError,
                    NotImplementedError, zlib.error, ArchiveUnavailable):
                self.failed = True
                raise ArchiveUnavailable("Archive release unavailable") from None

    def close(self):
        if self.zip is not None:
            self.zip.close()
        self.file.close()


class _Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.active = 0
        self.peak = 0
        self.instances = [dict(requests=0, bodyBytes=0, statuses={},
                               earlyRequests=[0] * len(EARLY_ASSETS),
                               earlyBodyBytes=[0] * len(EARLY_ASSETS))
                          for _ in range(20)]

    def begin(self, instance, early):
        with self.lock:
            self.active += 1
            self.peak = max(self.peak, self.active)
            record = self.instances[instance]
            record["requests"] += 1
            if early is not None:
                record["earlyRequests"][early] += 1

    def status(self, instance, status):
        with self.lock:
            statuses = self.instances[instance]["statuses"]
            key = str(status)
            statuses[key] = statuses.get(key, 0) + 1

    def written(self, instance, early, count):
        with self.lock:
            record = self.instances[instance]
            record["bodyBytes"] += count
            if early is not None:
                record["earlyBodyBytes"][early] += count

    def end(self):
        with self.lock:
            self.active -= 1

    def snapshot(self):
        with self.lock:
            return json.loads(json.dumps({
                "label": "MEASURED", "activeProviderResponses": self.active,
                "peakProviderResponses": self.peak, "instances": self.instances,
            }))


def _send_body(connection, payload, on_written):
    """No sendall: account short writes even when a later send fails."""
    view = memoryview(payload)
    while view:
        try:
            count = connection.send(view[:CHUNK_BYTES])
        except OSError:
            break
        if count <= 0:
            break
        on_written(count)
        view = view[count:]


def _mime(path):
    overrides = {".js": "text/javascript", ".json": "application/json",
                 ".svg": "image/svg+xml", ".ttf": "font/ttf"}
    suffix = Path(path).suffix.lower()
    return overrides.get(suffix) or mimetypes.guess_type(path)[0] or "application/octet-stream"


def _cover(index):
    # Original geometry only; no dependency on game content, randomness or user text.
    hue = (index * 47) % 360
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">'
        '<defs><linearGradient id="g" x2="1" y2="1">'
        f'<stop stop-color="hsl({hue},55%,24%)"/>'
        f'<stop offset="1" stop-color="hsl({(hue + 65) % 360},60%,48%)"/>'
        '</linearGradient></defs><path fill="url(#g)" d="M0 0h320v200H0z"/>'
        f'<circle cx="{60 + index * 7}" cy="100" r="54" '
        'fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3"/>'
        '<path d="M160 35l65 65-65 65-65-65z" fill="#fff" fill-opacity=".16"/>'
        '</svg>'
    ).encode("utf-8")


class _HTTPServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True

    def __init__(self, app, instance, port):
        self.app = app
        self.instance = instance
        self.connections = set()
        self.connections_lock = threading.Lock()
        super().__init__((LOOPBACK, port), _Handler, bind_and_activate=False)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        with self.connections_lock:
            self.connections.add(connection)
        return connection, address

    def close_request(self, request):
        with self.connections_lock:
            self.connections.discard(request)
        super().close_request(request)

    def abort_connections(self):
        with self.connections_lock:
            for connection in self.connections:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def handle_error(self, _request, _client_address):
        # Never emit raw request paths, headers, archive exceptions or tracebacks.
        pass


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_args):
        pass

    def csp(self):
        lobby = self.server.app.lobby_origin
        ancestry = f"frame-ancestors 'self' {lobby}; "
        common = ("worker-src 'none'; child-src 'none'; form-action 'none'; "
                  "object-src 'none'; base-uri 'none'; manifest-src 'none'; ")
        if self.server.instance is None:
            games = " ".join(self.server.app.game_origins)
            return ("default-src 'none'; script-src 'self'; style-src 'self'; "
                    f"img-src 'self'; font-src 'self'; connect-src {lobby} {games}; "
                    f"frame-src {games}; " + common + ancestry)
        origin = self.server.app.game_origins[self.server.instance]
        # An explicit HTTP connect source, unlike 'self', does not authorize WS.
        # A header sandbox cannot be removed like an iframe sandbox attribute.
        # Keep script/same-origin for the unchanged engine and parent observation.
        return (f"default-src 'none'; connect-src {origin}; frame-src {origin}; "
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
                "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                "font-src 'self' data:; media-src 'self' blob:; "
                "sandbox allow-scripts allow-same-origin; " + common + ancestry)

    def respond(self, status, payload, content_type="text/plain; charset=utf-8", *,
                cache=False, cors=False, provider=False, early=None):
        app = self.server.app
        if provider:
            app.stats.status(self.server.instance, status)
        try:
            # send_response_only avoids the default Server and timestamp headers.
            self.send_response_only(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "public, max-age=3600" if
                             cache and status == 200 and app.cache_policy == "cache"
                             else "no-store")
            self.send_header("Content-Security-Policy", self.csp())
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-DNS-Prefetch-Control", "off")
            self.send_header("Connection", "close")
            if cors:
                self.send_header("Access-Control-Allow-Origin", app.lobby_origin)
                self.send_header("Timing-Allow-Origin", app.lobby_origin)
            self.end_headers()
            if self.command != "HEAD":
                def record(count):
                    if provider:
                        app.stats.written(self.server.instance, early, count)
                _send_body(self.connection, payload, record)
        except OSError:
            pass
        finally:
            self.close_connection = True

    def send_error(self, code, message=None, explain=None):
        # Base class errors may otherwise reflect attacker-controlled request text.
        self.respond(code, b"Request rejected\n")

    def _valid_host(self):
        return self.headers.get_all("Host", []) == [f"{LOOPBACK}:{self.server.server_port}"]

    def _valid_browser_source(self):
        # Browser-supplied defense in depth, not a private-resource access token.
        # Direct local CLI clients without these headers remain supported.
        origins = self.headers.get_all("Origin", [])
        own = f"http://{LOOPBACK}:{self.server.server_port}"
        allowed = {own, self.server.app.lobby_origin}
        if origins and (len(origins) != 1 or origins[0] not in allowed):
            return False
        sites = self.headers.get_all("Sec-Fetch-Site", [])
        return not sites or (len(sites) == 1 and sites[0] in {"same-origin", "same-site", "none"})

    def do_GET(self):  # noqa: N802
        if not self._valid_host():
            self.respond(421, b"Request rejected\n")
            return
        if not self._valid_browser_source():
            self.respond(403, b"Request rejected\n")
            return
        # BaseHTTPRequestHandler collapses leading // in self.path. Validate the
        # original target instead, before any such normalization can hide it.
        target = self.requestline.split()[1]
        path = safe_path(target)
        if path is None:
            self.respond(400, b"Request rejected\n")
            return
        app = self.server.app
        instance = self.server.instance
        if path == "/__vault/config.json":
            try:
                app.archive.check()
                data = app.config(instance)
            except ArchiveUnavailable:
                self.respond(503, b"Archive release unavailable\n")
                return
            self.respond(200, json.dumps(data).encode(), "application/json")
            return
        if instance is None:
            if path == "/__vault/stats.json":
                self.respond(200, json.dumps(app.stats.snapshot()).encode(), "application/json")
                return
            match = re.fullmatch(r"/__vault/cover/title-(0[1-9]|1[0-9]|20)\.svg", path)
            if match:
                self.respond(200, _cover(int(match[1])), "image/svg+xml", cache=True)
                return
            self.local_file(LOBBY_FILES.get(path))
            return
        if path in WRAPPER_FILES:
            self.local_file(WRAPPER_FILES[path], wrapper=True)
            return
        if path.startswith("/__vault/"):
            self.respond(404, b"Not found\n")
            return
        early = EARLY_INDEX.get(target)
        app.stats.begin(instance, early)
        try:
            relative = "index.html" if path == "/" else path[1:]
            try:
                payload = app.archive.read(relative)
            except ArchiveUnavailable:
                self.respond(503, b"Archive release unavailable\n", cors=True,
                             provider=True, early=early)
                return
            if payload is None:
                self.respond(404, b"Not found\n", cors=True, provider=True, early=early)
            else:
                self.respond(200, payload, _mime(relative),
                             cache=Path(relative).suffix.lower() not in {".html", ".htm"},
                             cors=True, provider=True, early=early)
        finally:
            app.stats.end()

    def local_file(self, relative, wrapper=False):
        if relative is None:
            self.respond(404, b"Not found\n")
            return
        try:
            with _open_file_beneath(self.server.app.prototype_root, relative) as source:
                if os.fstat(source.fileno()).st_size > MAX_MEMBER_BYTES:
                    raise OSError("Static file too large")
                payload = source.read(MAX_MEMBER_BYTES + 1)
                if len(payload) > MAX_MEMBER_BYTES:
                    raise OSError("Static file too large")
        except OSError:
            self.respond(404, b"Not found\n")
            return
        self.respond(200, payload, _mime(relative),
                     cache=not wrapper and not relative.endswith(".html"))

    def do_HEAD(self):  # noqa: N802
        self.do_GET()

    def _unsupported(self):
        self.respond(405 if self._valid_host() else 421, b"Request rejected\n")

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_TRACE = do_CONNECT = _unsupported


class EmpireCatalogueServer:
    """One private archive, twenty stable synthetic identities, atomically bound."""

    def __init__(self, zip_path, *, prototype_root=None, lobby_port=8100,
                 game_ports=None, cache_policy="cache", expected_archive_sha256=None,
                 synthetic_fixture=False):
        if cache_policy not in {"cache", "no-store"}:
            raise ValueError("Invalid cache policy")
        ports = tuple(range(8101, 8121)) if game_ports is None else tuple(game_ports)
        all_ports = (lobby_port,) + ports
        if len(ports) != 20 or any(type(port) is not int or not 0 <= port <= 65535
                                   for port in all_ports):
            raise ValueError("Exactly twenty valid game ports are required")
        nonzero = [port for port in all_ports if port]
        if len(nonzero) != len(set(nonzero)):
            raise ValueError("Lobby and game ports must be disjoint")
        if expected_archive_sha256 is not None and not re.fullmatch(
                r"[0-9a-f]{64}", expected_archive_sha256):
            raise ValueError("Invalid archive SHA-256 pin")
        if type(synthetic_fixture) is not bool:
            raise ValueError("synthetic_fixture must be an explicit boolean")
        self.synthetic_fixture = synthetic_fixture
        self._initial_synthetic_fixture = synthetic_fixture
        if not self.synthetic_fixture:
            validate_provider_configuration(all_ports, expected_archive_sha256)
        self.prototype_root = (Path(prototype_root).absolute() if prototype_root else
                               Path(__file__).absolute().parents[1] / "prototype")
        self.cache_policy = cache_policy
        self.requested_ports = all_ports
        self.servers = []
        self.threads = []
        self.closed = False
        self.stats = _Stats()
        self.archive = _Archive(zip_path, expected_archive_sha256,
                                synthetic_fixture=synthetic_fixture)
        self.build = "empire-" + self.archive.sha256[:16]
        self.lobby_origin = None
        self.game_origins = []

    def start(self):
        if self.closed or self.servers:
            raise RuntimeError("Server instances can only start once")
        try:
            if not self._initial_synthetic_fixture:
                validate_provider_configuration(self.requested_ports, self.archive.sha256)
            self.archive.check()
            # Bind every port before activating any; no serving threads until all succeed.
            for index, port in enumerate(self.requested_ports):
                server = _HTTPServer(self, None if index == 0 else index - 1, port)
                self.servers.append(server)
                server.server_bind()
            for server in self.servers:
                server.server_activate()
            origins = [f"http://{LOOPBACK}:{server.server_port}" for server in self.servers]
            self.lobby_origin, *self.game_origins = origins
            for server in self.servers:
                thread = threading.Thread(target=server.serve_forever,
                                          kwargs={"poll_interval": 0.02}, daemon=False)
                thread.start()
                self.threads.append(thread)
        except BaseException:
            self.close()
            raise
        return self

    def config(self, instance=None):
        if self.lobby_origin is None:
            raise RuntimeError("Server not started")
        self.archive.check()
        entries = []
        for index, origin in enumerate(self.game_origins):
            if instance is not None and index != instance:
                continue
            entries.append({
                "id": f"title-{index + 1:02d}", "origin": origin,
                "assets": [dict(metadata, url=f"{origin}/{relative}", releaseBuild=self.build)
                           for (_, relative), metadata in zip(EARLY_ASSETS,
                                                               self.archive.manifest)],
            })
        return {
            "label": "SIMULATED", "mode": "PROVIDER_EARLY_ASSETS",
            "lobbyOrigin": self.lobby_origin, "build": self.build,
            "archiveSha256": self.archive.sha256, "locale": "en", "tier": "1x",
            "byteBudget": BYTE_BUDGET, "cachePolicy": self.cache_policy, "entries": entries,
        }

    def close(self):
        if self.closed:
            return
        self.closed = True
        # Only running serve_forever loops may receive shutdown (otherwise it deadlocks).
        for server in self.servers[:len(self.threads)]:
            server.shutdown()
        for server in self.servers:
            server.abort_connections()
        for server in self.servers:
            server.server_close()
        for thread in self.threads:
            thread.join()
        self.archive.close()

    def __enter__(self):
        return self.start()

    def __exit__(self, *_args):
        self.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, dest="zip_path")
    parser.add_argument("--prototype-root", type=Path)
    parser.add_argument("--lobby-port", type=int, default=8100)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--game-base-port", type=int, default=8101)
    group.add_argument("--game-ports", help="Exactly twenty comma-separated ports")
    parser.add_argument("--cache-policy", choices=("cache", "no-store"), default="cache")
    parser.add_argument("--expected-archive-sha256", required=True,
                        help="Required SHA-256 of the reviewed provider release")
    args = parser.parse_args(argv)
    stop = threading.Event()
    previous = {}
    try:
        game_ports = (tuple(int(port) for port in args.game_ports.split(","))
                      if args.game_ports else range(args.game_base_port, args.game_base_port + 20))
        with EmpireCatalogueServer(
                args.zip_path, prototype_root=args.prototype_root, lobby_port=args.lobby_port,
                game_ports=game_ports, cache_policy=args.cache_policy,
                expected_archive_sha256=args.expected_archive_sha256) as app:
            for signum in (signal.SIGINT, signal.SIGTERM):
                previous[signum] = signal.signal(signum, lambda *_args: stop.set())
            print(json.dumps({"label": "SIMULATED", "lobbyOrigin": app.lobby_origin,
                              "gameOrigins": app.game_origins, "build": app.build,
                              "cachePolicy": app.cache_policy, "readiness": "UNKNOWN"}), flush=True)
            stop.wait()
    except (OSError, ValueError, BadZipFile, ArchiveUnavailable, RuntimeError):
        print("Sandbox startup failed; require available fixed localhost ports 8100..8120 "
              "and the reviewed archive SHA-256 pin. Check private archive availability.",
              file=sys.stderr)
        return 1
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
