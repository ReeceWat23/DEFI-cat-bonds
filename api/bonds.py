"""
RHODEX Bonds API
Base: https://realestatesimplified.xyz/version-test/api/1.1/wf/<endpoint>

Five endpoints:

  1. mkr_bond            — create a bond record off-chain. Returns a unique ID.
  2. link-bond            — once the sponsor's contract is deployed on-chain,
                            link that address back onto the bond record.
  3. update-bond-status   — flip status-tiggered as the bond's on-chain
                            lifecycle advances (triggered / matured).
  4. get_bond             — read a bond record back by id.
  5. get_bonds            — list every bond record of a given trigger type.
                            POST {"type": "natcat"} returns every natcat_loss
                            bond (economic-loss and industry-loss together —
                            same product, see list_bonds()).

The unique ID is what ties the off-chain bond record to the on-chain contract:
create the record first (no contract address yet), deploy the contract,
then call link-bond with the address you just got back from the chain.

Bond object shape (see `build_bond_payload`):
    {
        "cedant":            string,   # sponsor / ceding company name
        "contract-address":  string,   # set later, via link-bond — omit at creation
        "description":       string,
        "Loss-history":      file,
        "maturity":          date,     # ISO 8601, e.g. "2027-08-20"
        "SOV":               file,
        "status-tiggered":   number,   # 0 ok, 1 triggered, 2 matured — field name matches the API's own typo, don't "fix" it
        "value":             number,   # deal value in USD
        "trigger-address":   string,   # NEW (sprint §2.6) — not yet /initialize'd on live Bubble, see build_bond_payload()
        "product-id":        string,   # NEW — same caveat
        "product-version":   number,   # NEW — same caveat
    }

Auth: RHODEX_API_KEY loaded from .env (Bearer token), same as natcat_loss.py.

SETUP NOTE (2026-08-20): these are Bubble API workflows with no manually
declared parameters, so each one 404/400s until it's been "initialized"
once — see initialize_endpoint(). POST a complete sample payload to
<endpoint>/initialize and Bubble auto-detects the parameter names/types
from whatever keys are in that body; it doesn't run the workflow or touch
any data. Do this once per endpoint before calling it for real — all four
are already initialized as of this date.

Confirmed live and working, in order:
  1. mkr_bond          — POST the full bond object (build_bond_payload) at
                          the top level. Returns {"response": {"id": "..."}}.
  2. link-bond          — POST {"bond-id": <id from step 1>, "contract": <address>}.
                          Note the param is "bond-id", not "unique-id" as
                          originally sketched in this file's comments.
                          Returns {"response": {"verification": <address>}}.
  3. update-bond-status — POST {"bond-id": <id>, "status-code": <0|1|2>}.
                          Same "bond-id" param name as step 2.
  4. get_bond           — POST {"bond-id": <id>}. Returns
                          {"response": {"bond": {...}}} with every field
                          that was set. Two read-vs-write quirks worth
                          knowing: the status field comes back spelled
                          correctly as "status-triggered" (write uses the
                          API's own "status-tiggered" typo — both refer to
                          the same field); and "maturity" comes back as a
                          Bubble-internal epoch-ms timestamp, not the ISO
                          date string you send on create.
  5. get_bonds          — POST {"type": "natcat"}. Returns
                          {"response": {"bonds": [...]}} — a list, not a
                          single record. Same "status-triggered"/epoch-ms
                          "maturity" read quirks as get_bond. Each record
                          also carries a "trigger" string field (e.g.
                          "ILW/econ") that isn't in the write-side spec
                          above — a read-only/legacy field, distinct from
                          the not-yet-live "trigger-address" write field.
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

API_BASE = "https://realestatesimplified.xyz/version-test/api/1.1/wf"
API_KEY  = os.environ.get("RHODEX_API_KEY", "")

# Bond status codes — status-tiggered field.
STATUS_OK        = 0
STATUS_TRIGGERED = 1
STATUS_MATURED   = 2

ENDPOINTS = {
    "create_bond":          "mkr_bond",
    "link_contract_address": "link-bond",
    "update_status":        "update-bond-status",
    "get_bond":             "get_bond",
    "list_bonds":           "get_bonds",
}


def _headers() -> dict:
    if not API_KEY:
        raise EnvironmentError("RHODEX_API_KEY not set — check your .env file")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
    }


def _post(endpoint_key: str, body: dict) -> dict:
    url = f"{API_BASE}/{ENDPOINTS[endpoint_key]}"
    resp = requests.post(url, headers=_headers(), json=body, timeout=10)
    resp.raise_for_status()
    return resp.json()


def initialize_endpoint(endpoint_key: str, sample_body: dict) -> dict:
    """
    Bubble-specific: an API workflow with no manually-declared parameters
    doesn't know what fields to expect until you POST a sample payload to
    <endpoint>/initialize once — that call registers the parameter names
    and types in the Bubble editor (it does not run the workflow itself
    or create/modify any data). Always pass a body with every field
    present (see build_bond_payload) so the full parameter set gets
    detected in one shot rather than growing piecemeal.
    """
    url = f"{API_BASE}/{ENDPOINTS[endpoint_key]}/initialize"
    resp = requests.post(url, headers=_headers(), json=sample_body, timeout=10)
    resp.raise_for_status()
    return resp.json()


# ── Bond object builder ──────────────────────────────────────────────────────

def build_bond_payload(
    cedant: str = "",
    description: str = "",
    maturity: str = "",
    value: float = 0,
    status_tiggered: int = STATUS_OK,
    contract_address: str = "",
    loss_history: str = "",
    sov: str = "",
    trigger_address: str = "",
    product_id: str = "",
    product_version: int = 0,
) -> dict:
    """
    Build the bond object. Every field from the spec is always present in
    the returned dict — even ones we don't have a real value for yet
    (contract-address at creation time, loss_history/sov with no file
    upload implemented) — sent as "" rather than omitted. Bubble's param
    auto-detection (the /initialize call) only registers whatever keys
    show up in the sample payload, so a partial payload means a partial
    parameter set on the workflow; this keeps every call complete.

    loss_history / sov are file fields on the live API; this client
    doesn't implement file upload (undocumented in the source spec), so
    they're passed through as plain strings (e.g. a filename or URL
    placeholder) — fine for the record-linking flow this module exists to
    prove out.

    trigger_address / product_id / product_version are new for the sprint's
    §2.6 ("bond gets trigger_address, product_id, product_version"). They're
    included in the payload shape here, but — unlike every other field —
    **no live `/initialize` call has been made registering them on the real
    Bubble workflow yet.** Per this module's own established pattern (see
    the SETUP NOTE below), an undeclared parameter 404s/400s until that
    one-time registration happens against the live API, so populating these
    today will not actually persist anything until that step is run
    deliberately — this is a live, one-way change to shared infrastructure,
    not something to trigger silently as a side effect of running code.
    """
    return {
        "cedant":           cedant,
        "contract-address": contract_address,
        "description":      description,
        "Loss-history":     loss_history,
        "maturity":         maturity,
        "SOV":              sov,
        "status-tiggered":  status_tiggered,
        "value":            value,
        "trigger-address":  trigger_address,
        "product-id":       product_id,
        "product-version":  product_version,
    }


# ── API calls ─────────────────────────────────────────────────────────────────

def create_bond(bond: dict) -> dict:
    """POST mkr_bond. Returns the raw response — inspect it to find the unique ID field."""
    return _post("create_bond", bond)


def link_contract_address(unique_id: str, contract_address: str) -> dict:
    """POST link-bond — attach the deployed contract address to a bond record."""
    return _post("link_contract_address", {"bond-id": unique_id, "contract": contract_address})


def update_bond_status(unique_id: str, status_code: int) -> dict:
    """POST update-bond-status — advance status-tiggered (0 ok / 1 triggered / 2 matured)."""
    return _post("update_status", {"bond-id": unique_id, "status-code": status_code})


def get_bond(unique_id: str) -> dict:
    """
    POST get_bond — read a bond record back by id. Returns the raw
    response; the record is nested under response["bond"]. Field-naming
    quirks on read vs write are documented in the module docstring.
    """
    return _post("get_bond", {"bond-id": unique_id})


def list_bonds(bond_type: str = "natcat") -> dict:
    """
    POST get_bonds — every bond record of a given trigger type. `bond_type`
    "natcat" covers both economic-loss and industry-loss deals in one call
    (they're the same natcat_loss product, two metrics from one endpoint —
    see products/README.md), matching how CANONICAL_TRIGGERS and the
    Trigger status dashboard already treat that pairing. Returns the raw
    response; use extract_bonds() to pull the list out of it.
    """
    return _post("list_bonds", {"type": bond_type})


def extract_bonds(list_response: dict) -> list[dict]:
    """
    Same defensive-candidate approach as extract_unique_id() — the list
    endpoint's response schema isn't documented in the source spec, so try
    the field names Bubble commonly uses for a list result, at both the
    top level and under the "response" wrapper every other endpoint here
    nests its payload in.
    """
    candidates = ("bonds", "results", "response")
    for container in (list_response, list_response.get("response", {})):
        if not isinstance(container, dict):
            continue
        for key in candidates:
            value = container.get(key)
            if isinstance(value, list):
                return value
    return []


def extract_unique_id(create_response: dict) -> str | None:
    """
    Response schema isn't documented in the source spec — try the field
    names Bubble commonly uses, checking both top level and the
    "response" wrapper (same nesting natcat_loss.py has to handle).
    """
    candidates = ("unique-id", "unique_id", "_id", "id")
    for container in (create_response, create_response.get("response", {})):
        if not isinstance(container, dict):
            continue
        for key in candidates:
            if key in container:
                return container[key]
    return None


# ── Fake end-to-end flow ───────────────────────────────────────────────────────
#
# Exercises all four endpoints against the LIVE API: create a bond record,
# generate a fake on-chain contract address (no real deploy — that's the

# Foundry side, out of scope here), link it, bump status, read it back, then
# print a simulated "contract read" to prove the off-chain unique ID and the
# on-chain address are tied together correctly.

if __name__ == "__main__":
    import json
    import secrets

    print("── 1. Create bond record ──────────────────────────────")
    bond = build_bond_payload(
        cedant="Raydion",
        description=(
            "Raydion is a Bermuda-based specialty reinsurer providing capacity across "
            "global natural catastrophe perils. This bond covers Raydion's net retained "
            "exposure across their global property catastrophe book."
        ),
        maturity="2027-08-20",
        value=500_000,
        status_tiggered=STATUS_OK,
    )
    print("Request body:", json.dumps(bond, indent=2))

    create_resp = create_bond(bond)
    print("Response:", json.dumps(create_resp, indent=2))

    unique_id = extract_unique_id(create_resp)
    if not unique_id:
        raise SystemExit(
            "Could not find a unique ID in the response — inspect the JSON above "
            "and adjust extract_unique_id()'s candidate field names."
        )
    print(f"\nUnique ID: {unique_id}")

    print("\n── 2. Deploy fake contract (simulated, not on-chain) ────")
    fake_contract_address = "0x" + secrets.token_hex(20)
    print(f"Fake contract address: {fake_contract_address}")

    print("\n── 3. Link contract address to bond record ──────────────")
    link_resp = link_contract_address(unique_id, fake_contract_address)
    print("Response:", json.dumps(link_resp, indent=2))

    print("\n── 4. Update bond status (still OK) ──────────────────────")
    status_resp = update_bond_status(unique_id, STATUS_OK)
    print("Response:", json.dumps(status_resp, indent=2))

    print("\n── 5. Read the bond record back ──────────────────────────")
    read_resp = get_bond(unique_id)
    print("Response:", json.dumps(read_resp, indent=2))
    read_back_address = read_resp.get("response", {}).get("bond", {}).get("contract-address")
    if read_back_address != fake_contract_address:
        raise SystemExit(
            f"Read-back mismatch: get_bond returned contract-address="
            f"{read_back_address!r}, expected {fake_contract_address!r}"
        )
    print("contract-address round-tripped correctly.")

    print("\n── 6. Simulated on-chain contract read ────────────────────")
    print("============================================================")
    print("  FAKE CatBond — contract state")
    print("============================================================")
    print(f"  Contract address:  {fake_contract_address}")
    print(f"  dealId (unique ID): {unique_id}")
    print(f"  Cedant:            {bond['cedant']}")
    print(f"  Value:             ${bond['value']:,}")
    print(f"  Maturity:          {bond['maturity']}")
    print(f"  Status:            {bond['status-tiggered']} (0=ok, 1=triggered, 2=matured)")
    print("============================================================")
    print(f"\nDone. Check the RHODEX bonds database for unique ID {unique_id} —")
    print(f"it should show contract-address = {fake_contract_address}.")
