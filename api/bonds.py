"""
RHODEX Bonds store — Supabase backend (moved off Bubble 2026-11-17).

Table: public.rpos  (migration: supabase/migrations/20261117000000_rpos_cleanup_snake_case.sql)
Files: private Storage bucket "rpo-documents"; rows hold the object path
       in loss_history_path / sov_path.

Talks to Supabase's REST layer (PostgREST) with plain `requests`, so no
new dependency. Server-side only: it uses the service-role / secret key,
which bypasses RLS. rpos has RLS on with no policies, so the browser
can't read it even with the publishable key. Same rule as before: the
browser never talks to the bond store directly, it goes through server.py.

Env (.env at repo root):
    SUPABASE_URL                 https://<project_ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY    legacy service_role JWT  (or)
    SUPABASE_SECRET_KEY          new-style sb_secret_... key

Functions return plain records, and what you write is what you read back
(no read/write naming quirks).

The bond id is Postgres's bigint `id`. CatBond.dealId is a string on-chain,
so callers pass str(id) to the contract. Every function here accepts the
id as either a str or an int.
"""

import os

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

TABLE = "rpos"
DOCUMENTS_BUCKET = "rpo-documents"

STATUS_OK        = 0
STATUS_TRIGGERED = 1
STATUS_MATURED   = 2
VALID_STATUSES = (STATUS_OK, STATUS_TRIGGERED, STATUS_MATURED)

DEFAULT_TRIGGER_TYPE = "natcat"

# Columns a caller may write. id / created_at / updated_at are DB-managed.
WRITABLE_COLUMNS = (
    "cedant", "description", "maturity", "value", "status_triggered",
    "contract_address", "trigger_address", "trigger_type",
    "product_id", "product_version", "loss_history_path", "sov_path",
)


class BondNotFound(LookupError):
    pass


def _config() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY", "")
    if not url or not key:
        raise EnvironmentError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) "
            "must be set — check your .env file"
        )
    return url, key


def _headers(key: str, *, return_rows: bool = False) -> dict:
    headers = {"apikey": key, "Content-Type": "application/json"}
    # Legacy service_role keys are JWTs and also go in Authorization.
    # New sb_secret_ keys are not JWTs and must only be sent as apikey.
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    if return_rows:
        headers["Prefer"] = "return=representation"
    return headers


def _request(method: str, *, params: dict | None = None, body: dict | None = None,
             return_rows: bool = False) -> list[dict]:
    url, key = _config()
    resp = requests.request(
        method,
        f"{url}/rest/v1/{TABLE}",
        headers=_headers(key, return_rows=return_rows),
        params=params,
        json=body,
        timeout=10,
    )
    if not resp.ok:
        # PostgREST error bodies ({code, message, details, hint}) are far more
        # useful than a bare status line, so surface them.
        raise requests.HTTPError(f"{resp.status_code} from Supabase: {resp.text}", response=resp)
    return resp.json() if resp.content else []


def _single(rows: list[dict], bond_id) -> dict:
    if not rows:
        raise BondNotFound(f"no bond with id {bond_id}")
    return rows[0]


# ── Bond object builder ──────────────────────────────────────────────────────

def build_bond_payload(
    cedant: str = "",
    description: str = "",
    maturity: str = "",
    value: float = 0,
    status_triggered: int = STATUS_OK,
    contract_address: str = "",
    trigger_address: str = "",
    trigger_type: str = DEFAULT_TRIGGER_TYPE,
    product_id: str = "",
    product_version: int | None = None,
    loss_history_path: str = "",
    sov_path: str = "",
) -> dict:
    """
    Build a row for rpos. Unset fields become NULL instead of "":
    Postgres rejects "" for a date column, and a NULL
    contract_address stays compatible with its UNIQUE constraint, where
    two "" values would collide.
    """
    if status_triggered not in VALID_STATUSES:
        raise ValueError(f"status_triggered must be one of {VALID_STATUSES}, got {status_triggered!r}")
    row = {
        "cedant":            cedant,
        "description":       description,
        "maturity":          maturity,
        "value":             value,
        "status_triggered":  status_triggered,
        "contract_address":  contract_address,
        "trigger_address":   trigger_address,
        "trigger_type":      trigger_type,
        "product_id":        product_id,
        "product_version":   product_version,
        "loss_history_path": loss_history_path,
        "sov_path":          sov_path,
    }
    return {k: (None if v == "" else v) for k, v in row.items()}


# ── API calls ─────────────────────────────────────────────────────────────────

def create_bond(bond: dict) -> dict:
    """Insert a bond row. Returns the stored row, including its new `id`."""
    unknown = set(bond) - set(WRITABLE_COLUMNS)
    if unknown:
        raise ValueError(f"unknown bond fields: {sorted(unknown)}")
    return _request("POST", body=bond, return_rows=True)[0]


def link_contract_address(bond_id, contract_address: str) -> dict:
    """Attach the deployed CatBond address to a bond row. Returns the updated row."""
    rows = _request("PATCH", params={"id": f"eq.{int(bond_id)}"},
                    body={"contract_address": contract_address}, return_rows=True)
    return _single(rows, bond_id)


def update_bond_status(bond_id, status_code: int) -> dict:
    """Set status_triggered (0 ok / 1 triggered / 2 matured). Returns the updated row."""
    if status_code not in VALID_STATUSES:
        raise ValueError(f"status_code must be one of {VALID_STATUSES}, got {status_code!r}")
    rows = _request("PATCH", params={"id": f"eq.{int(bond_id)}"},
                    body={"status_triggered": status_code}, return_rows=True)
    return _single(rows, bond_id)


def get_bond(bond_id) -> dict:
    """Read one bond row by id. Raises BondNotFound if it doesn't exist."""
    rows = _request("GET", params={"id": f"eq.{int(bond_id)}", "select": "*"})
    return _single(rows, bond_id)


def list_bonds(bond_type: str = DEFAULT_TRIGGER_TYPE) -> list[dict]:
    """Every bond with this trigger_type, newest first."""
    return _request("GET", params={
        "trigger_type": f"eq.{bond_type}",
        "select": "*",
        "order": "created_at.desc",
    })


# ── Fake end-to-end flow (live — creates one real row) ─────────────────────────

if __name__ == "__main__":
    import json
    import secrets

    row = create_bond(build_bond_payload(
        cedant="Raydion",
        description="Smoke-test bond created by bonds.py __main__.",
        maturity="2027-08-20",
        value=500_000,
    ))
    print("Created:", json.dumps(row, indent=2, default=str))

    fake_address = "0x" + secrets.token_hex(20)
    linked = link_contract_address(row["id"], fake_address)
    assert linked["contract_address"] == fake_address
    update_bond_status(row["id"], STATUS_OK)

    read_back = get_bond(str(row["id"]))
    assert read_back["contract_address"] == fake_address
    print(f"Round-trip OK: bond {row['id']} -> {fake_address}")
    print(f"natcat bonds listed: {len(list_bonds())}")
