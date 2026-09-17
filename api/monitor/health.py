"""
"Bond health view" data — combines a product's definition, its monitor
buffer, and open alerts into one read-only payload per sprint plan §2.3
("Expose a read endpoint for the bond health view. This gives users
no-cost status; nothing on-chain is touched.").

This module is the read endpoint at the function level — it's import-and-
call ready. Wiring it to an actually HTTP-served route (e.g. a Flask
`GET /health/<product_id>/<metric>`) is a deployment decision this repo
hasn't made yet (there's no running backend server today; every existing
api/ script is CLI-invoked, not served — see monitor/README.md), so that
last step is intentionally left undone here rather than inventing a
server/hosting story nobody asked for.
"""

from __future__ import annotations

from datetime import datetime, timezone

from products import registry

from . import store


def get_metric_health(product_id: str, metric: str, db_path: str | None = None) -> dict:
    """Health payload for one (product, metric) pair."""
    product = registry.get_latest_active(product_id)
    if metric not in product["value_paths"]:
        raise ValueError(f"{product_id!r} has no metric {metric!r} — has {list(product['value_paths'])}")

    latest = store.latest_entry(product_id, metric, db_path=db_path)
    latest_good = store.latest_successful_entry(product_id, metric, db_path=db_path)
    buffer = store.get_buffer(product_id, metric, db_path=db_path)

    is_stale = True
    age_seconds = None
    if latest_good is not None:
        fetched_at = datetime.fromisoformat(latest_good["fetched_at"])
        age_seconds = (datetime.now(timezone.utc) - fetched_at).total_seconds()
        is_stale = age_seconds > product["max_report_age"] * 86400

    return {
        "product_id": product_id,
        "product_version": product["version"],
        "metric": metric,
        "units": product["units"],
        "max_report_age_days": product["max_report_age"],
        "latest_entry": latest,
        "latest_successful_entry": latest_good,
        "is_stale": is_stale,
        "age_seconds": age_seconds,
        "buffer": buffer,
    }


def get_product_health(product_id: str, db_path: str | None = None) -> dict:
    """Health payload for every metric a product exposes, plus the
    product's open alerts (alerts are per-product, not per-metric — a
    total fetch failure affects every metric at once)."""
    product = registry.get_latest_active(product_id)
    return {
        "product_id": product_id,
        "product_version": product["version"],
        "metrics": {metric: get_metric_health(product_id, metric, db_path=db_path) for metric in product["value_paths"]},
        "open_alerts": store.get_open_alerts(product_id, db_path=db_path),
    }
