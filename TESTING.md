# Testing

How to run every test suite in this repo, what each one actually covers, and
a running results log. Created at the start of the "Deployed Triggers as
Source of Truth" sprint (`api/it3_plan_triggers_n_mgmnt.md`) per that plan's
working rule §0.3 — append a log entry every time a suite is run during the
sprint, pass or fail.

## Suites

### `forge test` — `DEAL 000/`
The live contract tree. This is what `ui/src/artifacts/*.json` is actually
compiled from and what the app deploys against — **this is the tree that
matters**. Run from `DEAL 000/`:
```
cd "DEAL 000" && forge test
```
53 tests, 5 suites: `CatBondTest` (21 — deposits, subscription lifecycle,
coupon/settlement math, fuzzing), `TriggerReportTest` (15 — `TriggerBase`'s
reporter role and report log, plus `CatBond.checkTrigger()`/`settle()`
end-to-end against real `postReport()` calls), `TriggerValidationTest`
(4 — deploy-time trigger address validation), `EarlyTriggerGuardTest` (3 —
the pre-Active guard against an already-qualifying report), `SellerInfoTest`
(10 — sellerName/dealId/exposure/verified read-back). See the §2.4/§2.5
audit note below for what changed and why.

### `forge test` — repo root (`contracts/`, `script/`, `test/`) — REMOVED
This dead tree (see audit below) has been deleted, along with the root
`foundry.toml` that pointed at it. Its 33/38 baseline is recorded below for
the record, but the suite no longer exists — `DEAL 000/` is the only live
contract tree from here on.

### `python3 -m pytest` — `api/`
```
cd api && python3 -m pytest
```
71 tests total.

- `test_bonds.py` (15) exercises `bonds.py` (the Bubble Bond-record CRUD
  client) live against the real Bubble backend — **no mock/staging double
  exists**, per `api/README.md`. Expect occasional transient `ReadTimeout`
  failures against the live API; re-run before treating a failure as a
  real regression.
- `test_products.py` (21, §2.2) exercises `products/schema.py` and
  `products/registry.py` — schema validation runs against fixture dicts,
  registry success paths run against the real file in `products/public/`,
  and failure paths (malformed JSON, duplicate `(product_id, version)`,
  deprecated-version exclusion) run against an isolated temp directory via
  `monkeypatch`, so testing failure scenarios never touches the real
  registry.
- `test_monitor.py` (35, §2.3) exercises `monitor/value_path.py` (path
  parsing/resolution, every documented failure mode),
  `monitor/fetcher.py` (HTTP calls fully monkeypatched — **never hits the
  network**), `monitor/store.py` (SQLite ring buffer, pruning, alerts —
  always against a `tmp_path` DB file, never the real
  `monitor/data/monitor.db`), `monitor/scheduler.py` (due-ness logic,
  per-metric vs. whole-fetch failure handling, alert de-duplication), and
  `monitor/health.py` (staleness calculation).

No test file exists yet for `natcat_loss.py` (only a `__main__` smoke
test) or `report_trigger.py` (no test file at all) — both still Iteration 1
work in progress (§2.6 will refactor `report_trigger.py` to read from the
monitor instead of calling the live API directly).

### UI (`ui/`)
No test runner is configured (`package.json` has no `test` script). The
"Build a Bond" end-to-end flow (create → deploy → view) is verified by
manual/static trace only — no browser automation is available in this
environment. See the audit's §5 findings below for what that trace found.

## Results log

| Date | Suite | Result | Notes |
|---|---|---|---|
| 2026-09-16 | `forge test` (`DEAL 000/`) | 38/38 pass | Baseline before sprint work starts. 4 suites: `EarlyTriggerGuardTest`(2), `SellerInfoTest`(10), `TriggerReportTest`(6), `CatBondTest`(20, incl. 3 fuzz @256 runs). |
| 2026-09-16 | `forge test` (repo root) | 33/33 pass | Historical only — this tree (`contracts/`, `script/`, `test/`, root `foundry.toml`) was deleted the same day once confirmed dead. 4 suites: `EarlyTriggerGuardTest`(2), `TriggerReportTest`(6), `RemixTest`(5), `CatBondTest`(20, incl. 3 fuzz @1000 runs). |
| 2026-09-16 | `pytest` (`api/`) | 15/15 pass | First run hit 1 transient `ReadTimeout` against the live Bubble API (`test_create_bond_returns_a_usable_id`); immediate re-run was clean 15/15. Flaky-by-design, not a regression — see suite note above. |
| 2026-09-16 | `pytest test_products.py` (`api/`) | 19/19 pass | New this session (§2.2 — products registry). Schema validation, real-file loading, and temp-dir failure paths (malformed JSON, duplicate version, deprecated exclusion). |
| 2026-09-16 | `pytest` (`api/`, full suite) | 34/34 pass | `test_bonds.py` + `test_products.py` together, no interference between the two. |
| 2026-09-16 | `pytest test_products.py` (`api/`, after products redesign) | 21/21 pass | Products schema revised same day (see audit note below) — `peril_type` removed, `value_path` → `value_paths` dict. Test count moved from 19 to 21 (net +2: two new `value_paths` shape tests replaced the removed `peril_type` test). |
| 2026-09-16 | `pytest test_monitor.py` (`api/`) | 35/35 pass | New this session (§2.3 — monitor service). All network calls monkeypatched; storage tests use per-test `tmp_path` DB files, never the real `monitor/data/monitor.db`. |
| 2026-09-16 | `pytest` (`api/`, full suite) | 71/71 pass | `test_bonds.py`(15) + `test_products.py`(21) + `test_monitor.py`(35), no interference between any of the three. |
| 2026-09-16 | `forge test` (`DEAL 000/`, after §2.4/§2.5 trigger rewrite) | 53/53 pass | Up from 38 (net +15). New suites `TriggerValidationTest`(4); `TriggerReportTest` grew 6→15; `EarlyTriggerGuardTest` grew 2→3. Two real test bugs caught and fixed during this work — see audit note below. |
| 2026-09-16 | `./run.sh quick` live on anvil (deploy → fund → deposit → close → markMatured → withdraw) | Pass | Not a unit test — a real deployed instance. Confirmed `markMatured()` correctly reverts `NoReports` with zero reports posted, then succeeds once a fresh below-threshold report exists; investor withdrew exactly the $500,000 principal deposited. Full detail below. |

---

## Pre-sprint audit (§2.1 — "run the existing flow end to end, log every
bug or dead path before changing anything")

Full read-only investigation, no code changed. Organized to match the
sprint plan's own sections.

### Current trigger contract
`DEAL 000/src/catbond/TriggerBase.sol` (mirrored byte-identically at
`contracts/TriggerBase.sol`, only `CatBond.sol` diverges between the two
trees):
- `bool internal _triggered` — a permanent latch. `report(lossValue, source)`
  (owner-only) overwrites `reportedValue`/`reportedSource` and sets
  `_triggered = true` once `lossValue >= lossLimit`; it never auto-resets.
- `setTriggered(bool)` (owner-only) — a direct manual override of the flag,
  bypassing any comparison entirely.
- No report history, no `productConfig`, no `reporter` role distinct from
  `owner`, no `postReport`/`latestReport`/`latestReportSince`.

This is close to the opposite of the target design in plan §2.4: today is
"latch a boolean forever, allow direct override"; the target is "append-only
log, compute triggered-or-not at read time from the latest report in
window." `report()`'s auto-latch-never-unlatch behavior is itself exactly
the kind of hidden state the new design avoids by not storing `isTriggered`
at all.

### Current CatBond.sol
No `checkTrigger()` exists. Four sites call `trigger.isTriggered()`
directly: `closeSubscription()` (line 285), `markMatured()` (line 337),
`settle()` (lines 361-376, pays out the full `totalDeposited` with **no
threshold comparison on the bond side** — the comparison already happened
inside the trigger's `report()`), and the read-only `triggerStatus()`/
`pingTrigger()` (lines 385-398, `pingTrigger` emits `TriggerDetected` "for
off-chain monitors" that don't exist yet).

Deploy does **not** require or validate a trigger address — zero-address or
a non-conforming address is accepted silently. No `threshold`,
`commencement`, or `lastCheck{...}` fields exist on the bond (threshold
lives on the trigger instead). This means a stale or missing report can
never block `settle()` today, since the bond only ever asks "is the flag
true" — always answerable. **This is the single biggest behavioral gap
between today and plan §2.5.**

Fields that exist today but aren't in the plan's target list — `sellerName`,
`dealId`, `verified`, `exposure[]` — were added for the Deal Page's
off-chain link/disclosure needs and must survive whatever the constructor
signature becomes.

### Current backend reporting path
`api/natcat_loss.py` is a pure read client against the live RHODEX NatCat
Loss Bubble API; `check_trigger()` does the `>=` comparison itself, with no
buffering — every call hits the live API fresh. `api/report_trigger.py` is
the only script that writes to a trigger: reads `dealType()`/`lossLimit()`
off the trigger via `cast call`, calls `natcat_loss.check_trigger()`, then
`cast send ... report(...)` from the company wallet via
`anvil_impersonateAccount` (dev-only pattern). **There is no monitor concept
at all today** — no scheduler, no ring buffer, no persisted history, no
failure/alert path, no product-registry lookup. Everything in plan §2.3 is
net-new; there's nothing here to migrate, only build.

### Redundant "triggered" paths found (plan §0.4 — kill all but one)
- **A.** `TriggerBase.report()` — auto-latches `_triggered = true`, never
  auto-clears. (`DEAL 000/.../TriggerBase.sol:63-70`, root mirror identical.)
- **B.** `TriggerBase.setTriggered(bool)` — direct manual flag write,
  bypassing comparison. Exercised in multiple test files; **live in the UI**
  as the admin "Reset Trigger" button (`ui/src/pages/AdminPage.jsx:788-794`).
  Clearest violation of "exactly one way a bond can be triggered."
- **C.** `CatBond.settle()` — reads the pre-latched boolean rather than
  performing its own comparison against a report. Also the "Settle" admin
  action (`AdminPage.jsx:710-718`).
- **D.** `CatBond.pingTrigger()` — signal-only, reads the same latched
  boolean; wired into the UI as "Ping Trigger Oracle"
  (`AdminPage.jsx:796-803`).
- **E.** `CatBond.triggerStatus()` — a third read-site of `isTriggered()`,
  currently a dead getter (nothing in the UI calls it).
- **F.** `api/report_trigger.py` — a second front door onto path A (drives
  `report()` via CLI, alongside the admin UI's own "Submit Report" button
  at `AdminPage.jsx:765-782`).
- **G.** `api/bonds.py`'s `status-tiggered` Bubble field — a **second,
  fully separate off-chain "triggered" concept**, decoupled from the
  on-chain flag. `update_bond_status()` can set it independent of anything
  on-chain. Currently dormant/unwired in the live flow (only exercised by
  the module's own demo and its test suite) but still a second source of
  truth that the sprint's Bubble-schema work must reconcile or explicitly
  retire, not leave dangling.
- **H.** The entire root-level `contracts/`/`script/`/`test/` tree
  duplicates paths A-E a second time, compiled and tested independently of
  `DEAL 000/` (which is what the app actually deploys from). Not wired to
  the live app, but a second drifting copy of the whole mechanism.

No Chainlink client code exists anywhere in application source (only
doc/comment mentions) — nothing to remove for plan §0.5.

### Build a Bond flow (create → deploy → view) — static trace
Every "Post deal" click deploys a **brand-new trigger** — no code anywhere
lists or selects an already-deployed trigger (zero hits for
"select/existing/deployed trigger" in `ui/src`). Plan §2.6's "Select
trigger" step has no informal precursor to build on; it's 100% new UI.

The workshop flow (`ReviewSection.jsx`) hardcodes `dealId: ''` on deploy —
a bond built through the live UI today gets **no web2 Bubble record at
all** (only `api/deploy_deal.py`'s separate fixture-driven script creates
one). The admin's manual `DeploySection` (`AdminPage.jsx`) is a second,
independent deploy path against the same contracts, with its own
`sellerName` collection (a real form field) vs. the workshop's
`guessSellerName()` heuristic derived from a URL — two different surfaces
populate the same on-chain field two different ways.

If the trigger deploy in `ReviewSection.jsx` succeeds but the auto-chained
bond deploy fails (or the user navigates away between them), the trigger
address is orphaned in `localStorage` with no bond and no UI to recover or
reuse it — another argument for the "Select trigger" step.

### Admin page's existing tooling
`ui/src/pages/AdminPage.jsx` has two sections: `DeploySection` (manual
two-step trigger+bond deploy, parallel to the workshop) and `ManageSection`
(address-paste-driven Fund/Close/MarkMatured/Settle/Submit-Report/
Reset-Trigger/Ping actions). This is the direct, if primitive, precursor to
Iteration 2's dashboard + "Manage a deal" — no product/monitor concept, no
trigger list, no bond-count/value rollups, no alerts, no report queue, no
version migration tracking. The settle/report/mark-matured wiring pattern
itself is sound and just needs `checkTrigger()`/`postReport()` swapped in
for `isTriggered()`/`report()`/`setTriggered()` — evolve, don't replace.

### Bubble/DB schema reality check
Live Bond record fields today (`api/bonds.py`): `cedant`,
`contract-address`, `description`, `Loss-history` (file, upload
unimplemented), `maturity`, `SOV` (file, upload unimplemented),
`status-tiggered` (0/1/2, off-chain, currently unwired), `value`.

`trigger_address`, `product_id`, `product_version`, `visibility`,
`owned_by_us`, coupon, and investor count — none of these exist in any
form today; all genuinely new for this sprint. Separately (and predating
this sprint): the Bond record has no field mirroring the bond's own
`sellerName`/`dealId`/`exposure`/`verified` on-chain fields — the on-chain
and off-chain schemas had already partially diverged before any of this
sprint's work starts.

### Naming mismatch — resolved
The plan specifies `apis/products/` (plural); the repo's real backend
folder is `api/` (singular). **Decision: the new registry goes at
`api/products/`**, matching the existing convention. Every reference to
`apis/products/...` in the sprint plan should be read as `api/products/...`.

### Decisions made before Iteration 1 work started
Three open items from the audit above were resolved with the project owner
before writing any Iteration 1 code:
1. **Registry location**: `api/products/` (not `apis/products/` — see above).
2. **Dead root contract tree** (`contracts/`, `script/`, `test/`, and the
   root `foundry.toml` that pointed at them): deleted outright via
   `git rm`. Fully tracked in git history (last touched at commit
   `347b087`) so it's recoverable if ever needed; nothing uncommitted was
   lost. `DEAL 000/` is now the only contract tree in the repo.
3. **Bubble's dormant `status-tiggered` field**: kept, not retired — but
   it stops being an independent write path. Once the reporting flow
   exists (§2.6), it syncs `lastCheck.triggered` from the on-chain trigger
   into this field, so Bubble mirrors chain state for cheap off-chain
   reads without a second source of truth.

### §2.2 revised mid-build: one product, multiple metrics
The plan's original §2.2 field list specs one `value_path` and one
`peril_type` per product — implying a 1:1 product-to-peril mapping. Caught
during review: RHODEX's real NatCat Loss API returns both economic-loss
and industry-loss figures in a single response for the same year. Two
separate product definitions (`ilw_industry_loss`, `economic_loss`) would
have meant the monitor polling the identical endpoint twice for data it
already has after the first call.

**Revised**: `peril_type` removed from the product schema entirely;
`value_path` (string) became `value_paths` (object: `{metric_name: path}`,
at least one entry). A product now describes an endpoint and every metric
it can serve; which metric a given trigger cares about is a deal-type
choice made at **trigger deploy time** (using the existing `dealType` on
`TriggerBase.sol`), not a product-time one — only one resolved path string
ever gets snapshotted into a trigger's `productConfig`, same as before.
The two example products collapsed into one: `public/natcat_loss.v1.json`,
exposing `economic_loss` and `industry_loss` as its two metrics. Full
rationale in `api/products/README.md`'s "One endpoint, multiple metrics"
section.

This is also why the monitor's ring buffer (§2.3, below) is keyed by
`(product_id, metric)` rather than just `product_id` — two metrics from
one product age and fail independently even though they share an HTTP
call.

### §2.3 — Off-chain monitor service, built
`api/monitor/` — `value_path.py`, `fetcher.py`, `store.py`, `scheduler.py`,
`health.py`. Full design writeup in `api/monitor/README.md`; key points
and judgment calls made along the way:

- **Storage**: stdlib `sqlite3`, no new dependency — this repo has no
  existing DB of any kind (everything else is Bubble-backed or flat
  files), and the data volume (20 rows × however many product/metric
  pairs, plus alerts) doesn't call for anything heavier.
- **One HTTP call per product per poll, regardless of metric count**:
  `fetcher.fetch_raw()` hits the network once; `fetcher.resolve_metric()`
  extracts each configured metric from that one already-fetched response.
  A total fetch failure fails every metric on that product identically and
  raises **one** alert naming all affected metrics (not one alert per
  metric, to avoid alert spam for what's really one problem). A single
  metric's `value_path` breaking (the source changed shape — the "drift
  detector" from §2.3) fails and alerts only that metric.
- **A true ring buffer**: `store.record_entry()` prunes each
  `(product_id, metric)` pair back down to 20 rows immediately after every
  insert — bounded storage, not "keep everything, only ever read 20."
- **Found and fixed a real staleness bug while writing tests, before it
  shipped**: every `store.py` function originally defaulted
  `db_path: str = _DEFAULT_DB_PATH` — a value bound once at module-import
  time. A test doing `monkeypatch.setattr(store, "_DEFAULT_DB_PATH",
  tmp_path)` would have silently had no effect on already-defined
  functions, meaning "isolated" tests would have kept hitting the real
  on-disk `monitor.db`. Fixed by defaulting to `None` and resolving the
  module attribute *inside* the function body instead, so monkeypatching
  it actually works. `scheduler.py`/`health.py` had the identical bug via
  `db_path: str = store._DEFAULT_DB_PATH` defaults and got the same fix.
- **Two things deliberately left unbuilt, documented rather than
  guessed at**: (1) no actual recurring scheduler — `poll_due_products()`
  decides what's due and polls it when called, but nothing cron-like
  invokes it; there's no existing "how does anything in `api/` run
  continuously" story in this repo to hook into. (2) no HTTP-served health
  endpoint — `health.py`'s functions are import-and-call ready, but there's
  no running backend server anywhere in this repo for a frontend to call
  (the UI talks to Bubble and the chain directly, never to Python).
  Turning either into real infrastructure is a hosting/deployment decision
  outside this sprint's scope, not something to silently invent.
- **Alert delivery** (email/Slack/etc.) is explicitly unanswered in the
  sprint plan itself (§3.5 references "Q5," which isn't answered in the
  plan doc) and is Iteration 2 scope. Alerts are persisted
  (`store.record_alert`/`get_open_alerts`/`resolve_alert`) so the health
  view can surface them now; delivery is future work.

### §2.4/§2.5 — Trigger contract rewrite and CatBond updates

**`ITrigger.sol`/`TriggerBase.sol` rewritten** (`DEAL 000/src/catbond/`):
`isTriggered`/`_triggered`/`setTriggered`/`report(value, source)` are gone.
Replaced with an append-only `Report[]` (`{value, reportedAt, reporter,
monitorRef}`), a `reporter` role settable by `owner` via `setReporter()`
(initially the company wallet — single wallet per Q2, multisig is a future
`setReporter()` call, not built now per §0.5's no-oracle-network rule),
`postReport(value, monitorRef)` (reporter-only), and three read functions:
`reportCount()`, `latestReport()` (reverts if empty), `latestReportSince(notBefore)`
(reverts if the latest report predates `notBefore`). `dealType`/`lossLimit`
are also gone from the trigger entirely — see below.

**Where the threshold went**: `CatBond.sol` gained its own immutable
`threshold` (a new 4th constructor param, right after `_trigger`). The
trigger has no concept of a threshold at all anymore — it just logs
reported values for one product/metric. This is a deliberate structural
change beyond the plan's literal §2.4/§2.5 text, made because it's what the
report-log redesign was already pushing toward: **multiple bonds with
different thresholds can now share one trigger/product**, which is exactly
what Iteration 2's dashboard wants to show ("number of bonds relying on
this trigger," §3.2). `dealType` (economic vs. industry loss) is likewise
gone as a separate trigger field — it's now implicit in *which* trigger a
bond points at, since each trigger snapshots one specific
`productConfig.valuePath` from `api/products/` at deploy time (see §2.2's
revised "one endpoint, multiple metrics" design). `TriggerBase`'s
`ProductConfig` struct (`productId`, `version`, `valuePath`, `units`,
`maxReportAge`, `endpointHash`) is exactly that snapshot; `endpointHash` is
`keccak256` of the endpoint URL passed at deploy — the raw URL is never
stored on-chain, only its hash, enough to detect drift if a product's
endpoint changes without a version bump.

**`CatBond.sol`**: added `threshold` (immutable) and a `LastCheck` struct
(`{value, reportedAt, triggered, checkedAt, checkedBy}`) written by the new
`checkTrigger()`. `activeStart` (already existed) doubles as this bond's
"commencement" — no new field was added for it, since it's the same concept
the plan calls `commencement`. Three functions now route through
`checkTrigger()` instead of the old `trigger.isTriggered()`:

- **`checkTrigger()`** (new, `public`, callable by anyone): reads
  `trigger.latestReportSince(activeStart)`, reverts `StaleReport` if that
  report is older than `trigger.maxReportAge()`, compares `value >=
  threshold`, writes `lastCheck`, emits `TriggerChecked`. This is the one
  path by which a bond decides it's triggered — closes out the audit's §4
  finding that there were previously five-plus separate ways to read/set
  "triggered" state.
- **`settle()`**: now `if (!checkTrigger()) revert TriggerNotFired();` — a
  `checkTrigger()` revert (no report, or stale) propagates uncaught, so a
  missed report blocks settlement outright, exactly per §2.5's explicit
  instruction ("never default to not triggered").
- **`markMatured()`**: now also calls `checkTrigger()` and reverts
  `TriggerAlreadyFired` if it returns true — extended the same "a missed
  report blocks you" discipline to the untriggered/maturity path, not just
  `settle()`. This is a genuine behavioral tightening: previously a bond
  with a trigger that had *never once been reported to* could still reach
  maturity and let investors withdraw; now it can't, until the company
  wallet posts at least one fresh report. This is the direct, intended
  consequence of §1's framing — "the company wallet keeps reports fresh...
  the operational responsibility we take on instead of paying an oracle
  network" — not a side effect to route around.
- **`closeSubscription()`**'s early guard (fires *before* `activeStart`
  exists, so `checkTrigger()`'s window logic doesn't apply yet) now checks
  `trigger.latestReport().value >= threshold` instead of
  `trigger.isTriggered()`. Meaningful behavior change from the old
  permanent-latch design: the report log has **no memory** beyond its
  latest entry, so a later below-threshold report supersedes an earlier
  above-threshold one for this guard's purposes (there is no way to
  "un-trigger" a bond that already reached the Triggered *status*, but this
  guard only ever looks at the current top-of-log value). Covered by
  `EarlyTriggerGuardTest.test_CloseSubscription_SucceedsWhenLatestReportIsBelowThreshold`.
- **Deploy-time trigger validation** (§2.5: "reverts if zero or if the
  address does not implement the trigger interface"): the constructor now
  reverts `ZeroTrigger` on the zero address, `InvalidTrigger` if the address
  has no code, and `InvalidTrigger` again if a `try/catch`'d call to
  `reportCount()` fails to decode — catches both an EOA and a
  wrong-shaped contract (tested against `MockUSDC` as a stand-in
  non-conforming contract).
- **`triggerStatus()` and `pingTrigger()` deleted** — both were flagged
  dead/redundant in the pre-sprint audit (§4.D/§4.E: `triggerStatus()` had
  no caller anywhere in the UI; `pingTrigger()`'s "ping periodically for an
  on-chain event" pattern is now redundant with `checkTrigger()` emitting
  `TriggerChecked` directly). `TriggerDetected` event removed with them.
  **This breaks `AdminPage.jsx`'s "Ping Trigger Oracle" button** — expected
  and tracked for §2.6, not fixed here (contracts-only pass, per this
  session's explicit scope).

**Three distinct revert reasons, kept separate rather than collapsed**:
`TriggerBase.NoReports` (the trigger has nothing usable at all, or nothing
in the requested window — propagates unmodified from `latestReportSince`),
`CatBond.StaleReport` (a report exists and is in-window but older than
`max_report_age`), `CatBond.TriggerNotFired` (a fresh, in-window report
exists but is below threshold). Tests exercise all three independently
(`test_Reject_SettleWhenNoReportPosted`,
`test_CheckTrigger_RevertsWhenStale`,
`test_Reject_SettleWhenReportedBelowThreshold`) — collapsing them into one
error would have hidden exactly the kind of ambiguity (missing vs. stale
vs. genuinely-not-triggered) this sprint exists to remove.

**Setup.s.sol / DEAL 000's deploy script updated to match**: `Deal000Trigger`
now takes the full 8-arg `TriggerBase` constructor; `run()` builds its
`valuePath` from `TRIGGER_TYPE` the same way the old script built
`dealType`, sourced from `api/products/public/natcat_loss.v1.json`'s two
metrics; `threshold` (renamed from `lossLimit`) now goes to the `CatBond`
constructor call instead of the trigger's.

**Two real test bugs caught and fixed while getting to green** (both in
the *tests*, not the contracts):
1. `TriggerValidationTest`'s revert tests initially all failed with "next
   call did not revert as expected." Cause: `vm.expectRevert()` attaches to
   the *next* CALL/CREATE the test makes — the helper created `MockUSDC`
   *inside* the same statement block as `new CatBond(...)`, so the
   (successful) `MockUSDC` creation consumed the expectation before
   `CatBond`'s constructor ever ran. Fixed by creating `usdc` before
   arming `vm.expectRevert()`, passing its address into the helper.
2. `test_CheckTrigger_RevertsWhenReportPredatesCommencement` first failed
   with `WrongStatus(1, 0)` (forgot to fund the bond before calling
   `closeSubscription()`), then — after fixing that — failed again with
   `TriggerAlreadyFired()` instead of the expected `NoReports`: the
   above-threshold report used to set up the scenario was *also* tripping
   `closeSubscription()`'s separate early guard, so the test never reached
   the code path it meant to isolate. Fixed by posting a *below*-threshold
   report instead — still predates `activeStart` (which is what the test
   is actually about), but no longer collides with the unrelated guard.

**Known breakage, tracked for §2.6 (not fixed in this pass — contracts
only)**: `api/report_trigger.py` calls the old `report()`/`dealType()`/
`lossLimit()` — will fail against the new ABI. `ui/src/pages/AdminPage.jsx`
(DeploySection's trigger-deploy args, ManageSection's Submit
Report/Reset Trigger/Ping Trigger Oracle buttons) and
`ui/src/components/build-bond/ReviewSection.jsx` (trigger deploy args,
missing the new `threshold` param on the `CatBond` call) both target the
old constructor/function signatures. `ui/src/artifacts/CatBond.json` and
`ManualTrigger.json` are now **stale** — compiled from the pre-rewrite
contracts — and must be regenerated from `DEAL 000/out/` before any UI
work in §2.6 can proceed. `DEAL 000/run-insured-test.sh` calls
`report_trigger.py` and will fail until that script is rewritten.

### Live verification: `./run.sh quick` end to end on anvil

Beyond the 53 unit tests, ran the actual deploy script against a live local
chain to confirm the rewrite works outside the test harness too — this is
also direct evidence toward the plan's §2.8 Iteration 1 exit criterion
("one bond ... matured untriggered" on testnet).

1. `./run.sh quick` — starts anvil, runs `api/deploy_deal.py` →
   `Setup.s.sol`, deploys `Deal000Trigger` + `CatBond` (economic-loss,
   $370B threshold, `natcat_loss` v1 product), creates the web2 Bubble
   record, links it, verifies `dealId`/`sellerName` read back correctly.
   Confirmed the trigger's `productConfig()` on-chain matches the product
   definition exactly (`natcat_loss`, v1, the economic-loss `valuePath`,
   `usd_billions`, `maxReportAge` = 12,960,000s = 150 days).
2. Sponsor funded the coupon budget, investor deposited the full $500,000
   coverage, `closeSubscription()` succeeded immediately (fully
   subscribed) — confirmed status `Active`.
3. Warped past the 5-minute quick term. **Called `markMatured()` with
   zero reports ever posted — reverted `NoReports`, exactly as designed.**
   This is the real behavioral tightening from §2.5 confirmed live, not
   just in a test harness: a bond cannot reach Matured (and therefore
   investors cannot withdraw) without the company wallet having posted at
   least one report.
4. Posted a report ($142B, below the $370B threshold) via
   `trigger.postReport()`. Called `checkTrigger()` (from an arbitrary
   caller — it's public) and read back `lastCheck()`: value, reportedAt,
   `triggered = false`, checkedAt, checkedBy all correct.
5. Called `markMatured()` again — succeeded this time, status → `Matured`.
6. Investor called `withdrawPrincipal()` — received exactly $500,000
   (500000000000 in 6-decimal units), matching principal deposited
   exactly.

No discrepancies from the unit-test suite's expectations — the live run
confirmed the same behavior the 53 `forge test` cases already assert,
against a real deployed instance rather than an in-memory EVM.

### Live verification #2: the triggered path, with investor/sponsor self-checks

Same live setup (fresh `./run.sh quick`), this time exercising an actual
trigger firing mid-term rather than the untriggered-maturity path above —
and specifically having the sponsor and investor interact with the trigger
themselves rather than only the company wallet, since `checkTrigger()` and
`closeSubscription()` are both intentionally permissionless.

1. Sponsor funded, investor deposited the full $500,000 coverage. The
   **investor** (not the company) called `closeSubscription()` —
   succeeded, confirming it's genuinely callable by anyone.
2. Warped 2 minutes into the 5-minute term. **Sponsor** called
   `checkTrigger()` before any report existed — reverted `NoReports`,
   the honest answer rather than a false negative.
3. Company posted a $400B economic-loss report (threshold: $370B) via
   `trigger.postReport()`.
4. **Investor** — not the company — called `checkTrigger()` directly.
   Read back `lastCheck()`: `value=$400B`, `triggered=true`, and critically
   `checkedBy` = the investor's own address, proving they verified the
   trigger fired themselves rather than taking the company's word for it.
5. Company called `settle()` — status → `Triggered`, sponsor received
   exactly the $500,000 principal.
6. Investor called `claimCoupon()` — received a partial coupon (~$29,600
   of the $40,000 full-term coupon), correctly prorated to only the time
   elapsed before `settlementTime`, not the full term. (Exact figure
   depends on anvil's real block timestamps during the session, not hand-
   verified to the dollar here — `testFuzz_CouponNeverExceedsCap` and
   `test_TriggerPath` already pin the exact math deterministically; this
   run's job was proving the live integration, not re-deriving it.)

Confirms the design goal directly: neither the sponsor nor the investor
has to trust the company wallet's word that a bond triggered — anyone can
call `checkTrigger()` and get the same on-chain answer, with a record of
who checked and when.

### §2.6 audit — how bond status currently updates end to end (before touching the health view)

Per §2.6's explicit instruction: trace the current mechanism before
rebuilding anything, and only rebuild what's actually broken. Traced
`ui/src/pages/AdminPage.jsx` and `ui/src/pages/DealPage.jsx` in full.

**Finding: the entire read side is broken, not just the write side.**
Both pages read `isTriggered`, `lossLimit`, `dealType`, `reportedValue`,
`reportedSource` directly off the trigger contract — every one of those
fields is gone in the §2.4 rewrite. This isn't a case of "the mechanism
already reflects `lastCheck` correctly, leave it alone" — there is no
existing mechanism that reads `lastCheck` at all, because `lastCheck`
didn't exist before this sprint. Every status-related read in both pages
needs rebuilding, not patching.

Specifics:
- **`AdminPage.jsx` `ManageSection`** (line ~532-544): reads
  `isTriggered/lossLimit/dealType/reportedValue/reportedSource` from the
  trigger to compute `triggerFired` and render the "🔴 FIRED / 🟢 Not
  fired" badge, the threshold line, and the "Last report" line. All five
  calls will fail against the new ABI. `triggerFired` also gates the
  Settle button's `disabled` prop and the "Reset Trigger"/"Ping Trigger"
  buttons' `disabled` props.
- **`AdminPage.jsx` `DeploySection`** (line ~205-240): `handleDeployTrigger()`
  calls the old 3-arg constructor `[companyWallet, lossLimit, dealType]`;
  `handleDeployBond()` is missing the new `_threshold` constructor arg
  entirely (still the pre-rewrite 12-arg call). Both will revert or
  construct nonsense against the new bytecode.
- **`AdminPage.jsx` ManageSection's "Submit Report"** (line ~765-782) calls
  `report(lossUSD, source)` — function no longer exists, replaced by
  `postReport(value, monitorRef)` (a `bytes32`, not a free-text source
  string). **"Reset Trigger"** (line ~788-794) calls `setTriggered(false)`
  — function deleted outright by design (§2.4: no more manual override).
  **"Ping Trigger Oracle"** (line ~797-803) calls `pingTrigger()` — deleted
  in §2.5 as dead/redundant. All three buttons are calling functions that
  no longer exist on the contract at all.
- **`DealPage.jsx`** (line ~512-524): same five-field trigger read,
  feeding `triggerType` (which `TRIGGER_TYPES` entry to show — economic
  vs. industry loss), `thresholdB`, `reportedB`, and `triggerState`
  (`not_triggered`/`triggered`/`settled`, passed to `TriggerWidget`). All
  broken the same way. `reportedSource` specifically has no equivalent at
  all in the new design — a report's provenance is now a `monitorRef`
  hash tying it to a specific monitor-buffer entry, not a human-readable
  string like `"Gallagher Re H1 2026"`.

**Design decision for the rebuild**: `DealPage.jsx` is a passively-loaded
public page — requiring every visitor to sign a gas-paying transaction
just to see whether a bond looks triggered would be bad UX, and
`checkTrigger()` is a state-changing call, not a free `view` read. So the
rebuild separates two distinct things, both surfaced in the UI: (1) a
**client-side, gas-free "likely triggered" read** — fetch
`trigger.latestReport()` and `bond.threshold()` directly and compare them
in the browser, clearly labeled as unconfirmed; (2) the **on-chain
`lastCheck`** — the bond's own confirmed record of the last time anyone
actually ran `checkTrigger()`, which may lag behind the latest report if
nobody's called it recently. A **"Self-check" button** (exactly what §2.6
asks for) lets any connected wallet pay their own gas to call
`checkTrigger()` and bring `lastCheck` up to date — this is the same
pattern already verified live in this session's second scenario (an
investor independently calling `checkTrigger()` rather than trusting the
company wallet).

Nothing here was left alone — everything traced above needed a real
rebuild, which is what the rest of this §2.6 entry covers.

### §2.6 — what was rebuilt, and what's honestly still open

**Artifacts regenerated**: `ui/src/artifacts/CatBond.json` and
`ManualTrigger.json` (the latter compiled from `Deal000Trigger`, the
concrete deployable subclass — `TriggerBase` itself is abstract) copied
fresh from `DEAL 000/out/`, matching the §2.4/§2.5 rewrite.

**`ui/src/data/historicalLoss.js`**: added `NATCAT_LOSS_PRODUCT` (the
product's `productId`/`version`/`units`/`maxReportAgeSeconds`/`endpoint`)
and a `valuePath` on each `TRIGGER_TYPES` entry — this is the browser-side
mirror of `api/products/public/natcat_loss.v1.json`, needed because
there's no HTTP path for the browser to fetch the real registry from (see
`api/monitor/README.md`'s "what's deliberately not built here"). If the
product ever changes, all three copies (this file, the product JSON,
`Setup.s.sol`) need updating together — noted in-code.

**`ReviewSection.jsx`** (the live public "Post deal" workshop flow): both
deploy calls fixed to the new constructor shapes — trigger deploy now
builds the 8-arg `TriggerBase` constructor from `NATCAT_LOSS_PRODUCT` +
the selected `triggerType.valuePath`; bond deploy now includes `threshold`
(moved off the trigger in §2.5). This was flagged in the audit as the
highest-priority fix — before this, nobody could post a deal through the
live workshop at all.

**`AdminPage.jsx`**: `DeploySection`'s two deploy calls fixed the same way,
with copy updated so the "Loss Threshold" field is clearly a Step 2 (bond)
input now, not Step 1 (trigger). `ManageSection` rebuilt:
- Reads replaced: `isTriggered/lossLimit/dealType/reportedValue/reportedSource`
  → `reportCount/latestReport/maxReportAge/productConfig` (trigger) plus
  the bond's own new `threshold`/`lastCheck`.
- **"Reset Trigger" deleted outright** — `setTriggered()` no longer exists,
  by design (§2.4).
- **"Ping Trigger Oracle" replaced with "Self-check (checkTrigger)"** —
  callable by anyone, not gated to the company wallet, matching §2.6's
  explicit ask and the mechanic this session already verified live (an
  investor independently confirming a trigger fired).
- **"Submit Report" → "Post Report"**, now calls `postReport(value,
  monitorRef)`. Since there's no monitor HTTP endpoint for the browser to
  pull a real traceable entry from yet, the admin's free-text "note" field
  is hashed into `monitorRef` and the UI says outright that this is a
  manual test report, not a production-traceable one — an honest limit,
  not a silently-faked one.
- **Settle button** no longer pre-blocks on a possibly-stale local
  `triggerFired` read — it's enabled whenever the connected wallet is the
  company wallet and the bond is Active, and lets the on-chain
  `checkTrigger()` inside `settle()` be the actual authority (its revert
  surfaces through the existing error banner either way).
- Status display now shows two distinct things, never collapsed into one:
  the **on-chain confirmed** `lastCheck` (only as fresh as the last
  `checkTrigger()` call) and a **client-side, gas-free** comparison of the
  latest report against threshold, explicitly labeled "unconfirmed."

**`DealPage.jsx`** (public bond health view): same read rebuild —
`triggerType` now derived by matching the trigger's `productConfig.valuePath`
against `TRIGGER_TYPES`; `thresholdB` reads the bond's own `threshold`;
`reportedB` reads the trigger's `latestReport().value`. `TriggerWidget`
gained a **Self-check button** calling `checkTrigger()` — this *is* §2.6's
"bond health view ... Self-check button calls checkTrigger()" requirement,
landed on the existing widget rather than as a separate new page, since
the existing widget already occupies the right spot in the layout and
already had the right shape for it. Added `StaleReport`/`NoReports` to the
revert-message map so a failed self-check reads as an explanation, not a
raw error dump. Added `lib/utils.js::formatAge()` (shared by both pages)
for "3h ago"/"12d ago" report-age display.

**`api/report_trigger.py`** rewritten per §2.6's literal spec: split into
`compare(value, threshold)` (pure) and `build_report_payload(product_id,
metric)` (reads the monitor's latest *successful* entry, shapes it into
`{value, monitor_ref, ...}` — raises rather than fabricating a value if
the monitor has nothing successful yet). The monitor's `raw_response_hash`
(sha256, 32 bytes) turned out to fit `bytes32` exactly with no reshaping —
a small design payoff from §2.3's fetcher already hashing raw responses.
The CLI wrapper (`report()`, used by `run-insured-test.sh`) now resolves
which product/metric a trigger reports on by reading its own on-chain
`productConfig()` and matching `valuePath` against the registry — so it
still works from just a trigger address, no env vars needed, same as the
pre-sprint CLI shape. It deliberately no longer prints whether a report
"triggers" anything: threshold now lives on the bond, and one trigger can
back multiple bonds at different thresholds (§2.5), so "triggered" isn't
a trigger-level fact anymore. Added `api/test_report_trigger.py` (6 tests,
covering `compare()` and every `build_report_payload()` path — latest
successful entry wins, failed entries are skipped, raises on nothing
successful). Full `api/` suite: 78/78.

**`api/bonds.py`**: added `trigger_address`/`product_id`/`product_version`
to `build_bond_payload()`, per §2.6's "bond gets trigger_address,
product_id, product_version." **Explicitly not done, and flagged rather
than faked**: these three fields have **not** been registered on the real
live Bubble workflow via the one-time `/initialize` call this module's own
setup note describes — populating them today builds a correct Python dict
but won't actually persist anything on a real `create_bond()`/`get_bond()`
round-trip until that live registration step is run deliberately (a
one-way mutation to shared third-party infrastructure, not something to
trigger as a side effect of writing code). `deploy_deal.py` also hasn't
been wired to populate them yet — the trigger address isn't known until
after the web2 record already exists, so populating it needs either a
follow-up "link" call (mirroring `link_contract_address`) or folding it
into that same call, and either needs the same live `/initialize` step
first.

**Confirmed still correct as read-only, not touched**: `TriggerBase`'s
`report()` comment structure, `CatBond`'s own contract logic (§2.4/§2.5,
already shipped and live-verified in the prior entries above) — this pass
was UI/backend wiring only, no contract changes.

**Genuinely still open, not built, not faked**:
- **"Select trigger" step** (§2.6: "list deployed public triggers —
  product name, version, latest report age"). No infrastructure exists
  anywhere in this repo to enumerate "every trigger ever deployed" — no DB
  table, no Bubble object type, no indexer/subgraph. Every deploy still
  creates a brand-new trigger (same gap the original audit found). Building
  this needs a decision about where that list lives before it can be built
  — not something to fabricate a fake list for.
- **Monitor HTTP endpoint** (still, as documented in §2.3/`api/monitor/README.md`)
  — the admin's "Post Report" note-hashing workaround above exists
  precisely because of this gap.
- **A real recurring scheduler** — same gap, unchanged from §2.3.
- **New "Trigger" Bubble object type** for a `latest_report` mirror — the
  audit confirmed no such object type exists today (only Bond records
  exist); inventing one wasn't done here for the same reason the field
  registration above wasn't run live.

### Post-§2.6 fix: a new live endpoint exposed a real bug in natcat_loss.v1

The user added a new live Bubble endpoint (`latest-report`, discovered at
that exact hyphenated slug after a few naming variants 404'd — `latest_report`
and the all-caps/hyphenated forms all failed) that returns the single most
recently added record directly, under `response.reports` (an object, not
an array, despite the plural key). Probing it live turned up a real,
pre-existing defect in `natcat_loss.v1.json`, not something the new
endpoint introduced:

- `natcat_loss.get_records()`'s last entry and this new endpoint's record
  have the **identical `_id`** — confirmed by direct comparison. So
  `ALL-LOSSES[-1]` was never "the latest completed year," it's whatever
  the newest record is, in-progress or not.
- Right now that's 2026, which — being not yet finished — has **no
  `"economic-loss | total"`/`"industry-loss | total"` field at all**, only
  whatever quarters have completed (`"Q1 economic"`, `"Q2 | economic"`,
  etc., with the live API's own inconsistent spacing/pipe conventions
  preserved deliberately, matching this codebase's "don't fix the API's
  typos" policy elsewhere).
- `natcat_loss.v1.json`'s `value_paths` (`response.ALL-LOSSES[-1]."economic-loss | total"`)
  therefore **cannot resolve against live data today** — a real bug that
  existed before this endpoint was added, this session just happened to
  surface it while investigating the new endpoint. `api/natcat_loss.py`'s
  own `latest_loss_for_year()` already handled this correctly in Python
  (a total→Q3→Q2→Q1 fallback chain) — the product definition's static
  `value_path` string just never had an equivalent.

**Fix — `value_path.py` gained fallback-chain support**: a `value_paths`
entry can now be a list of paths tried in order
(`value_path.resolve_first()`), not just a single string.
`products/schema.py` validates either shape; `monitor/fetcher.py`'s
`resolve_metric()` dispatches to whichever resolver the shape calls for.

**`natcat_loss` versioned to v2** per the registry's own rule (endpoint,
call_parameters, and value_paths all changed): v2 switches to the
`latest-report` endpoint (no `ALL`/`YEAR` params, no array to fetch and
index into) and gives each metric the same total→Q3→Q2→Q1 chain
`natcat_loss.py` already used. v1 flipped to `"status": "deprecated"`,
left in place per the never-delete rule, with its `data_source_description`
recording exactly why. `api/natcat_loss.py` gained `fetch_latest_report()`
for parity, even though the monitor's fetcher calls the endpoint directly
and doesn't route through this module.

Updated to match: `DEAL 000/script/Setup.s.sol` (version 2, new endpoint,
value_path strings without array indexing — the on-chain snapshot only
ever needs the fallback chain's primary/identifying entry, since the
contract never re-derives anything; the chain itself is a monitor-only
concern), `ui/src/data/historicalLoss.js`'s `NATCAT_LOSS_PRODUCT`/
`TRIGGER_TYPES`, and `report_trigger.py`'s on-chain-`valuePath`-to-metric
matching (now checks membership in a fallback-chain list, not plain
string equality). Added `resolve_first()` tests (including the exact
in-progress-year scenario), schema tests for the list shape, and updated
the real-registry tests to check v2 is what `get_latest_active()` returns
while v1 still loads but reports deprecated. `api/` suite: 85/85.

### "Select trigger" — resolved, not left as an open gap

Raised a fair challenge to the earlier "no infrastructure enumerates
deployed triggers" framing: the plan's §2.6 "Select trigger" step
(picking from public triggers by product/version/report-age) is only
hard if triggers are meant to be numerous and independently browsable.
For **public** deal types specifically, there are only ever two
choices — economic-loss and industry-loss — and the existing "Deal Type"
selector already picks between exactly those two. So instead of building
a registry, this deploys **one canonical, already-reported-to trigger per
public deal type**, shared by every public bond of that type, and lets
Deal Type selection double as trigger selection — no enumeration needed
because there's nothing to enumerate.

- Deployed both live on the current anvil chain (`Deal000Trigger`, v2
  product, one per metric):
  economic-loss `0x593C66DBf77348920DA8C2c47d23390781a53656`,
  industry-loss `0xC8615da9d2511b7B6fD0C07DFdC52005cA26ECEE`. Verified
  each one's on-chain `productConfig()` matches the intended metric.
- Added `CANONICAL_TRIGGERS` to `ui/src/constants/abis.js`, explicitly
  flagged testnet/anvil-only (chain-id 31337) — same placeholder-until-
  real-launch status as `RHODEX_COMPANY_WALLET` right above it.
- **Simplified `ReviewSection.jsx` significantly**: "Post deal" no longer
  deploys a trigger at all — it looks up `CANONICAL_TRIGGERS[triggerType.id]`
  and deploys only the bond, referencing it directly. This is a genuine UX
  win too, not just a simplification: one on-chain transaction instead of
  two, and no more risk of an orphaned trigger if the auto-chained bond
  deploy that used to follow it ever failed (a real gap the original §2.1
  audit flagged).
- **Live-verified**: deployed a fresh `CatBond` via `forge create` pointed
  directly at the canonical economic trigger (no trigger deploy step at
  all) and confirmed on-chain that `bond.trigger()` resolves to the
  canonical address and `bond.threshold()` is independently set on the
  bond — proof multiple bonds really can share one trigger at different
  thresholds, the core design property from §2.5.
- `AdminPage.jsx`'s manual `DeploySection` deliberately keeps its own
  from-scratch trigger deploy — that tool's job is custom/private/testing
  deploys (and it's literally what was used to deploy the two canonical
  triggers above), not the public workshop flow.
- **Still explicitly out of scope**: a private-trigger equivalent
  (Iteration 2, §3.1) and a real per-network deployment process for the
  canonical addresses before any non-anvil launch — both flagged, neither
  faked.

### 2026-09-16 — Iteration 2: admin ghost reskin + trigger status dashboard
- `npx vite build` — clean, no new errors, both before and after the
  full `AdminPage.jsx` reskin and the new `TriggerStatusSection`/
  `WorldMap` additions. Bundle size unaffected (map is a static inline
  SVG, no new dependency).
- **Live on anvil**: the two `CANONICAL_TRIGGERS` from the previous
  entry were still deployed but had `reportCount() == 0` on the running
  chain (fresh state since that session). Impersonated the reporter
  (`RHODEX_COMPANY_WALLET`, confirmed live via `cast call reporter()`)
  and posted a report (`300000000000` = $300B) to the economic-loss
  trigger via `cast send ... postReport(...)`. Confirmed via `cast call`:
  `reportCount() == 1`, `latestReport()` and `reports(0)` both return the
  posted value/timestamp/reporter/monitorRef exactly — this is the same
  data path the new `TriggerCard` component reads (`productConfig`,
  `reportCount`, `latestReport`, `reporter`, `owner` via one multicall;
  `reports(i)` per-index for history), so the on-chain side of the
  dashboard is confirmed correct without guessing at wagmi's behavior.
- Confirmed `reports(uint256)` exists as a public-array auto-getter on
  the deployed `ManualTrigger` artifact (`ui/src/artifacts/ManualTrigger.json`)
  with the expected 4-field return (`value, reportedAt, reporter,
  monitorRef`) — this is what makes on-chain-only report history
  possible without a backend.
- **Not verified visually**: no browser-automation tooling is available
  in this environment (confirmed no `chromium-cli` or Playwright driver
  present), so the actual rendered page — accordion animation, map hover
  color-shift, layout at various widths — was not screenshotted. The
  user should sanity-check `/admin` → section 03 in a real browser
  before relying on this.
- Health-label pill in `ManageSection` uses the same `latestValue`/
  `bondThreshold` values already fetched for `likelyTriggered` — no new
  reads, so no new failure mode introduced there.

### 2026-09-17 — Three live bugs found and fixed in `report_trigger.py`
User reported `run-insured-test.sh` failing with `RuntimeError: no
metric on natcat_loss v2 matches on-chain valuePath ...` — chased this
down against the real running anvil chain rather than guessing from the
code, and found three separate real bugs stacked on top of each other
in the reporting path (see `CHANGELOG.md` same date for the full
writeup). Results, in the order each was found and fixed:

1. `cast call 0x593C... productConfig() --json` — confirmed cast's
   default text output backslash-escapes embedded quotes in string
   return values, and that `_metric_for_trigger`'s `.strip('"')` left
   stray backslashes behind instead of the real string. Fixed by
   switching to `--json` + `json.loads`. Re-ran
   `_metric_for_trigger()` directly against both canonical triggers
   post-fix: `('natcat_loss', 2, 'economic_loss')` and `('natcat_loss',
   2, 'industry_loss')` — both correct.
2. `python3 -c "from monitor import scheduler; print(scheduler.poll_all_active_products())"`
   — reproduced "secret env var 'RHODEX_API_KEY' is not set" even with
   a valid `.env` at repo root, confirming `monitor/fetcher.py` never
   loaded it. Added `load_dotenv()`; re-ran the same command post-fix —
   real live values came back (`economic_loss: $142.0B`, `industry_loss:
   $46.0B`).
3. Ran `report_trigger.py` end-to-end against a freshly-deployed
   industry-loss trigger (via `run-insured-test.sh`) — succeeded but
   printed "Reported $4.6e-08B", revealing the value wasn't scaled to
   the on-chain integer convention. Fixed `build_report_payload` to
   scale by the product's `units` (`usd_billions` → ×1e9). Re-ran the
   same live report: printed "Reported $46.0B" correctly, and `cast
   call latestReport()` on the trigger confirmed `46000000000` on-chain
   — exact match.
- `python3 -m pytest` (full `api/` suite): 85/85, including
  `test_report_trigger.py`'s updated assertions for the scaled values.
- **Not yet resolved**: the user separately reported the whole `/admin`
  page rendering blank in their browser after the trigger-status
  dashboard changes (previous entry). No crash-causing bug was found by
  re-reading `TriggerCard`/`WorldMap`/`TriggerStatusSection` — every
  hook pattern mirrors already-working code in `ManageSection`, and
  `AccordionSection` mounts all three sections' content unconditionally
  (only height-clips the collapsed ones), so a render-time throw
  anywhere in section 03 would blank the whole page, consistent with
  the report. Waiting on the actual browser console error text to
  pinpoint it — no headless browser tooling is available in this
  environment to reproduce it directly.
- **Correction**: it turns out headless browser tooling *is* available
  — `pip show playwright` found Playwright 1.58.0 already installed
  with a working Chromium binary (`p.chromium.launch()` succeeds). Used
  it immediately to load `/admin` and `/deal` cold: zero console errors,
  zero page errors, both rendered correctly (screenshotted). The user's
  "blank" turned out to be environment-side (resolved itself — "it's
  working now"), not a code bug. Lesson for future sessions in this
  repo: try Playwright before assuming no visual verification is
  possible.

### 2026-09-17 — Live bonds map verified with Playwright
- `cd ui && npx vite build` — clean both after wiring `LiveBondsMap` in
  and after reworking the hover effect twice.
- `python3 api/server.py` — started, confirmed `GET /bonds?type=natcat`
  returns real data (`curl`), then left running for the UI to hit.
- **Full Playwright pass** against the real dev server + real anvil
  chain + real `api/server.py`: unlocked `/admin`, screenshotted the
  live bonds map — headline read "$750K" (matches `500000 + 250000`
  from the two real Bubble bonds), subtext "2 bonds relying on NatCat
  triggers", grid background and higher-resolution dots both visible,
  "Latest report →" pill present (no value shown — correct, since the
  canonical triggers on the current anvil chain have `reportCount() ==
  0` after the earlier `run.sh quick` reset), pastel rainbow link
  visible with a clear pink→yellow gradient.
- First hover attempt (`mix-blend-mode: color`) was confirmed
  *mechanically* correct via `getComputedStyle` (opacity 1, correct
  `--spot-x`/`--spot-y`, gradient present) but visually near-invisible
  in a screenshot — blending a saturated blue onto already-blue dots
  barely shifts them. Switched to a masked bright-dot overlay instead;
  re-screenshotted with the cursor moved into the map and could clearly
  see a small brighter cluster of dots around the cursor position this
  time.
- No console/page errors at any point in this pass.
