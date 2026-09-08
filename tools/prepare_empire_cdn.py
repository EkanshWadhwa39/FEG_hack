#!/usr/bin/env python3
"""Prepare the reviewed, unchanged Empire bundle for an HTTPS CDN deployment.

The provider ZIP remains private and is never copied into the output. Only its
``empireofgold/index.html`` and ``empireofgold/assets/`` regular-file entries
are extracted. Provider payload bytes are copied verbatim; wrapper/config and
Cloudflare Pages policy files are separate deployment artifacts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import tempfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from zipfile import BadZipFile, ZipFile, ZipInfo

try:
    from tools.empire_catalogue_server import (
        ARCHIVE_PREFIX,
        BYTE_BUDGET,
        EARLY_ASSETS,
        MAX_MEMBER_BYTES,
        REVIEWED_ARCHIVE_SHA256,
    )
except ModuleNotFoundError as error:
    if error.name != "tools":
        raise
    from empire_catalogue_server import (  # type: ignore[no-redef]
        ARCHIVE_PREFIX,
        BYTE_BUDGET,
        EARLY_ASSETS,
        MAX_MEMBER_BYTES,
        REVIEWED_ARCHIVE_SHA256,
    )

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PROTOTYPE_ROOT = REPOSITORY_ROOT / "prototype"
MAX_EXTRACTED_BYTES = 8 * 1024 * 1024 * 1024
COPY_CHUNK_BYTES = 1024 * 1024
WRAPPER_FILES = {
    "__vault/player.html": "empire-player.html",
    "__vault/player.js": "src/empire-player.js",
}
PUBLIC_OUTPUTS = (
    "releases/<sha256>/index.html",
    "releases/<sha256>/assets/",
    "__vault/player.html",
    "__vault/player.js",
    "__vault/config.json",
    "_headers",
    "deployment-manifest.json",
)


class PreparationError(ValueError):
    """A sanitized preparation failure safe to show to an operator."""


def _sha256_stream(source) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: source.read(COPY_CHUNK_BYTES), b""):
        digest.update(chunk)
    return digest.hexdigest()


def _exact_origin(value: str, *, https_only: bool) -> str:
    """Accept only a serialized origin, never a URL carrying extra components."""
    if not isinstance(value, str) or not value or any(
        character.isspace() or ord(character) < 32 or ord(character) == 127
        for character in value
    ):
        raise PreparationError("An exact origin is required")
    if "\\" in value:
        raise PreparationError("An exact origin is required")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        raise PreparationError("An exact origin is required") from None
    schemes = {"https"} if https_only else {"http", "https"}
    if (
        parsed.scheme not in schemes
        or not parsed.netloc
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
        or value != f"{parsed.scheme}://{parsed.netloc}"
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise PreparationError("An exact origin is required")
    return value


def _output_path(value: str | os.PathLike[str]) -> Path:
    candidate = Path(value).expanduser()
    try:
        if candidate.is_symlink():
            raise PreparationError("Output directory must not be a symbolic link")
        resolved = candidate.resolve(strict=False)
        repository = REPOSITORY_ROOT.resolve(strict=True)
    except OSError:
        raise PreparationError("Output directory is unavailable") from None
    if resolved == repository or repository in resolved.parents:
        raise PreparationError("Output directory must be outside the repository")
    if resolved.exists():
        if not resolved.is_dir() or any(resolved.iterdir()):
            raise PreparationError("Output directory must be absent or empty")
    return resolved


def _safe_member(info: ZipInfo) -> str | None:
    """Validate every ZIP name and return an allowlisted provider output path."""
    name = info.filename
    if (
        not name
        or name.startswith("/")
        or "//" in name
        or "\\" in name
        or any(ord(character) < 32 or ord(character) == 127 for character in name)
    ):
        raise PreparationError("Provider archive contains an unsafe member")
    parts = PurePosixPath(name).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise PreparationError("Provider archive contains an unsafe member")
    mode = info.external_attr >> 16
    file_type = stat.S_IFMT(mode)
    if info.is_dir():
        if file_type not in {0, stat.S_IFDIR}:
            raise PreparationError("Provider archive contains a nonregular member")
        return None
    if file_type not in {0, stat.S_IFREG}:
        raise PreparationError("Provider archive contains a nonregular member")
    if info.flag_bits & 1 or info.file_size > MAX_MEMBER_BYTES:
        raise PreparationError("Provider archive contains an unsupported member")
    if not name.startswith(ARCHIVE_PREFIX):
        return None
    relative = name[len(ARCHIVE_PREFIX) :]
    if relative == "index.html" or relative.startswith("assets/"):
        if relative.endswith("/") or any(part in {"", ".", ".."} for part in relative.split("/")):
            raise PreparationError("Provider archive contains an unsafe member")
        return relative
    return None


def _open_reviewed_archive(zip_path: str | os.PathLike[str]):
    path = Path(zip_path).expanduser()
    try:
        if path.is_symlink():
            raise PreparationError("Provider archive must be a regular file")
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        source = os.fdopen(descriptor, "rb")
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            source.close()
            raise PreparationError("Provider archive must be a regular file")
        digest = _sha256_stream(source)
        if digest != REVIEWED_ARCHIVE_SHA256:
            source.close()
            raise PreparationError("Provider archive does not match the reviewed SHA-256")
        source.seek(0)
        try:
            archive = ZipFile(source)
        except BadZipFile:
            source.close()
            raise
        return source, archive, digest
    except PreparationError:
        raise
    except (OSError, BadZipFile):
        raise PreparationError("Provider archive is unavailable or invalid") from None


def _inventory(archive: ZipFile) -> dict[str, ZipInfo]:
    selected: dict[str, ZipInfo] = {}
    seen: set[str] = set()
    total = 0
    try:
        for info in archive.infolist():
            if info.filename in seen:
                raise PreparationError("Provider archive contains duplicate members")
            seen.add(info.filename)
            relative = _safe_member(info)
            if relative is None:
                continue
            if relative in selected:
                raise PreparationError("Provider archive contains duplicate members")
            selected[relative] = info
            total += info.file_size
            if total > MAX_EXTRACTED_BYTES:
                raise PreparationError("Provider archive exceeds the extraction limit")
    except (BadZipFile, RuntimeError):
        raise PreparationError("Provider archive is unavailable or invalid") from None
    required = {"index.html", *(relative for _, relative in EARLY_ASSETS)}
    if not required.issubset(selected):
        raise PreparationError("Provider archive is missing required public content")
    return selected


def _write_json(path: Path, value: object) -> bytes:
    payload = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)
    return payload


def _copy_provider_files(
    archive: ZipFile, selected: dict[str, ZipInfo], destination: Path, archive_sha256: str
) -> list[dict[str, object]]:
    records = []
    release_prefix = f"releases/{archive_sha256}"
    try:
        for relative in sorted(selected, key=lambda item: (item != "index.html", item)):
            public_path = f"{release_prefix}/{relative}"
            target = destination.joinpath(*public_path.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            size = 0
            with archive.open(selected[relative], "r") as source, target.open("xb") as output:
                while chunk := source.read(COPY_CHUNK_BYTES):
                    output.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
            if size != selected[relative].file_size:
                raise PreparationError("Provider archive changed during extraction")
            records.append({"path": public_path, "bytes": size, "sha256": digest.hexdigest()})
    except PreparationError:
        raise
    except (BadZipFile, OSError, RuntimeError):
        raise PreparationError("Provider extraction failed") from None
    return records


def _copy_wrappers(destination: Path) -> list[dict[str, object]]:
    records = []
    for output_name, prototype_name in WRAPPER_FILES.items():
        source = PROTOTYPE_ROOT / prototype_name
        target = destination.joinpath(*output_name.split("/"))
        try:
            if source.is_symlink() or not source.is_file():
                raise OSError
            payload = source.read_bytes()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        except OSError:
            raise PreparationError("Required CDN wrapper artifact is unavailable") from None
        records.append(
            {"path": output_name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}
        )
    return records


def _configuration(
    *, cdn_origin: str, lobby_origin: str, archive_sha256: str, records: list[dict[str, object]]
) -> dict[str, object]:
    build = f"empire-{archive_sha256[:16]}"
    release_base = f"{cdn_origin}/releases/{archive_sha256}/"
    by_path = {record["path"]: record for record in records}
    assets = []
    for stage, relative in EARLY_ASSETS:
        record = by_path[f"releases/{archive_sha256}/{relative}"]
        assets.append(
            {
                "url": f"{release_base}{relative}",
                "stage": stage,
                "estimatedBytes": record["bytes"],
                "sha256": record["sha256"],
                "releaseBuild": build,
            }
        )
    return {
        "label": "STATICALLY-INFERRED",
        "mode": "PROVIDER_EARLY_ASSETS_CDN_ONE_TITLE",
        "delivery": "CDN",
        "lobbyOrigin": lobby_origin,
        "build": build,
        "archiveSha256": archive_sha256,
        "locale": "en",
        "tier": "1x",
        "byteBudget": BYTE_BUDGET,
        "cachePolicy": "public, max-age=31536000, immutable",
        "entries": [
            {
                "id": "title-01",
                "delivery": "CDN",
                "origin": cdn_origin,
                "wrapperUrl": f"{cdn_origin}/__vault/player.html",
                "launchUrl": f"{release_base}index.html?language=en",
                "assetBaseUrl": release_base,
                "assets": assets,
            }
        ],
    }


def _headers(lobby_origin: str, archive_sha256: str) -> bytes:
    return (
        f"/releases/{archive_sha256}/index.html\n"
        "  Cache-Control: no-store\n"
        "\n"
        "/__vault/*\n"
        "  Cache-Control: no-store\n"
        "  X-Content-Type-Options: nosniff\n"
        "  Referrer-Policy: no-referrer\n"
        "\n"
        f"/releases/{archive_sha256}/assets/*\n"
        "  Cache-Control: public, max-age=31536000, immutable\n"
        f"  Access-Control-Allow-Origin: {lobby_origin}\n"
        f"  Timing-Allow-Origin: {lobby_origin}\n"
        "  X-Content-Type-Options: nosniff\n"
    ).encode()


def _artifact_record(path: str, payload: bytes) -> dict[str, object]:
    return {"path": path, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}


def prepare(
    *, zip_path: str | os.PathLike[str], cdn_origin: str, lobby_origin: str, output_dir: str | os.PathLike[str]
) -> dict[str, object]:
    """Prepare a deployment atomically and return its sanitized manifest."""
    cdn_origin = _exact_origin(cdn_origin, https_only=True)
    lobby_origin = _exact_origin(lobby_origin, https_only=False)
    if cdn_origin == lobby_origin:
        raise PreparationError("CDN and lobby origins must be distinct")
    output = _output_path(output_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".prepare-empire-", dir=output.parent))
    source = archive = None
    try:
        source, archive, archive_sha256 = _open_reviewed_archive(zip_path)
        selected = _inventory(archive)
        provider_records = _copy_provider_files(archive, selected, staging, archive_sha256)
        wrapper_records = _copy_wrappers(staging)
        config = _configuration(
            cdn_origin=cdn_origin,
            lobby_origin=lobby_origin,
            archive_sha256=archive_sha256,
            records=provider_records,
        )
        config_payload = _write_json(staging / "__vault/config.json", config)
        headers_payload = _headers(lobby_origin, archive_sha256)
        (staging / "_headers").write_bytes(headers_payload)
        manifest = {
            "schemaVersion": 1,
            "label": "STATICALLY-INFERRED",
            "delivery": "CDN",
            "cdnOrigin": cdn_origin,
            "lobbyOrigin": lobby_origin,
            "build": config["build"],
            "archiveSha256": archive_sha256,
            "providerBytesModified": False,
            "providerFiles": provider_records,
            "artifacts": wrapper_records
            + [
                _artifact_record("__vault/config.json", config_payload),
                _artifact_record("_headers", headers_payload),
            ],
        }
        _write_json(staging / "deployment-manifest.json", manifest)
        if output.exists():
            if output.is_symlink() or not output.is_dir() or any(output.iterdir()):
                raise PreparationError("Output directory must be absent or empty")
            output.rmdir()
        staging.replace(output)
        return manifest
    except PreparationError:
        raise
    except OSError:
        raise PreparationError("CDN deployment preparation failed") from None
    finally:
        if archive is not None:
            archive.close()
        if source is not None:
            source.close()
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, dest="zip_path")
    parser.add_argument("--cdn-origin", required=True)
    parser.add_argument("--lobby-origin", default="http://127.0.0.1:8100")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    try:
        prepare(
            zip_path=args.zip_path,
            cdn_origin=args.cdn_origin,
            lobby_origin=args.lobby_origin,
            output_dir=args.output_dir,
        )
    except PreparationError as error:
        parser.error(str(error))
    print(json.dumps({"status": "prepared", "outputs": PUBLIC_OUTPUTS}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
