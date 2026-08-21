# RHODEX APIs

Python clients for the RHODEX-hosted APIs (Bubble backend at
`realestatesimplified.xyz`, staging/"version-test" environment). Two
independent APIs live here:

- **`natcat_loss.py`** — real historical + current-year natural catastrophe
  loss data (economic and industry loss, per year and per quarter), sourced
  from Gallagher Re reports. Read-only.
- **`bonds.py`** — the off-chain bond record lifecycle: create a bond,
  link it to its on-chain contract address once deployed, update its
  status as it triggers/matures, and read it back.

Both are real, live APIs — there is no mock/staging double for either.
Running the tests here creates real (throwaway) records in the bonds
database and makes real calls against the NatCat feed.

## Setup

```bash
pip install -r requirements.txt
```

Requires `RHODEX_API_KEY` in a `.env` file at the repo root (bearer token,
shared by both APIs):

```
RHODEX_API_KEY=...
```

## Running the tests

```bash
./run_tests.sh
```

Runs `validate.sh` (NatCat Loss endpoint checks) and `test_bonds.py`
(pytest — unit tests for the pure helpers, plus live integration tests for
the full bonds lifecycle) back to back, with a combined pass/fail summary.

Run them individually:

```bash
./validate.sh                    # NatCat Loss API only
python3 -m pytest test_bonds.py -v   # Bonds API only
```

If `RHODEX_API_KEY` isn't set, `test_bonds.py`'s integration tests skip
cleanly rather than failing (the unit tests still run — they don't touch
the network).

## Bonds API — endpoints

All four are Bubble API workflows under
`https://realestatesimplified.xyz/version-test/api/1.1/wf/<endpoint>`,
POST + `Authorization: Bearer <RHODEX_API_KEY>`.

| Endpoint | Purpose | Body | Notes |
|---|---|---|---|
| `mkr_bond` | Create a bond record | full bond object (see below) | Returns `{"response": {"id": "..."}}` |
| `link-bond` | Attach the deployed contract address | `{"bond-id": ..., "contract": ...}` | Returns `{"response": {"verification": "<address>"}}` |
| `update-bond-status` | Advance lifecycle status | `{"bond-id": ..., "status-code": 0\|1\|2}` | 0 ok, 1 triggered, 2 matured |
| `get_bond` | Read a bond record back | `{"bond-id": ...}` | Returns `{"response": {"bond": {...}}}`; unknown id → `{"bond": {}}`, not an error |

Bond object (`bonds.build_bond_payload`) — every field is always sent,
even empty ones (see "Bubble param auto-detection" below for why):

```
{
  "cedant":            string,   # sponsor / ceding company name
  "contract-address":  string,   # set later via link-bond — "" at creation
  "description":       string,
  "Loss-history":      file,     # no upload implemented — plain string placeholder
  "maturity":          date,     # ISO 8601 on write, comes back as epoch-ms on read
  "SOV":               file,     # same as Loss-history
  "status-tiggered":   number,   # write-side field name (the API's own typo)
  "value":             number,   # USD
}
```

Two read-vs-write quirks worth knowing, both documented at the top of
`bonds.py`: the status field reads back correctly spelled as
`status-triggered` even though the write param is `status-tiggered`; and
`maturity` reads back as a Bubble-internal epoch-ms timestamp rather than
the ISO date string you sent.

### Bubble param auto-detection ("initialize")

A Bubble API workflow with no manually-declared parameters 400s with
`Missing parameter for workflow <name>: parameter <name>` until it's been
initialized once — `POST <endpoint>/initialize` with a *complete* sample
payload registers the parameter names/types in the Bubble editor from
whatever keys are in that body. It doesn't run the workflow or touch any
data. `bonds.initialize_endpoint()` does this; all four bonds endpoints
are already initialized as of 2026-08-20, so this normally doesn't need
re-running — only if a new field gets added to the bond object later.

## Fake end-to-end flow

```bash
python3 bonds.py
```

Creates a real bond record, generates a fake (non-deployed) contract
address, links it, updates status, reads the record back, and prints a
simulated "contract read" tying the off-chain unique ID to the fake
on-chain address — proving the round trip without needing a real deploy.
