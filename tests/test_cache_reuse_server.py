import json
import threading
import urllib.request
import zipfile
from contextlib import contextmanager

import pytest

from tools.cache_reuse_server import (
    ASSET_PATH,
    MISMATCH_ASSET_PATH,
    NO_STORE_ASSET_PATH,
    load_asset,
    start_servers,
)


@contextmanager
def running_servers(asset=b"fixture", source="SYNTHETIC"):
    lobby, asset_server = start_servers(asset, source)
    threads = [
        threading.Thread(target=server.serve_forever, daemon=True)
        for server in (lobby, asset_server)
    ]
    for thread in threads:
        thread.start()
    try:
        yield (
            f"http://127.0.0.1:{lobby.server_port}",
            f"http://127.0.0.1:{asset_server.server_port}",
        )
    finally:
        for server in (lobby, asset_server):
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(timeout=2)


def request(url, method="GET"):
    return urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=2)


def test_two_origin_pages_use_matching_request_semantics():
    with running_servers() as (lobby_origin, asset_origin):
        with request(f"{lobby_origin}/?mode=treatment") as response:
            parent = response.read().decode()
        with request(f"{asset_origin}/frame.html") as response:
            frame = response.read().decode()

    assert lobby_origin != asset_origin
    assert 'mode: "cors", credentials: "omit", cache: "default"' in parent
    assert 'mode: "cors", credentials: "omit", cache: "default"' in frame
    assert ASSET_PATH in parent
    assert ASSET_PATH in frame
    assert parent.index('addEventListener("message"') < parent.index("document.body.append(frame)")


def test_asset_is_cacheable_cors_enabled_and_counted_by_phase():
    payload = b"cache-me"
    with running_servers(payload) as (_, asset_origin):
        with request(f"{asset_origin}/phase/launch", method="POST"):
            pass
        with request(f"{asset_origin}{ASSET_PATH}") as response:
            assert response.read() == payload
            assert response.headers["Cache-Control"] == "public, max-age=3600, immutable"
            assert response.headers["Access-Control-Allow-Origin"] == "*"
            assert response.headers["Timing-Allow-Origin"] == "*"
            assert response.headers.get("Vary") is None
        with request(f"{asset_origin}/metrics") as response:
            metrics = json.load(response)

    assert metrics == {
        "asset_bytes": len(payload),
        "requests": {"launch": 1, "prefetch": 0, "setup": 0},
        "response_body_bytes": {"launch": len(payload), "prefetch": 0, "setup": 0},
        "source": "SYNTHETIC",
    }


def test_negative_control_assets_have_expected_cache_policy():
    with running_servers() as (_, asset_origin):
        with request(f"{asset_origin}{MISMATCH_ASSET_PATH}") as response:
            assert response.headers["Cache-Control"] == "public, max-age=3600, immutable"
        with request(f"{asset_origin}{NO_STORE_ASSET_PATH}") as response:
            assert response.headers["Cache-Control"] == "no-store"


def test_reset_removes_previous_counts():
    with running_servers() as (_, asset_origin):
        with request(f"{asset_origin}{ASSET_PATH}"):
            pass
        with request(f"{asset_origin}/reset", method="POST"):
            pass
        with request(f"{asset_origin}/metrics") as response:
            metrics = json.load(response)

    assert sum(metrics["requests"].values()) == 0
    assert sum(metrics["response_body_bytes"].values()) == 0


def test_private_zip_member_can_be_read_without_extraction(tmp_path):
    archive_path = tmp_path / "provider.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("game/assets/bootstrap.js", b"private fixture")

    asset, source = load_asset(archive_path, "game/assets/bootstrap.js", size=1)

    assert asset == b"private fixture"
    assert source == "FEG_PROVIDED_PRIVATE_BUNDLE"


def test_zip_requires_an_explicit_member(tmp_path):
    archive_path = tmp_path / "provider.zip"
    with zipfile.ZipFile(archive_path, "w"):
        pass

    with pytest.raises(ValueError, match="zip-member"):
        load_asset(archive_path, None, size=1)
