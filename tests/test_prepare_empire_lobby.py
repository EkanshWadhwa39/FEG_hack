import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[1] / "tools" / "prepare_empire_lobby.py"
SPEC = importlib.util.spec_from_file_location("prepare_empire_lobby", MODULE_PATH)
module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(module)


def test_prepares_explicit_source_only_lobby_with_pinned_cdn_policy(tmp_path):
    output = tmp_path / "lobby"
    result = module.prepare(
        cdn_origin="https://cdn.example.test",
        lobby_origin="https://lobby.example.test",
        output_dir=output,
    )
    html = (output / "empire-demo.html").read_text()
    assert (output / "index.html").read_text() == html
    assert '<meta name="empire-config-url" content="https://cdn.example.test/__vault/config.json">' in html
    assert '/__vault/config.json">' in html
    headers = (output / "_headers").read_text()
    assert "connect-src https://cdn.example.test" in headers
    assert "frame-src https://cdn.example.test" in headers
    assert "frame-ancestors 'none'" in headers
    assert not any(path.name.endswith(".zip") for path in output.rglob("*"))
    assert not (output / "empire-player.html").exists()
    persisted = json.loads((output / "deployment-manifest.json").read_text())
    assert persisted == result
    assert persisted["providerFilesIncluded"] is False
    assert persisted["lobbyOrigin"] == "https://lobby.example.test"
    for record in persisted["files"]:
        payload = (output / record["path"]).read_bytes()
        assert record["bytes"] == len(payload)
        assert record["sha256"] == hashlib.sha256(payload).hexdigest()


@pytest.mark.parametrize("origin", ["http://cdn.example.test", "https://user@cdn.example.test", "https://cdn.example.test/path"])
def test_rejects_non_https_or_non_origin_cdn_values(origin, tmp_path):
    with pytest.raises(module.PreparationError):
        module.prepare(
            cdn_origin=origin,
            lobby_origin="https://lobby.example.test",
            output_dir=tmp_path / "lobby",
        )


@pytest.mark.parametrize(
    "origin",
    ["http://lobby.example.test", "https://LOBBY.example.test", "https://lobby.example.test/"],
)
def test_rejects_non_https_or_noncanonical_lobby_values(origin, tmp_path):
    with pytest.raises(module.PreparationError):
        module.prepare(
            cdn_origin="https://cdn.example.test",
            lobby_origin=origin,
            output_dir=tmp_path / "lobby",
        )


def test_rejects_shared_lobby_and_provider_origin(tmp_path):
    with pytest.raises(module.PreparationError, match="distinct"):
        module.prepare(
            cdn_origin="https://same.example.test",
            lobby_origin="https://same.example.test",
            output_dir=tmp_path / "lobby",
        )
