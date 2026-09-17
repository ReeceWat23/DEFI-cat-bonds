"""
Calls a product's endpoint and resolves value_paths against the response.

Split into two steps because one product can expose several metrics
(products/README.md's "One endpoint, multiple metrics") that all come from
the same HTTP call: `fetch_raw()` hits the network once, `resolve_metric()`
extracts one named value from the already-fetched response. The scheduler
calls `fetch_raw()` once per product per poll, then `resolve_metric()` once
per configured metric in that product's `value_paths` — never re-fetching
per metric.

Neither function raises. A failed call — bad auth, non-2xx, invalid JSON,
a value_path that doesn't resolve — comes back as a normal result with an
`error` set, so the scheduler can record it in the ring buffer and raise an
alert. Per sprint plan §2.3, a product breaking is something the monitor
buffer shows before any bond tries to settle on it; that only works if
failures are recorded, not thrown away.
"""

from __future__ import annotations

import hashlib
import os

import requests
from dotenv import load_dotenv

from . import value_path as value_path_module

# Pre-refactor, the reporting flow imported natcat_loss.py directly, which
# loaded .env as an import side effect. The generic monitor path (this
# module) never picked up an equivalent call, so RHODEX_API_KEY silently
# never reached os.environ unless something else happened to import
# natcat_loss.py first. Same load_dotenv() call natcat_loss.py itself uses.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


def fetch_raw(product: dict, timeout: int = 10) -> dict:
    """
    Perform the HTTP call described by `product`. Does not touch
    value_paths at all — see resolve_metric() for that.

    Returns:
        success: {"data": dict, "http_status": int, "raw_response_hash": str, "error": None}
        failure: {"data": None, "http_status": int | None, "raw_response_hash": str | None, "error": str}
    """
    auth_env_var = product["auth"]
    secret = os.environ.get(auth_env_var, "")
    if not secret:
        return _raw_failure(None, None, f"secret env var {auth_env_var!r} is not set")

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {secret}"}
    method = product["method"]
    endpoint = product["endpoint"]
    params = product["call_parameters"]

    try:
        if method == "GET":
            resp = requests.get(endpoint, headers=headers, params=params, timeout=timeout)
        else:
            resp = requests.request(method, endpoint, headers=headers, json=params, timeout=timeout)
    except requests.RequestException as e:
        return _raw_failure(None, None, f"request failed: {e}")

    raw_hash = hashlib.sha256(resp.content).hexdigest()

    if not (200 <= resp.status_code < 300):
        return _raw_failure(resp.status_code, raw_hash, f"non-2xx response: {resp.status_code}")

    try:
        data = resp.json()
    except ValueError:
        return _raw_failure(resp.status_code, raw_hash, "response was not valid JSON")

    return {"data": data, "http_status": resp.status_code, "raw_response_hash": raw_hash, "error": None}


def resolve_metric(data: dict, path) -> tuple[float | None, str | None]:
    """
    Resolve one value_path against an already-fetched response. `path` is
    either a single value_path string or a fallback chain (list of
    strings — see products/schema.py's field reference).

    Returns (value, error) — exactly one of the two is None.
    """
    try:
        resolver = value_path_module.resolve_first if isinstance(path, list) else value_path_module.resolve
        return float(resolver(data, path)), None
    except value_path_module.ValuePathError as e:
        return None, f"value_path did not resolve: {e}"


def _raw_failure(http_status: int | None, raw_hash: str | None, message: str) -> dict:
    return {"data": None, "http_status": http_status, "raw_response_hash": raw_hash, "error": message}
