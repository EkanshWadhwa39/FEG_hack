#!/usr/bin/env python3
"""Compute T_ready and U(t) from a warm-telemetry run record.

The input is the flat JSON shape produced by
``src/src/warm-telemetry.js``'s ``getRun()``::

    {
      "assets": [
        {
          "id": "0",
          "stage": "PRELOADER" | "COMMON" | "SPLASH" | "PRIMARY",
          "bytes": 12345,
          "critical": true | false,
          "trigger": 12.5,
          "dispatch": 20.1,
          "resolve": 40.0,
          "admit": 55.3
        },
        ...
      ]
    }

``trigger``/``dispatch``/``resolve``/``admit`` are milliseconds on whatever
clock produced them (``performance.now()`` or ``Date.now()``); an event that
has not happened yet is ``null``. Only stage, byte counts, and timestamps are
read — never a URL, token, cookie, header, or player identifier. This tool
does not fabricate a hover-to-click delay distribution; the two sample
delays it reports on (1s, 5s) are fixed points from the plan, not a claim
about real user behavior.

Every number this tool prints carries an explicit provenance label:
MEASURED, SIMULATED-NETWORK, or UNKNOWN. A run record produced against a
throttled CDP network profile should be labelled SIMULATED-NETWORK by the
caller via --provenance; local/untouched runs default to MEASURED.
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

MEASURED = "MEASURED"
SIMULATED_NETWORK = "SIMULATED-NETWORK"
UNKNOWN = "UNKNOWN"

_VALID_PROVENANCE = {MEASURED, SIMULATED_NETWORK, UNKNOWN}
_READY_STAGES = {"PRELOADER", "COMMON", "SPLASH"}
_ALLOWED_STAGES = _READY_STAGES | {"PRIMARY"}
_SAMPLE_DELAYS_MS = (1000, 5000)


class WarmLatencyError(ValueError):
    """A safe, user-facing warm-telemetry parsing error."""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _nonnegative(value: Any) -> float | None:
    value = _number(value)
    return value if value is not None and value >= 0 else None


def _is_critical_path(asset: dict) -> bool:
    stage = asset.get("stage")
    if stage == "PRIMARY":
        return asset.get("critical") is True
    return stage in _READY_STAGES


def load_run(path: Path) -> list[dict]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise WarmLatencyError(f"cannot read run file: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise WarmLatencyError(f"run file is not valid JSON: {exc}") from exc

    if not isinstance(raw, dict) or not isinstance(raw.get("assets"), list):
        raise WarmLatencyError("run record must be an object with an 'assets' array")

    assets: list[dict] = []
    for index, entry in enumerate(raw["assets"]):
        if not isinstance(entry, dict):
            raise WarmLatencyError(f"asset {index} must be an object")
        stage = entry.get("stage")
        if stage not in _ALLOWED_STAGES:
            raise WarmLatencyError(f"asset {index} has an invalid stage")
        bytes_ = _nonnegative(entry.get("bytes"))
        if bytes_ is None:
            raise WarmLatencyError(f"asset {index} requires a non-negative 'bytes'")
        assets.append(
            {
                "stage": stage,
                "critical": entry.get("critical") is True,
                "bytes": bytes_,
                "trigger": _number(entry.get("trigger")),
                "admit": _number(entry.get("admit")),
            }
        )
    return assets


def compute_t_ready(assets: Sequence[dict]) -> float | None:
    """max(admit - trigger) over eligible critical-path assets, or None if
    no eligible asset has been admitted yet."""
    durations = [
        asset["admit"] - asset["trigger"]
        for asset in assets
        if _is_critical_path(asset) and asset["trigger"] is not None and asset["admit"] is not None
    ]
    return max(durations) if durations else None


def compute_unwarmed_bytes(assets: Sequence[dict], t_ms: float) -> float:
    """U(t): unwarmed critical bytes remaining t ms after the run's trigger
    (the earliest recorded trigger among eligible assets)."""
    if not math.isfinite(t_ms) or t_ms < 0:
        raise WarmLatencyError("t must be a finite, non-negative number of milliseconds")

    eligible = [asset for asset in assets if _is_critical_path(asset)]
    if not eligible:
        return 0.0

    triggers = [asset["trigger"] for asset in eligible if asset["trigger"] is not None]
    if not triggers:
        raise WarmLatencyError("eligible assets must have a recorded trigger")
    run_trigger = min(triggers)
    cutoff = run_trigger + t_ms

    remaining = 0.0
    for asset in eligible:
        admitted = asset["admit"] is not None and asset["admit"] <= cutoff
        if not admitted:
            remaining += asset["bytes"]
    return remaining


def _format(label: str, value: float | None, provenance: str, unit: str = "ms") -> str:
    if value is None:
        return f"{label}: UNKNOWN (no eligible asset admitted yet)"
    return f"{label}: {value:g}{unit} [{provenance}]"


def build_report(assets: Sequence[dict], provenance: str) -> str:
    t_ready = compute_t_ready(assets)
    lines = [_format("T_ready", t_ready, provenance if t_ready is not None else UNKNOWN)]
    for delay_ms in _SAMPLE_DELAYS_MS:
        u_value = compute_unwarmed_bytes(assets, delay_ms)
        lines.append(
            f"U({delay_ms}ms): {u_value:g} bytes [{provenance}]"
        )
    return "\n".join(lines)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute T_ready and U(t) from a warm-telemetry run record.",
    )
    parser.add_argument("run_file", type=Path, help="path to a warm-telemetry run JSON file")
    parser.add_argument(
        "--provenance",
        choices=sorted(_VALID_PROVENANCE),
        default=MEASURED,
        help="label applied to every reported number (default: MEASURED)",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        assets = load_run(args.run_file)
        print(build_report(assets, args.provenance))
    except WarmLatencyError as exc:
        print(f"error: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
