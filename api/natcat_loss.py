"""
RHODEX Natural Catastrophe Loss API
Endpoint: https://realestatesimplified.xyz/version-test/api/1.1/wf/RHODEX-NATCAT-LOSS

POST Parameters
---------------
ALL   (string, required) : "yes" returns all historical losses.
                           "no"  returns only the year specified by YEAR.

YEAR  (string, optional) : Year in "XXXX" format e.g. "2026".
                           When provided, response includes YEAR-LOSSES for
                           that calendar year. Required when ALL="no".

Response shape
--------------
{
  "status": "success",
  "response": {
    "ALL-LOSSES": [
      {
        "year": "2024",
        "economic-loss | total": 417,     # full-year total economic losses ($B)
        "industry-loss | total": 154,     # full-year insured losses ($B)
        "gap| total ":           263,     # protection gap ($B)
        "source | total ":       "url",
        "As of date | total ":   1737435600000,   # epoch ms

        # Quarterly cumulative figures (not all years have all quarters)
        "Q1 economic":           43,
        "Q1 industry":           20,
        "Q2 | economic":         128,
        "Q2 | industry":         61,
        "Q3 | economic ":        280,
        "Q3 | industry ":        108,
        "source | Q1":           "url",
        "source | Q2":           "url",
        "source | Q3":           "url",
      },
      ...
    ]
  }
}

Loss figures are in billions of USD ($B).
Contract trigger thresholds are in whole USD — multiply by 1_000_000_000.

Auth: RHODEX_API_KEY loaded from .env (Bearer token).
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

API_BASE = "https://realestatesimplified.xyz/version-test/api/1.1/wf"
API_URL  = f"{API_BASE}/RHODEX-NATCAT-LOSS"
API_KEY  = os.environ.get("RHODEX_API_KEY", "")

# Deal type constants — match TriggerBase.sol
INDUSTRY_LOSS = 0
ECONOMIC_LOSS = 1


def _headers() -> dict:
    if not API_KEY:
        raise EnvironmentError("RHODEX_API_KEY not set — check your .env file")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }


# ── Raw API calls ──────────────────────────────────────────────────────────────

def fetch_all_losses() -> dict:
    """Return the full ALL-LOSSES list from the API."""
    resp = requests.post(API_URL, headers=_headers(), json={"ALL": "yes"}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def fetch_year_losses(year: str) -> dict:
    """
    Return data for a single calendar year.

    Args:
        year: Four-digit string e.g. "2026".
    """
    if len(year) != 4 or not year.isdigit():
        raise ValueError(f"year must be a 4-digit string, got: {year!r}")
    resp = requests.post(
        API_URL,
        headers=_headers(),
        json={"ALL": "no", "YEAR": year},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def fetch(year: str | None = None) -> dict:
    """
    Convenience wrapper.

    fetch()         → full ALL-LOSSES list
    fetch("2026")   → single-year record
    """
    return fetch_year_losses(year) if year else fetch_all_losses()


LATEST_REPORT_URL = f"{API_BASE}/latest-report"


def fetch_latest_report() -> dict:
    """
    Return the single most recently added report directly — no ALL/YEAR
    params, no array to fetch and index into. Equivalent to
    fetch_all_losses()'s last ALL-LOSSES entry (confirmed live: identical
    `_id`), just without fetching the whole history first. Added
    2026-09-16 alongside api/products/public/natcat_loss.v2.json, which
    uses this endpoint as its source.

    Response is nested under response["reports"] (singular record, despite
    the plural key name — matches the live API, not a typo to fix).
    """
    resp = requests.post(LATEST_REPORT_URL, headers=_headers(), json={}, timeout=10)
    resp.raise_for_status()
    return resp.json()


# ── Parsed helpers ─────────────────────────────────────────────────────────────

def get_records() -> list[dict]:
    """Return the ALL-LOSSES list, sorted oldest → newest."""
    data = fetch_all_losses()
    records = data.get("response", {}).get("ALL-LOSSES", [])
    return sorted(records, key=lambda r: r.get("year", "0"))


def latest_loss_for_year(record: dict, deal_type: int) -> tuple[float | None, str | None]:
    """
    Extract the most recent confirmed loss figure from a year record.

    Returns (loss_in_billions, source_url).
    Prefers the full-year total; falls back to the latest available quarter.
    """
    if deal_type == ECONOMIC_LOSS:
        total_field    = "economic-loss | total"
        q3_field       = "Q3 | economic "
        q2_field       = "Q2 | economic"
        q1_field       = "Q1 economic"
    else:
        total_field    = "industry-loss | total"
        q3_field       = "Q3 | industry "
        q2_field       = "Q2 | industry"
        q1_field       = "Q1 industry"

    for (loss_field, src_field) in [
        (total_field, "source | total "),
        (q3_field,    "source | Q3"),
        (q2_field,    "source | Q2"),
        (q1_field,    "source | Q1"),
    ]:
        val = record.get(loss_field)
        if val is not None:
            return float(val), record.get(src_field)

    return None, None


def check_trigger(deal_type: int, loss_limit_usd: int, year: str | None = None) -> dict:
    """
    Check whether the trigger threshold has been met.

    Args:
        deal_type:      ECONOMIC_LOSS (1) or INDUSTRY_LOSS (0)
        loss_limit_usd: threshold in whole USD (e.g. 370_000_000_000 for $370B)
        year:           year to check; defaults to the most recent available year

    Returns:
        {
          "triggered": bool,
          "loss_usd":  int,           # confirmed loss in whole USD
          "loss_b":    float,         # same in billions
          "threshold_b": float,
          "year":      str,
          "source":    str | None,
        }
    """
    records = get_records()
    if not records:
        raise RuntimeError("No records returned from API")

    record = next((r for r in records if r.get("year") == year), None) if year else records[-1]
    if record is None:
        raise ValueError(f"No data found for year {year!r}")

    loss_b, source = latest_loss_for_year(record, deal_type)
    if loss_b is None:
        raise RuntimeError(f"No loss figure available for {record.get('year')}")

    loss_usd      = int(loss_b * 1_000_000_000)
    threshold_b   = loss_limit_usd / 1_000_000_000
    triggered     = loss_usd >= loss_limit_usd

    return {
        "triggered":   triggered,
        "loss_usd":    loss_usd,
        "loss_b":      loss_b,
        "threshold_b": threshold_b,
        "year":        record.get("year"),
        "source":      source,
    }


# ── Quick smoke test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    print("── All records ──────────────────────────────────────")
    for r in get_records():
        econ = r.get("economic-loss | total", "—")
        ind  = r.get("industry-loss | total", "—")
        print(f"  {r['year']}  economic: ${econ}B  insured: ${ind}B")

    print()
    print("── DEAL 000 trigger check ($370B economic loss) ─────")
    result = check_trigger(
        deal_type=ECONOMIC_LOSS,
        loss_limit_usd=370_000_000_000,
    )
    print(json.dumps(result, indent=2))
