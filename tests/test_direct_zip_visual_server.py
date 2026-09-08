"""Synthetic tests for the direct visual timer's read-only server."""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from http.client import HTTPConnection
from pathlib import Path
from threading import Thread
from zipfile import ZipFile

import pytest

from tools.direct_zip_visual_server import make_handler, member_for_path, verify_archive
from http.server import ThreadingHTTPServer


@pytest.mark.parametrize("path", ["/../secret", "/%2e%2e/secret", "/a/./b", "/a%5cb", "/a%00b"])
def test_direct_visual_server_rejects_unsafe_paths(path):
    assert member_for_path(path) is None


def test_direct_visual_server_maps_exact_path_without_query_rewrite():
    assert member_for_path("/") == "empireofgold/index.html"
    assert member_for_path("/assets/%401x/a.png?v=reviewed") == "empireofgold/assets/@1x/a.png"


def synthetic_zip(tmp_path: Path) -> tuple[Path, str]:
    path = tmp_path / "synthetic.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("empireofgold/index.html", "<title>Synthetic</title>")
        archive.writestr("empireofgold/assets/a.bin", b"unchanged-test-bytes")
    return path, sha256(path.read_bytes()).hexdigest()


def test_direct_visual_server_requires_exact_archive_hash(tmp_path):
    path, digest = synthetic_zip(tmp_path)
    members = verify_archive(path, expected_sha256=digest)
    assert "empireofgold/index.html" in members
    with pytest.raises(ValueError, match="SHA-256"):
        verify_archive(path, expected_sha256="0" * 64)


def test_direct_visual_server_handles_concurrent_reads_and_sets_no_store(tmp_path):
    path, digest = synthetic_zip(tmp_path)
    members = verify_archive(path, expected_sha256=digest)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(path, members))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request_once() -> tuple[int, str | None, bytes]:
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        connection.request("GET", "/assets/a.bin?exact=1")
        response = connection.getresponse()
        result = response.status, response.getheader("Cache-Control"), response.read()
        connection.close()
        return result

    try:
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(lambda _index: request_once(), range(24)))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert results == [(200, "no-store", b"unchanged-test-bytes")] * 24
