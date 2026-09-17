"""
Tests for api/monitor/ — value_path resolution, the fetcher (HTTP calls
monkeypatched, never hits the network), the SQLite-backed store, the
scheduler, and the health view.
"""

import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
import requests

from monitor import fetcher, health, scheduler, store
from monitor.value_path import ValuePathError, parse, resolve, resolve_first
from products import registry


# ── value_path.py ────────────────────────────────────────────────────────

SAMPLE_RESPONSE = {
    "status": "success",
    "response": {
        "ALL-LOSSES": [
            {"year": "2023", "economic-loss | total": 300, "industry-loss | total": 120},
            {"year": "2024", "economic-loss | total": 417, "industry-loss | total": 154},
        ]
    },
}


def test_parse_mixed_path():
    segments = parse('response.ALL-LOSSES[-1]."industry-loss | total"')
    assert segments == ["response", "ALL-LOSSES", -1, "industry-loss | total"]


def test_resolve_last_year_industry_loss():
    assert resolve(SAMPLE_RESPONSE, 'response.ALL-LOSSES[-1]."industry-loss | total"') == 154


def test_resolve_specific_index():
    assert resolve(SAMPLE_RESPONSE, 'response.ALL-LOSSES[0]."economic-loss | total"') == 300


def test_resolve_missing_key_raises():
    with pytest.raises(ValuePathError, match="not found"):
        resolve(SAMPLE_RESPONSE, "response.NOT-A-KEY")


def test_resolve_index_out_of_range_raises():
    with pytest.raises(ValuePathError, match="out of range"):
        resolve(SAMPLE_RESPONSE, "response.ALL-LOSSES[99].year")


def test_resolve_indexing_a_non_list_raises():
    with pytest.raises(ValuePathError, match="expected a list"):
        resolve(SAMPLE_RESPONSE, "response[0]")


def test_resolve_keying_a_non_dict_raises():
    with pytest.raises(ValuePathError, match="expected an object"):
        resolve(SAMPLE_RESPONSE, "response.ALL-LOSSES.year")


def test_resolve_non_numeric_result_raises():
    with pytest.raises(ValuePathError, match="non-numeric"):
        resolve(SAMPLE_RESPONSE, "response.ALL-LOSSES[-1].year")


def test_parse_empty_path_raises():
    with pytest.raises(ValuePathError):
        parse("")


# ── resolve_first — fallback chains (real-world case: current in-progress
# year has no full-year total yet, only whatever quarters have completed) ──

IN_PROGRESS_YEAR = {
    "response": {
        "reports": {
            "year": "2026",
            "Q1 economic": 58,
            "Q1 industry": 20,
            "Q2 | economic": 142,
            "Q2 | industry": 46,
            # no "economic-loss | total" / "industry-loss | total" yet, no Q3 yet
        }
    }
}

ECONOMIC_CHAIN = [
    'response.reports."economic-loss | total"',
    'response.reports."Q3 | economic "',
    'response.reports."Q2 | economic"',
    'response.reports."Q1 economic"',
]


def test_resolve_first_falls_back_to_latest_available_quarter():
    # total and Q3 are both missing; Q2 is the best available.
    assert resolve_first(IN_PROGRESS_YEAR, ECONOMIC_CHAIN) == 142


def test_resolve_first_prefers_earlier_entries_when_present():
    complete_year = {"response": {"reports": {"economic-loss | total": 417, "Q2 | economic": 142}}}
    assert resolve_first(complete_year, ECONOMIC_CHAIN) == 417


def test_resolve_first_raises_when_nothing_in_chain_resolves():
    with pytest.raises(ValuePathError, match="no path in the fallback chain resolved"):
        resolve_first({"response": {"reports": {}}}, ECONOMIC_CHAIN)


# ── fetcher.py (network monkeypatched) ──────────────────────────────────

PRODUCT = {
    "product_id": "natcat_loss",
    "version": 2,
    "endpoint": "https://example.com/api",
    "method": "POST",
    "auth": "TEST_AUTH_ENV",
    "call_parameters": {},
    "value_paths": {
        "economic_loss": ECONOMIC_CHAIN,
        "industry_loss": [
            'response.reports."industry-loss | total"',
            'response.reports."Q3 | industry "',
            'response.reports."Q2 | industry"',
            'response.reports."Q1 industry"',
        ],
    },
}


# A completed year, matching PRODUCT's "reports" shape — used wherever a
# test wants the fallback chain's primary (total) entry to resolve cleanly.
COMPLETE_YEAR_RESPONSE = {
    "response": {
        "reports": {
            "year": "2024",
            "economic-loss | total": 417,
            "industry-loss | total": 154,
        }
    }
}


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, content=b"{}", bad_json=False):
        self.status_code = status_code
        self._json_data = json_data
        self.content = content

        def _json():
            if bad_json:
                raise ValueError("not valid json")
            return self._json_data
        self.json = _json


@pytest.fixture
def auth_env(monkeypatch):
    monkeypatch.setenv("TEST_AUTH_ENV", "test-secret")


def test_fetch_raw_success(monkeypatch, auth_env):
    body = b'{"ok": true}'
    monkeypatch.setattr(requests, "request", lambda *a, **k: FakeResponse(200, {"ok": True}, body))
    result = fetcher.fetch_raw(PRODUCT)
    assert result["error"] is None
    assert result["data"] == {"ok": True}
    assert result["http_status"] == 200
    import hashlib
    assert result["raw_response_hash"] == hashlib.sha256(body).hexdigest()


def test_fetch_raw_missing_auth_env(monkeypatch):
    monkeypatch.delenv("TEST_AUTH_ENV", raising=False)
    result = fetcher.fetch_raw(PRODUCT)
    assert result["error"] is not None
    assert "TEST_AUTH_ENV" in result["error"]
    assert result["data"] is None


def test_fetch_raw_network_error(monkeypatch, auth_env):
    def _raise(*a, **k):
        raise requests.ConnectionError("boom")
    monkeypatch.setattr(requests, "request", _raise)
    result = fetcher.fetch_raw(PRODUCT)
    assert result["error"] is not None
    assert "request failed" in result["error"]


def test_fetch_raw_non_2xx(monkeypatch, auth_env):
    monkeypatch.setattr(requests, "request", lambda *a, **k: FakeResponse(500, None, b"error"))
    result = fetcher.fetch_raw(PRODUCT)
    assert result["error"] is not None
    assert "500" in result["error"]
    assert result["raw_response_hash"] is not None  # hash still computed on a bad status


def test_fetch_raw_invalid_json(monkeypatch, auth_env):
    monkeypatch.setattr(requests, "request", lambda *a, **k: FakeResponse(200, None, b"not json", bad_json=True))
    result = fetcher.fetch_raw(PRODUCT)
    assert result["error"] is not None
    assert "not valid JSON" in result["error"]


def test_resolve_metric_success():
    value, error = fetcher.resolve_metric(COMPLETE_YEAR_RESPONSE, PRODUCT["value_paths"]["economic_loss"])
    assert value == 417
    assert error is None


def test_resolve_metric_success_with_fallback_chain():
    value, error = fetcher.resolve_metric(IN_PROGRESS_YEAR, ECONOMIC_CHAIN)
    assert value == 142  # total/Q3 missing, Q2 is the best available
    assert error is None


def test_resolve_metric_failure():
    value, error = fetcher.resolve_metric(COMPLETE_YEAR_RESPONSE, "response.NOT-A-KEY")
    assert value is None
    assert "value_path did not resolve" in error


# ── store.py ─────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "test_monitor.db")


def test_record_and_get_buffer(db_path):
    store.record_entry("p1", 1, "m1", value=100.0, http_status=200, raw_response_hash="h1", db_path=db_path)
    store.record_entry("p1", 1, "m1", value=200.0, http_status=200, raw_response_hash="h2", db_path=db_path)
    buf = store.get_buffer("p1", "m1", db_path=db_path)
    assert len(buf) == 2
    assert buf[0]["value"] == 200.0  # newest first
    assert buf[1]["value"] == 100.0


def test_buffer_prunes_to_20(db_path):
    for i in range(25):
        store.record_entry("p1", 1, "m1", value=float(i), http_status=200, raw_response_hash=f"h{i}", db_path=db_path)
    buf = store.get_buffer("p1", "m1", limit=100, db_path=db_path)
    assert len(buf) == 20
    assert buf[0]["value"] == 24.0  # newest
    assert buf[-1]["value"] == 5.0  # oldest surviving (0-4 pruned)


def test_metrics_on_same_product_are_independent(db_path):
    store.record_entry("p1", 1, "economic_loss", value=1.0, http_status=200, raw_response_hash="h", db_path=db_path)
    store.record_entry("p1", 1, "industry_loss", value=2.0, http_status=200, raw_response_hash="h", db_path=db_path)
    assert len(store.get_buffer("p1", "economic_loss", db_path=db_path)) == 1
    assert len(store.get_buffer("p1", "industry_loss", db_path=db_path)) == 1
    assert store.known_metrics("p1", db_path=db_path) == ["economic_loss", "industry_loss"]


def test_latest_successful_entry_skips_failures(db_path):
    store.record_entry("p1", 1, "m1", value=100.0, http_status=200, raw_response_hash="h1", db_path=db_path)
    store.record_entry("p1", 1, "m1", value=None, http_status=500, raw_response_hash=None, error="boom", db_path=db_path)
    assert store.latest_entry("p1", "m1", db_path=db_path)["error"] == "boom"
    assert store.latest_successful_entry("p1", "m1", db_path=db_path)["value"] == 100.0


def test_latest_entry_empty_returns_none(db_path):
    assert store.latest_entry("nonexistent", "m1", db_path=db_path) is None
    assert store.latest_successful_entry("nonexistent", "m1", db_path=db_path) is None


def test_alerts_record_list_resolve(db_path):
    a = store.record_alert("p1", "monitor_failure", "something broke", db_path=db_path)
    assert a["resolved_at"] is None
    open_alerts = store.get_open_alerts("p1", db_path=db_path)
    assert len(open_alerts) == 1
    store.resolve_alert(a["id"], db_path=db_path)
    assert store.get_open_alerts("p1", db_path=db_path) == []


def test_alerts_filtered_by_product(db_path):
    store.record_alert("p1", "monitor_failure", "p1 broke", db_path=db_path)
    store.record_alert("p2", "monitor_failure", "p2 broke", db_path=db_path)
    assert len(store.get_open_alerts("p1", db_path=db_path)) == 1
    assert len(store.get_open_alerts(db_path=db_path)) == 2  # no filter = all products


def _backdate(db_path, table, row_id, seconds_ago, column="fetched_at"):
    conn = sqlite3.connect(db_path)
    ts = (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()
    conn.execute(f"UPDATE {table} SET {column} = ? WHERE id = ?", (ts, row_id))
    conn.commit()
    conn.close()


# ── scheduler.py ─────────────────────────────────────────────────────────

def test_poll_product_success_records_both_metrics(monkeypatch, db_path):
    monkeypatch.setattr(fetcher, "fetch_raw", lambda p, timeout=10: {
        "data": COMPLETE_YEAR_RESPONSE, "http_status": 200, "raw_response_hash": "h", "error": None,
    })
    result = scheduler.poll_product(PRODUCT, db_path=db_path)
    assert result["ok"] is True
    assert result["metrics"]["economic_loss"]["value"] == 417
    assert result["metrics"]["industry_loss"]["value"] == 154
    assert store.latest_entry("natcat_loss", "economic_loss", db_path=db_path)["value"] == 417
    assert store.get_open_alerts("natcat_loss", db_path=db_path) == []


def test_poll_product_total_failure_raises_one_alert_for_all_metrics(monkeypatch, db_path):
    monkeypatch.setattr(fetcher, "fetch_raw", lambda p, timeout=10: {
        "data": None, "http_status": 500, "raw_response_hash": None, "error": "non-2xx response: 500",
    })
    result = scheduler.poll_product(PRODUCT, db_path=db_path)
    assert result["ok"] is False
    assert result["metrics"]["economic_loss"]["error"] == "non-2xx response: 500"
    assert result["metrics"]["industry_loss"]["error"] == "non-2xx response: 500"
    alerts = store.get_open_alerts("natcat_loss", db_path=db_path)
    assert len(alerts) == 1
    assert "monitor_failure" == alerts[0]["kind"]
    assert "economic_loss" in alerts[0]["message"] and "industry_loss" in alerts[0]["message"]


def test_poll_product_partial_value_path_failure_alerts_only_that_metric(monkeypatch, db_path):
    broken_product = {**PRODUCT, "value_paths": {**PRODUCT["value_paths"], "industry_loss": "response.GONE"}}
    monkeypatch.setattr(fetcher, "fetch_raw", lambda p, timeout=10: {
        "data": COMPLETE_YEAR_RESPONSE, "http_status": 200, "raw_response_hash": "h", "error": None,
    })
    result = scheduler.poll_product(broken_product, db_path=db_path)
    assert result["ok"] is False
    assert result["metrics"]["economic_loss"]["error"] is None
    assert result["metrics"]["industry_loss"]["error"] is not None
    alerts = store.get_open_alerts("natcat_loss", db_path=db_path)
    assert len(alerts) == 1
    assert alerts[0]["kind"] == "value_path_drift"
    assert "industry_loss" in alerts[0]["message"]


@pytest.fixture
def temp_registry(tmp_path, monkeypatch):
    (tmp_path / "public").mkdir()
    (tmp_path / "private").mkdir()
    monkeypatch.setattr(registry, "_PRODUCTS_DIR", str(tmp_path))
    return tmp_path


def _write_product(dir_path, filename, data):
    import json
    with open(str(dir_path / filename), "w") as f:
        json.dump(data, f)


def test_is_due_true_when_never_polled(db_path):
    product = {**PRODUCT, "update_frequency": "daily"}
    assert scheduler._is_due(product, db_path) is True


def test_is_due_false_when_recently_polled(db_path):
    product = {**PRODUCT, "update_frequency": "daily"}
    store.record_entry("natcat_loss", 1, "economic_loss", value=1.0, http_status=200, raw_response_hash="h", db_path=db_path)
    store.record_entry("natcat_loss", 1, "industry_loss", value=2.0, http_status=200, raw_response_hash="h", db_path=db_path)
    assert scheduler._is_due(product, db_path) is False


def test_is_due_true_once_stale(db_path):
    product = {**PRODUCT, "update_frequency": "daily"}
    e1 = store.record_entry("natcat_loss", 1, "economic_loss", value=1.0, http_status=200, raw_response_hash="h", db_path=db_path)
    e2 = store.record_entry("natcat_loss", 1, "industry_loss", value=2.0, http_status=200, raw_response_hash="h", db_path=db_path)
    _backdate(db_path, "monitor_entries", e1["id"], seconds_ago=90000)  # > 1 day
    _backdate(db_path, "monitor_entries", e2["id"], seconds_ago=90000)
    assert scheduler._is_due(product, db_path) is True


def test_is_due_true_for_unknown_frequency(db_path):
    product = {**PRODUCT, "update_frequency": "biannually"}  # not in _FREQUENCY_SECONDS
    store.record_entry("natcat_loss", 1, "economic_loss", value=1.0, http_status=200, raw_response_hash="h", db_path=db_path)
    store.record_entry("natcat_loss", 1, "industry_loss", value=2.0, http_status=200, raw_response_hash="h", db_path=db_path)
    assert scheduler._is_due(product, db_path) is True


def test_poll_due_products_and_poll_all_active_products(monkeypatch, temp_registry, db_path):
    real_product = {
        "product_id": "natcat_loss", "version": 1, "status": "active",
        "name": "Test", "endpoint": "https://example.com/api", "method": "POST",
        "auth": "TEST_AUTH_ENV", "call_parameters": {"ALL": "yes"}, "response_schema": {},
        "value_paths": {"economic_loss": 'response.ALL-LOSSES[-1]."economic-loss | total"'},
        "units": "usd_billions", "update_frequency": "daily", "max_report_age": 150,
        "data_source_description": "test",
    }
    _write_product(temp_registry / "public", "natcat_loss.v1.json", real_product)

    monkeypatch.setattr(fetcher, "fetch_raw", lambda p, timeout=10: {
        "data": SAMPLE_RESPONSE, "http_status": 200, "raw_response_hash": "h", "error": None,
    })

    # Nothing polled yet -> due.
    due_results = scheduler.poll_due_products(db_path=db_path)
    assert len(due_results) == 1
    assert due_results[0]["ok"] is True

    # Just polled -> not due again immediately.
    assert scheduler.poll_due_products(db_path=db_path) == []

    # force a full poll regardless of due-ness
    all_results = scheduler.poll_all_active_products(db_path=db_path)
    assert len(all_results) == 1


# ── health.py ────────────────────────────────────────────────────────────

def test_get_metric_health_unknown_metric_raises(temp_registry, db_path):
    real_product = {
        "product_id": "natcat_loss", "version": 1, "status": "active",
        "name": "Test", "endpoint": "https://example.com/api", "method": "POST",
        "auth": "TEST_AUTH_ENV", "call_parameters": {}, "response_schema": {},
        "value_paths": {"economic_loss": "response.x"},
        "units": "usd_billions", "update_frequency": "daily", "max_report_age": 150,
        "data_source_description": "test",
    }
    _write_product(temp_registry / "public", "natcat_loss.v1.json", real_product)
    with pytest.raises(ValueError, match="no metric"):
        health.get_metric_health("natcat_loss", "not_a_real_metric", db_path=db_path)


def test_get_metric_health_stale_vs_fresh(temp_registry, db_path):
    real_product = {
        "product_id": "natcat_loss", "version": 1, "status": "active",
        "name": "Test", "endpoint": "https://example.com/api", "method": "POST",
        "auth": "TEST_AUTH_ENV", "call_parameters": {}, "response_schema": {},
        "value_paths": {"economic_loss": "response.x"},
        "units": "usd_billions", "update_frequency": "daily", "max_report_age": 1,  # 1 day
        "data_source_description": "test",
    }
    _write_product(temp_registry / "public", "natcat_loss.v1.json", real_product)

    entry = store.record_entry("natcat_loss", 1, "economic_loss", value=417.0, http_status=200, raw_response_hash="h", db_path=db_path)
    fresh = health.get_metric_health("natcat_loss", "economic_loss", db_path=db_path)
    assert fresh["is_stale"] is False
    assert fresh["latest_successful_entry"]["value"] == 417.0

    _backdate(db_path, "monitor_entries", entry["id"], seconds_ago=2 * 86400)  # 2 days, > 1 day max_report_age
    stale = health.get_metric_health("natcat_loss", "economic_loss", db_path=db_path)
    assert stale["is_stale"] is True


def test_get_metric_health_no_data_is_stale(temp_registry, db_path):
    real_product = {
        "product_id": "natcat_loss", "version": 1, "status": "active",
        "name": "Test", "endpoint": "https://example.com/api", "method": "POST",
        "auth": "TEST_AUTH_ENV", "call_parameters": {}, "response_schema": {},
        "value_paths": {"economic_loss": "response.x"},
        "units": "usd_billions", "update_frequency": "daily", "max_report_age": 150,
        "data_source_description": "test",
    }
    _write_product(temp_registry / "public", "natcat_loss.v1.json", real_product)
    result = health.get_metric_health("natcat_loss", "economic_loss", db_path=db_path)
    assert result["is_stale"] is True
    assert result["latest_successful_entry"] is None


def test_get_product_health_covers_every_metric(temp_registry, db_path):
    real_product = {
        "product_id": "natcat_loss", "version": 1, "status": "active",
        "name": "Test", "endpoint": "https://example.com/api", "method": "POST",
        "auth": "TEST_AUTH_ENV", "call_parameters": {}, "response_schema": {},
        "value_paths": {"economic_loss": "response.x", "industry_loss": "response.y"},
        "units": "usd_billions", "update_frequency": "daily", "max_report_age": 150,
        "data_source_description": "test",
    }
    _write_product(temp_registry / "public", "natcat_loss.v1.json", real_product)
    store.record_entry("natcat_loss", 1, "economic_loss", value=1.0, http_status=200, raw_response_hash="h", db_path=db_path)
    store.record_alert("natcat_loss", "value_path_drift", "industry_loss broke", db_path=db_path)

    result = health.get_product_health("natcat_loss", db_path=db_path)
    assert set(result["metrics"].keys()) == {"economic_loss", "industry_loss"}
    assert len(result["open_alerts"]) == 1
