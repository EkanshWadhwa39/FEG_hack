#!/usr/bin/env python3
"""Redact a HAR file: strip URLs, query strings, tokens, headers, and cookies.

Produces only safe aggregate/redacted output suitable for public review.
No raw URL, query parameter, sensitive header value, or cookie is emitted.

Note: No HAR files are committed to this repository. The tool is ready for
use when Devtools_games/casino.psk.hr_cold.har and _warm.har are provided.
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

# Request header names whose values are safe to retain verbatim.
_SAFE_REQUEST_HEADER_NAMES: frozenset[str] = frozenset(
    {
        "accept",
        "accept-encoding",
        "accept-language",
        "cache-control",
        "connection",
        "content-length",
        "content-type",
        "if-none-match",
        "if-modified-since",
        "origin",
        "pragma",
        "range",
    }
)

# Response header names whose values are safe to retain verbatim.
_SAFE_RESPONSE_HEADER_NAMES: frozenset[str] = frozenset(
    {
        "accept-ranges",
        "age",
        "cache-control",
        "content-encoding",
        "content-length",
        "content-type",
        "vary",
    }
)

# Response fields that carry cache evidence (safe to keep as-is).
_RESPONSE_CACHE_FIELDS: frozenset[str] = frozenset(
    {
        "_fromCache",
        "fromCache",
        "_servedFromCache",
        "_fromDiskCache",
        "_fromMemoryCache",
        "_transferSize",
    }
)

# Top-level entry fields that carry no sensitive data and can pass through.
_ENTRY_PASSTHROUGH: frozenset[str] = frozenset(
    {
        "startedDateTime",
        "time",
        "cache",
        "timings",
        "pageref",
        "_fetchedViaServiceWorker",
    }
)


class RedactionError(ValueError):
    """A safe, user-facing redaction error."""


def _redact_url(url: str, url_registry: dict[str, str]) -> str:
    """Return a stable opaque label for a URL, never the URL itself."""
    if url not in url_registry:
        url_registry[url] = f"asset-{len(url_registry) + 1}"
    return url_registry[url]


def _redact_headers(
    headers: Any,
    safe_names: frozenset[str],
) -> list[dict[str, str]]:
    """Keep header names; redact values unless the name is in safe_names."""
    if not isinstance(headers, list):
        return []
    result = []
    for header in headers:
        if not isinstance(header, Mapping):
            continue
        name = header.get("name", "")
        if not isinstance(name, str):
            continue
        safe = name.strip().lower() in safe_names
        result.append(
            {
                "name": name,
                "value": str(header.get("value", "")) if safe else "[REDACTED]",
            }
        )
    return result


def _redact_content(content: Any) -> dict[str, Any]:
    """Retain size and MIME type; strip body text entirely."""
    if not isinstance(content, Mapping):
        return {"size": 0, "mimeType": "application/octet-stream"}
    redacted: dict[str, Any] = {
        "size": content.get("size", 0),
        "mimeType": content.get("mimeType", "application/octet-stream"),
    }
    if "compression" in content:
        redacted["compression"] = content["compression"]
    # "text" deliberately omitted — may contain response body
    return redacted


def _redact_request(
    request: Any,
    url_registry: dict[str, str],
) -> dict[str, Any]:
    """Redact one HAR request object."""
    if not isinstance(request, Mapping):
        return {}
    return {
        "method": request.get("method", "GET"),
        "url": _redact_url(str(request.get("url", "")), url_registry),
        "httpVersion": request.get("httpVersion", ""),
        "headers": _redact_headers(
            request.get("headers", []),
            _SAFE_REQUEST_HEADER_NAMES,
        ),
        "queryString": [],  # always strip
        "cookies": [],  # always strip
        "headersSize": request.get("headersSize", -1),
        "bodySize": request.get("bodySize", -1),
        # postData intentionally omitted
    }


def _redact_response(response: Any) -> dict[str, Any]:
    """Redact one HAR response object."""
    if not isinstance(response, Mapping):
        return {}
    redacted: dict[str, Any] = {
        "status": response.get("status", 0),
        "statusText": response.get("statusText", ""),
        "httpVersion": response.get("httpVersion", ""),
        "headers": _redact_headers(
            response.get("headers", []),
            _SAFE_RESPONSE_HEADER_NAMES,
        ),
        "cookies": [],  # always strip
        "content": _redact_content(response.get("content", {})),
        "redirectURL": "",  # always strip
        "headersSize": response.get("headersSize", -1),
        "bodySize": response.get("bodySize", -1),
    }
    # Preserve cache-evidence fields verbatim.
    for key in _RESPONSE_CACHE_FIELDS:
        if key in response:
            redacted[key] = response[key]
    return redacted


def _redact_entry(
    entry: Mapping[str, Any],
    url_registry: dict[str, str],
) -> dict[str, Any]:
    """Redact one HAR log entry."""
    redacted: dict[str, Any] = {}
    for key in _ENTRY_PASSTHROUGH:
        if key in entry:
            redacted[key] = entry[key]
    redacted["request"] = _redact_request(entry.get("request", {}), url_registry)
    redacted["response"] = _redact_response(entry.get("response", {}))
    # serverIPAddress and connection identifiers intentionally omitted
    return redacted


def _redact_page(page: Mapping[str, Any], index: int) -> dict[str, Any]:
    """Redact one HAR page object: strip title, preserve timing."""
    redacted: dict[str, Any] = {
        "startedDateTime": page.get("startedDateTime", ""),
        "id": page.get("id", f"page_{index}"),
        "title": f"Page {index + 1}",  # original title may contain provider URL
    }
    if "pageTimings" in page:
        redacted["pageTimings"] = page["pageTimings"]
    return redacted


def redact_har(har: Any) -> dict[str, Any]:
    """Produce a redacted HAR safe for public review.

    Every URL is replaced with a stable opaque label (asset-N).
    All cookies, query strings, and sensitive header values are stripped.
    Timing data, sizes, status codes, and cache indicators are preserved.
    """
    if not isinstance(har, Mapping):
        raise RedactionError("HAR root must be an object")
    log = har.get("log")
    if not isinstance(log, Mapping):
        raise RedactionError("HAR has no log object")

    raw_entries = log.get("entries")
    if not isinstance(raw_entries, list):
        raise RedactionError("HAR log has no entries array")

    url_registry: dict[str, str] = {}

    redacted_entries = [
        _redact_entry(entry, url_registry)
        for entry in raw_entries
        if isinstance(entry, Mapping)
    ]

    raw_pages = log.get("pages", [])
    redacted_pages = [
        _redact_page(page, index)
        for index, page in enumerate(raw_pages)
        if isinstance(page, Mapping)
    ]

    creator = log.get("creator", {})
    browser_info = log.get("browser", {})

    return {
        "log": {
            "version": log.get("version", "1.2"),
            "creator": (
                {"name": creator.get("name", ""), "version": creator.get("version", "")}
                if isinstance(creator, Mapping)
                else {}
            ),
            "browser": (
                {
                    "name": browser_info.get("name", ""),
                    "version": browser_info.get("version", ""),
                }
                if isinstance(browser_info, Mapping)
                else {}
            ),
            "pages": redacted_pages,
            "entries": redacted_entries,
            "_redaction": {
                "tool": "redact_har.py",
                "unique_urls_redacted": len(url_registry),
                "note": (
                    "All URLs replaced with opaque labels (asset-N). "
                    "No original URL, query string, sensitive header value, or cookie is present."
                ),
            },
        }
    }


def aggregate_redacted(redacted_har: Mapping[str, Any]) -> dict[str, Any]:
    """Compute aggregate metrics from a redacted HAR, labeled MEASURED or UNKNOWN."""
    log = redacted_har.get("log", {})
    entries = log.get("entries", [])
    total = len(entries)

    statuses: dict[int, int] = {}
    transfer_bytes = 0
    missing_transfer = 0

    for entry in entries:
        resp = entry.get("response", {})
        status = resp.get("status", 0)
        statuses[status] = statuses.get(status, 0) + 1
        raw_transfer = resp.get("_transferSize")
        if isinstance(raw_transfer, (int, float)) and raw_transfer >= 0:
            transfer_bytes += int(raw_transfer)
        else:
            missing_transfer += 1

    unique_urls = (
        redacted_har.get("log", {})
        .get("_redaction", {})
        .get("unique_urls_redacted")
    )

    return {
        "total_entries": total,
        "total_entries_label": "MEASURED",
        "status_distribution": statuses,
        "status_distribution_label": "MEASURED",
        "transfer_bytes": transfer_bytes if missing_transfer == 0 else None,
        "transfer_bytes_label": "MEASURED" if missing_transfer == 0 else "UNKNOWN",
        "missing_transfer_count": missing_transfer,
        "missing_transfer_count_label": "MEASURED",
        "unique_urls_redacted": unique_urls,
        "unique_urls_redacted_label": "MEASURED" if unique_urls is not None else "UNKNOWN",
    }


def format_aggregate(agg: dict[str, Any]) -> str:
    """Render aggregate output; no request-level fields are included."""
    lines = ["AGGREGATE SUMMARY (labels: MEASURED / UNKNOWN)"]
    for key, value in agg.items():
        if key.endswith("_label"):
            continue
        label = agg.get(f"{key}_label", "UNKNOWN")
        lines.append(f"  {key}: {value} [{label}]")
    return "\n".join(lines)


def _load_har(path: str) -> Mapping[str, Any]:
    try:
        with Path(path).open("r", encoding="utf-8") as fh:
            value = json.load(fh)
    except json.JSONDecodeError as exc:
        raise RedactionError(
            f"invalid JSON at line {exc.lineno}, column {exc.colno}"
        ) from None
    except (OSError, UnicodeError):
        raise RedactionError("unable to read HAR file") from None
    if not isinstance(value, Mapping):
        raise RedactionError("HAR root is not an object")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Redact a HAR file: strip URLs, query strings, tokens, headers, and cookies. "
            "Output never contains request URLs, query strings, header secrets, or cookies."
        )
    )
    parser.add_argument("har_file", help="HAR file to redact")
    parser.add_argument(
        "--output",
        metavar="FILE",
        help="write redacted HAR JSON to FILE (only with --format har or both)",
    )
    parser.add_argument(
        "--format",
        choices=("aggregate", "har", "both"),
        default="aggregate",
        help="output: aggregate summary (default), redacted HAR JSON, or both",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        raw_har = _load_har(args.har_file)
        redacted = redact_har(raw_har)
    except RedactionError as exc:
        parser.error(str(exc))
        return 1

    if args.format in ("aggregate", "both"):
        agg = aggregate_redacted(redacted)
        print(format_aggregate(agg))

    if args.format in ("har", "both"):
        har_json = json.dumps(redacted, indent=2, sort_keys=True)
        if args.output:
            Path(args.output).write_text(har_json + "\n", encoding="utf-8")
            print(f"Redacted HAR written to: {args.output}")
        else:
            print(har_json)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
