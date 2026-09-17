// Historical annual loss series for the "Build a bond" trigger-type charts.
//
// Illustrative demo figures (same convention as the HISTORICAL array in
// DealPage.jsx — not a verified feed). TODO: replace with a real data
// source (per Plan-it-2 §4.1's note) — likely a CSV dropped in this same
// folder and fetched, once one exists, rather than inlined here.

// Total economic loss ($B) — same series DealPage.jsx uses for its chart.
export const ECONOMIC_LOSS_HISTORY = [
  { year: 2016, valueB: 175 },
  { year: 2017, valueB: 344 },
  { year: 2018, valueB: 165 },
  { year: 2019, valueB: 150 },
  { year: 2020, valueB: 202 },
  { year: 2021, valueB: 270 },
  { year: 2022, valueB: 313 },
  { year: 2023, valueB: 280 },
  { year: 2024, valueB: 368 },
  { year: 2025, valueB: 310 },
]

// Insured (industry) loss ($B) — a distinct, smaller-scale series. Industry
// loss has never approached $200B in a calendar year, hence the separate
// $200B chart ceiling (vs. $1T for economic loss).
export const INDUSTRY_LOSS_HISTORY = [
  { year: 2016, valueB: 54 },
  { year: 2017, valueB: 144 },
  { year: 2018, valueB: 93 },
  { year: 2019, valueB: 63 },
  { year: 2020, valueB: 89 },
  { year: 2021, valueB: 130 },
  { year: 2022, valueB: 125 },
  { year: 2023, valueB: 118 },
  { year: 2024, valueB: 145 },
  { year: 2025, valueB: 120 },
]

// The one product this UI knows how to deploy triggers against —
// api/products/public/natcat_loss.v2.json. Kept in sync with that file and
// with DEAL 000/script/Setup.s.sol's own copy of the same values, since
// there's no HTTP endpoint yet for the browser to fetch the real registry
// from (api/products/ is a Python-only concept today — see
// api/monitor/README.md's "what's deliberately not built here"). If this
// product's endpoint/units/maxReportAge ever change, update all three
// places together.
//
// v2 (2026-09-16): switched from RHODEX-NATCAT-LOSS + ALL-LOSSES[-1] to
// the simpler latest-report endpoint, which returns the newest record
// directly — no array to fetch/index into. `valuePath` below is each
// metric's primary (full-year total) field; it's only used here to
// *identify* which metric a trigger reports on (matched against the
// registry), not to resolve a value — the monitor does the real
// resolution off-chain with a total→quarterly fallback chain (see
// natcat_loss.v2.json's value_paths), since the current in-progress year
// never has a total until it completes.
export const NATCAT_LOSS_PRODUCT = {
  productId: 'natcat_loss',
  version: 2,
  units: 'usd_billions',
  maxReportAgeSeconds: 150 * 24 * 60 * 60, // 150 days
  endpoint: 'https://realestatesimplified.xyz/version-test/api/1.1/wf/latest-report',
}

export const TRIGGER_TYPES = {
  economic: {
    id: 'economic',
    label: 'Economic loss',
    description: 'Total measured economic damage from the event',
    history: ECONOMIC_LOSS_HISTORY,
    maxB: 1000,
    dealTypeCode: 1, // legacy UI selector value — kept only to pick the row below
    valuePath: 'response.reports."economic-loss | total"',
  },
  industry: {
    id: 'industry',
    label: 'Industry loss',
    description: 'Insured industry loss as reported by the settlement oracle',
    history: INDUSTRY_LOSS_HISTORY,
    maxB: 200,
    dealTypeCode: 0,
    valuePath: 'response.reports."industry-loss | total"',
  },
}
