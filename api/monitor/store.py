"""
Persistence for the monitor's per-(product, metric) ring buffer and alerts.

Uses stdlib `sqlite3` — no new dependency, and this data is small (20 rows
per product+metric, plus alerts) so a single local file is enough for this
iteration. The DB file lives at `api/monitor/data/monitor.db` (gitignored,
runtime state) unless overridden.

Buffer is keyed by (product_id, metric), not just product_id: one product
can expose several metrics from the same HTTP call (see
products/README.md's "One endpoint, multiple metrics"), and each metric
ages and fails independently even though they share a fetch.

A true ring buffer, not just a limited read: `record_entry()` prunes each
(product_id, metric) pair down to its most recent 20 rows immediately after
inserting, so storage itself stays bounded — this isn't "keep everything,
only ever read 20."

Every public function takes `db_path: str | None = None` and resolves it
to `_DEFAULT_DB_PATH` *inside* the function body, not as the parameter's
default value. A default value is bound once, at module-import time — if
it were `db_path: str = _DEFAULT_DB_PATH`, a test doing
`monkeypatch.setattr(store, "_DEFAULT_DB_PATH", tmp_path)` would silently
have no effect on already-defined functions, and would keep hitting the
real on-disk DB. Resolving inside the body re-reads the module attribute
on every call, so monkeypatching it actually works.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

BUFFER_SIZE = 20

_DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "monitor.db")


def _resolve_db_path(db_path: str | None) -> str:
    return db_path if db_path is not None else _DEFAULT_DB_PATH


def _connect(db_path: str | None) -> sqlite3.Connection:
    path = _resolve_db_path(db_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS monitor_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            product_version INTEGER NOT NULL,
            metric TEXT NOT NULL,
            value REAL,
            fetched_at TEXT NOT NULL,
            http_status INTEGER,
            raw_response_hash TEXT,
            error TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_entries_product_metric ON monitor_entries(product_id, metric, id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            message TEXT NOT NULL,
            raised_at TEXT NOT NULL,
            resolved_at TEXT
        )
        """
    )
    conn.commit()
    return conn


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_entry(
    product_id: str,
    product_version: int,
    metric: str,
    *,
    value: float | None,
    http_status: int | None,
    raw_response_hash: str | None,
    error: str | None = None,
    db_path: str | None = None,
) -> dict:
    """
    Append one resolved-metric result and prune that (product_id, metric)
    pair's buffer back down to BUFFER_SIZE. `value`/`raw_response_hash` are
    None on a failed call; `error` carries the failure reason in that case.
    """
    conn = _connect(db_path)
    try:
        fetched_at = _now_iso()
        cur = conn.execute(
            """
            INSERT INTO monitor_entries
                (product_id, product_version, metric, value, fetched_at, http_status, raw_response_hash, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (product_id, product_version, metric, value, fetched_at, http_status, raw_response_hash, error),
        )
        entry_id = cur.lastrowid

        # Prune: keep only the BUFFER_SIZE most recent rows for this (product, metric) pair.
        conn.execute(
            """
            DELETE FROM monitor_entries
            WHERE product_id = ? AND metric = ? AND id NOT IN (
                SELECT id FROM monitor_entries
                WHERE product_id = ? AND metric = ?
                ORDER BY id DESC LIMIT ?
            )
            """,
            (product_id, metric, product_id, metric, BUFFER_SIZE),
        )
        conn.commit()

        row = conn.execute("SELECT * FROM monitor_entries WHERE id = ?", (entry_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def get_buffer(product_id: str, metric: str, limit: int = BUFFER_SIZE, db_path: str | None = None) -> list[dict]:
    """Most recent entries for a (product, metric) pair, newest first."""
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM monitor_entries WHERE product_id = ? AND metric = ? ORDER BY id DESC LIMIT ?",
            (product_id, metric, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def latest_entry(product_id: str, metric: str, db_path: str | None = None) -> dict | None:
    buf = get_buffer(product_id, metric, limit=1, db_path=db_path)
    return buf[0] if buf else None


def latest_successful_entry(product_id: str, metric: str, db_path: str | None = None) -> dict | None:
    """Most recent entry that wasn't a failure (error IS NULL)."""
    conn = _connect(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM monitor_entries WHERE product_id = ? AND metric = ? AND error IS NULL ORDER BY id DESC LIMIT 1",
            (product_id, metric),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def known_metrics(product_id: str, db_path: str | None = None) -> list[str]:
    """Every distinct metric name ever recorded for a product — used by the
    health view to enumerate what to show without the caller having to
    already know a product's value_paths keys."""
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            "SELECT DISTINCT metric FROM monitor_entries WHERE product_id = ? ORDER BY metric",
            (product_id,),
        ).fetchall()
        return [r["metric"] for r in rows]
    finally:
        conn.close()


def record_alert(product_id: str, kind: str, message: str, db_path: str | None = None) -> dict:
    """
    Raise an alert. Delivery (email/Slack/etc., sprint plan §3.5 Q5) is not
    decided yet — this persists the alert so the health view can surface
    it now; wiring an actual delivery channel is Iteration 2 work.
    """
    conn = _connect(db_path)
    try:
        raised_at = _now_iso()
        cur = conn.execute(
            "INSERT INTO alerts (product_id, kind, message, raised_at, resolved_at) VALUES (?, ?, ?, ?, NULL)",
            (product_id, kind, message, raised_at),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM alerts WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def get_open_alerts(product_id: str | None = None, db_path: str | None = None) -> list[dict]:
    conn = _connect(db_path)
    try:
        if product_id is not None:
            rows = conn.execute(
                "SELECT * FROM alerts WHERE resolved_at IS NULL AND product_id = ? ORDER BY id DESC",
                (product_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY id DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def resolve_alert(alert_id: int, db_path: str | None = None) -> None:
    conn = _connect(db_path)
    try:
        conn.execute("UPDATE alerts SET resolved_at = ? WHERE id = ?", (_now_iso(), alert_id))
        conn.commit()
    finally:
        conn.close()
