#!/usr/bin/env python3
"""Compare two HAR captures without exposing request-level secrets.

A confirmed cache hit requires an explicit exporter-provided cache marker.  A
zero transfer size, a populated HAR ``cache`` object, or a 304 response alone
is not treated as proof of a browser HTTP-cache hit.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

MEASURED = "MEASURED"
UNKNOWN = "UNKNOWN"

_TRUE_CACHE_STRINGS = {
    "cache",
    "cached",
    "disk",
    "disk cache",
    "disk_cache",
    "memory",
    "memory cache",
    "memory_cache",
}
_FALSE_CACHE_STRINGS = {"false", "miss", "network", "none"}
_CACHE_VALUE_KEYS = ("_fromCache", "fromCache", "_servedFromCache")
_CACHE_BOOLEAN_KEYS = ("_fromDiskCache", "_fromMemoryCache")


class HarError(ValueError):
    """A safe, user-facing HAR parsing error."""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _nonnegative(value: Any) -> float | None:
    value = _number(value)
    return value if value is not None and value >= 0 else None


def _cache_signal(value: Any) -> bool | None:
    if value is True:
        return True
    if value is False:
        return False
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in _TRUE_CACHE_STRINGS:
            return True
        if normalized in _FALSE_CACHE_STRINGS:
            return False
    return None


def classify_cache(entry: Mapping[str, Any]) -> str:
    """Return ``hit``, ``miss``, or ``unknown`` for one HAR entry.

    Only explicit cache-exporter markers confirm a hit. Positive wire transfer
    or an explicit false marker confirms a miss. Contradictory evidence and
    service-worker responses remain unknown rather than being overclaimed.
    """

    response = entry.get("response")
    response = response if isinstance(response, Mapping) else {}

    # A service worker is a different cache/interception layer and cannot prove
    # reuse from the browser HTTP cache measured by this project.
    if entry.get("_fetchedViaServiceWorker") is True or response.get(
        "_fetchedViaServiceWorker"
    ) is True:
        return "unknown"

    signals: list[bool] = []
    for container in (entry, response):
        for key in _CACHE_VALUE_KEYS:
            if key in container:
                signal = _cache_signal(container[key])
                if signal is not None:
                    signals.append(signal)
        for key in _CACHE_BOOLEAN_KEYS:
            if key in container and isinstance(container[key], bool):
                signals.append(container[key])

    transfer_size = _nonnegative(response.get("_transferSize"))
    positive = any(signals)
    negative = any(signal is False for signal in signals)

    if positive and not negative and not (transfer_size is not None and transfer_size > 0):
        return "hit"
    if not positive and (negative or (transfer_size is not None and transfer_size > 0)):
        return "miss"
    return "unknown"


def _wire_bytes(entry: Mapping[str, Any], classification: str) -> int | None:
    response = entry.get("response")
    response = response if isinstance(response, Mapping) else {}

    transfer_size = _nonnegative(response.get("_transferSize"))
    if transfer_size is not None:
        return int(round(transfer_size))
    if classification == "hit":
        return 0

    # Standard HAR fallback when Chrome's non-standard _transferSize is absent.
    headers_size = _nonnegative(response.get("headersSize"))
    body_size = _nonnegative(response.get("bodySize"))
    if headers_size is not None and body_size is not None:
        return int(round(headers_size + body_size))
    return None


def _timestamp_ms(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        normalized = value[:-1] + "+00:00" if value.endswith(("Z", "z")) else value
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp() * 1000
    except (ValueError, OverflowError):
        return None


def _is_data_entry(entry: Mapping[str, Any]) -> bool:
    request = entry.get("request")
    request = request if isinstance(request, Mapping) else {}
    url = request.get("url")
    return isinstance(url, str) and url.lstrip().lower().startswith("data:")


def _metric(report: dict[str, Any], name: str, value: Any, label: str) -> None:
    report[name] = value
    report[f"{name}_label"] = label


def measure_har(har: Mapping[str, Any]) -> dict[str, Any]:
    """Measure one parsed HAR document, excluding data URLs."""

    log = har.get("log")
    if not isinstance(log, Mapping):
        raise HarError("HAR has no log object")
    raw_entries = log.get("entries")
    if not isinstance(raw_entries, list):
        raise HarError("HAR log has no entries array")

    entries = [
        entry
        for entry in raw_entries
        if isinstance(entry, Mapping) and not _is_data_entry(entry)
    ]

    classes = [classify_cache(entry) for entry in entries]
    hits = classes.count("hit")
    misses = classes.count("miss")
    unknowns = classes.count("unknown")

    starts: list[float] = []
    ends: list[float] = []
    for entry in entries:
        start = _timestamp_ms(entry.get("startedDateTime"))
        duration = _nonnegative(entry.get("time"))
        if start is not None and duration is not None:
            starts.append(start)
            ends.append(start + duration)

    elapsed_ms = round(max(ends) - min(starts), 3) if starts else None

    byte_values = [
        _wire_bytes(entry, classification)
        for entry, classification in zip(entries, classes)
    ]
    missing_byte_counts = sum(value is None for value in byte_values)
    wire_bytes = (
        sum(value for value in byte_values if value is not None)
        if missing_byte_counts == 0
        else None
    )

    report: dict[str, Any] = {}
    _metric(report, "elapsed_ms", elapsed_ms, MEASURED if elapsed_ms is not None else UNKNOWN)
    _metric(report, "wire_bytes", wire_bytes, MEASURED if wire_bytes is not None else UNKNOWN)
    _metric(report, "request_count", len(entries), MEASURED)
    _metric(report, "confirmed_hits", hits, MEASURED)
    _metric(report, "confirmed_misses", misses, MEASURED)
    _metric(report, "unknowns", unknowns, MEASURED)
    _metric(report, "wire_bytes_unknown_requests", missing_byte_counts, MEASURED)
    return report


def compare_hars(cold: Mapping[str, Any], warm: Mapping[str, Any]) -> dict[str, Any]:
    cold_report = measure_har(cold)
    warm_report = measure_har(warm)
    comparison: dict[str, Any] = {}

    for output_name, metric_name, operation in (
        ("elapsed_ms_saved", "elapsed_ms", lambda a, b: a - b),
        ("wire_bytes_saved", "wire_bytes", lambda a, b: a - b),
        ("request_count_delta", "request_count", lambda a, b: b - a),
        ("confirmed_hits_delta", "confirmed_hits", lambda a, b: b - a),
        ("unknowns_delta", "unknowns", lambda a, b: b - a),
    ):
        cold_value = cold_report[metric_name]
        warm_value = warm_report[metric_name]
        if cold_value is None or warm_value is None:
            _metric(comparison, output_name, None, UNKNOWN)
        else:
            value = operation(cold_value, warm_value)
            if isinstance(value, float):
                value = round(value, 3)
            _metric(comparison, output_name, value, MEASURED)

    return {"cold": cold_report, "warm": warm_report, "comparison": comparison}


def _load_har(path: str, role: str) -> Mapping[str, Any]:
    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except json.JSONDecodeError as exc:
        raise HarError(
            f"invalid JSON in {role} HAR at line {exc.lineno}, column {exc.colno}"
        ) from None
    except (OSError, UnicodeError):
        raise HarError(f"unable to read {role} HAR") from None
    if not isinstance(value, Mapping):
        raise HarError(f"{role} HAR root is not an object")
    return value


def _format_value(value: Any) -> str:
    if value is None:
        return "UNKNOWN"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def format_readable(result: Mapping[str, Any]) -> str:
    """Render aggregate-only output; no request fields are included."""

    sections = (
        (
            "COLD",
            result["cold"],
            (
                "elapsed_ms",
                "wire_bytes",
                "request_count",
                "confirmed_hits",
                "confirmed_misses",
                "unknowns",
                "wire_bytes_unknown_requests",
            ),
        ),
        (
            "WARM",
            result["warm"],
            (
                "elapsed_ms",
                "wire_bytes",
                "request_count",
                "confirmed_hits",
                "confirmed_misses",
                "unknowns",
                "wire_bytes_unknown_requests",
            ),
        ),
        (
            "COMPARISON",
            result["comparison"],
            (
                "elapsed_ms_saved",
                "wire_bytes_saved",
                "request_count_delta",
                "confirmed_hits_delta",
                "unknowns_delta",
            ),
        ),
    )
    lines: list[str] = []
    for heading, values, names in sections:
        lines.append(heading)
        for name in names:
            lines.append(
                f"  {name}: {_format_value(values[name])} "
                f"[{values[name + '_label']}]"
            )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Compare aggregate measurements from cold and warm HAR files. "
            "Output never includes request URLs, query strings, headers, or cookies."
        )
    )
    parser.add_argument("cold_har", help="cold-run HAR file")
    parser.add_argument("warm_har", help="warm-run HAR file")
    parser.add_argument(
        "--format",
        choices=("readable", "json"),
        default="readable",
        help="output format (default: readable)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="shorthand for --format json",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = compare_hars(
            _load_har(args.cold_har, "cold"),
            _load_har(args.warm_har, "warm"),
        )
    except HarError as exc:
        parser.error(str(exc))

    if args.json or args.format == "json":
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(format_readable(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
