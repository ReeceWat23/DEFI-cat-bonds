"""
Polls active products and records results into the ring buffer.

`poll_product()` does exactly one HTTP call per product regardless of how
many metrics it exposes, then resolves every configured metric from that
one response — see products/README.md's "One endpoint, multiple metrics"
and fetcher.py's fetch_raw()/resolve_metric() split. A failed HTTP call
fails every metric identically (one alert, mentioning all affected
metrics); a failed value_path on an otherwise-successful call fails only
that metric (its own alert).

This module provides the polling logic and a due-or-not check based on
`update_frequency` — it does not run on any actual recurring schedule.
Wiring `poll_due_products()` to cron / a systemd timer / a hosted scheduled
function is a deployment decision outside this codebase; for now, invoke
it manually or via `python3 -m monitor.scheduler` from `api/`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from products import registry

from . import fetcher, store

_FREQUENCY_SECONDS = {
    "hourly": 3600,
    "daily": 86400,
    "weekly": 7 * 86400,
    "monthly": 30 * 86400,
    "quarterly": 91 * 86400,
    "annually": 365 * 86400,
}


def _is_due(product: dict, db_path: str | None) -> bool:
    """
    Due if any of the product's metrics has never been polled, or its most
    recent entry (success or failure — a failure still counts as "we
    tried") is older than the product's update_frequency. An unrecognized
    frequency string is treated as always-due rather than never-due.
    """
    freq_seconds = _FREQUENCY_SECONDS.get(product["update_frequency"])
    for metric in product["value_paths"]:
        last = store.latest_entry(product["product_id"], metric, db_path=db_path)
        if last is None or freq_seconds is None:
            return True
        fetched_at = datetime.fromisoformat(last["fetched_at"])
        age = (datetime.now(timezone.utc) - fetched_at).total_seconds()
        if age >= freq_seconds:
            return True
    return False


def poll_product(product: dict, db_path: str | None = None) -> dict:
    """
    Poll one product unconditionally (no due-ness check) — one HTTP call,
    one buffer entry per configured metric, at most one alert for a total
    fetch failure or one alert per metric for a value_path failure.

    Returns {"product_id": str, "ok": bool, "metrics": {name: {"value": float|None, "error": str|None}}}.
    """
    product_id = product["product_id"]
    raw = fetcher.fetch_raw(product)
    results = {}

    if raw["error"] is not None:
        for metric in product["value_paths"]:
            store.record_entry(
                product_id, product["version"], metric,
                value=None, http_status=raw["http_status"], raw_response_hash=raw["raw_response_hash"],
                error=raw["error"], db_path=db_path,
            )
            results[metric] = {"value": None, "error": raw["error"]}
        store.record_alert(
            product_id, "monitor_failure",
            f"{product_id}: fetch failed ({raw['error']}) — affects metrics: {', '.join(product['value_paths'])}",
            db_path=db_path,
        )
        return {"product_id": product_id, "ok": False, "metrics": results}

    any_failed = False
    for metric, path in product["value_paths"].items():
        value, error = fetcher.resolve_metric(raw["data"], path)
        store.record_entry(
            product_id, product["version"], metric,
            value=value, http_status=raw["http_status"], raw_response_hash=raw["raw_response_hash"],
            error=error, db_path=db_path,
        )
        results[metric] = {"value": value, "error": error}
        if error is not None:
            any_failed = True
            store.record_alert(product_id, "value_path_drift", f"{product_id}.{metric}: {error}", db_path=db_path)

    return {"product_id": product_id, "ok": not any_failed, "metrics": results}


def poll_due_products(db_path: str | None = None) -> list[dict]:
    """Poll every active product whose data is due for a refresh."""
    return [poll_product(p, db_path=db_path) for p in registry.list_products(status="active") if _is_due(p, db_path)]


def poll_all_active_products(db_path: str | None = None) -> list[dict]:
    """Poll every active product regardless of due-ness — for a manual
    "check now" action or for tests that don't want to wait on due-ness."""
    return [poll_product(p, db_path=db_path) for p in registry.list_products(status="active")]


if __name__ == "__main__":
    import json
    print(json.dumps(poll_due_products(), indent=2))
