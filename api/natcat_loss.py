"""
RHODEX Natural Catastrophe Loss API
Endpoint: https://realestatesimplified.xyz/RHODEX-NATCAT-LOSS

POST Parameters
---------------
ALL   (string, required) : "yes" returns all historical losses.
                           "no"  returns only the year specified by YEAR.

YEAR  (string, optional) : Year in "XXXX" format e.g. "2026".
                           When provided, response includes YEAR-LOSSES for
                           that calendar year. Required when ALL="no".

Response Fields
---------------
YEAR-LOSSES : Total economic loss figure for the requested year.
ALL-LOSSES  : List of loss records across all available years.

Auth: RHODEX_API_KEY loaded from .env (Bearer token).
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

API_URL = "https://realestatesimplified.xyz/RHODEX-NATCAT-LOSS"
API_KEY = os.environ.get("RHODEX_API_KEY", "")


def _headers() -> dict:
    if not API_KEY:
        raise EnvironmentError("RHODEX_API_KEY not set — check your .env file")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }


def fetch_all_losses() -> dict:
    """Return ALL-LOSSES list covering every available year."""
    resp = requests.post(API_URL, headers=_headers(), json={"ALL": "yes"}, timeout=10)
    resp.raise_for_status()
    return resp.json()


def fetch_year_losses(year: str) -> dict:
    """
    Return YEAR-LOSSES for a specific calendar year.

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

    fetch()         → ALL-LOSSES list (all years)
    fetch("2026")   → YEAR-LOSSES for 2026 only
    """
    if year is None:
        return fetch_all_losses()
    return fetch_year_losses(year)


# ── Quick smoke test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    print("── ALL losses ───────────────────────────────────────")
    data = fetch()
    print(json.dumps(data, indent=2))

    print()
    print("── 2026 losses ──────────────────────────────────────")
    data = fetch("2026")
    print(json.dumps(data, indent=2))
