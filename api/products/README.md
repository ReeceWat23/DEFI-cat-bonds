# Products

A **product** is a managed API endpoint plus everything needed to call it
and pull one or more comparable numbers out of its response. It's the
layer between "some third-party risk API" and "a trigger contract" — a
trigger never talks to an API directly; it references a product by
`product_id` + `version`, and the specific metric it cares about, and that
gets frozen into the trigger's `productConfig` at deploy time.

This is Iteration 1 of the sprint at `api/it3_plan_triggers_n_mgmnt.md` —
read that for the full architecture. Two things worth restating here:

- The plan's own text says `apis/products/` (plural "apis"); this repo's
  backend folder is `api/` (singular), so the registry lives at
  **`api/products/`**. Every reference to `apis/products/...` elsewhere
  should be read as `api/products/...`.
- The plan's §2.2 originally specced one `value_path` and one `peril_type`
  per product — implying one product per peril. That's been revised: see
  "One endpoint, multiple metrics" below.

## What lives here

```
api/products/
  README.md      — this file
  schema.py       — validate(data) for one product definition dict
  registry.py     — loads every definition, rejects malformed/duplicate
                    ones, answers lookups
  public/
    <product>.v<N>.json
  private/
    <product>.v<N>.json   (empty this iteration — see private/README.md)
```

`registry.py` is the only thing that should ever read these JSON files
directly. The monitor service, the trigger-deploy flow, and the admin
dashboard all go through `registry.list_products()` / `registry.get()` /
`registry.get_latest_active()`, not the filesystem.

## One endpoint, multiple metrics

RHODEX's real NatCat Loss API returns both the industry (insured) loss
*and* the economic loss figures in the same response, for the same year.
Modeling that as two separate product definitions — `ilw_industry_loss`
and `economic_loss` — would mean the monitor polling the identical
endpoint twice for data it already has after the first call. Instead, a
product can expose **several named metrics** via `value_paths`:

```json
"value_paths": {
  "economic_loss": "response.ALL-LOSSES[-1].\"economic-loss | total\"",
  "industry_loss": "response.ALL-LOSSES[-1].\"industry-loss | total\""
}
```

**Which metric a given trigger cares about is a deal-type/trigger-time
choice, not a product-time one.** `TriggerBase.sol` already has a
`dealType` (0 = IndustryLoss, 1 = EconomicLoss); at trigger deploy, that
selects one key out of the product's `value_paths`, and only that single
resolved path string gets snapshotted into the trigger's `productConfig`
(plan §2.4). The trigger itself never sees `value_paths` plural — it's
handed one path, same as if the product only had one.

The monitor, on the other hand, calls the endpoint once per poll and
resolves *every* configured metric from that one response — see
`../monitor/README.md`. This is also why the ring buffer is keyed by
`(product_id, metric)`, not just `product_id`: two metrics from the same
product age and fail independently even though they share an HTTP call.

## Product definition fields

| Field | Type | Notes |
|---|---|---|
| `product_id` | string | Stable identifier, e.g. `"natcat_loss"`. Never changes across versions of the same product. |
| `version` | int | Starts at 1. See versioning rule below. |
| `status` | `"active"` \| `"deprecated"` | Deprecated versions are never deleted, never offered for new trigger deploys. |
| `name` | string | Human label. |
| `endpoint` | string | URL the monitor calls. |
| `method` | `"GET"` \| `"POST"` \| `"PUT"` | |
| `auth` | string | **The name of a secret/env var, never the secret's value.** e.g. `"RHODEX_API_KEY"` — the monitor reads that env var at call time. |
| `call_parameters` | object | Request params/body sent verbatim. |
| `response_schema` | object | Free-form description of the response shape — enough for a human (or the monitor) to know what they're looking at. Not a strict JSON Schema validator in this iteration. |
| `value_paths` | object | `{metric_name: path, ...}`, at least one entry. `path` is a single path string, or a **fallback chain** (list of strings, tried in order — see below). See convention below and "One endpoint, multiple metrics" above. |
| `units` | string | Unit shared by every metric in `value_paths` on this product, e.g. `"usd_billions"`. |
| `update_frequency` | string | How often the source actually changes, e.g. `"quarterly"`. Informational — not enforced by the registry. |
| `max_report_age` | int (days) | A report older than this can no longer be used to settle a bond (`Trigger.latestReportSince`, plan §2.4). |
| `data_source_description` | string | Plain-language description of where the number comes from. |

**Path convention** (used within every `value_paths` entry): dot-separated
for object keys, `[-1]` for "last item of an array," and a quoted key
where the source field name itself contains spaces or pipes — e.g.
`response.ALL-LOSSES[-1]."industry-loss | total"`. Implemented and tested
in `../monitor/value_path.py`.

**Fallback chains** — a `value_paths` entry can be a list instead of a
single string, tried in order until one resolves
(`value_path.resolve_first()`). Real example that forced this:
`natcat_loss`'s current in-progress year has no full-year total field
until the year actually finishes — only whatever quarters have completed
so far. v2's `economic_loss` metric is
```json
[
  "response.reports.\"economic-loss | total\"",
  "response.reports.\"Q3 | economic \"",
  "response.reports.\"Q2 | economic\"",
  "response.reports.\"Q1 economic\""
]
```
mirroring `api/natcat_loss.py`'s own `latest_loss_for_year()` fallback
order exactly. The trigger's on-chain `productConfig.valuePath` still
stores a single string (the chain's first/primary entry) purely for
identification — the fallback only matters to the off-chain monitor
deciding what to actually report; the contract never re-derives anything.

## Versioning rule

Changing any of `endpoint`, `call_parameters`, `response_schema`,
`value_paths`, or `units` requires a **new file at `version + 1`** — never
edit those five fields on an existing version's file. Flip the old
version's `status` to `"deprecated"` in its own file; don't delete it.
Changing only `name` or `data_source_description` does not require a new
version. Adding a new metric key to `value_paths` counts as changing
`value_paths` — bump the version.

`registry.py` enforces the mechanical half of this: it raises
`RegistryError` if it finds two files claiming the same
`(product_id, version)` pair, across `public/` and `private/` combined
(a `product_id` is globally stable regardless of which list it's offered
in). It does **not** currently enforce that a version bump actually
changed one of the five versioned fields — `schema.diff_versioned_fields()`
is provided for that check, but wiring it into a pre-deploy or CI gate is
future work, not required for Iteration 1's exit criteria.

## Comparison is always `>=`

There is deliberately no `comparison_op` field. Every metric is
interpreted as "triggered when `value >= threshold`" — the threshold
itself lives on the trigger contract (or, before this sprint, on the bond),
not on the product.

## Adding a product

1. Pick a `product_id` that doesn't already exist (or, for a new version
   of an existing product, keep the same `product_id`).
2. Write `<product_id>.v1.json` (or `.v<N+1>.json`) under `public/` or
   `private/`, filling in every field above. List every metric this
   endpoint can serve in `value_paths`, even if only one deal type uses it
   today — a new deal type against an existing product should be a new
   `value_paths` key (new version), not a new product.
3. Validate it loads: `python3 -c "from products import registry; print(registry.load_all())"`
   from `api/` — a malformed file raises `RegistryError` with the specific
   problem.
4. If this is a new version of an existing product, also flip the old
   version's file to `"status": "deprecated"`.

## Current products

- `public/natcat_loss.v2.json` — RHODEX's `latest-report` endpoint, one
  call, two metrics: `economic_loss` and `industry_loss`, both annual,
  both sourced from the same underlying `api/natcat_loss.py` client
  (`fetch_latest_report()`). Each metric is a fallback chain (total, then
  Q3, Q2, Q1) since the current in-progress year never has a full-year
  total until it completes. Scope for this sprint is exactly these two
  (economic-loss and ILW/industry-loss deals) per the plan's §0 — a new
  peril within this same product would be a new `value_paths` key at v3,
  not a new product; a genuinely different data source would be a new
  product entirely.
- `public/natcat_loss.v1.json` — **deprecated 2026-09-16.** Called the
  older `RHODEX-NATCAT-LOSS` endpoint with `{"ALL": "yes"}` and indexed
  `ALL-LOSSES[-1]` for "the latest year," with a single (non-fallback)
  `value_paths` string per metric. Left in place, never deleted, per the
  versioning rule — but it was live-verified broken: `ALL-LOSSES[-1]` is
  the same in-progress current-year record `latest-report` returns, and
  that record has no full-year total field yet, so v1's paths would fail
  to resolve against live data today. See its own
  `data_source_description` for the full account.

`natcat_loss.py` itself is unchanged by any of this — it's still the one
place that actually calls the live API on the CLI/script side. The
registry describes that same data source declaratively so the monitor and
future trigger deploys can reference it by product/metric instead of every
call site hardcoding endpoint details independently.
