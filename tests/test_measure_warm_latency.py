import json

import pytest

from tools import measure_warm_latency as mwl


def asset(*, stage="COMMON", bytes=100, critical=False, trigger=0.0, admit=None):
    return {
        "stage": stage,
        "bytes": bytes,
        "critical": critical,
        "trigger": trigger,
        "admit": admit,
    }


def run(*assets):
    return {"assets": list(assets)}


def write_run(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def test_compute_t_ready_is_max_admit_minus_trigger_over_eligible_assets():
    assets = [
        {"stage": "PRELOADER", "critical": False, "bytes": 10, "trigger": 0, "admit": 100},
        {"stage": "COMMON", "critical": False, "bytes": 10, "trigger": 0, "admit": 400},
        {"stage": "PRIMARY", "critical": False, "bytes": 10, "trigger": 0, "admit": 900},
        {"stage": "PRIMARY", "critical": True, "bytes": 10, "trigger": 0, "admit": 250},
    ]
    assert mwl.compute_t_ready(assets) == 400


def test_compute_t_ready_returns_none_when_nothing_eligible_is_admitted():
    assets = [{"stage": "PRIMARY", "critical": False, "bytes": 10, "trigger": 0, "admit": None}]
    assert mwl.compute_t_ready(assets) is None


def test_compute_unwarmed_bytes_counts_only_still_unadmitted_critical_path_bytes():
    assets = [
        {"stage": "PRELOADER", "critical": False, "bytes": 100, "trigger": 0, "admit": 200},
        {"stage": "COMMON", "critical": False, "bytes": 100, "trigger": 0, "admit": 800},
    ]
    assert mwl.compute_unwarmed_bytes(assets, 100) == 200
    assert mwl.compute_unwarmed_bytes(assets, 200) == 100
    assert mwl.compute_unwarmed_bytes(assets, 800) == 0


def test_compute_unwarmed_bytes_excludes_noncritical_primary():
    assets = [
        {"stage": "PRIMARY", "critical": False, "bytes": 500, "trigger": 0, "admit": None},
        {"stage": "PRIMARY", "critical": True, "bytes": 50, "trigger": 10, "admit": 20},
    ]
    assert mwl.compute_unwarmed_bytes(assets, 0) == 50
    assert mwl.compute_unwarmed_bytes(assets, 10) == 0


def test_compute_unwarmed_bytes_rejects_negative_t():
    with pytest.raises(mwl.WarmLatencyError):
        mwl.compute_unwarmed_bytes([], -1)


def test_load_run_rejects_invalid_stage(tmp_path):
    path = tmp_path / "run.json"
    write_run(path, run(asset(stage="BOGUS")))
    with pytest.raises(mwl.WarmLatencyError):
        mwl.load_run(path)


def test_load_run_rejects_negative_bytes(tmp_path):
    path = tmp_path / "run.json"
    write_run(path, run(asset(bytes=-1)))
    with pytest.raises(mwl.WarmLatencyError):
        mwl.load_run(path)


def test_load_run_rejects_malformed_json(tmp_path):
    path = tmp_path / "run.json"
    path.write_text("not json", encoding="utf-8")
    with pytest.raises(mwl.WarmLatencyError):
        mwl.load_run(path)


def test_load_run_rejects_missing_assets_array(tmp_path):
    path = tmp_path / "run.json"
    write_run(path, {"not_assets": []})
    with pytest.raises(mwl.WarmLatencyError):
        mwl.load_run(path)


def test_build_report_labels_every_number_with_provenance(tmp_path):
    assets = [
        {"stage": "PRELOADER", "critical": False, "bytes": 100, "trigger": 0.0, "admit": 500.0},
    ]
    report = mwl.build_report(assets, mwl.SIMULATED_NETWORK)
    assert "T_ready: 500ms [SIMULATED-NETWORK]" in report
    assert "U(1000ms):" in report and "[SIMULATED-NETWORK]" in report
    assert "U(5000ms):" in report
    for line in report.splitlines():
        assert "[" in line and "]" in line


def test_build_report_labels_t_ready_unknown_when_nothing_admitted():
    assets = [{"stage": "PRELOADER", "critical": False, "bytes": 100, "trigger": 0.0, "admit": None}]
    report = mwl.build_report(assets, mwl.MEASURED)
    assert "T_ready: UNKNOWN" in report


def test_main_prints_report_and_returns_zero(tmp_path, capsys):
    path = tmp_path / "run.json"
    write_run(
        path,
        run(asset(stage="PRELOADER", bytes=100, trigger=0.0, admit=500.0)),
    )
    exit_code = mwl.main([str(path)])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "T_ready: 500ms [MEASURED]" in captured.out


def test_main_reports_simulated_network_provenance_flag(tmp_path, capsys):
    path = tmp_path / "run.json"
    write_run(
        path,
        run(asset(stage="PRELOADER", bytes=100, trigger=0.0, admit=500.0)),
    )
    exit_code = mwl.main([str(path), "--provenance", "SIMULATED-NETWORK"])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "[SIMULATED-NETWORK]" in captured.out


def test_main_returns_nonzero_on_invalid_run_file(tmp_path, capsys):
    path = tmp_path / "run.json"
    path.write_text("not json", encoding="utf-8")
    exit_code = mwl.main([str(path)])
    captured = capsys.readouterr()
    assert exit_code == 1
    assert "error:" in captured.out
