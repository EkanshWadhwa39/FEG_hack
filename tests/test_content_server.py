"""HTTP-only checks of ORIGINAL SIMULATED fixtures, never provider/browser data."""

import hashlib
import http.client
import json
import os
import selectors
import signal
import socket
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

import pytest

from tools.content_server import (
    ASSET_SIZES,
    BUILD,
    IMMUTABLE,
    LOCALES,
    NO_STORE,
    PROTOTYPE,
    TIERS,
    TITLE_IDS,
    fixture_manifest,
    serve,
    thumbnail_svg,
)


def request(server, path, method="GET", headers=None):
    """http.client deliberately preserves traversal and noncanonical targets."""
    port = server if isinstance(server, int) else server.server_port
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.headers, response.read()
    finally:
        connection.close()


def make_prototype(parent):
    root = parent / "prototype"
    root.mkdir()
    (root / "index.html").write_text('<script type="module" src="/src/main.js"></script>')
    (root / "src").mkdir()
    (root / "src/main.js").write_text('export const classification = "SIMULATED";')
    (root / "src/helper.mjs").write_text("export const value = 1;")
    (root / "style.css").write_text("body { color: black; }")
    (root / "config.json").write_text('{"classification":"SIMULATED"}')
    return root


@contextmanager
def running(root, **kwargs):
    server = serve(directory=root, port=0, **kwargs)
    try:
        assert server.server_address[0] == "127.0.0.1"
        assert server.server_port > 0
        yield server
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture(scope="module")
def host(tmp_path_factory):
    with running(make_prototype(tmp_path_factory.mktemp("content-http"))) as server:
        yield server


def assert_headers(headers, cache, content_type=None):
    assert headers.get_all("Cache-Control") == [cache]
    assert headers["Access-Control-Allow-Origin"] == "*"
    assert headers["Timing-Allow-Origin"] == "*"
    assert headers["X-Content-Classification"] == "SIMULATED"
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'none'" in headers["Content-Security-Policy"]
    for name in ("Set-Cookie", "Access-Control-Allow-Credentials", "Vary", "Content-Encoding"):
        assert headers.get(name) is None
    if content_type:
        assert headers["Content-Type"] == content_type


def assert_error(response, status):
    actual, headers, body = response
    assert actual == status
    assert_headers(headers, NO_STORE, "application/json")
    assert int(headers["Content-Length"]) == len(body)
    assert json.loads(body) == {
        "classification": "SIMULATED", "error": "request rejected", "status": status,
    }
    assert headers.get("Location") is None


@pytest.mark.parametrize("title", TITLE_IDS)
@pytest.mark.parametrize("locale", LOCALES)
@pytest.mark.parametrize("tier", TIERS)
def test_all_240_binary_fixtures_exact_urls_lengths_and_head(host, title, locale, tier):
    manifest = fixture_manifest(title, locale, tier)
    assert manifest["classification"] == "SIMULATED"
    assert manifest["id"] == title
    assert manifest["build"] == BUILD == "synthetic-v1"
    assert manifest["locale"] == locale
    assert manifest["tier"] == tier
    assert len(manifest["assets"]) == 3
    for asset in manifest["assets"]:
        url = f'/synthetic/{title}/{BUILD}/{locale}/{tier}/{asset["type"]}.bin?v=1'
        assert asset["url"] == url
        status, headers, body = request(host, url)
        assert status == 200
        assert_headers(headers, IMMUTABLE, "application/octet-stream")
        assert len(body) == int(headers["Content-Length"]) == asset["bytes"]
        assert len(body) == ASSET_SIZES[asset["type"]]
        expected = hashlib.shake_256(f"SIMULATED original fixture|{url}".encode())
        assert body == expected.digest(asset["bytes"])
        status, head_headers, head_body = request(host, url, "HEAD")
        assert status == 200
        assert head_body == b""
        assert head_headers["Content-Length"] == headers["Content-Length"]
        assert_headers(head_headers, IMMUTABLE, "application/octet-stream")


def test_twenty_unique_original_svg_thumbnails_and_head(host):
    thumbnails = set()
    for number, title in enumerate(TITLE_IDS, 1):
        url = fixture_manifest(title)["thumbnail"]
        assert url == f"/synthetic/{title}/{BUILD}/thumbnail.svg?v=1"
        status, headers, body = request(host, url)
        assert status == 200
        assert_headers(headers, IMMUTABLE, "image/svg+xml")
        assert len(body) == int(headers["Content-Length"])
        assert body == thumbnail_svg(title)
        svg = ET.fromstring(body)
        assert svg.tag == "{http://www.w3.org/2000/svg}svg"
        assert svg.find("{http://www.w3.org/2000/svg}title").text == f"SIMULATED title {number:02d}"
        assert all("href" not in key for element in svg.iter() for key in element.attrib)
        thumbnails.add(body)
        status, head_headers, head_body = request(host, url, "HEAD")
        assert status == 200 and head_body == b""
        assert head_headers["Content-Length"] == str(len(body))
        assert_headers(head_headers, IMMUTABLE, "image/svg+xml")
    assert len(thumbnails) == len(TITLE_IDS) == 20


@pytest.mark.parametrize("tail", [
    "", "?", "?v=0", "?v=2", "?v=01", "?v=1&v=1", "?v=1&token=secret",
    "?V=1", "?v=%31", "?v=1?", "?v=1&", "?v=1/",
])
def test_exact_version_query_required(host, tail):
    for suffix in ("thumbnail.svg", "hr-HR/1x/preloader.bin"):
        assert_error(request(host, f"/synthetic/title-01/{BUILD}/{suffix}{tail}"), 404)


@pytest.mark.parametrize("path", [
    "/synthetic/title-00/synthetic-v1/thumbnail.svg?v=1",
    "/synthetic/title-21/synthetic-v1/thumbnail.svg?v=1",
    "/synthetic/title-1/synthetic-v1/thumbnail.svg?v=1",
    "/synthetic/title-01/synthetic-v2/thumbnail.svg?v=1",
    "/synthetic/title-01/SYNTHETIC-v1/thumbnail.svg?v=1",
    "/synthetic/title-01/synthetic-v1/hr/1x/preloader.bin?v=1",
    "/synthetic/title-01/synthetic-v1/hr-HR/2x/preloader.bin?v=1",
    "/synthetic/title-01/synthetic-v1/hr-HR/1x/secondary.bin?v=1",
    "/synthetic/title-01/synthetic-v1/hr-HR/1x/preloader?v=1",
    "/synthetic/title-01/synthetic-v1/hr-HR/1x/preloader.bin.bin?v=1",
    "/synthetic/title-01/synthetic-v1/thumbnail.svg/?v=1",
    "/synthetic//title-01/synthetic-v1/thumbnail.svg?v=1",
])
def test_invalid_identity_build_variant_and_asset_are_not_cacheable(host, path):
    assert_error(request(host, path), 404)


def test_one_missing_thumbnail_does_not_disable_other_content(tmp_path):
    root = make_prototype(tmp_path)
    with running(root, missing_thumbnails=("title-03", "title-03")) as server:
        for title in TITLE_IDS:
            manifest = fixture_manifest(title)
            response = request(server, manifest["thumbnail"])
            if title == "title-03":
                assert_error(response, 404)
                status, headers, body = request(server, manifest["thumbnail"], "HEAD")
                assert status == 404 and body == b""
                assert_headers(headers, NO_STORE)
                assert int(headers["Content-Length"]) > 0
            else:
                assert response[0] == 200
            for locale in LOCALES:
                for tier in TIERS:
                    for asset in fixture_manifest(title, locale, tier)["assets"]:
                        status, _, body = request(server, asset["url"])
                        assert status == 200 and len(body) == asset["bytes"]
        _, headers, body = request(server, "/health")
        assert_headers(headers, NO_STORE)
        assert json.loads(body) == {
            "classification": "SIMULATED", "ready": True, "title_count": 20,
            "thumbnail_ready_count": 19, "missing_thumbnail_count": 1,
            "binary_fixture_count": 240,
        }
        metrics = json.loads(request(server, "/__metrics")[2])
        assert metrics["by_title"]["title-03"]["thumbnail"]["errors"] == 2
        assert metrics["errors"] == 2


@pytest.mark.parametrize("path", [
    "/../secret.json", "/src/../../secret.json", "/src/./main.js", "/.hidden.json",
    "/%2e%2e/secret.json", "/%252e%252e/secret.json", "/src%2fmain.js",
    "/src\\main.js", "/src/main.js#fragment", "/src/main.js?q=#fragment",
    "//index.html", "///src/main.js", "http://127.0.0.1/index.html",
])
def test_noncanonical_paths_rejected_without_normalizing(host, path):
    assert_error(request(host, path), 400)


@pytest.mark.parametrize("path", [
    "/src", "/src/", "/src//main.js", "/missing.js", "/unknown.html",
    "/image.png", "/capture.har", "/secret.csv", "/CODE.md",
    "/Devtools_games/capture.har", "/provider/index.html",
])
def test_no_listings_redirects_raw_data_or_missing_static(host, path):
    assert_error(request(host, path), 404)


@pytest.mark.parametrize("path,content_type", [
    ("/", "text/html; charset=utf-8"),
    ("/index.html", "text/html; charset=utf-8"),
    ("/src/main.js", "text/javascript; charset=utf-8"),
    ("/src/helper.mjs", "text/javascript; charset=utf-8"),
    ("/style.css", "text/css; charset=utf-8"),
    ("/config.json", "application/json; charset=utf-8"),
])
def test_prototype_sources_at_origin_root_are_no_store(host, path, content_type):
    status, headers, body = request(host, path)
    assert status == 200
    assert body
    assert len(body) == int(headers["Content-Length"])
    assert_headers(headers, NO_STORE, content_type)
    head_status, head_headers, head_body = request(host, path, "HEAD")
    assert head_status == 200 and head_body == b""
    assert head_headers["Content-Length"] == headers["Content-Length"]
    assert_headers(head_headers, NO_STORE, content_type)
    # Application mode queries are permitted on source files, never fixtures.
    assert request(host, path + "?mode=control")[2] == body


def test_static_confinement_refuses_file_directory_and_internal_symlinks(tmp_path):
    root = make_prototype(tmp_path)
    secret = tmp_path / "secret.json"
    secret.write_text('"not public"')
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "main.js").write_text("not public")
    (root / "leak.json").symlink_to(secret)
    (root / "linked").symlink_to(outside, target_is_directory=True)
    (root / "internal.js").symlink_to(root / "src/main.js")
    (root / "directory.json").mkdir()
    os.mkfifo(root / "pipe.json")
    with running(root) as server:
        for path in ("/leak.json", "/linked/main.js", "/internal.js",
                     "/directory.json", "/pipe.json", "/secret.json"):
            assert_error(request(server, path), 404)
        assert request(server, "/src/main.js")[0] == 200


def test_root_is_pinned_against_replacement_after_start(tmp_path):
    root = make_prototype(tmp_path)
    original = (root / "index.html").read_bytes()
    with running(root) as server:
        root.rename(tmp_path / "original")
        root.mkdir()
        (root / "index.html").write_text("outside replacement must not be served")
        assert request(server, "/")[2] == original


def test_source_root_validation_including_symlink_ancestors(tmp_path):
    root = make_prototype(tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    linked_parent = tmp_path / "linked-parent"
    linked_parent.symlink_to(tmp_path, target_is_directory=True)
    linked_root = other / "prototype"
    linked_root.symlink_to(root, target_is_directory=True)
    for invalid in (tmp_path, tmp_path / "absent/prototype", linked_root,
                    linked_parent / "prototype"):
        with pytest.raises(ValueError, match="prototype"):
            with running(invalid):
                pass
    with pytest.raises(ValueError, match="missing-thumbnail"):
        with running(root, missing_thumbnails=("title-21",)):
            pass


@pytest.mark.parametrize("args", [("title-21",), ("title-01", "fr"),
                                  ("title-01", "en", "2x")])
def test_manifest_rejects_unknown_inputs(args):
    with pytest.raises(ValueError):
        fixture_manifest(*args)
    with pytest.raises(ValueError):
        thumbnail_svg("title-21")


def test_no_store_and_redirect_forbidden_negative_controls(host):
    for _ in range(2):
        status, headers, body = request(host, "/__test/no-store")
        assert status == 200 and body == b"SIMULATED no-store fixture\n"
        assert_headers(headers, NO_STORE, "text/plain")
    status, headers, body = request(host, "/__test/redirect")
    assert status == 302 and body == b""
    assert headers["Content-Length"] == "0"
    assert headers["Location"] == "/forbidden"
    assert_headers(headers, NO_STORE)
    assert_error(request(host, headers["Location"]), 403)
    status, headers, body = request(host, "/__test/redirect", "HEAD")
    assert status == 302 and body == b""
    assert headers["Location"] == "/forbidden"
    assert_error(request(host, "/forbidden?token=do-not-retain"), 403)


def test_metrics_exact_totals_safe_aggregates_head_and_instance_isolation(tmp_path, capfd,
                                                                       monkeypatch):
    monkeypatch.setenv("SANDBOX_VERBOSE", "1")
    root = make_prototype(tmp_path)
    with running(root) as server:
        manifest = fixture_manifest("title-01")
        cases = [
            (manifest["assets"][0]["url"], "GET", "preloader", "title-01", 200),
            (manifest["assets"][0]["url"], "HEAD", "preloader", "title-01", 200),
            (manifest["thumbnail"], "GET", "thumbnail", "title-01", 200),
            ("/", "GET", "static", None, 200),
            ("/health", "GET", "health", None, 200),
            ("/health", "HEAD", "health", None, 200),
            ("/not-here.js?token=SECRET_QUERY", "GET", "rejected", None, 404),
            ("/not-here.js", "HEAD", "rejected", None, 404),
            ("/health", "POST", "rejected", None, 501),
            ("/forbidden", "GET", "rejected", None, 403),
            ("/../SECRET_PATH", "GET", "rejected", None, 400),
            ("/__test/no-store", "GET", "test_no_store", None, 200),
            ("/__test/redirect", "GET", "test_redirect", None, 302),
        ]
        expected = {"requests": 0, "body_bytes": 0, "errors": 0}
        expected_types = {}
        expected_titles = {}
        for path, method, kind, title, status in cases:
            actual, _, body = request(server, path, method, headers={
                "Cookie": "SECRET_COOKIE", "Authorization": "Bearer SECRET_AUTH",
            })
            assert actual == status
            buckets = [expected, expected_types.setdefault(kind, dict.fromkeys(expected, 0))]
            if title:
                buckets.append(expected_titles.setdefault(kind, dict.fromkeys(expected, 0)))
            for bucket in buckets:
                bucket["requests"] += 1
                bucket["body_bytes"] += len(body)
                bucket["errors"] += int(status >= 400)
        status, headers, body = request(server, "/__metrics")
        assert status == 200
        assert_headers(headers, NO_STORE)
        metrics = json.loads(body)
        assert metrics["classification"] == "MEASURED"
        assert metrics["content_classification"] == "SIMULATED"
        for key, value in expected.items():
            assert metrics[key] == value
        assert metrics["errors_by_status"] == {"400": 1, "403": 1, "404": 2, "501": 1}
        assert set(metrics["by_title"]) == set(TITLE_IDS)
        for kind, bucket in metrics["by_type"].items():
            assert bucket == expected_types.get(kind, dict.fromkeys(expected, 0))
        assert metrics["by_title"]["title-01"]["preloader"] == expected_titles["preloader"]
        assert metrics["by_title"]["title-01"]["thumbnail"] == expected_titles["thumbnail"]
        assert metrics["by_title"]["title-02"]["thumbnail"]["requests"] == 0
        assert b"SECRET" not in body
        for path, *_ in cases:
            if len(path) > 1:
                assert path.encode() not in body
        # GET metrics excludes itself; HEAD metrics counts one request, zero bytes.
        assert request(server, "/__metrics", "HEAD")[2] == b""
        after = json.loads(request(server, "/__metrics")[2])
        assert after["requests"] == expected["requests"] + 2
        assert after["body_bytes"] == expected["body_bytes"] + len(body)
        assert after["by_type"]["metrics"] == {
            "requests": 2, "body_bytes": len(body), "errors": 0,
        }
    with running(root) as fresh:
        clean = json.loads(request(fresh, "/__metrics")[2])
        assert clean["requests"] == clean["body_bytes"] == clean["errors"] == 0
    captured = capfd.readouterr()
    assert captured.out == captured.err == ""


def test_concurrent_requests_keep_exact_metrics(tmp_path):
    with running(make_prototype(tmp_path)) as server:
        urls = [fixture_manifest(title)["assets"][1]["url"] for title in TITLE_IDS] * 3
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda url: request(server, url), urls))
        assert all(response[0] == 200 for response in responses)
        metrics = json.loads(request(server, "/__metrics")[2])
        assert metrics["requests"] == len(urls)
        assert metrics["errors"] == 0
        assert metrics["body_bytes"] == sum(len(response[2]) for response in responses)
        for title in TITLE_IDS:
            assert metrics["by_title"][title]["common"] == {
                "requests": 3, "body_bytes": 3 * ASSET_SIZES["common"], "errors": 0,
            }


def test_public_relative_directory_api_uses_checkout_prototype(monkeypatch):
    monkeypatch.chdir(PROTOTYPE.parent)
    with running(Path("prototype")) as server:
        status, headers, body = request(server, "/")
        assert status == 200 and body == (PROTOTYPE / "index.html").read_bytes()
        assert_headers(headers, NO_STORE, "text/html; charset=utf-8")
        module = next((PROTOTYPE / "src").glob("*.js"))
        status, headers, body = request(server, "/" + module.relative_to(PROTOTYPE).as_posix())
        assert status == 200 and body == module.read_bytes()
        assert_headers(headers, NO_STORE, "text/javascript; charset=utf-8")


def test_cli_port_zero_emits_readiness_json_and_uses_checkout_root(tmp_path):
    script = PROTOTYPE.parent / "tools/content_server.py"
    process = subprocess.Popen(
        [sys.executable, str(script), "--port", "0", "--missing-thumbnail", "title-03"],
        cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            assert selector.select(timeout=5), "CLI did not emit readiness promptly"
            ready = json.loads(process.stdout.readline())
        assert ready == {
            "classification": "SIMULATED", "ready": True, "host": "127.0.0.1",
            "port": ready["port"], "origin": f'http://127.0.0.1:{ready["port"]}',
        }
        assert 0 < ready["port"] <= 65535
        assert request(ready["port"], "/")[2] == (PROTOTYPE / "index.html").read_bytes()
        assert_error(request(ready["port"], fixture_manifest("title-03")["thumbnail"]), 404)
        process.send_signal(signal.SIGINT)
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 0
        assert stdout == stderr == ""
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=5)


@pytest.mark.parametrize("args", [("--port", "-1"), ("--port", "65536"),
                                  ("--missing-thumbnail", "title-21")])
def test_cli_invalid_configuration_fails_before_ready(args, tmp_path):
    result = subprocess.run(
        [sys.executable, str(PROTOTYPE.parent / "tools/content_server.py"), *args],
        cwd=tmp_path, capture_output=True, text=True, timeout=5,
    )
    assert result.returncode == 2 and result.stdout == ""
    assert "error:" in result.stderr


@pytest.mark.parametrize("port", [-1, 65536, True, "0", None])
def test_python_api_rejects_invalid_port(tmp_path, port):
    root = make_prototype(tmp_path)
    with pytest.raises(ValueError, match="port"):
        serve(root, port=port)


def test_server_close_and_bind_failure_release_pinned_descriptors(tmp_path):
    root = make_prototype(tmp_path)
    with running(root) as server:
        descriptor = server._source_root
        assert os.fstat(descriptor)
        before = set(os.listdir("/proc/self/fd"))
        with pytest.raises(OSError):
            serve(root, port=server.server_port)
        assert set(os.listdir("/proc/self/fd")) == before
    assert server._source_root is None
    with pytest.raises(OSError):
        os.fstat(descriptor)
    server.server_close()  # Idempotent, never closes a reused descriptor.
    with pytest.raises(OSError, match="closed"):
        server.duplicate_source_root()


def test_child_directory_replaced_by_symlink_remains_confined(tmp_path):
    root = make_prototype(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "main.js").write_text("not public")
    with running(root) as server:
        assert request(server, "/src/main.js")[0] == 200
        (root / "src").rename(root / "original-src")
        (root / "src").symlink_to(outside, target_is_directory=True)
        assert_error(request(server, "/src/main.js"), 404)


@pytest.mark.parametrize("request_line,status", [
    (b"GET /SECRET_PATH HTTP/1.1 extra", 400),
    (b"GET /SECRET_PATH HTTP/2.0", 505),
    (b"GET /SECRET_PATH", 505),
    (b"GET /" + b"x" * 65536 + b" HTTP/1.1", 414),
    (b"OPTIONS /SECRET_PATH HTTP/1.1", 501),
    (b"GET //synthetic/title-01/synthetic-v1/thumbnail.svg?v=1 HTTP/1.1", 400),
])
def test_parser_and_method_errors_are_no_store_redacted(host, request_line, status, capfd):
    with socket.create_connection(("127.0.0.1", host.server_port), timeout=5) as connection:
        connection.sendall(request_line + b"\r\nHost: localhost\r\n\r\n")
        response = http.client.HTTPResponse(connection)
        response.begin()
        assert_error((response.status, response.headers, response.read()), status)
    assert request(host, "/health")[0] == 200
    captured = capfd.readouterr()
    assert captured.out == captured.err == ""


def test_failed_socket_write_does_not_count_planned_body_bytes():
    # A failed sendall may have delivered part of a block; that partial length
    # is unknowable. Only successful whole writes belong in this counter.
    from tools.content_server import Metrics

    class FailedOutput:
        def write(self, block):
            raise BrokenPipeError

    metrics = Metrics()
    metrics.response(200, "title-01", "preloader")
    with pytest.raises(BrokenPipeError):
        metrics.write(FailedOutput(), b"not-confirmed", "title-01", "preloader")
    snapshot = metrics.snapshot()
    assert snapshot["requests"] == 1
    assert snapshot["body_bytes"] == 0
    assert snapshot["by_title"]["title-01"]["preloader"]["body_bytes"] == 0
