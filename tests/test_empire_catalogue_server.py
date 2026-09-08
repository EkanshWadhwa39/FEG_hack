"""Isolated stdlib HTTP tests using small synthetic ZIPs; no browser/provider bundle.

Run from the worktree with PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest
-p no:cacheprovider -q tests/test_empire_catalogue_server.py. Every listener uses
owned ephemeral ports. Files created by these tests live only in pytest tmp_path.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import errno
import socket
import stat
import subprocess
import sys
import threading
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest

from tools import empire_catalogue_server as module
from tools.empire_catalogue_server import (
    ARCHIVE_PREFIX,
    BYTE_BUDGET,
    EARLY_ASSETS,
    LOBBY_FILES,
    MODULES,
    WRAPPER_FILES,
    EmpireCatalogueServer,
    safe_path,
)

# Deliberately independent of the implementation constant: verify audited order.
EXPECTED_EARLY = (
    ("PRELOADER", "assets/locale/en/gameContent.json"),
    ("PRELOADER", "assets/locale/en/commonContent.json"),
    ("PRELOADER", "assets/fonts/en/Mulish.ttf"),
    ("PRELOADER", "assets/images/@1x/brandLogo.png"),
    ("COMMON", "assets/fonts/en/NewRocker-Regular.ttf"),
    ("COMMON", "assets/fonts/en/Oswald-Bold.ttf"),
    ("COMMON", "assets/images/@1x/controlPanelPrimaryAssets.json"),
    ("COMMON", "assets/images/@1x/controlPanelPrimaryAssets.webp"),
)


def make_zip(path, *, omit=None, extra=()):
    entries = {
        relative: bytes([index, 255, 0, 128]) * (index + 1)
        for index, (_, relative) in enumerate(EXPECTED_EARLY)
        if relative != omit
    }
    entries.update({
        "index.html": b'<!doctype html><link href="/assets/panel/css/common.css?v=1788443825853">',
        "assets/panel/css/common.css": b"/* unchanged CSS */ body { color: blue; }\n",
        "assets/index-bootstrap.js": b"/* synthetic bootstrap, never proactive */\n",
        "assets/spines/@1x/book.atlas": b"book.png\nsize: 1,1\n",
        "assets/late.bin": b"\x00\xffunchanged late bytes\r\n",
        "assets/images/@1x/splashBG.json": b'{"image":"splashBG.jpg"}',
        "assets/images/@1x/splashBG.jpg": b"synthetic foreground-only splash",
        "assets/images/@1x/splashAssets.json": b'{"image":"splashAssets.webp"}',
        "assets/images/@1x/splashAssets.webp": b"synthetic foreground-only splash",
    })
    entries.pop(omit, None)
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        for relative, payload in entries.items():
            archive.writestr(ARCHIVE_PREFIX + relative, payload)
        archive.writestr(ARCHIVE_PREFIX + ".DS_Store", b"private metadata")
        archive.writestr("elsewhere/private.txt", b"private outside the game root")
        for name, payload in extra:
            archive.writestr(name, payload)
    return entries


@pytest.fixture
def fixture_files(tmp_path):
    archive = tmp_path / "fixture.zip"
    entries = make_zip(archive)
    prototype = tmp_path / "prototype"
    for relative in set(LOBBY_FILES.values()) | set(WRAPPER_FILES.values()):
        path = prototype / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(("synthetic local file: " + relative).encode())
    (prototype / "secret.txt").write_text("not public")
    return archive, prototype, entries


def new_app(fixture_files, **kwargs):
    archive, prototype, _ = fixture_files
    return EmpireCatalogueServer(archive, synthetic_fixture=True, prototype_root=prototype,
                                 lobby_port=0, game_ports=[0] * 20, **kwargs)


@pytest.fixture
def app(fixture_files):
    with new_app(fixture_files) as running:
        yield running


def request(origin, path="/", *, method="GET", headers=None):
    parsed = urlsplit(origin)
    connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=5)
    try:
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def get_json(origin, path):
    status, headers, payload = request(origin, path)
    assert status == 200
    assert headers["Cache-Control"] == "no-store"
    assert headers["Content-Type"] == "application/json"
    return json.loads(payload)


def settled_stats(app):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        data = get_json(app.lobby_origin, "/__vault/stats.json")
        if data["activeProviderResponses"] == 0:
            return data
        time.sleep(0.005)
    pytest.fail("Provider responses did not settle")


def test_manifest_exact_schema_order_sizes_hashes_and_20_stable_identities(app, fixture_files):
    archive, _, entries = fixture_files
    assert EARLY_ASSETS == EXPECTED_EARLY
    config = get_json(app.lobby_origin, "/__vault/config.json")
    archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    build = "empire-" + archive_hash[:16]
    metadata = {key: value for key, value in config.items() if key != "entries"}
    assert metadata == {
        "label": "SIMULATED", "mode": "PROVIDER_EARLY_ASSETS", "build": build,
        "archiveSha256": archive_hash, "lobbyOrigin": app.lobby_origin,
        "locale": "en", "tier": "1x", "byteBudget": 10485760, "cachePolicy": "cache",
    }
    assert len(config["entries"]) == 20
    assert len(set(app.game_origins + [app.lobby_origin])) == 21
    for index, entry in enumerate(config["entries"]):
        assert entry == {
            "id": f"title-{index + 1:02d}", "origin": app.game_origins[index],
            "assets": [
                {"url": f"{app.game_origins[index]}/{relative}", "stage": stage,
                 "estimatedBytes": len(entries[relative]),
                 "sha256": hashlib.sha256(entries[relative]).hexdigest(), "releaseBuild": build}
                for stage, relative in EXPECTED_EARLY
            ],
        }
        own = get_json(entry["origin"], "/__vault/config.json")
        assert own == dict(metadata, entries=[entry])
        assert sum(asset["estimatedBytes"] for asset in entry["assets"]) <= BYTE_BUDGET
    assert get_json(app.lobby_origin, "/__vault/config.json") == config
    assert all(item["requests"] == 0 for item in settled_stats(app)["instances"])


def test_config_does_not_load_game_or_any_assets(app, monkeypatch):
    def forbidden_read(_relative):
        pytest.fail("Configuration must not read/serve game content")
    monkeypatch.setattr(app.archive, "read", forbidden_read)
    get_json(app.lobby_origin, "/__vault/config.json")
    get_json(app.game_origins[0], "/__vault/config.json")
    assert settled_stats(app)["peakProviderResponses"] == 0


def test_provider_identity_headers_and_original_css_query(app, fixture_files):
    archive, _, entries = fixture_files
    before = archive.read_bytes()
    for relative, payload in entries.items():
        path = "/" + relative
        if relative.endswith(".css"):
            path += "?v=1788443825853"
        status, headers, body = request(app.game_origins[0], path,
                                        headers={"Origin": app.lobby_origin,
                                                 "Accept-Encoding": "gzip, br"})
        assert status == 200
        assert body == payload
        assert int(headers["Content-Length"]) == len(payload)
        assert headers["Access-Control-Allow-Origin"] == app.lobby_origin
        assert headers["Timing-Allow-Origin"] == app.lobby_origin
        assert "Access-Control-Allow-Credentials" not in headers
        assert "Content-Encoding" not in headers
        assert "Vary" not in headers
        assert "Location" not in headers
        assert "Server" not in headers
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["Referrer-Policy"] == "no-referrer"
        assert headers["X-DNS-Prefetch-Control"] == "off"
        assert headers["Cache-Control"] == (
            "no-store" if relative.endswith(".html") else "public, max-age=3600")
    for query in ("", "?language=en", "?language=en&v=not-a-build-rewrite"):
        assert request(app.game_origins[0], "/" + query)[2] == entries["index.html"]
    assert archive.read_bytes() == before


def test_csp_defense_in_depth_and_frame_ancestry_not_network_isolation(app):
    lobby_csp = request(app.lobby_origin)[1]["Content-Security-Policy"]
    game_csp = request(app.game_origins[0])[1]["Content-Security-Policy"]
    for csp in (lobby_csp, game_csp):
        for directive in ("worker-src 'none'", "child-src 'none'", "form-action 'none'",
                          "object-src 'none'", "manifest-src 'none'", "default-src 'none'",
                          "base-uri 'none'", f"frame-ancestors 'self' {app.lobby_origin}"):
            assert directive in csp
        assert "https:" not in csp
        assert "*" not in csp
    for directive in ("script-src 'self'", "style-src 'self'", "img-src 'self'"):
        assert directive + ";" in lobby_csp
    assert "unsafe-inline" not in lobby_csp
    assert "unsafe-eval" not in lobby_csp
    assert f"connect-src {app.lobby_origin} {' '.join(app.game_origins)};" in lobby_csp
    assert f"frame-src {' '.join(app.game_origins)};" in lobby_csp
    assert f"connect-src {app.game_origins[0]};" in game_csp
    assert f"frame-src {app.game_origins[0]};" in game_csp
    assert "sandbox allow-scripts allow-same-origin;" in game_csp
    for forbidden in ("allow-popups", "allow-top-navigation", "allow-forms",
                      "allow-downloads", "allow-modals", "connect-src 'self'", "ws:", "wss:"):
        assert forbidden not in game_csp
    assert "sandbox " not in lobby_csp
    assert "navigate-to" not in game_csp  # Unsupported directive is not a security boundary.
    assert "script-src 'self' 'unsafe-inline' 'unsafe-eval';" in game_csp


def test_explicit_lobby_whitelist_and_game_only_wrappers(app, fixture_files):
    _, prototype, _ = fixture_files
    assert set(MODULES) == {
        "empire-demo", "empire-catalogue", "empire-milestone", "catalogue", "drawer",
        "candidate-policy", "content-adapters", "bounded-browser-requester", "content-loader",
        "manifest", "warmer", "governor", "catalogue-bindings", "content-demo-policy",
        "content-demo-scheduler",
    }
    for path, relative in LOBBY_FILES.items():
        status, _, payload = request(app.lobby_origin, path)
        assert status == 200
        assert payload == (prototype / relative).read_bytes()
    for path, relative in WRAPPER_FILES.items():
        status, headers, payload = request(app.game_origins[0], path)
        assert status == 200
        assert payload == (prototype / relative).read_bytes()
        assert headers["Cache-Control"] == "no-store"
        assert request(app.lobby_origin, path)[0] == 404
    for path in ("/index.html", "/content-demo.html", "/sandbox.html", "/secret.txt",
                 "/src/sandbox.js", "/src/empire-player.js", "/empire-player.html",
                 "/src/", "/styles/", "/CODE.md", "/tools/empire_catalogue_server.py",
                 "/__vault/player.html", "/assets/index-bootstrap.js", "/fixture.zip"):
        status, headers, _ = request(app.lobby_origin, path)
        assert status == 404
        assert headers["Cache-Control"] == "no-store"
    assert request(app.game_origins[0], "/__vault/stats.json")[0] == 404
    assert all(item["requests"] == 0 for item in settled_stats(app)["instances"])


def test_covers_original_stable_distinct_and_lobby_only(app):
    covers = []
    for index in range(1, 21):
        path = f"/__vault/cover/title-{index:02d}.svg"
        status, headers, cover = request(app.lobby_origin, path)
        assert status == 200
        assert headers["Content-Type"] == "image/svg+xml"
        assert cover.startswith(b'<svg xmlns="http://www.w3.org/2000/svg"')
        assert b"<image" not in cover and b"<script" not in cover and b"href=" not in cover
        assert request(app.lobby_origin, path)[2] == cover
        assert request(app.game_origins[0], path)[0] == 404
        covers.append(cover)
    assert len(set(covers)) == 20
    for title in ("title-00", "title-21", "title-1", "private"):
        assert request(app.lobby_origin, f"/__vault/cover/{title}.svg")[0] == 404


@pytest.mark.parametrize("path", [
    "/../secret", "/%2e%2e/secret", "/assets/../secret", "/assets/%2e/secret",
    "/assets/%252e%252e/secret", "/assets/a%5cb", "/assets/a\\b", "/assets/a%00b",
    "/assets//secret", "//outside.invalid/secret", "http://outside.invalid/secret",
    "/assets/.hidden", "/assets/%2eDS_Store", "/assets/%ff", "/assets/%", "/assets/%xz",
    "/assets/a%0ab", "/assets/a#fragment", "/assets/%2f%2fsecret",
])
def test_path_rejection(app, path):
    assert safe_path(path) is None
    for origin in (app.lobby_origin, app.game_origins[0]):
        status, headers, payload = request(
            origin, path, headers={"Host": origin.removeprefix("http://")})
        assert status == 400
        assert headers["Cache-Control"] == "no-store"
        assert payload == b"Request rejected\n"


def test_exact_query_preservation_is_not_redirect_or_normalized_cache_key(app, fixture_files):
    _, _, entries = fixture_files
    assert safe_path("/assets/%401x/test.png?v=exact%2Fquery") == "/assets/@1x/test.png"
    for query in ("?v=1788443825853", "?v=other", "?v=1788443825853&token=redact-me"):
        status, headers, payload = request(
            app.game_origins[0], "/assets/panel/css/common.css" + query)
        assert status == 200 and "Location" not in headers
        assert payload == entries["assets/panel/css/common.css"]
    assert "redact-me" not in json.dumps(settled_stats(app))


@pytest.mark.parametrize("host", ["localhost", "localhost:8100", "127.0.0.1",
                                   "attacker.invalid", "127.0.0.1:1", "127.0.0.1:8100@evil"])
def test_exact_host_rebinding_protection(app, host):
    for origin in (app.lobby_origin, app.game_origins[0]):
        status, headers, body = request(origin, "/__vault/config.json", headers={"Host": host})
        assert status == 421
        assert headers["Cache-Control"] == "no-store"
        assert body == b"Request rejected\n"


def raw_request(origin, data):
    port = urlsplit(origin).port
    with socket.create_connection(("127.0.0.1", port), timeout=3) as connection:
        connection.sendall(data)
        result = bytearray()
        while chunk := connection.recv(8192):
            result.extend(chunk)
        return bytes(result)


def test_missing_duplicate_and_wrong_listener_hosts(app):
    host = app.lobby_origin.removeprefix("http://")
    for headers in ("", f"Host: {host}\r\nHost: {host}\r\n",
                    f"Host: {app.game_origins[0].removeprefix('http://')}\r\n"):
        response = raw_request(app.lobby_origin, f"GET / HTTP/1.1\r\n{headers}\r\n".encode())
        assert response.startswith(b"HTTP/1.1 421")
        assert b"Cache-Control: no-store" in response


def test_unknown_methods_and_parser_errors_are_sanitized(app, capsys):
    for method in ("POST", "OPTIONS", "TRACE", "CONNECT", "PUT", "DELETE", "PATCH"):
        status, headers, payload = request(app.game_origins[0], "/secret?token=private", method=method)
        assert status == 405
        assert headers["Cache-Control"] == "no-store"
        assert b"private" not in payload
    response = raw_request(app.lobby_origin, b"private-secret / HTTP/1.1\r\nHost: nope\r\n\r\n")
    assert b"private-secret" not in response
    assert b"Cache-Control: no-store" in response
    captured = capsys.readouterr()
    assert captured.out == "" and captured.err == ""


def test_missing_late_assets_are_real_uncached_404_not_manifest_failure(app):
    assert len(get_json(app.lobby_origin, "/__vault/config.json")["entries"]) == 20
    for path in ("/assets/spines/@1x/book.png", "/elsewhere/private.txt", "/assets/",
                 "/__vault/missing", "/fixture.zip"):
        status, headers, payload = request(app.game_origins[0], path)
        assert status == 404
        assert headers["Cache-Control"] == "no-store"
        assert payload == b"Not found\n"
        assert "Location" not in headers


def test_no_store_arm_applies_to_every_success_and_error(fixture_files):
    with new_app(fixture_files, cache_policy="no-store") as app:
        assert get_json(app.lobby_origin, "/__vault/config.json")["cachePolicy"] == "no-store"
        for origin, path in (
            (app.lobby_origin, "/"), (app.lobby_origin, "/styles/content-demo.css"),
            (app.lobby_origin, "/__vault/cover/title-01.svg"),
            (app.game_origins[0], "/assets/late.bin"),
            (app.game_origins[0], "/__vault/player.js"),
            (app.game_origins[0], "/assets/missing.png"),
        ):
            assert request(origin, path)[1]["Cache-Control"] == "no-store"


def test_filesystem_symlinks_and_nonregular_files_never_served(app, fixture_files, tmp_path):
    _, prototype, _ = fixture_files
    external = tmp_path / "outside-secret.txt"
    external.write_text("do not expose this")
    html = prototype / "empire-demo.html"
    html.unlink()
    html.symlink_to(external)
    assert request(app.lobby_origin)[0] == 404
    styles = prototype / "styles"
    styles.rename(prototype / "real-styles")
    styles.symlink_to(prototype / "real-styles", target_is_directory=True)
    assert request(app.lobby_origin, "/styles/content-demo.css")[0] == 404
    wrapper = prototype / "empire-player.html"
    wrapper.unlink()
    os.mkfifo(wrapper)
    assert request(app.game_origins[0], "/__vault/player.html")[0] == 404


def test_no_parent_directory_symlink_escape(fixture_files, tmp_path):
    archive, prototype, _ = fixture_files
    alias = tmp_path / "alias"
    alias.symlink_to(prototype, target_is_directory=True)
    with EmpireCatalogueServer(archive, synthetic_fixture=True, prototype_root=alias, lobby_port=0,
                                game_ports=[0] * 20) as app:
        assert request(app.lobby_origin)[0] == 404
    archive_alias = tmp_path / "alias.zip"
    archive_alias.symlink_to(archive)
    with pytest.raises(OSError):
        EmpireCatalogueServer(archive_alias, synthetic_fixture=True)


@pytest.mark.parametrize("kind", ["missing-early", "duplicate", "symlink", "traversal"])
def test_invalid_manifest_or_unsafe_archive_fails_before_start(tmp_path, kind):
    archive = tmp_path / "bad.zip"
    first = EXPECTED_EARLY[0][1]
    extra = []
    omit = None
    if kind == "missing-early":
        omit = first
    elif kind == "duplicate":
        extra = [(ARCHIVE_PREFIX + first, b"duplicate")]
    elif kind == "symlink":
        info = ZipInfo(ARCHIVE_PREFIX + "assets/symlink")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        extra = [(info, b"../../private")]
    else:
        extra = [(ARCHIVE_PREFIX + "assets/../private", b"private")]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        make_zip(archive, omit=omit, extra=extra)
    with pytest.raises(ValueError):
        EmpireCatalogueServer(archive, synthetic_fixture=True, lobby_port=0, game_ports=[0] * 20)


def test_wrong_release_pin_fails_and_correct_pin_works(fixture_files):
    archive, _, _ = fixture_files
    with pytest.raises(ValueError, match="pin mismatch"):
        new_app(fixture_files, expected_archive_sha256="0" * 64)
    with new_app(fixture_files, expected_archive_sha256=hashlib.sha256(archive.read_bytes()).hexdigest()):
        pass


@pytest.mark.parametrize("mutation", ["replace", "in-place", "remove"])
def test_runtime_archive_change_fails_closed_including_config(fixture_files, mutation, tmp_path):
    archive, _, _ = fixture_files
    with new_app(fixture_files) as app:
        if mutation == "replace":
            replacement = tmp_path / "replacement.zip"
            make_zip(replacement)
            replacement.replace(archive)
        elif mutation == "in-place":
            with archive.open("ab") as target:
                target.write(b"changed")
        else:
            archive.unlink()
        for origin, path in ((app.lobby_origin, "/__vault/config.json"),
                             (app.game_origins[0], "/__vault/config.json"),
                             (app.game_origins[0], "/assets/late.bin")):
            status, headers, payload = request(origin, path)
            assert status == 503
            assert headers["Cache-Control"] == "no-store"
            assert payload == b"Archive release unavailable\n"


def test_stats_aggregate_exact_body_bytes_statuses_and_early_indexes(app, fixture_files):
    _, _, entries = fixture_files
    for index, (_, relative) in enumerate(EXPECTED_EARLY):
        assert request(app.game_origins[0], "/" + relative)[0] == 200
    request(app.game_origins[0], "/assets/missing.bin?token=secret",
            headers={"Authorization": "Bearer secret", "Cookie": "player=private"})
    request(app.game_origins[1], "/assets/late.bin")
    status, headers, payload = request(app.game_origins[1], "/assets/late.bin", method="HEAD")
    assert status == 200 and payload == b""
    assert int(headers["Content-Length"]) == len(entries["assets/late.bin"])
    result = settled_stats(app)
    assert set(result) == {"label", "activeProviderResponses", "peakProviderResponses", "instances"}
    assert result["label"] == "MEASURED"
    assert result["peakProviderResponses"] >= 1
    assert len(result["instances"]) == 20
    first = result["instances"][0]
    assert first == {
        "requests": 9, "bodyBytes": sum(len(entries[path]) for _, path in EXPECTED_EARLY) + 10,
        "statuses": {"200": 8, "404": 1}, "earlyRequests": [1] * 8,
        "earlyBodyBytes": [len(entries[path]) for _, path in EXPECTED_EARLY],
    }
    assert result["instances"][1] == {
        "requests": 2, "bodyBytes": len(entries["assets/late.bin"]), "statuses": {"200": 2},
        "earlyRequests": [0] * 8, "earlyBodyBytes": [0] * 8,
    }
    assert all(item["requests"] == 0 for item in result["instances"][2:])
    serialized = json.dumps(result)
    for secret in ("http", "assets/", "secret", "Bearer", "Authorization", "Cookie", "private"):
        assert secret not in serialized


def test_partial_write_failure_charges_only_successful_socket_sends():
    stats = module._Stats()
    stats.begin(0, 3)
    stats.status(0, 200)

    class ShortSocket:
        def __init__(self):
            self.calls = 0
            self.received = bytearray()

        def send(self, view):
            self.calls += 1
            if self.calls == 3:
                raise BrokenPipeError("sensitive peer details must not escape")
            count = min(7, len(view))
            self.received.extend(view[:count])
            return count

    connection = ShortSocket()
    module._send_body(connection, b"x" * 1000, lambda n: stats.written(0, 3, n))
    stats.end()
    result = stats.snapshot()
    assert result["instances"][0]["bodyBytes"] == 14
    assert result["instances"][0]["earlyBodyBytes"][3] == 14
    assert bytes(connection.received) == b"x" * 14
    assert result["activeProviderResponses"] == 0


def test_zero_write_stops_without_charging():
    class ClosedSocket:
        def send(self, _view):
            return 0
    counts = []
    module._send_body(ClosedSocket(), b"some bytes", counts.append)
    assert counts == []


def test_overlapping_provider_responses_track_peak(app, monkeypatch):
    original = app.archive.read
    arrived = threading.Barrier(3)
    release = threading.Event()

    def controlled_read(relative):
        arrived.wait(timeout=3)
        assert release.wait(timeout=3)
        return original(relative)

    monkeypatch.setattr(app.archive, "read", controlled_read)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(request, origin, "/assets/late.bin")
                   for origin in app.game_origins[:2]]
        try:
            arrived.wait(timeout=3)
            stats = get_json(app.lobby_origin, "/__vault/stats.json")
            assert stats["activeProviderResponses"] == 2
            assert stats["peakProviderResponses"] == 2
        finally:
            release.set()
        assert all(future.result()[0] == 200 for future in futures)
    assert settled_stats(app)["peakProviderResponses"] == 2


def test_atomic_startup_failure_releases_all_previous_binds(fixture_files, monkeypatch):
    sockets = [socket.socket() for _ in range(2)]
    try:
        for held in sockets:
            held.bind(("127.0.0.1", 0))
        first_port = sockets[0].getsockname()[1]
        occupied = sockets[1].getsockname()[1]
        sockets[1].listen()
        sockets[0].close()
        archive, prototype, _ = fixture_files
        app = EmpireCatalogueServer(archive, synthetic_fixture=True, prototype_root=prototype, lobby_port=first_port,
                                     game_ports=[0] * 19 + [occupied])
        activations = []
        monkeypatch.setattr(module._HTTPServer, "server_activate", lambda _self: activations.append(1))
        with pytest.raises(OSError):
            app.start()
        assert activations == []
        assert app.closed and app.archive.file.closed
        assert all(server.socket.fileno() == -1 for server in app.servers)
        assert app.threads == []
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", first_port))
    finally:
        for held in sockets:
            held.close()


def test_activation_failure_also_rolls_back_without_threads(fixture_files, monkeypatch):
    app = new_app(fixture_files)
    calls = 0
    original = module._HTTPServer.server_activate

    def activate(server):
        nonlocal calls
        calls += 1
        if calls == 7:
            raise OSError("synthetic activation failure")
        original(server)

    monkeypatch.setattr(module._HTTPServer, "server_activate", activate)
    with pytest.raises(OSError):
        app.start()
    assert app.threads == []
    assert all(server.socket.fileno() == -1 for server in app.servers)
    assert app.archive.file.closed


def test_clean_shutdown_interrupts_idle_clients_and_restarts_same_identities(fixture_files):
    app = new_app(fixture_files).start()
    old_config = get_json(app.lobby_origin, "/__vault/config.json")
    ports = [server.server_port for server in app.servers]
    idle = socket.create_connection(("127.0.0.1", ports[1]), timeout=3)
    try:
        idle.sendall(b"GET / HTTP/1.1\r\n")
        deadline = time.monotonic() + 2
        while not app.servers[1].connections and time.monotonic() < deadline:
            time.sleep(0.005)
        assert app.servers[1].connections
        started = time.monotonic()
        app.close()
        assert time.monotonic() - started < 3
        app.close()  # idempotent
        assert all(not thread.is_alive() for thread in app.threads)
        assert all(not server.connections for server in app.servers)
        assert app.archive.file.closed
        with pytest.raises(RuntimeError):
            app.start()
        archive, prototype, _ = fixture_files
        with EmpireCatalogueServer(archive, synthetic_fixture=True, prototype_root=prototype, lobby_port=ports[0],
                                     game_ports=ports[1:]) as restarted:
            assert get_json(restarted.lobby_origin, "/__vault/config.json") == old_config
            assert settled_stats(restarted)["peakProviderResponses"] == 0
    finally:
        idle.close()
        app.close()


@pytest.mark.parametrize("kwargs", [
    {"game_ports": [1] * 20}, {"game_ports": [0] * 19}, {"game_ports": [0] * 21},
    {"game_ports": [0] * 19 + [-1]}, {"game_ports": [0] * 19 + [65536]},
    {"game_ports": [0] * 19 + [True]}, {"lobby_port": 8101},
    {"cache_policy": "invalid"}, {"expected_archive_sha256": "invalid"},
])
def test_invalid_port_policy_or_pin_configuration(fixture_files, kwargs):
    with pytest.raises(ValueError):
        EmpireCatalogueServer(fixture_files[0], synthetic_fixture=True, **kwargs)



def test_audited_sized_synthetic_eight_asset_budget(tmp_path):
    # Sizes are STATICALLY-INFERRED from the prior read-only package audit.
    # Synthetic bytes test the contract; this is not a new provider measurement.
    sizes = (3997, 14865, 210380, 10611, 168128, 87600, 1633, 26726)
    archive = tmp_path / "audited-sized-synthetic.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as source:
        source.writestr(ARCHIVE_PREFIX + "index.html", b"synthetic provider document")
        for (_, relative), size in zip(EXPECTED_EARLY, sizes, strict=True):
            source.writestr(ARCHIVE_PREFIX + relative, b"x" * size)
    with EmpireCatalogueServer(archive, synthetic_fixture=True, lobby_port=0, game_ports=[0] * 20) as app:
        config = get_json(app.lobby_origin, "/__vault/config.json")
        assert len(config["entries"]) == 20
        for entry in config["entries"]:
            assert len(entry["assets"]) == 8
            assert [item["estimatedBytes"] for item in entry["assets"]] == list(sizes)
            assert sum(item["estimatedBytes"] for item in entry["assets"]) == 523940
            assert {item["stage"] for item in entry["assets"]} == {"PRELOADER", "COMMON"}
        assert 3 * 523940 == 1571820 < config["byteBudget"]  # Top-three raw-body cost.
        assert config["locale"] == "en" and config["tier"] == "1x"


def test_missing_splash_is_not_required_by_conservative_manifest(tmp_path):
    archive = tmp_path / "no-splash.zip"
    make_zip(archive, omit="assets/images/@1x/splashBG.jpg")
    with EmpireCatalogueServer(archive, synthetic_fixture=True, lobby_port=0, game_ports=[0] * 20) as app:
        assert len(app.config()["entries"][0]["assets"]) == 8
        assert request(app.game_origins[0], "/assets/images/@1x/splashBG.jpg")[0] == 404
        assert not any(settled_stats(app)["instances"][0]["earlyRequests"])


def test_missing_document_and_special_archive_files_fail_closed(tmp_path):
    archive = tmp_path / "invalid.zip"
    make_zip(archive, omit="index.html")
    with pytest.raises(ValueError, match="entry document"):
        EmpireCatalogueServer(archive, synthetic_fixture=True)
    info = ZipInfo(ARCHIVE_PREFIX + "assets/pipe")
    info.create_system = 3
    info.external_attr = (stat.S_IFIFO | 0o600) << 16
    make_zip(archive, extra=[(info, b"not regular")])
    with pytest.raises(ValueError, match="Nonregular"):
        EmpireCatalogueServer(archive, synthetic_fixture=True)


def test_manifest_budget_and_member_size_limits_fail_before_bind(fixture_files, monkeypatch):
    def forbidden_read(*_args):
        pytest.fail("Over-budget archives must be rejected before decompression")
    monkeypatch.setattr(module._Archive, "read", forbidden_read)
    monkeypatch.setattr(module, "BYTE_BUDGET", 1)
    with pytest.raises(ValueError, match="byte budget"):
        new_app(fixture_files)
    monkeypatch.setattr(module, "BYTE_BUDGET", BYTE_BUDGET)
    monkeypatch.setattr(module, "MAX_MEMBER_BYTES", 1)
    with pytest.raises(ValueError, match="Unsupported archive member"):
        new_app(fixture_files)


@pytest.mark.parametrize("headers", [
    {"Origin": "https://untrusted.invalid"}, {"Origin": "null"},
    {"Origin": "http://127.0.0.1:1"}, {"Sec-Fetch-Site": "cross-site"},
    {"Sec-Fetch-Site": "invalid"},
])
def test_foreign_browser_requests_rejected_without_content_or_counters(app, headers):
    for origin, path in ((app.lobby_origin, "/__vault/config.json"),
                         (app.lobby_origin, "/__vault/stats.json"),
                         (app.game_origins[0], "/"),
                         (app.game_origins[0], "/" + EXPECTED_EARLY[0][1])):
        status, response_headers, body = request(origin, path, headers=headers)
        assert status == 403 and body == b"Request rejected\n"
        assert response_headers["Cache-Control"] == "no-store"
        assert "Access-Control-Allow-Origin" not in response_headers
    assert all(item["requests"] == 0 for item in settled_stats(app)["instances"])


def test_duplicate_browser_security_headers_rejected(app):
    for origin in (app.lobby_origin, app.game_origins[0]):
        host = origin.removeprefix("http://")
        for headers in (f"Origin: {origin}\r\nOrigin: {origin}\r\n",
                        "Sec-Fetch-Site: same-site\r\nSec-Fetch-Site: same-site\r\n"):
            response = raw_request(origin, (
                f"GET / HTTP/1.1\r\nHost: {host}\r\n{headers}\r\n").encode())
            assert response.startswith(b"HTTP/1.1 403")
            assert b"Cache-Control: no-store" in response


def test_valid_browser_origins_and_metadata_across_all_20_listeners(app, fixture_files):
    _, _, entries = fixture_files
    for origin in app.game_origins:
        for source in (app.lobby_origin, origin):
            status, headers, payload = request(origin, "/assets/late.bin", headers={
                "Origin": source, "Sec-Fetch-Site": "same-site"})
            assert status == 200 and payload == entries["assets/late.bin"]
            assert headers["Access-Control-Allow-Origin"] == app.lobby_origin
            assert headers["Cache-Control"] == "public, max-age=3600"
        assert request(origin, "/", headers={"Sec-Fetch-Site": "none"})[0] == 200
        assert request(origin, "/", headers={"Host": "0.0.0.0:" + str(urlsplit(origin).port)})[0] == 421
    # One provider origin is not allowed to make CORS requests to another provider.
    assert request(app.game_origins[0], "/assets/late.bin",
                   headers={"Origin": app.game_origins[1]})[0] == 403
    assert request(app.lobby_origin, "/__vault/config.json",
                   headers={"Origin": app.game_origins[0]})[0] == 403


def test_early_counters_require_exact_manifest_target_not_query_or_encoded_alias(app, fixture_files):
    _, _, entries = fixture_files
    relative = "assets/images/@1x/brandLogo.png"
    index = [path for _, path in EXPECTED_EARLY].index(relative)
    variants = ("/" + relative + "?v=other", "/" + relative + "?",
                "/" + relative.replace("@", "%40"), "/" + relative.replace("/", "%2f", 1))
    for path in variants:
        status, headers, body = request(app.game_origins[0], path)
        assert status == 200 and body == entries[relative]
        assert "Location" not in headers  # Browser cache identities stay untouched.
    first = settled_stats(app)["instances"][0]
    assert first["requests"] == 4 and first["bodyBytes"] == 4 * len(entries[relative])
    assert first["earlyRequests"] == [0] * 8
    assert first["earlyBodyBytes"] == [0] * 8
    request(app.game_origins[0], "/" + relative)
    request(app.game_origins[0], "/" + relative, method="HEAD")
    first = settled_stats(app)["instances"][0]
    assert first["requests"] == 6 and first["bodyBytes"] == 5 * len(entries[relative])
    assert first["earlyRequests"][index] == 2
    assert first["earlyBodyBytes"][index] == len(entries[relative])
    assert sum(first["earlyRequests"]) == 2


def test_range_headers_do_not_create_partial_or_compressed_representations(app, fixture_files):
    _, _, entries = fixture_files
    relative = EXPECTED_EARLY[0][1]
    status, headers, body = request(app.game_origins[0], "/" + relative, headers={
        "Range": "bytes=0-1", "If-None-Match": "not-a-validator", "Accept-Encoding": "gzip, br"})
    assert status == 200 and body == entries[relative]
    assert int(headers["Content-Length"]) == len(body)
    assert "Content-Range" not in headers and "Content-Encoding" not in headers
    assert settled_stats(app)["instances"][0]["earlyBodyBytes"][0] == len(body)


def test_short_archive_read_permanently_invalidates_release(app, monkeypatch):
    monkeypatch.setattr(app.archive.zip, "read", lambda _entry: b"short")
    relative = EXPECTED_EARLY[0][1]
    status, headers, body = request(app.game_origins[0], "/" + relative)
    assert status == 503 and body == b"Archive release unavailable\n"
    assert headers["Cache-Control"] == "no-store"
    assert app.archive.failed
    assert request(app.lobby_origin, "/__vault/config.json")[0] == 503
    result = settled_stats(app)["instances"][0]
    assert result["earlyRequests"][0] == 1
    assert result["earlyBodyBytes"][0] == len(body)  # Error bodies are not cache hits.
    assert result["statuses"] == {"503": 1}


@pytest.mark.parametrize("error", [module.zlib.error, NotImplementedError])
def test_corrupt_or_unsupported_member_read_fails_closed_without_private_details(app, monkeypatch, capsys, error):
    def broken_read(_entry):
        raise error("SECRET-private-archive-details")
    monkeypatch.setattr(app.archive.zip, "read", broken_read)
    status, headers, body = request(app.game_origins[0], "/assets/late.bin")
    assert status == 503 and body == b"Archive release unavailable\n"
    assert headers["Cache-Control"] == "no-store"
    assert request(app.lobby_origin, "/__vault/config.json")[0] == 503
    with pytest.raises(module.ArchiveUnavailable):
        app.config()
    result = settled_stats(app)["instances"][0]
    assert result["statuses"] == {"503": 1}
    assert result["bodyBytes"] == len(body)
    captured = capsys.readouterr()
    assert captured.out == captured.err == ""


# Confinement tests below never inspect the host or contact port 8121. Kernel
# observations, the probe, archive access and fixed-port listeners are injected.
ROUTE_HEADER = 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n'
LO_ROUTE = 'lo 0000007F 00000000 0001 0 0 0 000000FF 0 0 0\n'
V6_HOST = ' '.join(('0' * 31 + '1', '80', '0' * 32, '00', '0' * 32,
                    '00000000', '00000000', '00000000', '80200001', 'lo')) + '\n'
V6_REJECT = ' '.join(('0' * 32, '00', '0' * 32, '00', '0' * 32,
                      'ffffffff', '00000001', '00000000', '00200200', 'lo')) + '\n'
CAP_STATUS = ''.join(f'{name}:\t0000000000000000\n'
                     for name in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'))


def confined_snapshot(**changes):
    return replace(module.ConfinementSnapshot(
        platform='linux', uids=(1000, 1000, 1000), namespace='net:[4026533000]',
        reference_namespace='net:[4026531992]', interfaces=('lo',),
        status='Name:\tsynthetic\n' + CAP_STATUS,
        ipv4_routes=ROUTE_HEADER, ipv6_routes=V6_HOST + V6_REJECT), **changes)


def forbidden_io(*_args, **_kwargs):
    pytest.fail('Forbidden host/provider I/O or listener creation')


@pytest.mark.parametrize('routes', ['', LO_ROUTE])
@pytest.mark.parametrize('v6', ['', V6_HOST, V6_REJECT, V6_HOST + V6_REJECT])
def test_validate_confinement_accepts_only_synthetic_safe_kernel_shapes(routes, v6):
    assert module.validate_confinement(confined_snapshot(
        ipv4_routes=ROUTE_HEADER + routes, ipv6_routes=v6)) is None


@pytest.mark.parametrize('changes', [
    {'platform': 'darwin'}, {'platform': 'linux2'},
    {'uids': (0, 1000, 1000)}, {'uids': (1000, 0, 1000)}, {'uids': (1000, 1000, 0)},
    {'uids': (-1, 1000, 1000)}, {'uids': (True, 1000, 1000)},
    {'uids': ('1000', 1000, 1000)}, {'uids': (1000, 1000)}, {'uids': None},
    {'namespace': 'net:[4026531992]'}, {'namespace': 'net:[0]'},
    {'namespace': 'net:[-1]'}, {'namespace': 'net:[123]\n'}, {'namespace': None},
    {'reference_namespace': ''}, {'reference_namespace': 'mnt:[123]'},
    {'interfaces': ()}, {'interfaces': ('lo', 'eth0')}, {'interfaces': ('eth0',)},
    {'interfaces': ('lo', 'lo')}, {'status': ''}, {'status': None},
    {'ipv4_routes': ''}, {'ipv4_routes': 'not a route header\n'},
    {'ipv4_routes': ROUTE_HEADER + '\n'}, {'ipv6_routes': '\n'},
    {'ipv6_routes': None},
])
def test_validate_confinement_rejects_missing_malformed_or_unisolated_observations(changes):
    with pytest.raises(module.ConfinementError, match='^Unverified Linux network confinement$'):
        module.validate_confinement(confined_snapshot(**changes))


@pytest.mark.parametrize('cap', ['CapInh', 'CapPrm', 'CapEff', 'CapAmb'])
@pytest.mark.parametrize('value', ['0000000000000001', 'ffffffffffffffff', '-000000000000001',
                                   '0', 'g' * 16, '0' * 17, '0' * 8 + '_' + '0' * 7])
def test_validate_confinement_rejects_privilege_or_malformed_capabilities(cap, value):
    status = CAP_STATUS.replace(f'{cap}:\t' + '0' * 16, f'{cap}:\t{value}')
    with pytest.raises(module.ConfinementError):
        module.validate_confinement(confined_snapshot(status=status))


@pytest.mark.parametrize('cap', ['CapInh', 'CapPrm', 'CapEff', 'CapAmb'])
def test_validate_confinement_rejects_missing_and_duplicate_capabilities(cap):
    for status in (CAP_STATUS.replace(f'{cap}:\t' + '0' * 16 + '\n', ''),
                   f'{cap}:\t0000000000000001\n' + CAP_STATUS,
                   CAP_STATUS + f'{cap}:\t0000000000000000\n'):
        with pytest.raises(module.ConfinementError):
            module.validate_confinement(confined_snapshot(status=status))


@pytest.mark.parametrize('index,value', [
    (0, 'eth0'), (1, '00000000'), (1, '0100000A'), (1, '-0000081'),
    (1, '10000007F'), (1, '0x00007F'), (1, '0000_07F'), (2, '0100007F'),
    (3, 'xxxx'), (3, '-001'), (4, '-1'), (5, 'garbage'), (6, '0x0'),
    (7, '00000000'), (7, '0000007F'), (7, '000001FF'), (7, '1000000FF'),
    (8, '-1'), (9, 'oops'), (10, '-1'),
])
def test_validate_confinement_rejects_external_or_malformed_ipv4_routes(index, value):
    parts = LO_ROUTE.split()
    parts[index] = value
    with pytest.raises(module.ConfinementError):
        module.validate_confinement(confined_snapshot(
            ipv4_routes=ROUTE_HEADER + ' '.join(parts) + '\n'))


@pytest.mark.parametrize('index,value', [
    (0, '2' + '0' * 31), (0, '1'), (0, '-' + '0' * 30 + '1'), (1, '81'),
    (1, '080'), (2, '0' * 31 + '1'), (3, '01'), (4, '0' * 31 + '1'),
    (5, '-0000001'), (6, '0x000000'), (7, '0000_000'), (8, '100000001'), (9, 'eth0'),
])
def test_validate_confinement_rejects_external_or_malformed_ipv6_routes(index, value):
    parts = V6_HOST.split()
    parts[index] = value
    with pytest.raises(module.ConfinementError):
        module.validate_confinement(confined_snapshot(ipv6_routes=' '.join(parts)))


def test_validate_confinement_rejects_usable_ipv6_default_and_extra_columns():
    for v6 in (V6_REJECT.replace('00200200', '00000001'), V6_HOST + 'extra',
               ' '.join(V6_HOST.split()[:-1])):
        with pytest.raises(module.ConfinementError):
            module.validate_confinement(confined_snapshot(ipv6_routes=v6))
    for route in (LO_ROUTE + 'extra', ' '.join(LO_ROUTE.split()[:-1])):
        with pytest.raises(module.ConfinementError):
            module.validate_confinement(confined_snapshot(ipv4_routes=ROUTE_HEADER + route))


def mock_procfs(monkeypatch):
    snapshot = confined_snapshot()
    reads = []
    files = {'/proc/self/status': snapshot.status,
             '/proc/self/net/route': snapshot.ipv4_routes,
             '/proc/self/net/ipv6_route': snapshot.ipv6_routes}
    links = {'/proc/self/ns/net': snapshot.namespace,
             '/proc/1/ns/net': snapshot.reference_namespace}

    def read_text(path, *_args, **_kwargs):
        reads.append(str(path))
        return files[str(path)]

    def readlink(path):
        reads.append(path)
        value = links[path]
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(module.sys, 'platform', 'linux')
    monkeypatch.setattr(module.os, 'getresuid', lambda: snapshot.uids)
    monkeypatch.setattr(module.os, 'getpid', lambda: 200)
    monkeypatch.setattr(module.os, 'readlink', readlink)
    monkeypatch.setattr(Path, 'read_text', read_text)
    monkeypatch.setattr(module.socket, 'if_nameindex', lambda: [(1, 'lo')])
    return snapshot, files, links, reads


def test_inspect_confinement_reads_process_procfs_not_environment_or_sysfs(monkeypatch):
    snapshot, _, _, reads = mock_procfs(monkeypatch)
    monkeypatch.setenv('EMPIRE_NETWORK_ISOLATED', '1')
    monkeypatch.setattr(module.socket, 'socket', forbidden_io)
    assert module.inspect_confinement() == snapshot
    assert set(reads) == {'/proc/self/ns/net', '/proc/1/ns/net', '/proc/self/status',
                          '/proc/self/net/route', '/proc/self/net/ipv6_route'}


def test_inspect_confinement_non_linux_refuses_without_any_observations(monkeypatch):
    monkeypatch.setattr(module.sys, 'platform', 'win32')
    monkeypatch.setattr(module.os, 'readlink', forbidden_io)
    monkeypatch.setattr(Path, 'read_text', forbidden_io)
    with pytest.raises(module.ConfinementError, match='Linux network confinement required'):
        module.inspect_confinement()


@pytest.mark.parametrize('inaccessible', [PermissionError('PRIVATE'), ''])
def test_inspect_confinement_ancestor_fallback_for_inaccessible_pid_one(monkeypatch, inaccessible):
    snapshot, files, links, _ = mock_procfs(monkeypatch)
    links.update({'/proc/1/ns/net': inaccessible,
                  '/proc/200/ns/net': snapshot.namespace,
                  '/proc/199/ns/net': snapshot.namespace,
                  '/proc/198/ns/net': snapshot.reference_namespace})
    files.update({'/proc/200/status': 'PPid:\t199\n', '/proc/199/status': 'PPid:\t198\n'})
    assert module.inspect_confinement() == snapshot


@pytest.mark.parametrize('parent', ['0', '200', '-1', 'not-a-pid', '198\nPPid: 0'])
def test_inspect_confinement_no_ancestor_or_malformed_parent_fails_sanitized(monkeypatch, parent):
    snapshot, files, links, _ = mock_procfs(monkeypatch)
    links.update({'/proc/1/ns/net': snapshot.namespace,
                  '/proc/200/ns/net': snapshot.namespace})
    files['/proc/200/status'] = 'PPid:\t' + parent
    with pytest.raises(module.ConfinementError):
        module.inspect_confinement()


@pytest.mark.parametrize('error', [PermissionError, FileNotFoundError, ValueError, UnicodeError])
def test_inspect_confinement_unreadable_procfs_fails_sanitized(monkeypatch, error):
    mock_procfs(monkeypatch)

    def broken(*_args, **_kwargs):
        raise error('SECRET-host-detail')

    monkeypatch.setattr(Path, 'read_text', broken)
    with pytest.raises(module.ConfinementError) as caught:
        module.inspect_confinement()
    assert 'SECRET' not in str(caught.value)


@pytest.mark.parametrize('outcome', [errno.EAGAIN, errno.ETIMEDOUT, errno.EACCES, errno.EPERM])
def test_require_confinement_checks_snapshot_then_denied_probe(monkeypatch, outcome):
    events = []
    monkeypatch.setattr(module, 'inspect_confinement', forbidden_io)
    monkeypatch.setattr(module, 'probe_denied_loopback_port', forbidden_io)

    def inspect():
        events.append('inspect')
        return confined_snapshot()

    def probe():
        events.append('probe')
        return outcome

    assert module.require_confinement(inspect=inspect, probe=probe) is None
    assert events == ['inspect', 'probe']


@pytest.mark.parametrize('outcome', [0, errno.ECONNREFUSED, errno.ENETUNREACH, errno.EHOSTUNREACH,
                                   errno.EINPROGRESS, None, True, False, '110', 110.0, -1])
def test_require_confinement_closed_or_unverified_port_is_not_firewall_evidence(outcome):
    with pytest.raises(module.ConfinementError, match='not denied'):
        module.require_confinement(inspect=confined_snapshot, probe=lambda: outcome)


def test_require_confinement_invalid_snapshot_never_probes():
    with pytest.raises(module.ConfinementError):
        module.require_confinement(inspect=lambda: confined_snapshot(interfaces=('eth0',)),
                                   probe=forbidden_io)


@pytest.mark.parametrize('step', ['inspect', 'probe'])
@pytest.mark.parametrize('error', [OSError, ValueError, KeyError, TypeError])
def test_require_confinement_observation_failure_is_sanitized(step, error):
    def broken():
        raise error('SECRET-host-detail')

    with pytest.raises(module.ConfinementError) as caught:
        module.require_confinement(inspect=broken if step == 'inspect' else confined_snapshot,
                                   probe=broken if step == 'probe' else forbidden_io)
    assert 'SECRET' not in str(caught.value)


@pytest.mark.parametrize('outcome', [errno.ECONNREFUSED, errno.EACCES, TimeoutError])
def test_denied_probe_uses_only_bounded_numeric_loopback_socket(monkeypatch, outcome):
    events = []

    class Probe:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            events.append('closed')

        def settimeout(self, seconds):
            assert seconds == 0.25

        def connect_ex(self, address):
            assert address == ('127.0.0.1', 8121)
            if outcome is TimeoutError:
                raise TimeoutError
            return outcome

    def socket_factory(family, kind):
        assert (family, kind) == (socket.AF_INET, socket.SOCK_STREAM)
        return Probe()

    monkeypatch.setattr(module.socket, 'socket', socket_factory)
    monkeypatch.setattr(module.socket, 'getaddrinfo', forbidden_io)
    result = module.probe_denied_loopback_port()
    assert result == (errno.ETIMEDOUT if outcome is TimeoutError else outcome)
    assert events == ['closed']


@pytest.mark.parametrize('kwargs', [
    {}, {'expected_archive_sha256': '0' * 64},
    {'lobby_port': 0}, {'game_ports': [0] * 20},
    {'game_ports': list(range(8102, 8122))},
    {'game_ports': list(reversed(range(8101, 8121)))},
    {'synthetic_fixture': 1}, {'synthetic_fixture': 'true'},
])
def test_default_constructor_requires_reviewed_pin_and_fixed_ports_before_io(monkeypatch, kwargs):
    monkeypatch.setattr(module, '_Archive', forbidden_io)
    monkeypatch.setattr(module, '_HTTPServer', forbidden_io)
    monkeypatch.setattr(module, 'require_confinement', forbidden_io)
    if 'expected_archive_sha256' not in kwargs and kwargs:
        kwargs = dict(expected_archive_sha256=module.REVIEWED_ARCHIVE_SHA256, **kwargs)
    with pytest.raises((module.ConfinementError, ValueError)):
        EmpireCatalogueServer('/nonexistent-synthetic-only.zip', **kwargs)


def test_default_constructor_uses_host_network_without_confinement_gate(monkeypatch):
    monkeypatch.setattr(module, 'require_confinement', forbidden_io)
    class ExpectedArchive(Exception):
        pass
    monkeypatch.setattr(module, '_Archive', lambda *_args, **_kwargs: (_ for _ in ()).throw(ExpectedArchive()))
    with pytest.raises(ExpectedArchive):
        EmpireCatalogueServer('/nonexistent-synthetic-only.zip',
                              expected_archive_sha256=module.REVIEWED_ARCHIVE_SHA256)

def guarded_app(monkeypatch, fixture_files):
    # Repin ONLY to freshly generated synthetic bytes; no provider file is read.
    digest = hashlib.sha256(fixture_files[0].read_bytes()).hexdigest()
    monkeypatch.setattr(module, 'REVIEWED_ARCHIVE_SHA256', digest)
    events = []
    monkeypatch.setattr(module, 'require_confinement', lambda: events.append('guard'))
    original = module._Archive

    def archive(*args, **kwargs):
        events.append('archive')
        return original(*args, **kwargs)

    monkeypatch.setattr(module, '_Archive', archive)
    monkeypatch.setattr(module, '_HTTPServer', forbidden_io)
    app = EmpireCatalogueServer(fixture_files[0], expected_archive_sha256=digest)
    assert events == ['archive']
    return app, events


def test_default_start_does_not_call_legacy_confinement_gate(monkeypatch, fixture_files):
    app, events = guarded_app(monkeypatch, fixture_files)
    monkeypatch.setattr(module, 'require_confinement', forbidden_io)
    with pytest.raises(BaseException):
        app.start()
    assert events == ['archive']
    assert app.closed and app.archive.file.closed

@pytest.mark.parametrize('mutation', ['ports', 'hash'])
def test_default_start_revalidates_release_and_mode_before_binding(monkeypatch, fixture_files, mutation):
    app, _ = guarded_app(monkeypatch, fixture_files)
    if mutation == 'ports':
        app.requested_ports = (0,) * 21
    elif mutation == 'hash':
        app.archive.sha256 = '0' * 64
    monkeypatch.setattr(module, 'require_confinement', forbidden_io)
    with pytest.raises(module.ConfinementError):
        app.start()
    assert app.closed and app.archive.file.closed
    assert app.servers == app.threads == []


def test_default_start_rechecks_archive_signature_before_binding(monkeypatch, fixture_files):
    app, _ = guarded_app(monkeypatch, fixture_files)
    fixture_files[0].unlink()
    with pytest.raises(module.ArchiveUnavailable):
        app.start()
    assert app.closed and app.archive.file.closed


def test_synthetic_fixture_has_no_provider_specific_confinement_exception(monkeypatch, fixture_files):
    digest = hashlib.sha256(fixture_files[0].read_bytes()).hexdigest()
    monkeypatch.setattr(module, 'REVIEWED_ARCHIVE_SHA256', digest)
    monkeypatch.setattr(module, 'require_confinement', forbidden_io)
    app = new_app(fixture_files)
    assert app.archive.sha256 == digest
    app.close()

@pytest.mark.parametrize('args', [
    [], ['--expected-archive-sha256', '0' * 64],
    ['--expected-archive-sha256', module.REVIEWED_ARCHIVE_SHA256, '--lobby-port', '0'],
    ['--expected-archive-sha256', module.REVIEWED_ARCHIVE_SHA256, '--game-base-port', '8102'],
    ['--expected-archive-sha256', module.REVIEWED_ARCHIVE_SHA256,
     '--game-ports', ','.join(['0'] * 20)],
    ['--expected-archive-sha256', module.REVIEWED_ARCHIVE_SHA256, '--synthetic-fixture'],
])
def test_cli_rejects_missing_pin_wrong_release_ports_and_fixture_flag_without_host_io(tmp_path, args):
    # These argument failures precede confinement inspection, so even the child
    # never reads procfs, accesses an archive or opens a socket.
    missing = tmp_path / 'nonexistent-synthetic-only.zip'
    result = subprocess.run([sys.executable, '-B', str(Path(module.__file__).resolve()),
                             '--zip', str(missing), *args], capture_output=True,
                            text=True, timeout=5, check=False)
    assert result.returncode in (1, 2)
    assert result.stdout == ''
    assert 'Traceback' not in result.stderr
    assert str(missing) not in result.stderr
    assert not missing.exists()


def test_cli_valid_arguments_use_host_network_and_report_archive_failure(monkeypatch, capsys):
    monkeypatch.setattr(module, 'require_confinement', forbidden_io)
    monkeypatch.setattr(module, '_Archive', lambda *_a, **_k: (_ for _ in ()).throw(module.ArchiveUnavailable()))
    assert module.main(['--zip', '/nonexistent-synthetic-only.zip',
                        '--expected-archive-sha256', module.REVIEWED_ARCHIVE_SHA256]) == 1
    captured = capsys.readouterr()
    assert captured.out == ''
    assert 'Sandbox startup failed' in captured.err
    assert 'nonexistent' not in captured.err


def test_cli_help_requires_neither_archive_nor_isolation(monkeypatch, capsys):
    monkeypatch.setattr(module, '_Archive', forbidden_io)
    monkeypatch.setattr(module, 'require_confinement', forbidden_io)
    with pytest.raises(SystemExit) as caught:
        module.main(['--help'])
    assert caught.value.code == 0
    assert '--expected-archive-sha256' in capsys.readouterr().out
