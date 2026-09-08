import hashlib
import importlib.util
import json
from email.message import Message
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
    cache_headers = {
        "Cache-Control": module.IMMUTABLE_CACHE_POLICY,
        "Access-Control-Allow-Origin": LOBBY,
        "Timing-Allow-Origin": LOBBY,
    }
    for index, (stage, path) in enumerate(module.EARLY_ASSETS):
        body = f"asset-{index}".encode()
        url = f"{base}{path}"
        assets.append(
            {
                "url": url,
                "stage": stage,
                "estimatedBytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "releaseBuild": build,
            }
        )
        responses[url] = Response(url, body, cache_headers.copy())
        provider.append(record(f"{prefix}{path}", body))
    launch_body = b"provider-index"
    launch_url = f"{base}index.html?language=en"
    responses[launch_url] = Response(launch_url, launch_body, {"Cache-Control": "no-store"})
    provider.append(record(f"{prefix}index.html", launch_body))
    for index in range(module.EXPECTED_PROVIDER_FILE_COUNT - len(provider)):
        path = f"assets/inventory-{index}.bin"
        body = f"inventory-{index}".encode()
        url = f"{base}{path}"
        responses[url] = Response(url, body, cache_headers.copy())
        provider.append(record(f"{prefix}{path}", body))
    entry = {
        "id": "title-01",
        "delivery": "CDN",
        "origin": CDN,
        "wrapperUrl": f"{CDN}/__vault/player.html",
        "launchUrl": launch_url,
        "assetBaseUrl": base,
        "assets": assets,
    }
    config = {
        "mode": "PROVIDER_EARLY_ASSETS_CDN_ONE_TITLE",
        "delivery": "CDN",
        "archiveSha256": digest,
        "build": build,
        "lobbyOrigin": LOBBY,
        "locale": "en",
        "tier": "1x",
        "byteBudget": module.BYTE_BUDGET,
        "cachePolicy": module.IMMUTABLE_CACHE_POLICY,
        "entries": [entry],
    }
    config_body = json.dumps(config).encode()
    config_url = f"{CDN}/__vault/config.json"
    responses[config_url] = Response(
        config_url,
        config_body,
        {"Cache-Control": "no-store", "Access-Control-Allow-Origin": LOBBY},
    )
    artifacts = [record("__vault/config.json", config_body)]
    for path in ("__vault/player.html", "__vault/player.js"):
        body = path.encode()
        responses[f"{CDN}/{path}"] = Response(
            f"{CDN}/{path}", body, {"Cache-Control": "no-store"}
        )
        artifacts.append(record(path, body))
    artifacts.append(record("_headers", b"not served"))
    manifest = {
        "schemaVersion": 1,
        "delivery": "CDN",
        "cdnOrigin": CDN,
        "lobbyOrigin": LOBBY,
        "archiveSha256": digest,
        "providerBytesModified": False,
        "providerFiles": provider,
        "artifacts": artifacts,
    }
    manifest_path = tmp_path / "deployment-manifest.json"
    manifest_path.write_text(json.dumps(manifest))

    csp = (
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        f"connect-src {CDN}; frame-src {CDN}; frame-ancestors 'none'; base-uri 'none'; "
        "object-src 'none'; form-action 'none'"
    )
    lobby_headers = {
        "Cache-Control": "no-store",
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
    }
    marker = f'<meta name="empire-config-url" content="{CDN}/__vault/config.json">'.encode()
    lobby_files = {path: path.encode() for path in module.LOBBY_FILES.values()}
    lobby_files["index.html"] = b"<!doctype html>" + marker
    lobby_files["empire-demo.html"] = b"<!doctype html>" + marker
    for path, body in lobby_files.items():
        url = f"{LOBBY}/" if path == "index.html" else f"{LOBBY}/{path}"
        responses[url] = Response(url, body, lobby_headers.copy())
    lobby_manifest = {
        "schemaVersion": 1,
        "delivery": "CDN",
        "cdnOrigin": CDN,
        "lobbyOrigin": LOBBY,
        "providerFilesIncluded": False,
        "files": [record(path, body) for path, body in lobby_files.items()],
    }
    lobby_manifest_path = tmp_path / "lobby-manifest.json"
    lobby_manifest_path.write_text(json.dumps(lobby_manifest))
    return responses, manifest_path, lobby_manifest_path


def run_verify(monkeypatch, responses, manifest_path, lobby_manifest_path):
    opener = Opener(responses)
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: opener)
    result = module.verify(
        cdn_origin=CDN,
        lobby_origin=LOBBY,
        manifest_path=manifest_path,
        lobby_manifest_path=lobby_manifest_path,
    )
    return result, opener


def test_verifies_both_deployments_against_local_manifests_without_credentials(monkeypatch, tmp_path):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    result, opener = run_verify(monkeypatch, responses, manifest_path, lobby_manifest_path)
    assert result["status"] == "verified"
    assert result["providerFileCount"] == module.EXPECTED_PROVIDER_FILE_COUNT
    assert result["lobbyFileCount"] == len(module.LOBBY_FILES)
    assert all(request.get_header("Origin") == LOBBY for request, _timeout in opener.requests)
    assert all(request.get_header("Authorization") is None for request, _timeout in opener.requests)
    assert all(request.get_header("Cookie") is None for request, _timeout in opener.requests)


def test_fails_closed_on_inexact_config_cors(monkeypatch, tmp_path):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    responses[f"{CDN}/__vault/config.json"].headers["Access-Control-Allow-Origin"] = "*"
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="CORS/cache"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )


@pytest.mark.parametrize(
    "header,value",
    [
        ("Set-Cookie", "id=1"),
        ("Access-Control-Allow-Credentials", "false"),
        ("Vary", "Accept-Encoding, Origin"),
        ("Vary", "Authorization"),
    ],
)
def test_fails_closed_on_credential_dependent_responses(monkeypatch, tmp_path, header, value):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    responses[f"{CDN}/__vault/player.js"].headers[header] = value
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="credential-dependent"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )


@pytest.mark.parametrize(
    "header,extra",
    [("Cache-Control", "no-store"), ("Vary", "Cookie")],
)
def test_fails_closed_on_duplicate_conflicting_response_fields(
    monkeypatch, tmp_path, header, extra
):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    url = next(url for url in responses if "/assets/" in url)
    repeated = Message()
    for name, value in responses[url].headers.items():
        repeated.add_header(name, value)
    repeated.add_header(header, extra)
    responses[url].headers = repeated
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="cache|credential-dependent"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )


def test_fails_closed_on_truncated_trusted_inventories(monkeypatch, tmp_path):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    provider_manifest = json.loads(manifest_path.read_text())
    provider_manifest["providerFiles"].pop()
    manifest_path.write_text(json.dumps(provider_manifest))
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="inventory"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )

    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    lobby_manifest = json.loads(lobby_manifest_path.read_text())
    lobby_manifest["files"].pop()
    lobby_manifest_path.write_text(json.dumps(lobby_manifest))
    with pytest.raises(module.PreparationError, match="identity"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )


def test_fails_if_deployment_and_config_are_mutated_together(monkeypatch, tmp_path):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    url = next(url for url in responses if "/assets/" in url)
    responses[url]._body = b"mutated"
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="trusted local manifest"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )


@pytest.mark.parametrize(
    "cache",
    [
        "no-store, public, max-age=31536000, immutable",
        "private, public, max-age=31536000, immutable",
        "public, max-age=315360000, immutable",
        "public, max-age=31536000, immutable-false",
        "public, max-age=31536000, immutable, immutable",
    ],
)
def test_fails_closed_on_conflicting_or_inexact_asset_cache_policy(monkeypatch, tmp_path, cache):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    url = next(url for url in responses if "/assets/" in url)
    responses[url].headers["Cache-Control"] = cache
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="cache|malformed"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )


def test_fails_closed_when_lobby_bytes_or_policy_drift(monkeypatch, tmp_path):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    responses[f"{LOBBY}/src/empire-demo.js"]._body = b"changed"
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="trusted local manifest"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )

    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    responses[f"{LOBBY}/"].headers["Content-Security-Policy"] = "default-src *"
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="Lobby security policy"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )


def test_fails_closed_when_browser_required_config_field_is_missing(monkeypatch, tmp_path):
    responses, manifest_path, lobby_manifest_path = deployment(tmp_path)
    config_url = f"{CDN}/__vault/config.json"
    config = json.loads(responses[config_url]._body)
    del config["locale"]
    changed = json.dumps(config).encode()
    responses[config_url]._body = changed
    manifest = json.loads(manifest_path.read_text())
    config_record = next(record for record in manifest["artifacts"] if record["path"] == "__vault/config.json")
    config_record.update(record("__vault/config.json", changed))
    manifest_path.write_text(json.dumps(manifest))
    monkeypatch.setattr(module.urllib.request, "build_opener", lambda *_args: Opener(responses))
    with pytest.raises(module.PreparationError, match="configuration identity"):
        module.verify(
            cdn_origin=CDN,
            lobby_origin=LOBBY,
            manifest_path=manifest_path,
            lobby_manifest_path=lobby_manifest_path,
        )
