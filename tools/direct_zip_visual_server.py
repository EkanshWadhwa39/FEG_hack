#!/usr/bin/env python3
"""Read-only, no-store localhost server for human visual timing of the unchanged ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zipfile import BadZipFile, ZipFile

EXPECTED_ARCHIVE_SHA256 = "f0b4947f9d703af9c99419418293ac518189afe3c8dabfc9781f9558a9dacdba"
ARCHIVE_PREFIX = "empireofgold/"


def member_for_path(raw_path: str, prefix: str = ARCHIVE_PREFIX) -> str | None:
    """Map an origin-form URL to an archive member without URL rewriting."""
    path = unquote(urlsplit(raw_path).path)
    if not path.startswith("/") or "\\" in path or "\x00" in path:
        return None
    if any(part in {".", ".."} for part in path.split("/")):
        return None
    return prefix + (path.lstrip("/") or "index.html")


def archive_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive(path: Path, expected_sha256: str = EXPECTED_ARCHIVE_SHA256) -> frozenset[str]:
    if not path.is_file():
        raise ValueError("Provider ZIP does not exist or is not a file")
    if archive_sha256(path) != expected_sha256:
        raise ValueError("Provider ZIP SHA-256 does not match the reviewed unchanged release")
    try:
        with ZipFile(path) as archive:
            members = frozenset(entry.filename for entry in archive.infolist() if not entry.is_dir())
    except BadZipFile as error:
        raise ValueError("Provider archive is not a valid ZIP") from error
    if f"{ARCHIVE_PREFIX}index.html" not in members:
        raise ValueError("Provider archive is missing empireofgold/index.html")
    return members


def make_handler(zip_path: Path, members: frozenset[str]):
    class Handler(BaseHTTPRequestHandler):
        server_version = "DirectZipVisual/1"
        sys_version = ""

        def log_message(self, _format: str, *_args: object) -> None:
            pass

        def _respond(self, *, send_body: bool) -> None:
            member = member_for_path(self.path)
            if member is None or member not in members:
                payload = b"Not found"
                status = 404
            else:
                # A separate ZipFile per concurrent request avoids shared seek state while
                # preserving the supplied bytes and reading the archive in place.
                with ZipFile(zip_path) as archive:
                    payload = archive.read(member)
                status = 200
            self.send_response(status)
            self.send_header("Content-Type", mimetypes.guess_type(member or "")[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if send_body:
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def do_GET(self) -> None:  # noqa: N802
            self._respond(send_body=True)

        def do_HEAD(self) -> None:  # noqa: N802
            self._respond(send_body=False)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, dest="zip_path")
    args = parser.parse_args()
    zip_path = Path(args.zip_path).expanduser().resolve()
    try:
        members = verify_archive(zip_path)
    except ValueError as error:
        parser.error(str(error))

    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(zip_path, members))
    print(json.dumps({"port": server.server_port}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
