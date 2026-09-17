# Sprint: Deployed Triggers as Source of Truth

**Scope for this sprint:** ILW and economic-loss deals only. Do not add other perils yet, but structure the code so a new peril is a new product definition plus one trigger deployment, not new code.

**Run as two iterations.** Iteration 1 builds the one flow every bond uses. Iteration 2 builds the systems our team uses to manage triggers across all deals. Do not start Iteration 2 until Iteration 1 tests pass and are documented.

---

## 0. Working rules for this sprint

1. **Document every change.** Each PR / commit updates `CHANGELOG.md` and any affected README. New folder → new README explaining what lives there and why.
2. **Test before moving on.** No task is done until its tests pass. Smart-contract changes get new contract tests, not just app-layer tests.
3. **Create `TESTING.md`** at repo root: how to run each suite, what each covers, and a results log (date, suite, pass/fail, notes) appended every run during this sprint.
4. **Kill redundancy.** There are currently several ways a bond can be triggered. By the end of the sprint there is exactly one: bond reads the latest report from its linked trigger contract and compares `value >= threshold`. If you find another path, delete it or flag it.
5. **No oracle networks.** No Chainlink (Any API, Functions, or CRE), no LINK. If existing `ChainlinkClient` code is in the repo, remove it rather than extend it. Keep the door open (see §2.4, reporter role) but do not build for it.
6. **Ask before guessing.** If this spec conflicts with existing code or is ambiguous, stop and ask. Known open questions are in §5.

---

## 1. The thesis

**Every bond links to a deployed trigger contract. The trigger contract is the on-chain source of truth. It holds reports, not a triggered flag.**

- A **product** is a managed API endpoint plus everything needed to call and interpret it. Products live in `apis/products/`, are versioned, and are the foundation for everything else.
- A **trigger contract** is deployed per product (public deals) or per deal (private deals). Same contract code either way. It stores a frozen snapshot of the product definition and an append-only **report log** written by the company wallet. It has no `isTriggered`.
- A **bond** links to exactly one trigger at deploy. `checkTrigger()` reads the trigger's latest valid report, compares it to the bond's threshold, and records the result on the bond. `settle()` always runs that check first.

**The reference chain, spelled out for future devs.** A bond never talks to an API. A bond references a trigger contract by address. The trigger contract references a product (`product_id` + `version`) whose definition — endpoint, params, `value_path`, units — lives in `apis/products/` and is snapshotted into the trigger at deploy. The monitor service is the only thing that calls the API. The company wallet reads the monitor and writes a report to the trigger. The bond reads the report. So to answer "what data does this bond settle on?" you follow: bond → `trigger` address → `productConfig.product_id/version` → `apis/products/<scope>/<product>.v<N>.json`. Every layer must expose this chain in its UI and its data model (bond page shows trigger; trigger page shows product; product page shows the API).
- **Off-chain monitors** poll every product on a schedule and keep the 20 most recent responses per product. They are free, they feed the health view, and they are what the company wallet reports from.
- **The company wallet** keeps reports fresh. That is the operational responsibility we take on instead of paying an oracle network.

One flow. General and custom deals differ only in which products list the trigger was built from and how closely our team manages it.

```
apis/products/{public,private}/<product>.json   (versioned definitions)
        │  snapshot at trigger deploy
        ▼
TriggerContract (per product or per deal)
   productConfig · reporter role · reports[]  ← company wallet postReport()
        │  read latest report
        ▼
CatBond ── checkTrigger() ── settle()
        ▲
   users / admin / maturity

Monitor service (off-chain) ── polls products ── 20-entry buffer ── feeds reporting + health view
```

---

## 2. Iteration 1 — The base flow

### 2.1 Start: verify the Build a Bond page
Run the existing Build a Bond flow end to end (create → deploy → view). Log every bug or dead path in `TESTING.md` before changing anything. Fix blocking bugs only; larger refactors wait for 2.2+.

### 2.2 Products registry: `apis/products/`
```
apis/
  products/
    README.md          # what a product is, how to add one, versioning rules
    registry.py        # loads definitions; lookup by (product_id, version); list by scope
    schema.py          # validation model for a product definition
    public/
      ilw_industry_loss.v1.json
      economic_loss.v1.json
    private/
      README.md        # empty this iteration
```

Each definition captures: `product_id`, `version`, `status` (`active` | `deprecated`), `name`, `peril_type` (`ilw` | `economic_loss`), `endpoint`, `method`, `auth` (secret *name*, never the secret), `call_parameters`, `response_schema`, `value_path`, `units`, `update_frequency`, `max_report_age`, `data_source_description`.

**Versioning rule.** Any change to `endpoint`, `call_parameters`, `response_schema`, `value_path`, or `units` creates a new file at `version + 1`. The old version is marked `deprecated`, never deleted. Description/name changes do not bump. The registry rejects a definition whose version already exists.

**Comparison** is always `value >= threshold`. No `comparison_op` field.

### 2.3 Off-chain monitor service
- Scheduler polls every `active` product on its `update_frequency`.
- Per product, keep a ring buffer of the **20 most recent calls**: `{value, fetched_at, http_status, product_version, raw_response_hash}`. Persist in DB.
- On failure (non-2xx, `value_path` does not resolve, schema mismatch) record the failure in the buffer and raise an alert. This is the drift detector: a product breaks in the monitor before any bond tries to settle on it.
- Expose a read endpoint for the bond health view. This gives users no-cost status; nothing on-chain is touched.

### 2.4 Trigger contract (new or refactored)
One contract, deployed many times. Storage:
- `productConfig` — frozen snapshot written at deploy (product_id, version, value_path, units, max_report_age, endpoint hash). Immutable after deploy.
- `reporter` — address with permission to post reports. Set by owner via `setReporter()`. Initially the company wallet; multisig recommended (Q2). Keeping this a role rather than a hardcoded address is what lets an oracle be swapped in later with one call.
- `reports[]` — append-only: `{value, reportedAt, reporter, monitorRef}` where `monitorRef` is the hash of the monitor-buffer entry the report was derived from.

Functions:
- `postReport(value, monitorRef)` — reporter only. Appends, emits `ReportPosted`.
- `latestReport()` — returns the most recent report.
- `latestReportSince(uint256 notBefore)` — returns the most recent report with `reportedAt >= notBefore`, reverts if none. Bonds use this with their commencement date.
- **No** `isTriggered`, no `setTriggered`. Remove any existing function that lets anyone write a trigger status directly.

### 2.5 Cat bond contract updates
- Storage adds `trigger` (address, immutable after deploy), `threshold`, `commencement`, `maturity`, `lastCheck {value, reportedAt, triggered, checkedAt, checkedBy}`.
- Deploy **requires** a trigger address; reverts if zero or if the address does not implement the trigger interface.
- `checkTrigger()` — callable by anyone. Calls `trigger.latestReportSince(commencement)`. Reverts if the report's `reportedAt` is older than `productConfig.max_report_age`. Compares `value >= threshold`, writes `lastCheck`, emits `TriggerChecked`.
- `settle()` — always calls `checkTrigger()` first. If triggered → payout. If not triggered and `block.timestamp >= maturity` → release collateral. **If `checkTrigger()` reverts (no valid report in window, or stale), `settle()` reverts.** A missed report must block settlement, never default to "not triggered."
- Retire legacy trigger/settle paths. If deployed instances prevent removal, mark deprecated in NatSpec and record in `CHANGELOG.md`.

### 2.6 Backend / app updates
- `report_trigger.py` → generic `compare(value, threshold) -> bool` plus a helper that builds a report payload from the latest monitor-buffer entry for a product. All existing callers route through it.
- **Reporting flow:** admin action "Post report" for a product → pulls latest monitor entry → signs `postReport()` from the company wallet → records `{tx_hash, monitor entry, product_version}` in DB. Every on-chain report must be traceable to a monitor entry.
- **Build a Bond page:** add "Select trigger" step listing deployed public triggers (product name, version, latest report age). Deploy passes the trigger address. Remove any UI that creates a bond without a trigger.
- **Audit existing status updates first.** Before touching the health view, trace how bond status currently updates end to end (which events/polls write it, where it's stored — including what Bubble holds — and what the UI reads). Write the findings in `TESTING.md`. If the current mechanism already reflects `lastCheck` correctly once the contract changes land, leave it alone and say so. Only rebuild what is actually broken or redundant.
- **Bond health view:** shows linked trigger, latest report (value, age), threshold, `lastCheck`, and the monitor buffer for the underlying product. "Self-check" button calls `checkTrigger()`.
- DB: bond gets `trigger_address`, `product_id`, `product_version`; trigger gets `latest_report` mirror; `is_triggered` removed from the trigger table (Q1).

### 2.7 Tests (Iteration 1)
Contract:
- Trigger: only reporter can post; reports append in order; `latestReportSince` respects window; `setReporter` owner-only.
- Bond: deploy reverts without trigger; `checkTrigger` reads correct report and compares `>=` (including equal); reverts on stale report; reverts on report before commencement.
- Bond: `settle` reverts when check reverts; pays out when triggered; releases collateral at maturity when not triggered; never settles without a check.

App:
- Registry loads both products, rejects malformed definitions, rejects duplicate versions, lists deprecated versions but does not offer them for new trigger deploys.
- Monitor: buffer caps at 20; failures recorded and alerted; `value_path` drift detected.
- Reporting flow: report payload traceable to monitor entry; refuses to post from a failed monitor entry.
- Build flow: general ILW bond and general economic-loss bond deploy against their public triggers.
- Lint/grep test: no code path writes `is_triggered`.

Log all results in `TESTING.md`.

### 2.8 Iteration 1 exit criteria
- Two products in `apis/products/public/`, two triggers deployed to testnet (one per product).
- Monitor running against both; buffers populating.
- Company wallet has posted at least one report to each trigger via the admin flow.
- One ILW bond and one economic-loss bond deployed against those triggers, self-checked, and settled on testnet (one triggered, one matured untriggered).
- `TESTING.md`, `CHANGELOG.md`, `apis/products/README.md` current.

---

## 3. Iteration 2 — Oracle: the admin page as the trigger operations system

Custom deals use the exact same flow as Iteration 1. What Iteration 2 adds is the tooling our team uses to act as the oracle for every deal. We already have an admin page; it's rough, so this iteration is about making it robust rather than building a new surface.

**Design:** use the ghost design system already applied on the Build page. Core objects (triggers, deals) are containers you click into; the click-in / close transition uses the same `+ → X` animation as the Build page. Match its tokens, spacing and typography exactly — no new visual language.

### 3.1 Private products and trigger privacy
- Populate `apis/products/private/` for deals we sit closer to. Same schema, same versioning.
- Every product definition and every deployed trigger carries `visibility` (`public` | `private`) and `owned_by_us` (bool — do we control the endpoint, or are we consuming a third party's?). `owned_by_us` matters for next steps: it decides whether we can post new source data ourselves or only relay what the endpoint reports.
- `registry.list(scope=...)` filters on `visibility`. Private products and private triggers appear on the Build page **only** for admin sessions. Public users never see them.

### 3.2 Trigger testing & status dashboard
A running list of every deployed trigger, backed by the `triggers` table. Per row (collapsed container):
- product name, version, `visibility`, `owned_by_us`
- latest report value and age; `max_report_age`; **time until stale**
- **number of bonds relying on this trigger** and **total value of those bonds** (sum of deal size). If the fields needed to compute this aren't saved today, add them to what Bubble stores — flag the schema change in `CHANGELOG.md`.

Click into a trigger (expanded container):
- full product definition: endpoint, params, `value_path`, units, schema, `max_report_age`
- report history and the product's 20-entry monitor buffer side by side, so a report can be visually traced to the monitor entry it came from
- linked bonds with threshold, commencement, maturity
- **Post report** (company wallet → `postReport()`). Always available for relaying the monitor's latest value.
- **Add source data** — shown only when `owned_by_us` is true (e.g. entering a new nat-cat loss figure into an endpoint we host). This writes to our API; the monitor picks it up; the report is posted from the monitor entry as usual. Never bypass the monitor.
- **Test trigger**: run a dry check against a chosen bond's threshold without posting anything; shows what `checkTrigger()` would return.

### 3.3 Build / add a trigger
Container on the admin page, same `+ → X` interaction:
- Choose an existing product (public or private list) **or** attach a custom API endpoint. For a custom endpoint the admin enters what we know of the schema (endpoint, method, auth secret name, params, `value_path`, units, `max_report_age`). This creates a new product definition file in `apis/products/private/` at v1 — the registry is still the source of truth; the UI is just a writer for it.
- Set `visibility` and `owned_by_us`. Visibility decides which list the trigger lands in on the Build page.
- Deploy → trigger contract with `productConfig` snapshot → row appears in the dashboard.
- Validation before deploy: monitor must successfully fetch the endpoint at least once (a product that can't be monitored can't be reported on).

### 3.4 Manage a deal
Container on the admin page:
- Input a bond contract address → auto-populates the trigger it uses (from the bond's `trigger` field), the product behind that trigger, and the product's API details. Click through to the trigger container from here. The bond → trigger → product → API chain from §1 must be visible on one screen.
- **Status vs limit:** most recent report value and monitor value compared against the deal's threshold, with a health label. Example: economic loss deal, threshold $300B, current from API $200B → "Healthy". Show the margin (value / threshold as %) and the report age.
- **Deal highlights:** deal size, coupon, number of investors, commencement, maturity, days to maturity. Add to Bubble whatever isn't already saved.
- **Manual settle:** the same flow as today — but it calls the Iteration 1 `settle()`, which runs `checkTrigger()` first. The UI shows the check result before the settle transaction is signed, and blocks the button when `checkTrigger()` would revert (stale or missing report).

### 3.5 Alerts and report queue
- **Report queue** at the top of the dashboard: triggers sorted by urgency (time until stale × nearest linked maturity × total value). Post report directly from the queue.
- **Alerts:** report approaching `max_report_age`; monitor failure on a product with live bonds; bond within N days of maturity with no report in its window; product version deprecated while triggers still reference it. Delivery channel per Q5.

### 3.6 Version migration
- Dashboard groups triggers by product version. When a product bumps, old-version triggers are flagged.
- Migration is explicit: deploy a new trigger on the new version; existing bonds stay on their old trigger until maturity (bonds never re-point); new bonds select the new trigger.

### 3.7 Consolidation audit
- Confirm every settlement path — public self-settle and admin manual settle — goes through `checkTrigger()` → `latestReportSince()`. Remove anything else.
- Update `apis/products/README.md` with the §1 diagram and an operational runbook: how a report is posted, who can post, what "Add source data" does and when it's allowed, what to do when a monitor fails.

### 3.8 Tests (Iteration 2)
- Private products and triggers invisible to non-admin Build sessions.
- Custom endpoint → product file written correctly at v1; deploy blocked until the monitor has one successful fetch.
- Dashboard counts and total value per trigger match the bonds table.
- "Add source data" hidden when `owned_by_us` is false; when true, its write reaches the monitor before any report.
- Manage a deal: address lookup resolves the full bond → trigger → product → API chain; settle button blocked when the check would revert.
- Report queue orders by urgency; each alert fires at its threshold.
- Version migration: bond on old trigger still settles; new bond cannot select a deprecated trigger.
- Regression: all Iteration 1 tests pass.

### 3.9 Iteration 2 exit criteria
- One custom ILW bond built against a private trigger (created via "Build / add a trigger"), reported to from the dashboard, checked, and manually settled from "Manage a deal" on testnet.
- Dashboard shows every trigger with staleness, bond count and total value; at least one alert exercised end to end.
- Admin page visually consistent with the Build page's ghost design.
- Audit notes in `TESTING.md`; all READMEs and `CHANGELOG.md` current.

---

## 4. Files expected to change
- `apis/products/**` (new), `apis/monitor/**` (new)
- `report_trigger.py` (refactor)
- Trigger contract + tests (new or heavily refactored)
- Cat bond contract + tests
- Build a Bond page, bond creation API, bond health view
- Admin page: reporting flow (It. 1); trigger dashboard, build/add trigger, manage a deal, alerts (It. 2) — ghost design
- DB / Bubble schema: bonds (deal size, coupon, investor count), triggers (visibility, owned_by_us), monitor buffer, reports
- Removal of any Chainlink client code
- `CHANGELOG.md`, `TESTING.md`, folder READMEs

---

## 5. Open questions — answer before starting



**Q2.** Reporter key: single company wallet or multisig (e.g. 2-of-3)? The reporter decides whether deals settle; recommendation is multisig from day one. single for now 

**Q3.** `max_report_age` defaults per product — what cadence can the team realistically commit to for ILW and economic loss? This sets how often reports must be posted and when `settle()` blocks. this will be quarterly but some spill over with reporting delays 5 months but not before the start date of a deal 

**Q4.** Are there deployed bond or trigger contracts that need migration, or do only new deployments use the new contracts? no 
