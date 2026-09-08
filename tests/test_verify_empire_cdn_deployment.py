import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).parents[1] / "tools" / "verify_empire_cdn_deployment.py"
SPEC = importlib.util.spec_from_file_location("verify_empire_cdn_deployment", MODULE_PATH)
module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(module)

CDN = "https://cdn.example.test"
LOBBY = "https://lobby.example.test"


class Response:
    def __init__(self, url, body, headers):
        self.status = 200
        self._url = url
        self._body = body
        self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def geturl(self):
        return self._url

    def read(self, _limit):
        return self._body


class Opener:
    def __init__(self, responses):
        self.responses = responses
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        return self.responses[request.full_url]


def record(path, body):
    return {"path": path, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}


def deployment(tmp_path):
    digest = module.REVIEWED_ARCHIVE_SHA256
    build = f"empire-{digest[:16]}"
    prefix = f"releases/{digest}/"
    base = f"{CDN}/{prefix}"
    assets, responses, provider = [], {}, []
    cache_headers = {"Cache-Control": "public, max-age=31536000, immutable",
                     "Access-Control-Allow-Origin": LOBBY, "Timing-Allow-Origin": LOBBY}
    for index, (stage, path) in enumerate(module.EARLY_ASSETS):
        body = f"asset-{index}".encode()
        url = f"{base}{path}"
        assets.append({"url": url, "stage": stage, "estimatedBytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(), "releaseBuild": build})
        responses[url] = Response(url, body, cache_headers.copy())
        provider.append(record(f"{prefix}{path}", body))
    launch_body = b"provider-index"
    launch_url = f"{base}index.html?language=en"
    responses[launch_url] = Response(launch_url, launch_body, {"Cache-Control": "no-store"})
    provider.append(record(f"{prefix}index.html", launch_body))
    entry = {"id": "title-01", "delivery": "CDN", "origin": CDN,
        "wrapperUrl": f"{CDN}/__vault/player.html", "launchUrl": launch_url,
        "assetBaseUrl": base, "assets": assets}
    config = {"mode": "PROVIDER_EARLY_ASSETS_CDN_ONE_TITLE", "delivery": "CDN", "archiveSha256": digest,
        "build": build, "lobbyOrigin": LOBBY, "entries": [entry]}
    config_body = json.dumps(config).encode()
    config_url = f"{CDN}/__vault/config.json"
    responses[config_url] = Response(config_url, config_body,
        {"Cache-Control": "no-store", "Access-Control-Allow-Origin": LOBBY})
    artifacts = [record("__vault/config.json", config_body)]
    for path in ("__vault/player.html", "__vault/player.js"):
        body = path.encode()
        responses[f"{CDN}/{path}"] = Response(f"{CDN}/{path}", body, {"Cache-Control": "no-store"})
        artifacts.append(record(path, body))
    artifacts.append(record("_headers", b"not served"))
    manifest = {"schemaVersion": 1, "delivery": "CDN", "cdnOrigin": CDN, "lobbyOrigin": LOBBY,
        "archiveSha256": digest, "providerBytesModified": False, "providerFiles": provider, "artifacts": artifacts}
    manifest_path = tmp_path / "deployment-manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return responses, manifest_path


def test_verifies_exact_deployment_against_local_manifest_without_credentials(monkeypatch, tmp_path):
    responses, manifest_path = deployment(tmp_path)
    opener = Opener(responses)
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: opener)
    result = module.verify(cdn_origin=CDN, lobby_origin=LOBBY, manifest_path=manifest_path)
    assert result["status"] == "verified"
    assert result["providerFileCount"] == len(module.EARLY_ASSETS) + 1
    assert all(request.get_header("Origin") == LOBBY for request, _timeout in opener.requests)
    assert all(request.get_header("Authorization") is None for request, _timeout in opener.requests)
    assert all(request.get_header("Cookie") is None for request, _timeout in opener.requests)


def test_fails_closed_on_inexact_config_cors(monkeypatch, tmp_path):
    responses, manifest_path = deployment(tmp_path)
    responses[f"{CDN}/__vault/config.json"].headers["Access-Control-Allow-Origin"] = "*"
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="CORS/cache"):
        module.verify(cdn_origin=CDN, lobby_origin=LOBBY, manifest_path=manifest_path)


@pytest.mark.parametrize("header,value", [("Set-Cookie", "id=1"), ("Access-Control-Allow-Credentials", "true"),
                                            ("Vary", "Accept-Encoding, Origin")])
def test_fails_closed_on_credential_dependent_responses(monkeypatch, tmp_path, header, value):
    responses, manifest_path = deployment(tmp_path)
    responses[f"{CDN}/__vault/player.js"].headers[header] = value
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="credential-dependent"):
        module.verify(cdn_origin=CDN, lobby_origin=LOBBY, manifest_path=manifest_path)


def test_fails_if_deployment_and_config_are_mutated_together(monkeypatch, tmp_path):
    responses, manifest_path = deployment(tmp_path)
    url = next(url for url in responses if "/assets/" in url)
    responses[url]._body = b"mutated"
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="trusted local manifest"):
        module.verify(cdn_origin=CDN, lobby_origin=LOBBY, manifest_path=manifest_path)
