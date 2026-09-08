import json
import subprocess
import sys
from pathlib import Path

import pytest

from tools import measure_har


SCRIPT = Path(__file__).parents[1] / "tools" / "measure_har.py"


def entry(
    *,
    url="https://cdn.example/game.js?v=secret",
    started="2026-01-01T00:00:00Z",
    duration=10,
    transfer=100,
    cache_marker=None,
):
    result = {
        "startedDateTime": started,
        "time": duration,
        "request": {
            "url": url,
            "headers": [{"name": "Authorization", "value": "Bearer secret-token"}],
            "cookies": [{"name": "session", "value": "secret-cookie"}],
            "queryString": [{"name": "token", "value": "secret-query"}],
        },
        "response": {"_transferSize": transfer},
        "cache": {},
    }
    if cache_marker is not None:
        result["_fromCache"] = cache_marker
    return result


def har(*entries):
    return {"log": {"entries": list(entries)}}


def write_har(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def test_compare_reports_required_metrics_and_deltas():
    cold = har(
        entry(duration=100, transfer=125, cache_marker=False),
        entry(
            started="2026-01-01T00:00:00.050Z",
            duration=100,
            transfer=0,
            cache_marker="disk",
        ),
        entry(
            url="data:image/png;base64,secret-payload",
            duration=1000,
            transfer=999,
            cache_marker=False,
        ),
    )
    warm = har(
        entry(duration=25, transfer=0, cache_marker="memory"),
        entry(
            started="2026-01-01T00:00:00.010Z",
            duration=20,
            transfer=0,
        ),
    )

    result = measure_har.compare_hars(cold, warm)

    assert result["cold"]["elapsed_ms"] == 150.0
    assert result["cold"]["wire_bytes"] == 125
    assert result["cold"]["request_count"] == 2
    assert result["cold"]["confirmed_hits"] == 1
    assert result["cold"]["confirmed_misses"] == 1
    assert result["cold"]["unknowns"] == 0
    assert result["warm"]["elapsed_ms"] == 30.0
    assert result["warm"]["confirmed_hits"] == 1
    assert result["warm"]["unknowns"] == 1
    assert result["comparison"]["elapsed_ms_saved"] == 120.0
    assert result["comparison"]["wire_bytes_saved"] == 125
    assert result["comparison"]["unknowns_delta"] == 1
    assert result["comparison"]["elapsed_ms_saved_label"] == "MEASURED"


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"_fromCache": "disk"}, "hit"),
        ({"_fromMemoryCache": True}, "hit"),
        ({"_servedFromCache": True}, "hit"),
        ({"_fromCache": False}, "miss"),
    ],
)
def test_explicit_cache_markers(changes, expected):
    value = entry(transfer=0)
    value.update(changes)
    assert measure_har.classify_cache(value) == expected


def test_cache_classification_is_conservative():
    zero_transfer = entry(transfer=0)
    zero_transfer["cache"] = {"beforeRequest": {"expires": "2099-01-01T00:00:00Z"}}
    assert measure_har.classify_cache(zero_transfer) == "unknown"

    revalidated = entry(transfer=0)
    revalidated["response"]["status"] = 304
    assert measure_har.classify_cache(revalidated) == "unknown"

    contradictory = entry(transfer=7, cache_marker="memory")
    assert measure_har.classify_cache(contradictory) == "unknown"

    service_worker = entry(transfer=0, cache_marker="disk")
    service_worker["response"]["_fetchedViaServiceWorker"] = True
    assert measure_har.classify_cache(service_worker) == "unknown"


def test_missing_optional_fields_are_tolerated_and_labeled_unknown():
    report = measure_har.measure_har(har({}, {"request": {}}))

    assert report["request_count"] == 2
    assert report["confirmed_hits"] == 0
    assert report["unknowns"] == 2
    assert report["elapsed_ms"] is None
    assert report["elapsed_ms_label"] == "UNKNOWN"
    assert report["wire_bytes"] is None
    assert report["wire_bytes_label"] == "UNKNOWN"
    assert report["wire_bytes_unknown_requests"] == 2


def test_standard_har_sizes_are_wire_byte_fallback():
    value = entry(transfer=0)
    del value["response"]["_transferSize"]
    value["response"].update({"headersSize": 20, "bodySize": 80})

    report = measure_har.measure_har(har(value))

    assert report["wire_bytes"] == 100
    assert report["wire_bytes_label"] == "MEASURED"
    assert report["confirmed_misses"] == 0
    assert report["unknowns"] == 1


def test_exact_request_set_milestone_uses_successful_completion():
    first_url = "https://cdn.example/first.bin?v=exact"
    second_url = "https://cdn.example/second.bin?v=exact"
    failed = entry(url=second_url, duration=5)
    failed["response"]["status"] = 404
    successful_first = entry(url=first_url, duration=25)
    successful_first["response"]["status"] = 200
    successful_second = entry(
        url=second_url,
        started="2026-01-01T00:00:00.010Z",
        duration=40,
    )
    successful_second["response"]["status"] = 200

    report = measure_har.measure_har(
        har(failed, successful_first, successful_second),
        frozenset({first_url, second_url}),
    )

    assert report["milestone_elapsed_ms"] == 50.0
    assert report["milestone_elapsed_ms_label"] == "MEASURED"
    assert report["milestone_target_count"] == 2
    assert report["milestone_matched_count"] == 2


def test_milestone_exact_url_mismatch_is_unknown():
    captured_url = "https://cdn.example/asset.bin?v=one"
    requested_url = "https://cdn.example/asset.bin?v=two"
    value = entry(url=captured_url)
    value["response"]["status"] = 200

    report = measure_har.measure_har(har(value), frozenset({requested_url}))

    assert report["milestone_elapsed_ms"] is None
    assert report["milestone_elapsed_ms_label"] == "UNKNOWN"
    assert report["milestone_target_count"] == 1
    assert report["milestone_matched_count"] == 0


@pytest.mark.parametrize("output_option", [[], ["--json"], ["--format", "json"]])
def test_cli_outputs_aggregates_without_secrets(tmp_path, output_option):
    cold_path = tmp_path / "cold.har"
    warm_path = tmp_path / "warm.har"
    write_har(cold_path, har(entry(cache_marker=False)))
    write_har(warm_path, har(entry(transfer=0, cache_marker="memory")))

    completed = subprocess.run(
        [sys.executable, str(SCRIPT), str(cold_path), str(warm_path), *output_option],
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 0
    assert "secret-token" not in completed.stdout
    assert "secret-cookie" not in completed.stdout
    assert "secret-query" not in completed.stdout
    assert "game.js" not in completed.stdout
    assert "confirmed_hits" in completed.stdout
    if output_option:
        parsed = json.loads(completed.stdout)
        assert parsed["cold"]["request_count"] == 1
    else:
        assert "COLD" in completed.stdout
        assert "[MEASURED]" in completed.stdout


def test_cli_help():
    completed = subprocess.run(
        [sys.executable, str(SCRIPT), "--help"],
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 0
    assert "cold_har" in completed.stdout
    assert "warm_har" in completed.stdout
    assert "--json" in completed.stdout


def test_invalid_json_error_does_not_echo_file_contents(tmp_path):
    cold_path = tmp_path / "cold.har"
    warm_path = tmp_path / "warm.har"
    cold_path.write_text('{"Authorization":"secret-token", broken', encoding="utf-8")
    write_har(warm_path, har())

    completed = subprocess.run(
        [sys.executable, str(SCRIPT), str(cold_path), str(warm_path)],
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 2
    assert "invalid JSON in cold HAR" in completed.stderr
    assert "secret-token" not in completed.stderr


def test_malformed_required_har_structure_has_safe_error():
    with pytest.raises(measure_har.HarError, match="no log object"):
        measure_har.measure_har({})
