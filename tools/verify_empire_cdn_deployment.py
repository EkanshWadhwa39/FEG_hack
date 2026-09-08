#!/usr/bin/env python3
"""Verify deployed Empire bytes/headers against a trusted local packaging manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path

try:
    from tools.prepare_empire_cdn import PreparationError, _exact_origin
    from tools.empire_catalogue_server import EARLY_ASSETS, REVIEWED_ARCHIVE_SHA256
except ModuleNotFoundError as error:
    if error.name != "tools":
        raise
    from prepare_empire_cdn import PreparationError, _exact_origin  # type: ignore[no-redef]
    from empire_catalogue_server import EARLY_ASSETS, REVIEWED_ARCHIVE_SHA256  # type: ignore[no-redef]

MAX_BODY = 16 * 1024 * 1024
MAX_MANIFEST = 2 * 1024 * 1024
MAX_FILES = 1000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _get(opener, url: str, *, lobby_origin: str) -> tuple[bytes, object]:
    request = urllib.request.Request(url, headers={"Origin": lobby_origin, "Accept-Encoding": "identity", "User-Agent": "vault-cdn-smoke/1"})
    try:
        with opener.open(request, timeout=20) as response:
            if response.status != 200 or response.geturl() != url:
                raise PreparationError("Deployment returned an unexpected status or redirect")
            headers = response.headers
            vary = {token.strip().lower() for token in headers.get("Vary", "").split(",")}
            if (headers.get("Set-Cookie") is not None or headers.get("Access-Control-Allow-Credentials", "").lower() == "true"
                or vary.intersection({"origin", "cookie"})):
                raise PreparationError("Deployment response has a credential-dependent cache policy")
            body = response.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise PreparationError("Deployment response exceeded the smoke-check bound")
            return body, headers
    except (urllib.error.URLError, TimeoutError, OSError):
        raise PreparationError("Deployment request failed") from None


def _load_manifest(path: str | Path, *, cdn_origin: str, lobby_origin: str) -> dict[str, object]:
    source = Path(path)
    try:
        if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_MANIFEST:
            raise PreparationError("Trusted deployment manifest is unavailable")
        value = json.loads(source.read_bytes())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise PreparationError("Trusted deployment manifest is unavailable") from None
    if (not isinstance(value, dict) or value.get("schemaVersion") != 1 or value.get("delivery") != "CDN"
        or value.get("cdnOrigin") != cdn_origin or value.get("lobbyOrigin") != lobby_origin
        or value.get("archiveSha256") != REVIEWED_ARCHIVE_SHA256 or value.get("providerBytesModified") is not False):
        raise PreparationError("Trusted deployment manifest identity is invalid")
    records = value.get("providerFiles")
    artifacts = value.get("artifacts")
    if not isinstance(records, list) or not 1 <= len(records) <= MAX_FILES or not isinstance(artifacts, list):
        raise PreparationError("Trusted deployment manifest inventory is invalid")
    return value


def _record_map(records: list[object], *, prefix: str, allowed: set[str] | None = None) -> dict[str, tuple[int, str]]:
    result = {}
    for record in records:
        if not isinstance(record, dict):
            raise PreparationError("Trusted deployment manifest inventory is invalid")
        path, size, digest = record.get("path"), record.get("bytes"), record.get("sha256")
        unsafe = (not isinstance(path, str) or (allowed is None and not path.startswith(prefix)) or "\\" in path or "//" in path
                  or any(part in {"", ".", ".."} for part in path.split("/")) or (allowed is not None and path not in allowed))
        if unsafe or path in result or not isinstance(size, int) or not 0 <= size <= MAX_BODY or not isinstance(digest, str) or len(digest) != 64:
            raise PreparationError("Trusted deployment manifest inventory is invalid")
        result[path] = (size, digest)
    return result


def _assert_bytes(body: bytes, expected: tuple[int, str]) -> None:
    if len(body) != expected[0] or hashlib.sha256(body).hexdigest() != expected[1]:
        raise PreparationError("Deployed bytes differ from the trusted local manifest")


def verify(*, cdn_origin: str, lobby_origin: str, manifest_path: str | Path) -> dict[str, object]:
    cdn_origin = _exact_origin(cdn_origin, https_only=True)
    lobby_origin = _exact_origin(lobby_origin, https_only=True)
    if cdn_origin == lobby_origin:
        raise PreparationError("CDN and lobby origins must be distinct")
    manifest = _load_manifest(manifest_path, cdn_origin=cdn_origin, lobby_origin=lobby_origin)
    digest = REVIEWED_ARCHIVE_SHA256
    build = f"empire-{digest[:16]}"
    release_prefix = f"releases/{digest}/"
    provider = _record_map(manifest["providerFiles"], prefix=release_prefix)
    artifact_paths = {"__vault/player.html", "__vault/player.js", "__vault/config.json"}
    selected_artifacts = [record for record in manifest["artifacts"]
                          if isinstance(record, dict) and record.get("path") in artifact_paths]
    artifacts = _record_map(selected_artifacts, prefix="__vault/", allowed=artifact_paths)
    if set(artifacts) != artifact_paths or f"{release_prefix}index.html" not in provider:
        raise PreparationError("Trusted deployment manifest inventory is incomplete")

    opener = urllib.request.build_opener(NoRedirect)
    config_url = f"{cdn_origin}/__vault/config.json"
    raw, headers = _get(opener, config_url, lobby_origin=lobby_origin)
    _assert_bytes(raw, artifacts["__vault/config.json"])
    if headers.get("Access-Control-Allow-Origin") != lobby_origin or "no-store" not in headers.get("Cache-Control", "").lower():
        raise PreparationError("Configuration CORS/cache policy is not exact")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise PreparationError("Deployment configuration is malformed") from None
    expected_base = f"{cdn_origin}/releases/{digest}/"
    if (value.get("mode") != "PROVIDER_EARLY_ASSETS_CDN_ONE_TITLE" or value.get("delivery") != "CDN"
        or value.get("archiveSha256") != digest or value.get("build") != build
        or value.get("lobbyOrigin") != lobby_origin or len(value.get("entries", [])) != 1):
        raise PreparationError("Deployment configuration identity is not the reviewed release")
    entry = value["entries"][0]
    if (entry.get("origin") != cdn_origin or entry.get("assetBaseUrl") != expected_base
        or entry.get("wrapperUrl") != f"{cdn_origin}/__vault/player.html"
        or entry.get("launchUrl") != f"{expected_base}index.html?language=en"):
        raise PreparationError("Deployment URL identity is not exact")
    configured = entry.get("assets")
    if not isinstance(configured, list) or len(configured) != len(EARLY_ASSETS):
        raise PreparationError("Deployment early-asset set is not exact")
    early_by_path = {path: asset for asset, (_stage, path) in zip(configured, EARLY_ASSETS, strict=True)}

    total = 0
    for path, expected in provider.items():
        relative = path.removeprefix(release_prefix)
        url = f"{expected_base}{relative}"
        if relative == "index.html":
            url += "?language=en"
        body, item_headers = _get(opener, url, lobby_origin=lobby_origin)
        _assert_bytes(body, expected)
        cache = item_headers.get("Cache-Control", "").lower()
        if relative == "index.html":
            if "no-store" not in cache:
                raise PreparationError("Launch document is not no-store")
        elif (item_headers.get("Access-Control-Allow-Origin") != lobby_origin
              or item_headers.get("Timing-Allow-Origin") != lobby_origin
              or not all(token in cache for token in ("public", "max-age=31536000", "immutable"))):
            raise PreparationError("Provider asset cache/CORS policy is not exact")
        if relative in early_by_path:
            asset = early_by_path[relative]
            if (asset.get("url") != url or asset.get("releaseBuild") != build
                or asset.get("estimatedBytes") != expected[0] or asset.get("sha256") != expected[1]):
                raise PreparationError("Deployment early-asset identity is not exact")
        total += len(body)

    for path in ("__vault/player.html", "__vault/player.js"):
        body, item_headers = _get(opener, f"{cdn_origin}/{path}", lobby_origin=lobby_origin)
        _assert_bytes(body, artifacts[path])
        if "no-store" not in item_headers.get("Cache-Control", "").lower():
            raise PreparationError("Wrapper is not no-store")
    return {"status": "verified", "classification": "MEASURED", "scope": "HTTP deployment smoke only; not browser cache reuse",
            "providerFileCount": len(provider), "providerBodyBytes": total}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdn-origin", required=True)
    parser.add_argument("--lobby-origin", required=True)
    parser.add_argument("--manifest", required=True, dest="manifest_path")
    args = parser.parse_args(argv)
    try:
        result = verify(cdn_origin=args.cdn_origin, lobby_origin=args.lobby_origin, manifest_path=args.manifest_path)
    except PreparationError as error:
        parser.error(str(error))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
