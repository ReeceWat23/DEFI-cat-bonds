# Monitor

The off-chain monitor service (sprint plan `api/it3_plan_triggers_n_mgmnt.md`
§2.3). Polls every `active` product from `../products/`, keeps a 20-entry
ring buffer per `(product_id, metric)` pair, and is what the company
wallet's reporting flow (§2.6, not built yet) reads from — a report posted
on-chain must always be traceable back to a specific monitor entry, never
a live API call made at report time.

## Files

```
api/monitor/
  README.md      — this file
  value_path.py   — resolves a product's value_path string against a
                    parsed JSON response (dot/bracket/quoted-key mini
                    language — see ../products/README.md)
  fetcher.py      — fetch_raw() makes the one HTTP call a product needs;
                    resolve_metric() extracts one named value from an
                    already-fetched response. Split so multiple metrics
                    from one product never trigger duplicate HTTP calls.
  store.py        — SQLite-backed ring buffer + alerts. Schema and
                    rationale documented in the module docstring.
  scheduler.py     — decides which active products are due for a poll
                    (based on update_frequency) and drives fetcher.py +
                    store.py to actually poll them.
  health.py       — read-only "bond health view" payload: a product's
                    latest value, buffer, staleness, and open alerts.
  data/            — gitignored. `monitor.db` lives here at runtime.
```

## Why one product can produce several buffer rows per poll

A product can expose multiple named metrics (`value_paths`) from a single
HTTP response — RHODEX's NatCat Loss API returns both economic-loss and
industry-loss figures together. `scheduler.poll_product()` calls
`fetcher.fetch_raw()` exactly once, then `fetcher.resolve_metric()` once
per metric, and `store.record_entry()` once per metric — so the ring
buffer is keyed by `(product_id, metric)`, not just `product_id`. Two
metrics from the same product age and fail independently even though they
share a fetch.

## Failure handling

- The HTTP call itself fails (bad auth, network error, non-2xx, invalid
  JSON): every metric on that product gets a failure entry with the same
  error, and **one** alert is raised naming all affected metrics — not one
  alert per metric, to avoid alert spam for what's really one underlying
  problem.
- The call succeeds but one metric's `value_path` doesn't resolve (the
  source changed shape — the "drift detector" from §2.3): only that
  metric gets a failure entry, and its own alert is raised. Other metrics
  from the same response still get recorded normally.
- Alerts are persisted (`store.record_alert`/`get_open_alerts`) so the
  health view can surface them now. **Delivery** (email/Slack/etc.) is an
  open question in the sprint plan itself (§3.5, "Delivery channel per
  Q5" — Q5 isn't answered yet) and is Iteration 2 scope, not built here.

## What's deliberately not built here

- **Actual recurring scheduling.** `scheduler.poll_due_products()` decides
  *which* products are due and polls them when called, but nothing in this
  repo calls it on a timer. There's no cron entry, systemd timer, or hosted
  scheduled function wired up — that's a deployment/hosting decision this
  codebase hasn't made (there's no existing "how does anything in `api/`
  run continuously" story to hook into; every other script here is
  CLI-invoked on demand). Run `python3 -m monitor.scheduler` from `api/`
  by hand, or from whatever scheduling infra gets chosen later.
- **An HTTP-served health endpoint.** `health.py`'s functions are the read
  endpoint at the function level — import and call them from anywhere in
  Python. Turning `get_product_health()` into a real `GET /health/<id>`
  route is a few lines with the `flask` dependency already in
  `requirements.txt`, but there's no running backend server anywhere in
  this repo today for the frontend to call (the UI talks to Bubble and to
  the chain directly, never to a Python server) — wiring that up is a
  bigger decision (hosting, CORS, deploy target) than this sprint's scope
  asked for, so it's left as the obvious next step rather than guessed at.

## Storage

Stdlib `sqlite3` — no new dependency. `api/monitor/data/monitor.db`,
created on first use, gitignored (runtime state, not source). Tests never
touch this file directly; they monkeypatch `store._DEFAULT_DB_PATH` to an
isolated temp path.
