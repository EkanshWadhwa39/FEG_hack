#!/usr/bin/env python3
"""Verify deployed Empire and lobby bytes/headers against trusted local manifests."""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.error
import urllib.request
from pathlib import Path

try:
    from tools.prepare_empire_cdn import PreparationError, _exact_origin
    from tools.empire_catalogue_server import BYTE_BUDGET, EARLY_ASSETS, LOBBY_FILES, REVIEWED_ARCHIVE_SHA256
except ModuleNotFoundError as error:
    if error.name != "tools":
        raise
    from prepare_empire_cdn import PreparationError, _exact_origin  # type: ignore[no-redef]
    from empire_catalogue_server import (  # type: ignore[no-redef]
        BYTE_BUDGET,
        EARLY_ASSETS,
        LOBBY_FILES,
        REVIEWED_ARCHIVE_SHA256,
    )

MAX_BODY = 16 * 1024 * 1024
MAX_MANIFEST = 2 * 1024 * 1024
MAX_FILES = 1000
EXPECTED_PROVIDER_FILE_COUNT = 376
IMMUTABLE_CACHE_POLICY = "public, max-age=31536000, immutable"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _header_value(headers, name: str) -> str | None:
    get_all = getattr(headers, "get_all", None)
    if callable(get_all):
        values = get_all(name)
        if values:
            return ",".join(values)
    return headers.get(name)


def _get(opener, url: str, *, lobby_origin: str) -> tuple[bytes, object]:
    request = urllib.request.Request(
        url,
        headers={
            "Origin": lobby_origin,
            "Accept-Encoding": "identity",
            "User-Agent": "vault-cdn-smoke/1",
        },
    )
    try:
        with opener.open(request, timeout=20) as response:
            if response.status != 200 or response.geturl() != url:
                raise PreparationError("Deployment returned an unexpected status or redirect")
            headers = response.headers
            vary = {
                token.strip().lower()
                for token in (_header_value(headers, "Vary") or "").split(",")
                if token.strip()
            }
            if (
                _header_value(headers, "Set-Cookie") is not None
                or _header_value(headers, "Set-Cookie2") is not None
                or _header_value(headers, "Access-Control-Allow-Credentials") is not None
                or vary.intersection({"*", "origin", "cookie", "authorization"})
            ):
                raise PreparationError("Deployment response has a credential-dependent cache policy")
            body = response.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise PreparationError("Deployment response exceeded the smoke-check bound")
            return body, headers
    except PreparationError:
        raise
    except (urllib.error.URLError, TimeoutError, OSError):
        raise PreparationError("Deployment request failed") from None


def _read_manifest(path: str | Path) -> dict[str, object]:
    source = Path(path)
    try:
        if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_MANIFEST:
            raise PreparationError("Trusted deployment manifest is unavailable")
        value = json.loads(source.read_bytes())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise PreparationError("Trusted deployment manifest is unavailable") from None
    if not isinstance(value, dict):
        raise PreparationError("Trusted deployment manifest identity is invalid")
    return value


def _load_provider_manifest(path: str | Path, *, cdn_origin: str, lobby_origin: str) -> dict[str, object]:
    value = _read_manifest(path)
    if (
        value.get("schemaVersion") != 1
        or value.get("delivery") != "CDN"
        or value.get("cdnOrigin") != cdn_origin
        or value.get("lobbyOrigin") != lobby_origin
        or value.get("archiveSha256") != REVIEWED_ARCHIVE_SHA256
        or value.get("providerBytesModified") is not False
    ):
        raise PreparationError("Trusted deployment manifest identity is invalid")
    records = value.get("providerFiles")
    artifacts = value.get("artifacts")
    if (
        not isinstance(records, list)
        or len(records) != EXPECTED_PROVIDER_FILE_COUNT
        or not isinstance(artifacts, list)
        or len(artifacts) > MAX_FILES
    ):
        raise PreparationError("Trusted deployment manifest inventory is invalid")
    return value


def _load_lobby_manifest(path: str | Path, *, cdn_origin: str, lobby_origin: str) -> dict[str, object]:
    value = _read_manifest(path)
    files = value.get("files")
    if (
        value.get("schemaVersion") != 1
        or value.get("delivery") != "CDN"
        or value.get("cdnOrigin") != cdn_origin
        or value.get("lobbyOrigin") != lobby_origin
        or value.get("providerFilesIncluded") is not False
        or not isinstance(files, list)
        or len(files) != len(LOBBY_FILES)
    ):
        raise PreparationError("Trusted lobby manifest identity is invalid")
    return value


def _record_map(
    records: list[object], *, prefix: str, allowed: set[str] | None = None
) -> dict[str, tuple[int, str]]:
    result = {}
    for record in records:
        if not isinstance(record, dict):
            raise PreparationError("Trusted deployment manifest inventory is invalid")
        path, size, digest = record.get("path"), record.get("bytes"), record.get("sha256")
        unsafe = (
            not isinstance(path, str)
            or (allowed is None and not path.startswith(prefix))
            or "\\" in path
            or "//" in path
            or any(character in path for character in "?#%")
            or any(ord(character) < 33 or ord(character) == 127 for character in path)
            or any(part in {"", ".", ".."} for part in path.split("/"))
            or (allowed is not None and path not in allowed)
        )
        if (
            unsafe
            or path in result
            or not isinstance(size, int)
            or not 0 <= size <= MAX_BODY
            or not isinstance(digest, str)
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise PreparationError("Trusted deployment manifest inventory is invalid")
        result[path] = (size, digest)
    return result


def _assert_bytes(body: bytes, expected: tuple[int, str]) -> None:
    if len(body) != expected[0] or hashlib.sha256(body).hexdigest() != expected[1]:
        raise PreparationError("Deployed bytes differ from the trusted local manifest")


def _cache_directives(value: str) -> dict[str, str | None]:
    result: dict[str, str | None] = {}
    for raw in value.split(","):
        item = raw.strip()
        if not item:
            raise PreparationError("Deployment cache policy is malformed")
        name, separator, argument = item.partition("=")
        name = name.strip().lower()
        argument = argument.strip().lower() if separator else None
        if not name or name in result or (separator and not argument):
            raise PreparationError("Deployment cache policy is malformed")
        result[name] = argument
    return result


def _require_no_store(headers: object, message: str) -> None:
    if _cache_directives(_header_value(headers, "Cache-Control") or "") != {"no-store": None}:
        raise PreparationError(message)


def _require_immutable(headers: object, *, lobby_origin: str) -> None:
    expected = {"public": None, "max-age": "31536000", "immutable": None}
    if (
        _header_value(headers, "Access-Control-Allow-Origin") != lobby_origin
        or _header_value(headers, "Timing-Allow-Origin") != lobby_origin
        or _cache_directives(_header_value(headers, "Cache-Control") or "") != expected
    ):
        raise PreparationError("Provider asset cache/CORS policy is not exact")


def _verify_lobby(
    opener, *, cdn_origin: str, lobby_origin: str, lobby_manifest: dict[str, object]
) -> int:
    expected_files = {"index.html", *LOBBY_FILES.values()}
    files = _record_map(lobby_manifest["files"], prefix="", allowed=expected_files)
    if set(files) != expected_files:
        raise PreparationError("Trusted lobby manifest inventory is incomplete")
    expected_csp = (
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        f"connect-src {cdn_origin}; frame-src {cdn_origin}; frame-ancestors 'none'; "
        "base-uri 'none'; object-src 'none'; form-action 'none'"
    )
    for path, expected in files.items():
        url = f"{lobby_origin}/" if path == "index.html" else f"{lobby_origin}/{path}"
        body, headers = _get(opener, url, lobby_origin=lobby_origin)
        _assert_bytes(body, expected)
        _require_no_store(headers, "Lobby response is not no-store")
        if (
            _header_value(headers, "Content-Security-Policy") != expected_csp
            or _header_value(headers, "X-Content-Type-Options") != "nosniff"
            or _header_value(headers, "Referrer-Policy") != "no-referrer"
            or _header_value(headers, "X-Frame-Options") != "DENY"
        ):
            raise PreparationError("Lobby security policy is not exact")
        if path == "index.html":
            marker = f'<meta name="empire-config-url" content="{cdn_origin}/__vault/config.json">'.encode()
            if body.count(marker) != 1:
                raise PreparationError("Lobby configuration identity is not exact")
    return len(files)


def verify(
    *,
    cdn_origin: str,
    lobby_origin: str,
    manifest_path: str | Path,
    lobby_manifest_path: str | Path,
) -> dict[str, object]:
    cdn_origin = _exact_origin(cdn_origin, https_only=True)
    lobby_origin = _exact_origin(lobby_origin, https_only=True)
    if cdn_origin == lobby_origin:
        raise PreparationError("CDN and lobby origins must be distinct")
    manifest = _load_provider_manifest(manifest_path, cdn_origin=cdn_origin, lobby_origin=lobby_origin)
    lobby_manifest = _load_lobby_manifest(
        lobby_manifest_path, cdn_origin=cdn_origin, lobby_origin=lobby_origin
    )
    digest = REVIEWED_ARCHIVE_SHA256
    build = f"empire-{digest[:16]}"
    release_prefix = f"releases/{digest}/"
    provider = _record_map(manifest["providerFiles"], prefix=release_prefix)
    artifact_paths = {"__vault/player.html", "__vault/player.js", "__vault/config.json"}
    selected_artifacts = [
        record
        for record in manifest["artifacts"]
        if isinstance(record, dict) and record.get("path") in artifact_paths
    ]
    artifacts = _record_map(selected_artifacts, prefix="__vault/", allowed=artifact_paths)
    required_provider_paths = {
        f"{release_prefix}index.html",
        *(f"{release_prefix}{relative}" for _, relative in EARLY_ASSETS),
    }
    if set(artifacts) != artifact_paths or not required_provider_paths.issubset(provider):
        raise PreparationError("Trusted deployment manifest inventory is incomplete")

    opener = urllib.request.build_opener(NoRedirect)
    config_url = f"{cdn_origin}/__vault/config.json"
    raw, headers = _get(opener, config_url, lobby_origin=lobby_origin)
    _assert_bytes(raw, artifacts["__vault/config.json"])
    _require_no_store(headers, "Configuration CORS/cache policy is not exact")
    if _header_value(headers, "Access-Control-Allow-Origin") != lobby_origin:
        raise PreparationError("Configuration CORS/cache policy is not exact")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise PreparationError("Deployment configuration is malformed") from None
    expected_base = f"{cdn_origin}/releases/{digest}/"
    if (
        not isinstance(value, dict)
        or value.get("mode") != "PROVIDER_EARLY_ASSETS_CDN_ONE_TITLE"
        or value.get("delivery") != "CDN"
        or value.get("archiveSha256") != digest
        or value.get("build") != build
        or value.get("lobbyOrigin") != lobby_origin
        or value.get("locale") != "en"
        or value.get("tier") != "1x"
        or value.get("byteBudget") != BYTE_BUDGET
        or value.get("cachePolicy") != IMMUTABLE_CACHE_POLICY
        or not isinstance(value.get("entries"), list)
        or len(value["entries"]) != 1
    ):
        raise PreparationError("Deployment configuration identity is not the reviewed release")
    entry = value["entries"][0]
    if (
        not isinstance(entry, dict)
        or entry.get("id") != "title-01"
        or entry.get("delivery") != "CDN"
        or entry.get("origin") != cdn_origin
        or entry.get("assetBaseUrl") != expected_base
        or entry.get("wrapperUrl") != f"{cdn_origin}/__vault/player.html"
        or entry.get("launchUrl") != f"{expected_base}index.html?language=en"
    ):
        raise PreparationError("Deployment URL identity is not exact")
    configured = entry.get("assets")
    if not isinstance(configured, list) or len(configured) != len(EARLY_ASSETS):
        raise PreparationError("Deployment early-asset set is not exact")
    early_by_path: dict[str, dict[str, object]] = {}
    for asset, (stage, path) in zip(configured, EARLY_ASSETS, strict=True):
        if not isinstance(asset, dict) or asset.get("stage") != stage:
            raise PreparationError("Deployment early-asset identity is not exact")
        early_by_path[path] = asset

    total = 0
    for path, expected in provider.items():
        relative = path.removeprefix(release_prefix)
        url = f"{expected_base}{relative}"
        if relative == "index.html":
            url += "?language=en"
        body, item_headers = _get(opener, url, lobby_origin=lobby_origin)
        _assert_bytes(body, expected)
        if relative == "index.html":
            _require_no_store(item_headers, "Launch document is not no-store")
        else:
            _require_immutable(item_headers, lobby_origin=lobby_origin)
        if relative in early_by_path:
            asset = early_by_path[relative]
            if (
                asset.get("url") != url
                or asset.get("releaseBuild") != build
                or asset.get("estimatedBytes") != expected[0]
                or asset.get("sha256") != expected[1]
            ):
                raise PreparationError("Deployment early-asset identity is not exact")
        total += len(body)

    for path in ("__vault/player.html", "__vault/player.js"):
        body, item_headers = _get(opener, f"{cdn_origin}/{path}", lobby_origin=lobby_origin)
        _assert_bytes(body, artifacts[path])
        _require_no_store(item_headers, "Wrapper is not no-store")

    lobby_count = _verify_lobby(
        opener,
        cdn_origin=cdn_origin,
        lobby_origin=lobby_origin,
        lobby_manifest=lobby_manifest,
    )
    return {
        "status": "verified",
        "classification": "MEASURED",
        "scope": "HTTP deployment smoke only; not browser cache reuse",
        "providerFileCount": len(provider),
        "providerBodyBytes": total,
        "lobbyFileCount": lobby_count,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdn-origin", required=True)
    parser.add_argument("--lobby-origin", required=True)
    parser.add_argument("--manifest", required=True, dest="manifest_path")
    parser.add_argument("--lobby-manifest", required=True, dest="lobby_manifest_path")
    args = parser.parse_args(argv)
    try:
        result = verify(
            cdn_origin=args.cdn_origin,
            lobby_origin=args.lobby_origin,
            manifest_path=args.manifest_path,
            lobby_manifest_path=args.lobby_manifest_path,
        )
    except PreparationError as error:
        parser.error(str(error))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
