"""Tests for tools/redact_har.py.

All fixtures use synthetic data only — no real provider URLs, tokens, or
credentials. Test output never prints raw fixture URLs; assertions check
that sensitive values have been replaced with opaque labels or [REDACTED].
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "tools"))
from redact_har import (
    RedactionError,
    aggregate_redacted,
    format_aggregate,
    redact_har,
)

# ---------------------------------------------------------------------------
# Synthetic HAR builders — never use real provider domains or tokens
# ---------------------------------------------------------------------------

_SYNTHETIC_URL_A = "https://fixture.invalid/bundle.js?v=SYNTH_A"
_SYNTHETIC_URL_B = "https://fixture.invalid/sprite.webp?v=SYNTH_B"
_SYNTHETIC_TOKEN = "Bearer SYNTH_TOKEN_NOT_REAL"
_SYNTHETIC_SESSION = "session=SYNTH_SID_NOT_REAL"
_SYNTHETIC_BODY = "SYNTH_BODY_CONTENT_NOT_REAL"


def _make_entry(
    *,
    url: str = _SYNTHETIC_URL_A,
    status: int = 200,
    transfer_size: int | None = 1024,
    from_cache: str | None = None,
    extra_req_headers: list | None = None,
    extra_resp_headers: list | None = None,
) -> dict:
    req_headers = [
        {"name": "Accept", "value": "application/javascript"},
        {"name": "Authorization", "value": _SYNTHETIC_TOKEN},
        {"name": "Cookie", "value": _SYNTHETIC_SESSION},
        {"name": "Cache-Control", "value": "no-cache"},
    ]
    if extra_req_headers:
        req_headers.extend(extra_req_headers)

    resp_headers = [
        {"name": "Cache-Control", "value": "public, max-age=31536000"},
        {"name": "Set-Cookie", "value": "sid=SYNTH_RESP_SID; Path=/"},
        {"name": "Content-Type", "value": "application/javascript"},
        {"name": "X-Custom-Internal", "value": "SYNTH_INTERNAL_VALUE"},
    ]
    if extra_resp_headers:
        resp_headers.extend(extra_resp_headers)

    response: dict = {
        "status": status,
        "statusText": "OK",
        "httpVersion": "HTTP/2",
        "headers": resp_headers,
        "cookies": [{"name": "sid", "value": "SYNTH_RESP_SID"}],
        "content": {
            "size": 1024,
            "mimeType": "application/javascript",
            "text": _SYNTHETIC_BODY,
        },
        "redirectURL": "",
        "headersSize": 100,
        "bodySize": 1024,
    }
    if transfer_size is not None:
        response["_transferSize"] = transfer_size
    if from_cache is not None:
        response["_fromCache"] = from_cache

    return {
        "startedDateTime": "2026-01-01T00:00:00.000Z",
        "time": 42.0,
        "timings": {"send": 0.0, "wait": 40.0, "receive": 2.0},
        "cache": {},
        "pageref": "page_1",
        "request": {
            "method": "GET",
            "url": url,
            "httpVersion": "HTTP/2",
            "headers": req_headers,
            "queryString": [{"name": "v", "value": "SYNTH_A"}],
            "cookies": [{"name": "session", "value": "SYNTH_SID_NOT_REAL"}],
            "headersSize": 200,
            "bodySize": -1,
        },
        "response": response,
    }


def _make_har(entries: list | None = None) -> dict:
    return {
        "log": {
            "version": "1.2",
            "creator": {"name": "Chrome", "version": "120.0"},
            "browser": {"name": "Chrome", "version": "120.0"},
            "pages": [
                {
                    "startedDateTime": "2026-01-01T00:00:00.000Z",
                    "id": "page_1",
                    "title": "SYNTH_PAGE_TITLE — https://fixture.invalid/game",
                    "pageTimings": {"onLoad": 5000, "onContentLoad": 2000},
                }
            ],
            "entries": entries if entries is not None else [_make_entry()],
        }
    }


# ---------------------------------------------------------------------------
# URL redaction
# ---------------------------------------------------------------------------


class TestUrlRedaction:
    def test_raw_domain_not_in_output(self):
        har = _make_har([_make_entry(url=_SYNTHETIC_URL_A)])
        output = json.dumps(redact_har(har))
        assert "fixture.invalid" not in output

    def test_raw_path_not_in_output(self):
        har = _make_har([_make_entry(url=_SYNTHETIC_URL_A)])
        output = json.dumps(redact_har(har))
        assert "bundle.js" not in output

    def test_query_string_value_not_in_output(self):
        har = _make_har([_make_entry(url=_SYNTHETIC_URL_A)])
        output = json.dumps(redact_har(har))
        assert "SYNTH_A" not in output

    def test_url_replaced_with_opaque_label(self):
        result = redact_har(_make_har([_make_entry(url=_SYNTHETIC_URL_A)]))
        label = result["log"]["entries"][0]["request"]["url"]
        assert label == "asset-1"
        assert "fixture" not in label

    def test_same_url_same_label(self):
        result = redact_har(_make_har([_make_entry(url=_SYNTHETIC_URL_A), _make_entry(url=_SYNTHETIC_URL_A)]))
        entries = result["log"]["entries"]
        assert entries[0]["request"]["url"] == entries[1]["request"]["url"]

    def test_different_urls_different_labels(self):
        result = redact_har(_make_har([_make_entry(url=_SYNTHETIC_URL_A), _make_entry(url=_SYNTHETIC_URL_B)]))
        labels = [e["request"]["url"] for e in result["log"]["entries"]]
        assert labels[0] != labels[1]

    def test_unique_url_count_reported(self):
        result = redact_har(
            _make_har(
                [_make_entry(url=_SYNTHETIC_URL_A), _make_entry(url=_SYNTHETIC_URL_B), _make_entry(url=_SYNTHETIC_URL_A)]
            )
        )
        assert result["log"]["_redaction"]["unique_urls_redacted"] == 2

    def test_query_string_array_emptied(self):
        result = redact_har(_make_har([_make_entry()]))
        assert result["log"]["entries"][0]["request"]["queryString"] == []

    def test_redirect_url_stripped(self):
        entry = _make_entry()
        entry["response"]["redirectURL"] = "https://fixture.invalid/redirect?tok=SYNTH"
        result = redact_har(_make_har([entry]))
        assert result["log"]["entries"][0]["response"]["redirectURL"] == ""
        assert "SYNTH" not in json.dumps(result)

    def test_page_title_redacted(self):
        result = redact_har(_make_har())
        output = json.dumps(result)
        assert "SYNTH_PAGE_TITLE" not in output
        assert "fixture.invalid" not in output
        assert result["log"]["pages"][0]["title"] == "Page 1"


# ---------------------------------------------------------------------------
# Header redaction
# ---------------------------------------------------------------------------


class TestHeaderRedaction:
    def test_authorization_header_value_redacted(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["request"]["headers"]
        auth = next(h for h in headers if h["name"] == "Authorization")
        assert auth["value"] == "[REDACTED]"
        assert "SYNTH_TOKEN" not in json.dumps(result)

    def test_cookie_header_value_redacted(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["request"]["headers"]
        cookie = next(h for h in headers if h["name"] == "Cookie")
        assert cookie["value"] == "[REDACTED]"
        assert "SYNTH_SID" not in json.dumps(result)

    def test_set_cookie_response_header_redacted(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["response"]["headers"]
        sc = next(h for h in headers if h["name"] == "Set-Cookie")
        assert sc["value"] == "[REDACTED]"
        assert "SYNTH_RESP_SID" not in json.dumps(result)

    def test_custom_internal_header_redacted(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["response"]["headers"]
        custom = next(h for h in headers if h["name"] == "X-Custom-Internal")
        assert custom["value"] == "[REDACTED]"
        assert "SYNTH_INTERNAL_VALUE" not in json.dumps(result)

    def test_safe_request_cache_control_preserved(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["request"]["headers"]
        cc = next(h for h in headers if h["name"] == "Cache-Control")
        assert cc["value"] == "no-cache"

    def test_safe_response_cache_control_preserved(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["response"]["headers"]
        cc = next(h for h in headers if h["name"] == "Cache-Control")
        assert cc["value"] == "public, max-age=31536000"

    def test_safe_accept_header_preserved(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["request"]["headers"]
        accept = next(h for h in headers if h["name"] == "Accept")
        assert accept["value"] == "application/javascript"

    def test_header_name_always_retained(self):
        result = redact_har(_make_har())
        headers = result["log"]["entries"][0]["response"]["headers"]
        names = {h["name"] for h in headers}
        assert "Set-Cookie" in names
        assert "X-Custom-Internal" in names


# ---------------------------------------------------------------------------
# Cookie stripping
# ---------------------------------------------------------------------------


class TestCookieStripping:
    def test_request_cookies_empty(self):
        result = redact_har(_make_har())
        assert result["log"]["entries"][0]["request"]["cookies"] == []

    def test_response_cookies_empty(self):
        result = redact_har(_make_har())
        assert result["log"]["entries"][0]["response"]["cookies"] == []

    def test_cookie_values_not_in_output(self):
        output = json.dumps(redact_har(_make_har()))
        assert "SYNTH_SID_NOT_REAL" not in output
        assert "SYNTH_RESP_SID" not in output


# ---------------------------------------------------------------------------
# Body stripping
# ---------------------------------------------------------------------------


class TestBodyStripping:
    def test_response_body_text_absent(self):
        result = redact_har(_make_har())
        content = result["log"]["entries"][0]["response"]["content"]
        assert "text" not in content

    def test_body_content_not_in_output(self):
        assert _SYNTHETIC_BODY not in json.dumps(redact_har(_make_har()))

    def test_mime_type_preserved(self):
        result = redact_har(_make_har())
        content = result["log"]["entries"][0]["response"]["content"]
        assert content["mimeType"] == "application/javascript"

    def test_content_size_preserved(self):
        result = redact_har(_make_har())
        content = result["log"]["entries"][0]["response"]["content"]
        assert content["size"] == 1024


# ---------------------------------------------------------------------------
# Timing and size preservation
# ---------------------------------------------------------------------------


class TestPreservation:
    def test_entry_time_preserved(self):
        result = redact_har(_make_har())
        assert result["log"]["entries"][0]["time"] == 42.0

    def test_timings_preserved(self):
        result = redact_har(_make_har())
        timings = result["log"]["entries"][0]["timings"]
        assert timings["wait"] == 40.0
        assert timings["receive"] == 2.0

    def test_transfer_size_preserved(self):
        result = redact_har(_make_har([_make_entry(transfer_size=8192)]))
        assert result["log"]["entries"][0]["response"]["_transferSize"] == 8192

    def test_status_code_preserved(self):
        result = redact_har(_make_har([_make_entry(status=304)]))
        assert result["log"]["entries"][0]["response"]["status"] == 304

    def test_method_preserved(self):
        entry = _make_entry()
        entry["request"]["method"] = "HEAD"
        result = redact_har(_make_har([entry]))
        assert result["log"]["entries"][0]["request"]["method"] == "HEAD"

    def test_from_cache_field_preserved(self):
        result = redact_har(_make_har([_make_entry(from_cache="disk cache")]))
        assert result["log"]["entries"][0]["response"]["_fromCache"] == "disk cache"

    def test_page_timing_preserved(self):
        result = redact_har(_make_har())
        assert result["log"]["pages"][0]["pageTimings"]["onLoad"] == 5000

    def test_pageref_preserved(self):
        result = redact_har(_make_har())
        assert result["log"]["entries"][0]["pageref"] == "page_1"

    def test_server_ip_absent(self):
        entry = _make_entry()
        entry["serverIPAddress"] = "192.0.2.1"
        result = redact_har(_make_har([entry]))
        assert "serverIPAddress" not in result["log"]["entries"][0]
        assert "192.0.2.1" not in json.dumps(result)

    def test_creator_name_preserved(self):
        result = redact_har(_make_har())
        assert result["log"]["creator"]["name"] == "Chrome"


# ---------------------------------------------------------------------------
# Aggregate metrics
# ---------------------------------------------------------------------------


class TestAggregateMetrics:
    def test_entry_count(self):
        result = redact_har(_make_har([_make_entry(), _make_entry()]))
        agg = aggregate_redacted(result)
        assert agg["total_entries"] == 2
        assert agg["total_entries_label"] == "MEASURED"

    def test_transfer_bytes_sum(self):
        result = redact_har(_make_har([_make_entry(transfer_size=1000), _make_entry(transfer_size=2000)]))
        agg = aggregate_redacted(result)
        assert agg["transfer_bytes"] == 3000
        assert agg["transfer_bytes_label"] == "MEASURED"

    def test_missing_transfer_unknown(self):
        result = redact_har(_make_har([_make_entry(transfer_size=None)]))
        agg = aggregate_redacted(result)
        assert agg["transfer_bytes"] is None
        assert agg["transfer_bytes_label"] == "UNKNOWN"

    def test_status_distribution(self):
        result = redact_har(
            _make_har([_make_entry(status=200), _make_entry(status=304), _make_entry(status=200)])
        )
        agg = aggregate_redacted(result)
        dist = agg["status_distribution"]
        assert dist[200] == 2
        assert dist[304] == 1

    def test_unique_urls_reported(self):
        result = redact_har(_make_har([_make_entry(url=_SYNTHETIC_URL_A), _make_entry(url=_SYNTHETIC_URL_B)]))
        agg = aggregate_redacted(result)
        assert agg["unique_urls_redacted"] == 2
        assert agg["unique_urls_redacted_label"] == "MEASURED"

    def test_aggregate_output_contains_no_sensitive_data(self):
        result = redact_har(_make_har())
        agg = aggregate_redacted(result)
        output = format_aggregate(agg)
        assert "SYNTH" not in output
        assert "fixture.invalid" not in output
        assert "bundle.js" not in output


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    def test_non_mapping_root(self):
        with pytest.raises(RedactionError, match="root must be an object"):
            redact_har([])

    def test_missing_log(self):
        with pytest.raises(RedactionError, match="no log object"):
            redact_har({})

    def test_missing_entries(self):
        with pytest.raises(RedactionError, match="no entries array"):
            redact_har({"log": {}})

    def test_non_mapping_entries_skipped(self):
        har = _make_har(["not-a-mapping", None, _make_entry()])
        result = redact_har(har)
        # non-mapping entries are filtered out
        assert len(result["log"]["entries"]) == 1

    def test_redaction_note_present(self):
        result = redact_har(_make_har())
        note = result["log"]["_redaction"]["note"]
        assert "opaque labels" in note
        assert "asset-N" in note

    def test_format_aggregate_labels_all_numbers(self):
        result = redact_har(_make_har([_make_entry(transfer_size=512)]))
        agg = aggregate_redacted(result)
        output = format_aggregate(agg)
        # Every numeric value line should contain a label in brackets
        for line in output.splitlines()[1:]:
            assert "[MEASURED]" in line or "[UNKNOWN]" in line, f"unlabeled line: {line!r}"
