# RHODEX API

Server-side Python for RHODEX's off-chain data, backed by Supabase
(project `nqldthhutpfxpxnqqxsk`). Moved off Bubble 2026-11-17/18.

- **`bonds.py`** is the off-chain bond record lifecycle (table `public.rpos`).
  It creates a bond, links it to its deployed CatBond address, updates its
  status as it triggers or matures, and reads it back.
- **`natcat_store.py`** handles NatCat loss reports (table `public.natcat`,
  view `public.natcat_latest`). These are economic and insured (industry)
  loss per year and quarter, sourced from Gallagher Re, and they're what
  triggers settle on.
- **`server.py`** is the local dev server the UI calls. The browser never
  talks to Supabase directly.
- **`products/`, `monitor/`, `report_trigger.py`** form the trigger pipeline.
  A product describes a data source, the monitor polls it, and
  `report_trigger.py` posts the latest value on-chain.
- **`deploy_deal.py`** runs the full posting handshake: create a record,
  deploy a CatBond with its `dealId`, link the address back, and verify.

Schema lives in `../supabase/migrations/`. Apply new migrations in the
Supabase dashboard's SQL Editor.

## Setup

```bash
pip install -r requirements.txt
```

`.env` at the repo root:

```
SUPABASE_URL=https://nqldthhutpfxpxnqqxsk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...   # sb_secret_... or legacy service_role JWT
```

The key bypasses row-level security, so keep it server-side only. Both tables
have RLS on with no policies, so the publishable key can't read them.

## Running the tests

```bash
./run_tests.sh
```

Live tests run when the Supabase keys are set, and skip otherwise. The bonds
live test creates one throwaway `rpos` row and deletes it. The NatCat live
test is read-only: it checks that `natcat_latest` agrees with the raw table.

## Bonds (`public.rpos`)

| Function | Does |
|---|---|
| `build_bond_payload(...)` | Builds a row. Blank strings become NULL. `trigger_type` defaults to `natcat` |
| `create_bond(row)` | Inserts, returns the row with its new `id` |
| `link_contract_address(id, address)` | Sets `contract_address` (unique) |
| `update_bond_status(id, code)` | `status_triggered`: 0 ok, 1 triggered, 2 matured |
| `get_bond(id)` | Returns one row, raises `BondNotFound` if missing |
| `list_bonds(type)` | Every bond with that `trigger_type`, newest first |

The bond `id` is a bigint. `CatBond.dealId` is a string on-chain, so pass
`str(id)`. Documents (loss history, SOV) go in the private `rpo-documents`
Storage bucket, and the row stores their paths.

## NatCat reports (`public.natcat`)

There's one row per published report, keyed by `(year, period)`. `period` is
`Q1`, `Q2`, `Q3` or `FY`. Quarterly figures are cumulative year-to-date, as
published. Figures are in $B, so multiply by 1e9 for on-chain values.

- `economic_loss_b` and `industry_loss_b` are each nullable, since a report
  may publish only one of them. `gap_b` is generated from the two.
- `source_url` and `as_of` record where the figure came from and when.
- `metadata` (jsonb object) holds extra report detail, e.g.
  `{"regional_distribution": {"US": {"economic_loss_b": 80, "industry_loss_b": 30}}}`.

To add or revise a report, insert it in the Table Editor, or call
`natcat_store.upsert_reports([natcat_store.build_report(2026, "Q3", ...)])`.
Upsert updates the row in place when `(year, period)` already exists.

`natcat_latest` is what product `natcat_loss` v3 polls. It takes the newest
year, and for each metric the latest period in that year that has a figure
(FY, then Q3, Q2, Q1).

## Dev server

```bash
python3 server.py   # http://localhost:5001
```

| Route | Does |
|---|---|
| `GET /bonds?type=natcat` | `list_bonds` |
| `GET /bonds/<id>` | `get_bond` (404 for unknown or pre-Supabase ids) |
| `POST /bonds` | `create_bond`, returns `{"dealId": "<id>"}` |
| `POST /bonds/link` | `link_contract_address` |

Dev-only: CORS is wide open and there's no auth. Run it alongside
`npm run dev` in `ui/`.
