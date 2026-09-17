# Changelog

## Unreleased — Sprint: Deployed Triggers as Source of Truth

Sprint spec: `api/it3_plan_triggers_n_mgmnt.md`. Working rules require a
changelog entry per change and a `TESTING.md` results log — see that file
for the full pre-sprint audit and results.

### 2026-09-16 — Sprint kickoff: pre-work audit (no code changed)

- Added `TESTING.md` at repo root: how to run every suite (`DEAL 000/`
  forge tests, root forge tests, `api/` pytest), what each covers, and a
  results log. Baseline: `DEAL 000/` 38/38, root 33/33, `api/` 15/15 (one
  transient network timeout on first run, clean on retry).
- Completed the plan's required §2.1 audit ("run the existing flow end to
  end, log every bug or dead path before changing anything") — full
  findings logged in `TESTING.md`. Headline findings:
  - Confirmed the live app deploys from `DEAL 000/src/catbond/` (matches
    the UI's compiled artifacts); the root-level `contracts/`/`script/`/
    `test/` tree is a **dead, drifted duplicate** not wired to anything
    that ships.
  - Catalogued every redundant "triggered" code path per working rule
    §0.4 (`TriggerBase.report()`'s permanent latch, `setTriggered()`'s
    direct override — live in the admin UI as "Reset Trigger" — plus a
    second, fully dormant off-chain "triggered" concept in Bubble's
    `status-tiggered` field). All must collapse to the plan's single
    report-then-compare path.
  - Confirmed `CatBond.settle()` never performs its own threshold
    comparison and can never revert on a stale/missing report — the
    largest behavioral gap vs. the plan's target design (§2.5).
  - Confirmed the "Select trigger" step (§2.6) has zero precursor in the
    current Build a Bond flow — every deploy currently creates a brand-new
    trigger, with no way to list or reuse an existing one.
  - Flagged a folder-naming mismatch: the plan specifies `apis/products/`
    (plural); the existing backend folder is `api/` (singular). Needs a
    decision before the products registry is created.
- No contract, backend, or frontend code changed in this entry — audit and
  documentation only, per the plan's explicit sequencing.

### 2026-09-16 — Three pre-Iteration-1 decisions, made explicitly rather than guessed
- **Registry location**: the new products registry will live at
  `api/products/`, not the plan's literal `apis/products/` — matches the
  existing backend folder instead of creating a second, similarly-named
  top-level directory.
- **Deleted the dead root contract tree**: `contracts/`, `script/`,
  `test/`, and the root `foundry.toml` that pointed at them are removed
  (`git rm`). This tree was a fully-drifted duplicate of `DEAL 000/`'s
  contracts — not what the UI's compiled artifacts come from, not wired to
  anything live — and would only keep bit-rotting alongside the trigger
  rewrite. Fully recoverable from git history if ever needed.
  `DEAL 000/` is now the repo's only contract tree.
- **Bubble's `status-tiggered` field**: kept, but stops being an
  independent write path once the new reporting flow lands — it will be
  synced from the on-chain trigger's `lastCheck.triggered`, not written
  separately.

### 2026-09-16 — Iteration 1, §2.2: Products registry
- Added `api/products/` — `schema.py` (validates one product definition:
  required fields, enum checks on `status`/`peril_type`/`method`, a weak
  heuristic flagging an `auth` value that looks like a real secret rather
  than a secret name, and `diff_versioned_fields()` for checking whether a
  version bump actually changed something that warranted it) and
  `registry.py` (loads every definition across `public/`/`private/`,
  raises `RegistryError` on malformed JSON or a duplicate
  `(product_id, version)` pair, and exposes `list_products()` / `get()` /
  `get_latest_active()` — the only supported way anything else in the app
  should read a product definition).
- Added two real product definitions in `api/products/public/`:
  `ilw_industry_loss.v1.json` and `economic_loss.v1.json`. Both describe
  the same live endpoint `api/natcat_loss.py` already calls (RHODEX NatCat
  Loss API) — `natcat_loss.py` itself is unchanged; the registry describes
  that data source declaratively so a future trigger can reference it by
  `product_id`/`version` instead of every deploy hardcoding API details.
  `max_report_age` set to 150 days per the sprint's Q3 answer (quarterly
  cadence, up to ~5 months of real-world reporting delay).
- Added `api/products/README.md` (field reference, versioning rule,
  `value_path` convention, how to add a product) and
  `api/products/private/README.md` (placeholder — populated in
  Iteration 2, §3.1).
- Added `api/test_products.py`: 19 tests covering schema validation and
  every registry behavior called out in the sprint's own §2.7 test list
  (loads both real products, rejects malformed/duplicate definitions,
  excludes deprecated versions from `get_latest_active()`). Full `api/`
  suite: 34/34 passing (`test_bonds.py` unaffected).

### 2026-09-16 — Iteration 1, §2.2 revised: one product, multiple metrics
- Reworked the products schema mid-build after catching a real
  inefficiency: the plan's original one-`value_path`/one-`peril_type`-per-
  product design would have meant polling RHODEX's NatCat Loss API twice
  for data that comes back in a single response (it returns both
  economic-loss and industry-loss together). Removed `peril_type` from
  `products/schema.py` entirely; replaced the single `value_path` string
  with `value_paths` (an object of `{metric_name: path}`, at least one
  entry). Which metric a trigger cares about is now a deal-type choice at
  trigger-deploy time (the existing `dealType` on `TriggerBase.sol`), not
  a product-time one.
- Collapsed the two example products into one:
  `api/products/public/natcat_loss.v1.json`, exposing `economic_loss` and
  `industry_loss` as its two metrics. Deleted `ilw_industry_loss.v1.json`
  and `economic_loss.v1.json`.
- Updated `api/products/README.md` with a new "One endpoint, multiple
  metrics" section explaining the design and why it deviates from the
  plan's literal §2.2 text.
- Updated `api/test_products.py` for the new shape: removed the
  `peril_type` test, added `value_paths`-shape validation tests. 21 tests
  (net +2).

### 2026-09-16 — Iteration 1, §2.3: Off-chain monitor service
- Added `api/monitor/`: `value_path.py` (parses and resolves the
  dot/bracket/quoted-key path convention documented in
  `products/README.md`), `fetcher.py` (one HTTP call per product per poll
  via `fetch_raw()`, with `resolve_metric()` extracting each configured
  metric from that single response — never re-fetches per metric),
  `store.py` (SQLite-backed ring buffer, keyed by `(product_id, metric)`
  since two metrics from one product age/fail independently even though
  they share a fetch; true pruning to 20 rows per pair, not just a limited
  read; plus an `alerts` table), `scheduler.py` (due-ness based on
  `update_frequency`; a total fetch failure raises one alert covering every
  affected metric, a single metric's `value_path` breaking raises its own
  alert), and `health.py` (the "bond health view" payload — latest value,
  staleness vs. `max_report_age`, buffer, open alerts — as plain importable
  functions).
- **Caught and fixed a real bug before it shipped**: every `store.py`
  function originally defaulted `db_path: str = _DEFAULT_DB_PATH`, a value
  bound once at module-import time. Monkeypatching `_DEFAULT_DB_PATH` in
  tests would have silently done nothing, leaving "isolated" tests hitting
  the real on-disk database. Fixed by resolving the module attribute
  inside each function body instead of in the default value. Found while
  writing `test_monitor.py`, before any test ran against real state.
- **Two things intentionally left unbuilt** (documented in
  `api/monitor/README.md`, not silently skipped): a real recurring
  scheduler invoking `poll_due_products()` (no cron/timer/hosted-function
  infra exists anywhere in this repo to hook into), and an HTTP-served
  health endpoint (no backend server exists for a frontend to call — the
  UI talks to Bubble and the chain directly). Both are one step away
  (the logic is there and tested) but are hosting/deployment decisions,
  not something to invent unasked.
- Added `api/test_monitor.py`: 35 tests. All network calls monkeypatched
  (no real HTTP requests in tests); all storage tests use a per-test
  `tmp_path` database file. Full `api/` suite: 71/71 passing.

### 2026-09-16 — Iteration 1, §2.4/§2.5: Trigger contract rewrite, CatBond updates
- **`ITrigger.sol`/`TriggerBase.sol` rewritten**: dropped `isTriggered`,
  `_triggered`, `setTriggered`, and the old `report(value, source)`. Added
  an append-only `Report[]` log, a `reporter` role (`setReporter()`,
  owner-only), `postReport(value, monitorRef)` (reporter-only),
  `reportCount()`/`latestReport()`/`latestReportSince(notBefore)`, and a
  `ProductConfig` snapshot (`productId`, `version`, `valuePath`, `units`,
  `maxReportAge`, `endpointHash`) frozen at deploy from `api/products/`.
  `dealType`/`lossLimit` removed from the trigger entirely.
- **Threshold moved from the trigger to `CatBond`**: added an immutable
  `threshold` to `CatBond`'s constructor. The trigger no longer has any
  threshold concept — this is what lets multiple bonds share one
  trigger/product at different thresholds, matching where Iteration 2's
  dashboard needs to go (§3.2, "bonds relying on this trigger").
- **`CatBond.checkTrigger()`** (new): the one path by which a bond decides
  it's triggered — reads the trigger's latest report since `activeStart`
  (this bond's commencement), reverts on a stale or missing report,
  compares against `threshold`, records `lastCheck`. `settle()` and
  `markMatured()` both call it and propagate its revert uncaught — a
  missed report now blocks *either* outcome, not just settlement. This is
  a real behavioral tightening on `markMatured()`/investor withdrawal
  specifically: previously a never-reported trigger didn't block maturity;
  now it does, by design (§1: the company wallet keeping reports fresh is
  the tradeoff this sprint takes on instead of an oracle network).
- **`closeSubscription()`'s early guard** now reads
  `trigger.latestReport().value >= threshold` instead of
  `isTriggered()`. The report log has no permanent memory — a later
  below-threshold report supersedes an earlier above-threshold one for
  this guard, unlike the old latch.
- **Deploy-time trigger validation** added: `CatBond`'s constructor
  reverts `ZeroTrigger` on the zero address and `InvalidTrigger` on an EOA
  or a contract that doesn't implement `reportCount()`.
- **Deleted `triggerStatus()` and `pingTrigger()`** from `CatBond` — both
  flagged as dead/redundant in the pre-sprint audit. Breaks `AdminPage.jsx`'s
  "Ping Trigger Oracle" button; tracked for §2.6, not fixed in this
  contracts-only pass.
- Updated `DEAL 000/script/Setup.s.sol` (`Deal000Trigger`'s constructor,
  `run()`'s trigger/bond deploy calls) to match.
- Rewrote `DEAL 000/test/CatBond.t.sol` for the new API: 38 → 53 tests.
  New `TriggerValidationTest` (4); `TriggerReportTest` grew from 6 to 15
  (reporter role, report log mechanics, and `CatBond.checkTrigger()`/
  `settle()` end-to-end against real `postReport()` calls, including
  distinct stale/missing/below-threshold revert paths); `EarlyTriggerGuardTest`
  grew from 2 to 3. Caught and fixed two real test bugs while getting to
  green (a `vm.expectRevert()`/CREATE-ordering mistake, and a test that
  didn't fund the bond before calling `closeSubscription()`) — full
  details in `TESTING.md`. 53/53 passing.
- **Known breakage, explicitly tracked for §2.6, not fixed here**:
  `api/report_trigger.py`, `ui/src/pages/AdminPage.jsx`,
  `ui/src/components/build-bond/ReviewSection.jsx`, and
  `ui/src/artifacts/{CatBond,ManualTrigger}.json` (stale — compiled from
  the pre-rewrite contracts) all target the old ABI/constructor shapes.
  `DEAL 000/run-insured-test.sh` will fail until `report_trigger.py` is
  rewritten.
- **Verified live on anvil**, not just in unit tests: ran
  `./run.sh quick` end to end — deploy, fund, deposit, close subscription,
  then confirmed `markMatured()` reverts `NoReports` with zero reports
  posted, posted a below-threshold report, confirmed `markMatured()` then
  succeeds, and the investor withdrew exactly the $500,000 principal
  deposited. Full walkthrough in `TESTING.md`.
- **Second live run: the actual triggered path, with independent
  investor/sponsor self-checks.** Fresh `./run.sh quick` deploy; the
  investor (not the company) called `closeSubscription()`; the sponsor
  called `checkTrigger()` before any report existed and got an honest
  `NoReports` revert rather than a false negative; the company posted a
  $400B report against the $370B threshold; the **investor** independently
  called `checkTrigger()` and confirmed `triggered=true` with
  `lastCheck.checkedBy` recording their own address — proof neither party
  has to trust the company wallet's word. Company then `settle()`'d: sponsor
  received the full $500,000 principal, investor claimed a correctly
  prorated partial coupon. Full walkthrough in `TESTING.md`.

### 2026-09-16 — Iteration 1, §2.6: UI/backend wiring for the new trigger ABI
- Regenerated `ui/src/artifacts/CatBond.json`/`ManualTrigger.json` from
  `DEAL 000/out/` — these were stale since §2.4/§2.5, compiled from the
  pre-rewrite contracts.
- `ui/src/data/historicalLoss.js`: added `NATCAT_LOSS_PRODUCT` and a
  `valuePath` per `TRIGGER_TYPES` entry — the browser-side mirror of
  `api/products/public/natcat_loss.v1.json`, needed since there's no HTTP
  path yet for the browser to read the real registry (see
  `api/monitor/README.md`).
- **Fixed the two live deploy paths that were completely broken**:
  `ReviewSection.jsx` (the public "Post deal" workshop flow) and
  `AdminPage.jsx`'s `DeploySection` both now build the correct 8-arg
  trigger constructor and pass the new `threshold` bond arg. Before this,
  nobody could deploy a bond through either surface at all.
- `AdminPage.jsx`'s `ManageSection` rebuilt: deleted "Reset Trigger"
  (`setTriggered()` no longer exists, by design) and replaced "Ping
  Trigger Oracle" with "Self-check (checkTrigger)" — callable by anyone,
  not just the company wallet. "Submit Report" → "Post Report", now calls
  `postReport(value, monitorRef)`, with an honest note in the UI that the
  admin's manual entry isn't a real traceable monitor entry the way a
  production report would be. Status display now separates the
  on-chain-confirmed `lastCheck` from a free client-side "likely
  triggered" hint — never collapsed into one number the way the old
  `isTriggered()` boolean was.
- `DealPage.jsx`: same read-side rebuild, plus a **Self-check button** on
  the trigger widget calling `checkTrigger()` — this is §2.6's "bond
  health view ... Self-check button calls checkTrigger()" requirement.
  Added `StaleReport`/`NoReports` to the revert-message map.
- Added `lib/utils.js::formatAge()`, shared by both pages, for "3h
  ago"/"12d ago" report-age display.
- `api/report_trigger.py` rewritten into `compare(value, threshold)`
  (pure) + `build_report_payload(product_id, metric)` (reads the
  monitor's latest successful entry, raises rather than fabricating a
  value if there isn't one) per §2.6's literal spec. The monitor's
  `raw_response_hash` fits `bytes32` exactly, no reshaping needed — a
  small payoff from §2.3's design. The CLI wrapper resolves which
  product/metric a trigger reports on from its own on-chain
  `productConfig()`, so `run-insured-test.sh` still works from just a
  trigger address. Added `api/test_report_trigger.py` (6 tests).
- `api/bonds.py`: added `trigger_address`/`product_id`/`product_version`
  to `build_bond_payload()`. **Not done, flagged rather than faked**: no
  live `/initialize` call has registered these on the real Bubble
  workflow yet (a one-way mutation to shared infrastructure this session
  didn't trigger unprompted) — populating them today builds a correct
  dict but won't persist through a real API round-trip until that's run
  deliberately. `deploy_deal.py` isn't wired to populate them yet either.
- Full suite status: `api/` 78/78, `DEAL 000/` 53/53 (unchanged — no
  contract changes this pass), `ui` builds clean.
- **Genuinely still open** (not built, not faked): the monitor's HTTP
  endpoint, a real recurring scheduler, and a new "Trigger" Bubble object
  type for a `latest_report` mirror — none of these have any existing
  infra to hook into, so none were invented. ("Select trigger" — see
  below, this was resolved, not left open.) Full detail in `TESTING.md`.

### 2026-09-16 — natcat_loss v2: fixed a real bug found via a new live endpoint
- Investigated a new live Bubble endpoint the user added
  (`.../wf/latest-report`, discovered after a few naming variants 404'd)
  that returns the single most recent record directly under
  `response.reports`. Comparing it against `natcat_loss.get_records()`'s
  last entry showed an **identical `_id`** — confirming `ALL-LOSSES[-1]`
  was never "the latest completed year," just whatever's newest,
  in-progress or not.
- That surfaced a real, pre-existing bug: the current in-progress year
  (2026) has no `"economic-loss | total"`/`"industry-loss | total"` field
  at all yet, only completed quarters — so `natcat_loss.v1.json`'s static
  `value_paths` **cannot resolve against live data today**.
  `api/natcat_loss.py`'s own `latest_loss_for_year()` already handled this
  with a total→Q3→Q2→Q1 fallback in Python; the product definition never
  had an equivalent.
- Added fallback-chain support to fix it properly: `value_path.py` gained
  `resolve_first()` (tries a list of paths in order), `schema.py` now
  accepts either a single path or a fallback-chain list per metric, and
  `fetcher.py`'s `resolve_metric()` dispatches to whichever the shape
  calls for.
- Versioned `natcat_loss` to v2 per the registry's own rule (endpoint,
  call_parameters, and value_paths all changed): switches to the simpler
  `latest-report` endpoint and gives each metric the same total→quarterly
  fallback chain `natcat_loss.py` already used. v1 flipped to
  `"status": "deprecated"`, kept in place, with its
  `data_source_description` recording why. Updated `Setup.s.sol`,
  `historicalLoss.js`, and `report_trigger.py`'s on-chain-valuePath
  matching (now checks list membership, not string equality) to match.
  Added `fetch_latest_report()` to `natcat_loss.py` for parity. `api/`
  suite: 85/85.

### 2026-09-16 — "Select trigger" resolved via two canonical public triggers
- Reconsidered the earlier "no infrastructure enumerates deployed
  triggers" framing: for public deals there are only ever two possible
  choices (economic-loss, industry-loss), and the existing Deal Type
  selector already picks between them — no registry needed when there's
  nothing to enumerate.
- Deployed one canonical, already-configured trigger per public deal
  type on the current anvil chain (natcat_loss v2): economic-loss
  `0x593C66DBf77348920DA8C2c47d23390781a53656`, industry-loss
  `0xC8615da9d2511b7B6fD0C07DFdC52005cA26ECEE`. Added
  `CANONICAL_TRIGGERS` to `constants/abis.js`, flagged testnet/anvil-only
  the same way `RHODEX_COMPANY_WALLET` already is.
- **Significantly simplified `ReviewSection.jsx`**: "Post deal" no longer
  deploys a trigger — it deploys only the bond, referencing the canonical
  trigger for the selected deal type directly. One on-chain transaction
  instead of two, and the orphaned-trigger risk the original audit flagged
  (bond deploy failing after trigger deploy succeeded) is gone entirely
  for the public flow.
- `AdminPage.jsx`'s manual deploy tool deliberately keeps deploying
  fresh custom triggers — that's its actual job (private/testing deploys),
  and it's what deployed the two canonical triggers above.
- **Live-verified**: deployed a `CatBond` via `forge create` pointed
  directly at the canonical economic trigger with zero trigger-deploy
  step, confirmed on-chain `bond.trigger()` resolves to it and
  `bond.threshold()` is independently set — proof multiple bonds can
  share one trigger at different thresholds, the core §2.5 design
  property, working for real.

### 2026-09-16 — Admin page ghost-theme reskin + Iteration 2 trigger dashboard
- Reskinned all of `AdminPage.jsx` (§3's design mandate) to the same ghost
  design system already used on the Build page: `ConnectButton`,
  `FormField`, `TxBanner`, `PasswordGate`, `DeploySection`, `AdminAction`,
  and `ManageSection` all now use `--wkb-*` tokens and the shared
  `GhostButton`/`FilledButton`/`Panel` primitives instead of the old
  dark theme. The page root is now `.workshop-page`-scoped and wraps
  `DeploySection`/`ManageSection` in `Accordion`/`AccordionSection`, so
  it gets the same `+ → X` click-in/close interaction as the Build page.
- Added a purely cosmetic "Who are you?" field to the password gate
  (`ui/src/adminConfig.js`'s `nicknameGreeting()`) — never a second
  auth factor, the password alone still gates entry. Two mappings:
  "jefe"/"chef" → "Welcome back, Bread Boi", "big momma" → "Welcome
  back, Heloisa". Displayed under the header once unlocked.
- **New third section, "03 — Trigger status"** (`TriggerStatusSection`/
  `TriggerCard` in `AdminPage.jsx`) — a dashboard-lite for the two
  `CANONICAL_TRIGGERS`, built from on-chain reads only (see below for why
  it stops there). Per trigger: latest report + age, time-until-stale
  (red "STALE" past `maxReportAge`), an "outdated version" badge when
  `productConfig.version` trails `NATCAT_LOSS_PRODUCT.version`, and an
  expand panel with the full `productConfig`, on-chain report history
  (read directly via the `reports(uint256)` public-array getter — no
  backend needed), a **Test trigger** dry-run (`value >= threshold`,
  gas-free, no tx) and a **Post report** action. Live-verified against
  anvil: posted a report to the economic-loss canonical trigger and
  confirmed the card's history/staleness math against `cast call`.
- Added a decorative dotted world map (`WorldMap.jsx`) at the top of the
  new section — hand-rolled SVG dot-grid (continents as simple ellipses,
  no new map/geo dependency), light-blue dots, subtle color-shift-only
  hover animation (`.wkb-world-map-dot` in `index.css`, respects the
  page's existing `prefers-reduced-motion` kill-switch), linking out to
  Google's Weather Lab guide page. Captioned "Bond locations — overlay
  coming soon" — no real data plotted yet.
- `ManageSection` gained a health-label pill (Healthy/Watch/Triggered)
  and margin % next to the existing latest-report line — §3.4's "health
  label... show the margin," free from data already being fetched.
- **Explicitly deferred, not silently dropped** (see
  `api/it3_plan_triggers_n_mgmnt.md` §3 for the full list): a real "all
  live bonds" directory and per-trigger bond count/value (§3.2/§3.4) —
  blocked on a browser-reachable data source (there's no server between
  the browser and Bubble/monitor data today, and the user deferred that
  decision rather than standing up a dev server this pass); §3.1 private
  products (no UI would consume the fields without that same backend);
  §3.3 custom-endpoint trigger authoring; §3.5 alerts (explicitly
  skipped by request); §3.6 real version-migration workflow (the
  dashboard's "outdated version" badge is read-only, no re-point action
  — bonds never re-point anyway, per the plan doc).

### 2026-09-17 — Fixed three real bugs in `report_trigger.py`'s live path
- Found while chasing down a live failure in `run-insured-test.sh`
  ("no metric on natcat_loss v2 matches on-chain valuePath..."), not
  from a code review — all three below were confirmed against the real
  running anvil chain and the live NatCat Loss API, not just unit tests.
- **`_metric_for_trigger` parsed `cast call`'s text output wrong.**
  `productConfig()`'s `valuePath` contains embedded double quotes
  (`response.reports."economic-loss | total"`), and `cast call`'s
  default text mode wraps every string in its own display quotes and
  backslash-escapes the ones inside — a plain `.strip('"')` on that text
  strips the outer wrapping but leaves stray backslashes in place of the
  inner quotes, so the value never matches anything in the registry.
  Switched to `cast call --json` + `json.loads`, which decodes the value
  correctly regardless of what characters are inside it.
- **`RHODEX_API_KEY` silently never reached the monitor.** Pre-refactor,
  the reporting flow imported `natcat_loss.py` directly, which loads
  `.env` as an import side effect. The generalized `monitor/fetcher.py`
  path never picked up an equivalent call and reads `os.environ`
  directly — so polling always failed with "secret env var ... is not
  set" even with a valid `.env` at repo root. Added the same
  `load_dotenv()` call `natcat_loss.py` already uses.
- **Reported values weren't scaled to the on-chain integer convention.**
  The monitor buffer stores the raw float straight off the API (e.g.
  `46.0` meaning $46B) — un-scaled. Every other corner of this codebase
  (`AdminPage`'s Post Report input, `formatUSDWhole`, `CatBond`'s
  threshold) treats `usd_billions` as "×1e9 for the on-chain integer."
  `build_report_payload` was posting the raw float truncated to an int
  (`46`, i.e. $0.000000046B) instead of `46_000_000_000`. Now looks up
  the product's `units` via the registry and scales accordingly;
  `_metric_for_trigger` and `report()` updated to thread the resolved
  `version` through so the right product definition gets checked.
  `test_report_trigger.py` updated to assert the scaled values.
- **Live-verified end to end** on the running anvil chain: polled the
  real NatCat Loss API (`economic_loss` $142B, `industry_loss` $46B this
  run), posted a report to a freshly-deployed industry-loss trigger via
  `report_trigger.py`, and confirmed on-chain via `cast call` that
  `latestReport()` holds exactly `46000000000` — the correctly-scaled
  value, not the raw `46` the bug would have posted. `api/` suite: 85/85.

### 2026-09-17 — `bonds.py` gets `list_bonds()` (get_bonds endpoint)
- User added a fifth Bubble workflow, `get_bonds` — POST `{"type": "natcat"}`
  returns every bond of that trigger type. "natcat" deliberately covers
  both economic-loss and industry-loss deals in one call, same pairing
  `CANONICAL_TRIGGERS`/the Trigger status dashboard already treat as one
  product (`natcat_loss`) with two metrics.
- Added `bonds.list_bonds(bond_type="natcat")` and `bonds.extract_bonds()`
  (same defensive-candidate pattern as `extract_unique_id()`, since the
  list endpoint's response schema isn't documented any more than the
  others were). **Live-verified against the real endpoint** — confirmed
  response shape `{"response": {"bonds": [...]}}`, and that each record
  carries the same read-side quirks as `get_bond` (`status-triggered`
  spelled correctly, `maturity` as epoch-ms) plus a `trigger` string
  field (e.g. `"ILW/econ"`) not in the write-side spec — a read-only/
  legacy field, distinct from the not-yet-live `trigger-address`.
- This is the piece that was missing to build a real "all live bonds"
  view (deferred in the two entries above pending exactly this) — still
  need a browser-reachable way to call it (the standing "browser never
  calls Bubble directly" rule), which wasn't re-litigated this pass.
  `api/` suite: 90/90 (added `test_list_bonds_natcat_returns_bonds_with_expected_shape`,
  a live integration test, plus unit tests for `extract_bonds`).

### 2026-09-17 — Live bonds map: real data, higher-res, spotlight hover
- **`api/server.py`** (new) — the minimal local dev server the previous
  entry flagged as still missing: `GET /bonds?type=natcat` calls
  `bonds.list_bonds()` server-side (keeping `RHODEX_API_KEY` off the
  browser) and hands the admin UI plain JSON. Dev-only — wide-open CORS,
  Flask's built-in server, documented in `api/README.md` as a second
  process to run alongside `npm run dev`.
- **`LiveBondsMap.jsx`** replaces the old `WorldMap.jsx` and moves out of
  the Trigger status accordion section to sit directly under the
  greeting on the admin page — always visible once unlocked, not gated
  behind a click. Higher-resolution dot grid (step 12 → 6, ~4x the
  dots), background switched from a flat panel to a light grid pattern.
- Headline stat (animated count-up on load) is the total value of every
  live natcat bond, with "N bonds relying on NatCat triggers" underneath
  in smaller text — sourced from the new `/bonds` endpoint, gracefully
  showing "Live bonds unavailable" if the dev server isn't running
  rather than breaking the page.
- Bottom-right ghost container shows the single most recent report
  across both canonical triggers (on-chain read, picks whichever of the
  two has the newer `reportedAt`), "Latest report → " in blue,
  hyperlinked to the RHODEX NatCat Loss endpoint itself (the user's
  choice — it's a POST-only authenticated API, so the link is more a
  citation than something to click through, but it's the source rather
  than a guessed public URL).
- Hover interaction reworked: the first pass's whole-map color shift
  read as barely-there once actually tested (screenshotted via
  Playwright — see below), and a `mix-blend-mode: color` cursor glow
  was tried next but blending blue onto already-blue dots didn't read
  either. Landed on a masked duplicate dot layer — a second, brighter
  copy of the exact same dots, revealed only within ~70px of the cursor
  via `mask-image: radial-gradient(...)` tracked with CSS custom
  properties — genuinely visible as "a small area around the cursor
  that changes," confirmed by screenshot.
- Added a second link below the map container to Google DeepMind's
  Weather Lab (`https://deepmind.google.com/science/weatherlab` — a
  real URL this time, given directly rather than found via search),
  styled as pastel rainbow gradient text (`background-clip: text`).
- **Verified visually for the first time this sprint**: Playwright's
  Python package turned out to already be installed in this
  environment (previously assumed unavailable) — used it to actually
  load `/admin` headlessly, unlock it, screenshot the map, and confirm
  the spotlight hover, stats, and rainbow link all render as intended
  and produce zero console/page errors, rather than relying on a
  description of the code.

### 2026-09-17 — Fixed real "Deal page not loading" crash
- User reported `/deal` not loading. Reproduced with Playwright by
  actually loading a real bond (not just the empty pre-load state,
  which is why this wasn't caught earlier): the whole page crashed with
  `TypeError: object is not iterable`, unmounting to a blank screen.
- Root cause, confirmed by directly calling wagmi's own `readContracts`
  against the real deployed contract (bypassing React to isolate it):
  `latestReport()` has a single `Report`-struct return value, unlike
  `productConfig()`/`lastCheck()` which are multi-output getters that
  decode as arrays. viem decodes a lone struct output as a **named
  object** (`{value, reportedAt, reporter, monitorRef}`), not an array.
  `const [latestValue, latestReportedAt] = latestReport ?? []` throws
  the moment `latestReport` is a real object instead of `undefined` —
  which is exactly why this only surfaced now: every trigger this
  session had zero reports until this pass's live testing posted some.
- (Ruled out first: suspected the cause was this anvil chain missing a
  deployed Multicall3 contract, since `viem`'s `foundry` chain preset
  has no `multicall3` address configured here and `client.multicall()`
  does throw for that reason. Confirmed via direct testing that wagmi's
  `readContracts` already falls back to individual per-contract reads
  in that case and decodes correctly either way — that wasn't it.)
- Same bug, same fix, in three places: `DealPage.jsx`, and `AdminPage.jsx`'s
  `TriggerCard` and `ManageSection`. All three now read `latestReport?.value`
  / `latestReport?.reportedAt` by name instead of destructuring by index.
- **Live-verified**: reloaded `/deal` with a bond address that has a real
  posted report, confirmed zero console/page errors and real content
  rendering (previously: blank page, 3 uncaught errors).

### 2026-09-17 — Live bonds map: real geography, lighter grid
- Replaced the hand-drawn ellipse continents with real dot-matrix world
  landmass data via `dotted-map` (MIT, devDependency-only — it runs once
  in `ui/scripts/generate-world-dots.cjs` to produce the static
  `src/data/worldDots.json` the component actually imports, so none of
  `dotted-map`'s runtime or its `@turf`/`proj4` deps reach the browser
  bundle). 7,357 points vs. the ellipse version's ~2,500 approximated
  ones — genuinely reads as a world map instead of blobby continents.
- Grid background lightened: container background switched from the
  translucent `--wkb-panel` to solid `--wkb-surface` white, grid line
  opacity reduced (0.08 → 0.06), so the grid stays present but subtle
  rather than competing with the dots for attention.
- Confirmed via Playwright screenshot that the cursor spotlight hover
  still tracks correctly against the new coordinate space (mask-image
  radius is in rendered pixels, independent of the SVG's internal
  viewBox units, so this needed no changes — just verification).
