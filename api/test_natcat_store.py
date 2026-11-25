"""
Tests for natcat_store.py and product natcat_loss v3 as the monitor sees it.

Offline except test_live_latest_view_matches_table, which needs Supabase
credentials in the env and reads (never writes) the real natcat table.

Run: pytest api/test_natcat_store.py -v
"""

import os

import pytest

import natcat_store
from monitor import fetcher
from products import registry
from products.schema import validate

# What PostgREST returns for natcat_latest (2026: Q2 is the newest period).
SAMPLE_LATEST = [{
    "year": 2026,
    "economic_loss_b": 142, "economic_period": "Q2",
    "industry_loss_b": 46,  "industry_period": "Q2",
    "latest_period": "Q2", "latest_metadata": {},
}]


# ── build_report ─────────────────────────────────────────────────────────────

def test_build_report_sends_only_the_fields_given():
    # A revision of one figure must not carry empty values for the others:
    # the upsert would write them over what is stored.
    r = natcat_store.build_report(2026, "Q1", economic_loss_b=58)
    assert r == {"year": 2026, "period": "Q1", "economic_loss_b": 58}
    full = natcat_store.build_report(2026, "Q1", economic_loss_b=58, industry_loss_b=20,
                                     source_url="https://x", as_of="2026-04-01", metadata={"k": 1})
    assert set(full) == set(natcat_store.WRITABLE_COLUMNS)


def test_upsert_sends_one_request_per_field_set(monkeypatch):
    # PostgREST fills a field some rows omit with NULL on the rows that lack
    # it, so rows with different fields must not share a request.
    calls = []
    monkeypatch.setattr(natcat_store, "_request", lambda method, path, **kw: calls.append(kw["body"]) or kw["body"])
    a = natcat_store.build_report(2026, "Q1", economic_loss_b=58)
    b = natcat_store.build_report(2026, "Q2", economic_loss_b=60, industry_loss_b=20)
    c = natcat_store.build_report(2026, "Q3", economic_loss_b=61)
    natcat_store.upsert_reports([a, b, c])
    assert sorted(len(body) for body in calls) == [1, 2]
    assert {tuple(sorted(r)) for body in calls for r in body} == {tuple(sorted(a)), tuple(sorted(b))}


@pytest.mark.parametrize("kwargs", [
    {"period": "Q4", "economic_loss_b": 1},            # FY, not Q4
    {"period": "Q1"},                                   # no figure at all
    {"period": "Q1", "economic_loss_b": 1, "metadata": ["not", "an", "object"]},
])
def test_build_report_rejects_bad_input(kwargs):
    with pytest.raises(ValueError):
        natcat_store.build_report(2026, **kwargs)


def test_upsert_rejects_unknown_fields():
    with pytest.raises(ValueError):
        natcat_store.upsert_reports([{"year": 2026, "period": "Q1", "gap_b": 1}])


# ── product v3 through the monitor ───────────────────────────────────────────

def test_v3_is_schema_valid_and_resolves_both_metrics():
    product = registry.get("natcat_loss", 3)
    assert validate(product) == []
    assert fetcher.resolve_metric(SAMPLE_LATEST, product["value_paths"]["economic_loss"]) == (142.0, None)
    assert fetcher.resolve_metric(SAMPLE_LATEST, product["value_paths"]["industry_loss"]) == (46.0, None)


def test_v3_empty_table_is_a_recorded_error_not_a_crash():
    product = registry.get("natcat_loss", 3)
    value, err = fetcher.resolve_metric([], product["value_paths"]["industry_loss"])
    assert value is None and "out of range" in err


def test_supabase_auth_headers():
    assert fetcher._auth_headers("supabase", "sb_secret_x") == {
        "Content-Type": "application/json", "apikey": "sb_secret_x"}
    assert fetcher._auth_headers("supabase", "eyJx")["Authorization"] == "Bearer eyJx"
    assert fetcher._auth_headers("bearer", "k") == {
        "Content-Type": "application/json", "Authorization": "Bearer k"}


def test_v3_accepts_either_supabase_key_variable(monkeypatch):
    # The product names SUPABASE_SERVICE_ROLE_KEY; a .env that only sets the
    # new-style SUPABASE_SECRET_KEY must still fetch (as bonds.py already allows).
    seen = {}

    class Resp:
        status_code, content = 200, b"[]"
        def json(self): return []

    def fake_get(url, headers, params, timeout):
        seen["headers"] = headers
        return Resp()

    monkeypatch.setattr(fetcher.requests, "get", fake_get)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_x")
    raw = fetcher.fetch_raw(registry.get("natcat_loss", 3))
    assert raw["error"] is None
    assert seen["headers"]["apikey"] == "sb_secret_x"

    monkeypatch.delenv("SUPABASE_SECRET_KEY")
    assert "is not set" in fetcher.fetch_raw(registry.get("natcat_loss", 3))["error"]


# ── live ────────────────────────────────────────────────────────────────────

_live = bool(os.environ.get("SUPABASE_URL") and
             (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY")))


@pytest.mark.skipif(not _live, reason="Supabase credentials not in env")
def test_live_latest_view_matches_table():
    """natcat_latest must equal 'latest period with a figure, per metric, in the newest year'."""
    reports = natcat_store.list_reports()
    latest = natcat_store.get_latest()
    if not reports:
        assert latest is None
        return
    year = max(r["year"] for r in reports)
    this_year = [r for r in reports if r["year"] == year]   # list_reports is oldest -> newest

    def newest_with(col):
        rows = [r for r in this_year if r[col] is not None]
        return rows[-1] if rows else None

    assert latest["year"] == year
    for col, period_col in (("economic_loss_b", "economic_period"), ("industry_loss_b", "industry_period")):
        row = newest_with(col)
        assert latest[col] == (row[col] if row else None)
        assert latest[period_col] == (row["period"] if row else None)
    assert latest["latest_period"] == this_year[-1]["period"]
