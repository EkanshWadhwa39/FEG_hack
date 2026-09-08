#!/usr/bin/env python3
"""Prepare the public Vault lobby for one pinned Empire HTTPS CDN origin."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

try:
    from tools.empire_catalogue_server import LOBBY_FILES
    from tools.prepare_empire_cdn import PROTOTYPE_ROOT, PreparationError, _exact_origin, _output_path
except ModuleNotFoundError as error:
    if error.name != "tools":
        raise
    from empire_catalogue_server import LOBBY_FILES  # type: ignore[no-redef]
    from prepare_empire_cdn import PROTOTYPE_ROOT, PreparationError, _exact_origin, _output_path  # type: ignore[no-redef]

META = b'<meta name="empire-config-url" content="/__vault/config.json">'
MAX_SOURCE_BYTES = 1024 * 1024


def prepare(*, cdn_origin: str, output_dir: str | Path) -> dict[str, object]:
    cdn_origin = _exact_origin(cdn_origin, https_only=True)
    output = _output_path(output_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".prepare-empire-lobby-", dir=output.parent))
    records: list[dict[str, object]] = []
    try:
        for route, relative in sorted(LOBBY_FILES.items()):
            destination_relative = "index.html" if route == "/" else relative
            source = PROTOTYPE_ROOT / relative
            if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_SOURCE_BYTES:
                raise PreparationError("Lobby source is unavailable")
            payload = source.read_bytes()
            if relative == "empire-demo.html":
                if payload.count(META) != 1:
                    raise PreparationError("Lobby configuration marker is unavailable")
                payload = payload.replace(META, (
                    f'<meta name="empire-config-url" content="{cdn_origin}/__vault/config.json">'
                ).encode())
            destination = staging / destination_relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(payload)
            records.append({"path": destination_relative, "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest()})
        headers = (
            "/*\n"
            "  Cache-Control: no-store\n"
            "  X-Content-Type-Options: nosniff\n"
            "  Referrer-Policy: no-referrer\n"
            "  X-Frame-Options: DENY\n"
            f"  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src {cdn_origin}; frame-src {cdn_origin}; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'none'\n"
        ).encode()
        (staging / "_headers").write_bytes(headers)
        manifest: dict[str, object] = {"schemaVersion": 1, "label": "STATICALLY-INFERRED", "delivery": "CDN",
            "cdnOrigin": cdn_origin, "providerFilesIncluded": False, "files": records}
        (staging / "deployment-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        if output.exists():
            if output.is_symlink() or not output.is_dir() or any(output.iterdir()):
                raise PreparationError("Output directory must be absent or empty")
            output.rmdir()
        staging.replace(output)
        return manifest
    except PreparationError:
        raise
    except OSError:
        raise PreparationError("Lobby deployment preparation failed") from None
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdn-origin", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    try:
        prepare(cdn_origin=args.cdn_origin, output_dir=args.output_dir)
    except PreparationError as error:
        parser.error(str(error))
    print(json.dumps({"status": "prepared", "providerFilesIncluded": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
