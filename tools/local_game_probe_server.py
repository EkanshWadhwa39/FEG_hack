#!/usr/bin/env python3
"""Read-only, loopback-only archive server for a local boot diagnostic, not deployment."""

from __future__ import annotations

import argparse
import json
import mimetypes
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile


def member_for_path(raw_path: str, prefix: str = "empireofgold/") -> str | None:
    path = unquote(urlsplit(raw_path).path)
    if not path.startswith("/") or "\\" in path or "\x00" in path:
        return None
    if any(part in {".", ".."} for part in path.split("/")):
        return None
    return prefix + (path.lstrip("/") or "index.html")


def inventory(archive: ZipFile) -> dict:
    files = [entry for entry in archive.infolist() if not entry.is_dir()]
    names = {entry.filename for entry in files}
    missing = []
    for name in sorted(names):
        if not name.endswith(".atlas"):
            continue
        for line in archive.read(name).decode("utf-8").splitlines():
            image = line.strip()
            if image.endswith((".png", ".jpg", ".webp")):
                target = str(PurePosixPath(name).parent / image)
                if target not in names:
                    missing.append(target)
    return {
        "label": "STATICALLY-INFERRED",
        "file_count": len(files),
        "uncompressed_bytes_including_metadata": sum(entry.file_size for entry in files),
        "atlas_count": sum(name.endswith(".atlas") for name in names),
        "unresolved_atlas_page_references": len(missing),
        "unresolved_atlas_pages_by_tier": dict(Counter(
            "0.5x" if "/@0.5x/" in name else "1x" if "/@1x/" in name else "other"
            for name in missing
        )),
        "book_image_present": any(name.endswith("/book.png") for name in names),
        "offline_module_present": any("offline-data-" in name for name in names),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True)
    parser.add_argument("--inventory", action="store_true")
    args = parser.parse_args()
    with ZipFile(args.zip) as archive:
        if args.inventory:
            print(json.dumps(inventory(archive), indent=2))
            return
        members = {entry.filename for entry in archive.infolist() if not entry.is_dir()}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: object) -> None:
                pass

            def do_GET(self) -> None:  # noqa: N802
                member = member_for_path(self.path)
                exists = member in members
                payload = archive.read(member) if exists else b"Not found"
                self.send_response(200 if exists else 404)
                content_type = mimetypes.guess_type(member or "")[0] or "application/octet-stream"
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                # No external calls, worker execution, form submissions, or nested remote frames.
                self.send_header("Content-Security-Policy", (
                    "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; "
                    "connect-src 'self'; worker-src 'none'; frame-src 'none'; "
                    "form-action 'none'; object-src 'none'; base-uri 'none'"
                ))
                self.end_headers()
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        print(json.dumps({"port": server.server_port}), flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
