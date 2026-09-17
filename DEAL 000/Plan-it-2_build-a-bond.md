# Deal Page — Dynamic Data

**Build spec, iteration 2**
Owner: Reece · Status: hybrid data layer settled · Open questions in §10

---

## 1. Goal

Deal pages currently render static content. This iteration makes every section load from the deal's own data, so a bond built in the workshop and a bond viewed on its deal page are the same object with no discrepancies between them.

That's the whole test. Build a bond, open its page, and everything you typed is there — nothing hardcoded, nothing drifting.

**Deals are tracked off-chain.** Anything with heavy storage requirements — seller narrative, exposure breakdown, loss history — lives in the web2 Deal store, with the contract holding identity and a link to it. Settled this iteration; see §3.

**Why this order matters.** Once deal pages are genuinely dynamic, the all-deals index is a listing page over the same data source. If we build the index before the pages are dynamic, we build it twice.

**Scope**
1. Regional exposure constraint on the build page (bug fix, §2)
2. Seller details in the CAT bond contract, linked to web2 storage (§3)
3. Local verification path via the run scripts (§4)
4. Deal page sections wired to real data (§5–§7)
5. Design alignment with the build page (§7)

Out of scope: the all-deals index, secondary market, renewals.

**For the dev picking this up:** the API schema is the source of truth for request and response shapes. This document specifies *what* each section needs and *why*; read the schema for how to send and fetch it. Where the two disagree, the schema wins and this document is wrong — tell me and I'll fix it.

---

## 2. Regional exposure constraint

**The bug.** Regional exposure percentages accept any value with no total validation. Entered exposure can currently exceed 100%.

**Likely root cause, worth checking first.** The seed disclosure data has United States / China / Brazil listed twice — 50/30/15, then 50/30/15 again, then European Union 5%. That's 190% total, and it's the shape of a duplicate-append bug rather than a user typing bad numbers. Check whether adding a region that already exists appends a second row instead of updating the first. If so, the total validator alone won't fix it — you'll just block a state the UI shouldn't be able to reach.

**Two validators, both needed:**

| Rule | Behavior |
|---|---|
| No duplicate regions | A region already in the list is disabled in the picker. Selecting it focuses the existing row instead of adding a new one. |
| Total ≤ 110% | Running total displayed live above the region list. Above 110%, block progression. |

**Error state.** Inline, above the region list, not a modal:

> Regional exposure totals 190%. Reduce to 110% or below to continue.

Name the actual total. "Exceeds maximum" makes the user do arithmetic we already did.

**Below the threshold**, show the running total quietly in `--ink-muted`. It only escalates to `--blue` (highlight mode) or an error color when it crosses. A user at 96% shouldn't feel warned.

**Blocking, not correcting.** Do not auto-normalize to 100%. Silently rescaling someone's disclosure figures is worse than making them fix it — these numbers are a representation to investors and the sponsor needs to own them.

---

## 3. Data model — on-chain and off-chain

Seller information moves from page constants into a proper split: identity anchored on-chain, narrative and disclosure held off-chain in a Deal store, linked by contract address and hash.

### 3.1 What goes on-chain

**Settled: identity on-chain, narrative and disclosure off-chain, linked by id.** The seller description is a full paragraph and the exposure and loss history are heavier still — none of it belongs in contract storage. The contract holds who the seller is and where the rest lives.

```
SellerInfo {
  name:            String        // "Raydion"
  domicile:        String        // "Bermuda"
  entityType:      String        // "Specialty Reinsurer"
  verified:        bool          // RHODEX stamp, set by us
  dealId:          String        // off-chain record id — bidirectional link, see §3.3
  disclosureUri:   String        // pointer to the disclosure bundle
  disclosureHash:  Hash?         // nullable this iteration, see below
}
```

The disclosure bundle holds the description, region breakdown, and loss history file.

**On the hash.** `dealId` is the link and it does the whole job this iteration — it answers *which record belongs to this contract* and always matches. The hash answers a different question: *is this the record committed at issuance*. It stops matching when content changes, which is the point.

Keep the field nullable for now and populate it at freeze when you're ready. One column, no migration later. Without it, "frozen" is a policy the server enforces and anyone with database access can edit a posted disclosure silently — with it, the edit is detectable by anyone. That's the audit thesis from iteration 1 actually enforced rather than asserted.

### 3.1a Where the bundle lives

**Now: local.** Hashed disclosure bundles are stored on our own infrastructure alongside the loss history files (§5.3). For the demo and testnet this is fine — the volume is small, we control the environment, and it keeps the iteration cheap.

**Future state: almost certainly off-site.** Three reasons this doesn't survive contact with real money:

- **Availability.** If our server is down, the disclosure behind a live bond is unverifiable. The hash on-chain is worthless without the bundle it points at.
- **Trust.** A file we host, about a deal we list, verified against a hash we wrote, means investors are trusting RHODEX rather than trusting the mechanism. Off-site storage is what makes the hash mean something to a skeptical counterparty.
- **Tamper surface.** One compromised host is a single point of failure for every disclosure on the platform.

**The one thing that has to be right now.** Treat `disclosureUri` as an **opaque pointer**, never a filesystem path. No code — contract, page, or generator — may assume the bundle is local, concatenate a directory prefix, or read it with file I/O. Resolve it through a single fetch function with the storage backend behind it.

Get that boundary right and moving off-site later is a config change plus a backfill. Get it wrong and local paths leak into the contract, the page, and every deal record already written — and those are immutable.

Content-addressed storage (IPFS, Arweave) is the natural target since we're already hashing — the hash becomes the address and the integrity check collapses into the lookup. Not a decision for this iteration, but worth knowing which direction we're pointed so the pointer format doesn't box us out of it.

### 3.2 Existing fields

Confirm the contract already exposes, and that the deal page reads rather than hardcodes: trigger type, trigger level, raise amount, coupon, deposit, start date, end date, oracle. If any of these are page constants today, they get the same treatment in this pass.

### 3.3 Off-chain Deal store

A `Deal` type holding everything that doesn't belong on-chain — seller narrative, disclosure bundle, exposure breakdown, loss history pointers — served by a CRU API. Same pattern as the industry loss API, which is the right precedent: one service, one type, no framework.

**Linkage.** The unique id is the link; the hash is an integrity check layered on top, not a second linkage mechanism. The id answers *which record belongs to this contract* and always matches. The hash answers *is this the record committed at issuance* and stops matching when content changes. You need the first now; the second is nullable until you're ready for it.

One detail that decides the schema:

> **The off-chain id is primary, not the contract address.**

A deal exists off-chain before it exists on-chain. The workshop creates it at Section 01 and the sponsor may never finish. `contractAddress` is therefore nullable, populated at posting, and unique-indexed once set. If contract address is the primary key, drafts have nowhere to live and the build page can't use this API at all.

```
Deal {
  id:              UUID          // primary, issued at draft creation
  contractAddress: String?       // null until posted
  disclosureHash:  Hash?         // null until frozen at posting
  status:          draft | posted | matured
  seller:          SellerInfo
  exposure:        Exposure
  lossHistory:     LossHistoryRef
  createdAt, updatedAt
}
```

**CRU, no D — and the U needs a rule.** Dropping delete is right; investors rely on these records. But Update and `disclosureHash` are in direct conflict, and that has to be resolved before the API is written. If seller info stays freely mutable after posting, the hash on-chain stops matching the bundle and the tamper-evidence in §3.1 is decorative.

Recommended:

| Status | Update behavior |
|---|---|
| `draft` | Freely mutable. No hash yet. This is the workshop. |
| `posted` | **Frozen.** Disclosure fields reject writes. Hash committed at posting is the permanent record. |
| `posted` + correction needed | Append-only addendum, new version, new hash. Original stays retrievable. |

Freeze at posting is the simplest version and I'd ship that — but note the freeze is **field-scoped, not blanket**. `contractAddress` has to be writable exactly once, at the draft → posted transition, precisely when the rest of the record is locking. Two rules, not one:

- Disclosure fields: writable in `draft`, rejected in `posted`
- `contractAddress`: null in `draft`, writable once at transition, immutable after

Versioned addenda can wait until someone actually needs to correct a live disclosure — but leave a `version` field in the schema now so it isn't a migration.

**The posting handshake, and its failure mode.** Posting is two writes across two systems: deploy the contract, then update the deal record with the address. If the second fails, you get an orphan — a bond live on-chain with an off-chain record still marked `draft` and no address pointing at it. The deal page can't find it, and neither can you.

Cheap fix: **write the deal id into the contract at deploy.** The link becomes bidirectional, so either side can heal the other. If the update call fails, the contract still knows which record it belongs to and reconciliation is a scan rather than a forensic exercise. Costs one string field on-chain.

Sequence:

1. Freeze the draft — disclosure fields lock, hash computed if you're doing hashes
2. Deploy the contract with the deal id embedded
3. Update the deal record with `contractAddress`, status → `posted`
4. **Verify**: read the contract back, confirm the embedded deal id matches the record you just updated

Step 4 is the verification you flagged, and it should be a read of contract state rather than a check on the deploy receipt — same principle as the run scripts in §4. A successful transaction proves the write happened, not that it landed where you think.

If step 3 fails after step 2 succeeded, the record stays `draft` with a `pendingContract` marker. Retryable, not corrupt.

**Where the build page fits.** This makes the workshop a consumer of the same API: Create on entering Section 01, Update as sections complete, freeze plus contract deploy at Post deal. That's a small scope addition to iteration 1's work, and it's what makes "build a bond, open its page, everything matches" true by construction rather than by careful duplication.

**Scope boundary.** This iteration is the Deal type, CRU, and the resolver. Not an indexer, not cross-deal queries, not caching, not access control — those are the all-deals-page problem and pulling them in now is how a two-day job becomes two weeks.

### 3.4 Where this meets the industry loss API

The deal page reads both services: trigger level from the Deal store, current level from the industry loss API. They must share a basis or the trigger status in §5.4 is wrong in a way nobody will notice.

Worth checking what the existing industry loss API actually returns — per-occurrence or annual aggregate. If it already made that choice, open question 1 is answered and both pages should inherit it rather than deciding independently.

---

## 4. Local verification path

Update the run scripts first, before touching the deal page. This gives you something to verify against.

**`run.sh` / `run-quick.sh`**
1. Instantiate the bond with the Raydion fixture below as constructor arguments
2. Print the seller fields back from contract state on completion — not from the input variables, from a read call. Reading back your own inputs proves nothing.
3. `run-quick.sh` stays fast: one deal, one region set, no waiting

**The verification is simple:** if the deal page renders "Raydion / Bermuda / Specialty Reinsurer" and that string never appears anywhere in the page source, the wiring is real.

### 4.1 Canonical seed fixture

```json
{
  "seller": {
    "name": "Raydion",
    "domicile": "Bermuda",
    "entityType": "Specialty Reinsurer",
    "verified": false,
    "description": "Raydion is a Bermuda-based specialty reinsurer providing capacity across global natural catastrophe perils. With $2.4B in managed assets and over a decade operating across emerging and developed markets, Raydion seeks fully collateralised protection against extreme loss years that exceed their internal risk tolerance. This bond covers Raydion's net retained exposure across their global property catastrophe book."
  },
  "exposure": {
    "basis": "Gross written premium",
    "anonymized": true,
    "regions": [
      { "region": "United States",  "pct": 50 },
      { "region": "China",          "pct": 30 },
      { "region": "Brazil",         "pct": 15 },
      { "region": "European Union", "pct": 5  }
    ]
  }
}
```

Four regions, totals 100%. I removed the duplicated United States / China / Brazil block from your notes — see §2, that duplication is probably the bug rather than intended data. If those repeats are meant to represent something real (two separate treaties in the same territory, say), tell me and the model needs a treaty dimension, not just a region.

Footer line under the exposure chart, verbatim: **Anonymized portfolio · Gross written premium basis**

---

## 5. Deal page — dynamic sections

Every section below reads from deal state. No page-level constants except labels.

### 5.1 Sponsor identity

```
┌──────────────────────────────────────────┐
│  ┌───┐                                   │
│  │ R │  Raydion                    ✕     │
│  └───┘  Bermuda · Specialty Reinsurer    │
│                                          │
│  Raydion is a Bermuda-based specialty…   │
└──────────────────────────────────────────┘
```

- **Logo**: solid `--blue` square, first character of the seller name, white, IBM Plex Mono, uppercase. 4px radius. Single color — no hashed palette, no gradient. Sizes 32 / 40 / 56, one component, size prop.
- **Fallback**: empty or non-alphabetic name → filled blue square, no glyph. Never render a broken letter.
- **Verified badge**: the black cross, shown only when `verified` is true. Sits right of the name, never inside the logo square.
- **Description**: from the disclosure bundle. Clamp at 4 lines with a ghost "Read more" if longer.

### 5.2 Exposure

The exposure chart replaces the SOV entirely — there is no SOV download, because the anonymized chart *is* the disclosure. Say that in the footer line rather than leaving users hunting for a file that isn't there.

SOVs are standardized down to exposure values anyway, so a downloadable one would carry no information the chart doesn't already show. The loss history is the artifact with content worth taking away.

Renders the region array. Handles 1 to N regions without layout breakage. If the total is under 100%, show the remainder as an explicit "Unallocated" segment in `--ink-muted` rather than silently scaling the chart to fill — a 12% gap in someone's disclosure is information.

### 5.3 Loss history — the download

Loss history is now a file, and it's the only downloadable artifact on the page.

**Generated content**: a mini claims history per region, three years. For the fixture that's 4 regions × 3 years.

Per row: region, year, claim count, incurred loss, largest single event. Enough to be scannable, not so much that it implies a precision we don't have.

**Retrieval: a GET against the bond.** The page requests the loss history by deal id and the API serves it. The page never constructs a file path, never knows a directory exists, and holds no assumption about where the bytes live.

```
GET /deals/{dealId}/loss-history          → JSON, for rendering
GET /deals/{dealId}/loss-history?format=csv  → CSV, for download
```

Exact routes per the API schema — the shape that matters is *keyed by deal id, served by the API*. That makes the storage backend swappable without touching the deal page, which is the same boundary as §3.1a, now enforced by the network rather than by discipline.

**Server-side storage** is one directory per deal, and it stays an implementation detail behind the handler:

```
/data/loss-history/{dealId}/
```

Same source, two formats — generate both from one function so they can't drift.

**The download button hits the endpoint**, it is not an `<a href>` to a static file. Response carries `Content-Disposition` with a readable filename — `raydion-loss-history.csv`, not `loss-history.csv`, since a user downloading three of these wants to tell them apart.

**Failure state.** If the fetch fails, the button reports it — "Loss history unavailable, try again." Not a silent no-op, and not a downloaded file containing an error page, which is the classic version of this bug.

**Generated once, at deal creation.** Not on page load, not on request. If it regenerates per view, two investors see different numbers for the same bond and the whole disclosure premise collapses. Deterministic seed per deal id if the demo data is synthetic.

The GET is a read of a stored artifact. It never triggers generation.

### 5.4 Trigger status — deal-type aware

Currently hardcoded to economic loss. It needs to read `triggerType` and render accordingly.

| Trigger type | Status line | Unit label |
|---|---|---|
| Economic loss | Trigger at $40B economic loss · Current $12B · **Not triggered** | Economic loss, USD |
| Industry loss | Trigger at $40B industry insured loss · Current $12B · **Not triggered** | Industry insured loss, USD |

Three states: `not_triggered`, `triggered`, `settled`. Each needs its own visual treatment — don't rely on the words alone.

**This is where the per-occurrence question bites.** "Industry loss" is still ambiguous between single-event and annual-aggregate, and the two need different labels and different chart scales. For a single event, Katrina at ~$105B is the historical ceiling. For an annual aggregate, the record is ~$137–146B in 2024 and the modeled 1-in-10 runs to $300B. A page that says "industry loss" without saying which one is telling the investor less than it appears to. See §10.

### 5.5 Trigger vs history chart

Reuse the build page chart. **Same component, not a fork** — one chart with an `editable` prop:

- Build page: `editable` — the trigger rule drags, the derived line updates live
- Deal page: read-only — rule fixed at the deal's trigger level, and the derived line becomes past tense

> This level would have been breached 3 times in the last 24 years.

Scale and series come from `triggerType`. The two types don't share a y-axis.

---

## 6. Data contract

What the deal page needs, in one shape:

```json
{
  "dealId": "…",
  "seller": {
    "name": "Raydion",
    "domicile": "Bermuda",
    "entityType": "Specialty Reinsurer",
    "verified": false,
    "description": "…"
  },
  "terms": {
    "triggerType": "economic | industry",
    "triggerLevel": 40,
    "raise": 500000,
    "coupon": 10.0,
    "currency": "USDC | RDX",
    "startDate": "…",
    "endDate": "…"
  },
  "exposure": {
    "basis": "Gross written premium",
    "anonymized": true,
    "regions": [{ "region": "United States", "pct": 50 }]
  },
  "lossHistory": {
    "available": true,
    "generatedAt": "…",
    "hash": null
  },
  "status": {
    "trigger": "not_triggered | triggered | settled",
    "currentLevel": 12,
    "oracle": "gallagher_re"
  },
  "position": {
    "value": 0,
    "accruedCoupon": 0,
    "claimable": false,
    "withdrawable": false
  }
}
```

`position` is per-viewer and should be a separate call — it's the only part of this page that differs between two people looking at the same deal.

---

## 7. Design

Inherits the build page system unchanged — white and transparent white, hairlines, ghost buttons, single soft shadow, IBM Plex Sans and Mono, tabular numerals on every figure.

Ghost buttons are validated on the build page and carry over as-is. No changes to the button system this iteration.

### 7.1 Green — the one departure

Green is reserved for **value the viewer owns or can take**. Nothing else.

| Token | Value | Use |
|---|---|---|
| `--green` | `#0E8F5E` | Withdraw and Claim coupon buttons; portfolio value text |
| `--green-wash` | `rgba(14,143,94,0.06)` | Hover fill on those buttons only |

Applies to: Withdraw, Claim coupon, portfolio value, accrued coupon.
Does not apply to: trigger status, navigation, section headers, confirmations, anything neutral.

The discipline is what makes it work. If green appears on a non-value element, it stops reading as "this is yours" and becomes decoration — and on a page that is otherwise clinical white, a stray green pill is the loudest thing on screen.

Withdraw and Claim coupon keep the ghost treatment — 1px border, transparent fill — but in green rather than ink. They are the only green-bordered elements on the page. Disabled drops to 40% opacity, same as every other ghost button.

Portfolio value uses `--green` on the number only. The label above it stays `--ink-muted`.

---

## 8. Manual verification checklist

You said you'd verify by hand, so here's the pass:

1. Run `run-quick.sh`. Seller fields print back from a contract read, not from input variables.
2. Open the deal page. Sponsor block shows Raydion / Bermuda / Specialty Reinsurer.
3. Grep the page source for "Raydion". Zero hits.
4. Exposure chart shows four regions totaling 100%, footer reads *Anonymized portfolio · Gross written premium basis*.
5. No SOV download anywhere on the page.
6. Loss history downloads. 12 rows, four regions × three years.
7. Download it twice. Files are byte-identical.
8. Change `triggerType` to industry loss in the fixture, re-run. Trigger status text and chart axis both change. Nothing else does.
9. Build a bond in the workshop, open its page. Every number matches what you typed.
10. On the build page, try to add United States twice. It won't let you.
11. Force regional exposure past 110%. Blocked, with the actual total named in the error.
12. Grep the deal page for `/data/loss-history`. Zero hits — the path exists only in the API handler.

Item 3 is the real test. Items 9 and 11 are the ones most likely to fail. Item 12 is the one that costs you later if it's skipped now.

**Run this checklist twice.** Once with the resolver pointed at local storage, once pointed at the data layer. Same twelve items both passes. If the sponsor block comes up empty on pass two, you know it's the storage swap — because pass one already proved the contract read works. One extra run, and it removes every ambiguous failure from the debugging loop.

Add two items on the second pass:

13. Kill the data layer connection. The page fails with a stated error, not a blank section or a silent fallback to stale data.
14. Post a deal, then attempt an Update on a disclosure field. Rejected.
15. Post a deal, then attempt a second write to `contractAddress`. Rejected.
16. Simulate a failed link update — deploy the contract, skip step 3. The deal is recoverable from the id embedded in the contract, and retrying completes it.
17. Break the loss history endpoint. The download button reports an error. It does not download a file containing an error page.

---

## 9. Build order

| # | Ticket | Depends on | Size |
|---|---|---|---|
| 0 | `Deal` type + CRU API + freeze-on-post rule | Q7 | M |
| 1 | Region duplicate guard + total validator + running total display | — | S |
| 2 | `SellerInfo` in the bond contract | 0 | M |
| 3 | Run scripts seeded with Raydion fixture + read-back print | 2 | S |
| 4 | Loss history generator + storage + GET endpoint (JSON and CSV) | 0 | M |
| 5 | Deal page: sponsor identity block + logo component | 2, 3 | S |
| 6 | Deal page: exposure chart bound to region array | 3 | M |
| 7 | Deal page: loss history download, SOV removed | 4, Q5 | S |
| 8 | Trigger status: deal-type aware, three states | 3, Q1 | M |
| 9 | Shared trigger/history chart, `editable` prop, both consumers | 8 | M |
| 10 | Green tokens + Withdraw / Claim coupon / portfolio value | — | S |
| 11 | Build page writes to the Deal API instead of local state | 0 | M |

Ticket 0 now gates most of the work — it's the seam everything else sits on. 1 and 10 are independent and can run in parallel with it. Do 0, 2, and 3 before any deal page ticket; without the read-back working, every page ticket is unverifiable.

---

## 10. Open questions

1. **Per-occurrence or annual aggregate?** Still the biggest one, and it now affects two pages. Industry loss triggers need to say which, because the scales differ by roughly 2×. Carried from iteration 1. Likely already answered by whatever the industry loss API returns — check there first.
2. **Why 110% and not 100%?** If the tolerance is deliberate — overlapping treaties, rounding on aggregated books — say so in helper text under the region list, because an investor seeing 108% will otherwise read it as an error. If it's not deliberate, the cap should be 100%.
3. **Is under 100% valid?** A sponsor disclosing 70% of their book is telling investors something. Allowed with an "Unallocated" segment, or blocked?
4. **Duplicate regions in the fixture** — copy/paste artifact, or two treaties in one territory? Only the second answer changes the data model.
5. **Loss history data source.** Synthetic for the demo, or derived from something? If synthetic, it must be deterministic per deal id.
6. **Economic loss oracle.** Gallagher Re settles industry loss. What settles an economic loss trigger? The deal page names the oracle, so it needs an answer per trigger type.
7. **Freeze semantics** (§3.3). Frozen at posting, or versioned addenda? Frozen is simpler and I'd ship it, but it needs deciding before the CRU API is written — it's a validation rule, not a feature you bolt on.

**Settled since last revision:** hybrid data layer (§3.1) — identity on-chain, disclosure off-chain in the web2 Deal store, linked by `dealId`. Hash field stays nullable until freeze is implemented.