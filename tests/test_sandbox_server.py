"""Tests for the sandbox host that serves the provided game package."""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from sandbox_server import resolve_bundle, serve


def make_bundle(root: Path, nested: bool = False) -> Path:
    """Create a minimal bundle shaped like the provided package."""
    base = root / "bundle"
    target = base / "bundle" if nested else base
    (target / "assets" / "panel" / "css").mkdir(parents=True)
    (target / "index.html").write_text("<!doctype html><title>game</title>")
    (target / "assets" / "app-abc123.js").write_text("export default 1;")
    (target / "assets" / "panel" / "css" / "common.css").write_text("body{}")
    return base


def test_resolve_bundle_accepts_root_and_wrapper(tmp_path):
    direct = make_bundle(tmp_path / "a")
    assert resolve_bundle(direct) == direct

    wrapped = make_bundle(tmp_path / "b", nested=True)
    assert resolve_bundle(wrapped) == wrapped / "bundle"


def test_resolve_bundle_rejects_a_directory_without_an_entry_point(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(SystemExit):
        resolve_bundle(empty)


@pytest.fixture
def server(tmp_path):
    bundle = resolve_bundle(make_bundle(tmp_path))
    httpd = serve(bundle, 0, 0)
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def fetch(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.status, dict(response.headers), response.read()


def test_versioned_static_assets_are_served_immutable_and_cors_open(server):
    status, headers, body = fetch(f"{server}/assets/app-abc123.js")
    assert status == 200
    assert body == b"export default 1;"
    # Long-lived caching is what makes parent-origin warming worthwhile.
    assert headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert headers["Access-Control-Allow-Origin"] == "*"
    # Without this, cross-origin Resource Timing reports zeros.
    assert headers["Timing-Allow-Origin"] == "*"


def test_entry_documents_are_not_cached(server):
    _, headers, _ = fetch(f"{server}/index.html")
    assert headers["Cache-Control"] == "no-cache, no-store, must-revalidate"


def test_query_strings_resolve_to_the_real_file(server):
    # The provided package versions its CSS as common.css?v=1788443825853.
    status, headers, body = fetch(f"{server}/assets/panel/css/common.css?v=1788443825853")
    assert status == 200
    assert body == b"body{}"
    assert headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_directory_requests_serve_the_entry_point(server):
    status, _, body = fetch(f"{server}/")
    assert status == 200
    assert b"<title>game</title>" in body


def test_parent_traversal_cannot_escape_the_bundle(server, tmp_path):
    (tmp_path / "secret.txt").write_text("do not serve me")
    with pytest.raises(urllib.error.HTTPError) as excinfo:
        fetch(f"{server}/../secret.txt")
    assert excinfo.value.code == 404
