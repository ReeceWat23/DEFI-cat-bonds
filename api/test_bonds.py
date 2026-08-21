"""
Test suite for bonds.py.

No mocking framework/fixtures exist elsewhere in this repo for the API
scripts (natcat_loss.py's validate.sh is a live bash smoke test), and
Bubble's API workflows here have no local equivalent to run against — so
the integration tests below hit the real live endpoint, same as
bonds.py's own __main__ block. Each integration test run creates one real
throwaway Bond record in the "version-test" environment.

Run: pytest api/test_bonds.py -v
(or via api/run_tests.sh, which runs this alongside validate.sh)
"""

import secrets

import pytest

import bonds


# ── Unit tests — no network ──────────────────────────────────────────────────

def test_build_bond_payload_includes_all_fields_even_when_unset():
    payload = bonds.build_bond_payload(cedant="Acme", description="d", maturity="2027-01-01", value=100)
    assert set(payload.keys()) == {
        "cedant", "contract-address", "description", "Loss-history",
        "maturity", "SOV", "status-tiggered", "value",
    }
    # Fields not passed in stay present, just empty — not omitted.
    assert payload["contract-address"] == ""
    assert payload["Loss-history"] == ""
    assert payload["SOV"] == ""


def test_build_bond_payload_defaults_status_to_ok():
    payload = bonds.build_bond_payload()
    assert payload["status-tiggered"] == bonds.STATUS_OK


def test_build_bond_payload_honors_explicit_values():
    payload = bonds.build_bond_payload(
        cedant="Acme", description="d", maturity="2027-01-01", value=100,
        status_tiggered=bonds.STATUS_TRIGGERED,
        contract_address="0xabc", loss_history="loss.csv", sov="sov.pdf",
    )
    assert payload["contract-address"] == "0xabc"
    assert payload["Loss-history"] == "loss.csv"
    assert payload["SOV"] == "sov.pdf"
    assert payload["status-tiggered"] == bonds.STATUS_TRIGGERED


@pytest.mark.parametrize("response, expected", [
    ({"response": {"id": "abc123"}}, "abc123"),
    ({"id": "abc123"}, "abc123"),
    ({"response": {"_id": "abc123"}}, "abc123"),
    ({"response": {"unique-id": "abc123"}}, "abc123"),
])
def test_extract_unique_id_finds_known_field_names(response, expected):
    assert bonds.extract_unique_id(response) == expected


def test_extract_unique_id_returns_none_when_absent():
    assert bonds.extract_unique_id({"response": {"status": "success"}}) is None


def test_extract_unique_id_handles_missing_response_key():
    assert bonds.extract_unique_id({"status": "success"}) is None


# ── Integration tests — hit the live API ─────────────────────────────────────
#
# Skip cleanly (rather than fail) if no API key is configured, so this
# suite doesn't break for anyone running it without .env set up.

pytestmark = pytest.mark.skipif(not bonds.API_KEY, reason="RHODEX_API_KEY not set in .env")


@pytest.fixture
def fresh_bond_id():
    """Creates one real bond record and returns its unique id."""
    payload = bonds.build_bond_payload(
        cedant="Test Suite Cedant",
        description="Created by test_bonds.py — safe to ignore/delete.",
        maturity="2027-01-01",
        value=1,
    )
    resp = bonds.create_bond(payload)
    unique_id = bonds.extract_unique_id(resp)
    assert unique_id, f"create_bond didn't return a usable id: {resp}"
    return unique_id


def test_create_bond_returns_a_usable_id(fresh_bond_id):
    assert isinstance(fresh_bond_id, str)
    assert len(fresh_bond_id) > 0


def test_link_contract_address_round_trips(fresh_bond_id):
    fake_address = "0x" + secrets.token_hex(20)

    link_resp = bonds.link_contract_address(fresh_bond_id, fake_address)
    assert link_resp.get("status") == "success"

    read_back = bonds.get_bond(fresh_bond_id)
    stored_address = read_back.get("response", {}).get("bond", {}).get("contract-address")
    assert stored_address == fake_address


def test_update_bond_status_round_trips(fresh_bond_id):
    resp = bonds.update_bond_status(fresh_bond_id, bonds.STATUS_TRIGGERED)
    assert resp.get("status") == "success"

    read_back = bonds.get_bond(fresh_bond_id)
    bond = read_back.get("response", {}).get("bond", {})
    # Read-side field is spelled "status-triggered" (correctly) even
    # though the write-side param is "status-tiggered" — see bonds.py's
    # module docstring.
    assert bond.get("status-triggered") == bonds.STATUS_TRIGGERED


def test_get_bond_reflects_created_fields(fresh_bond_id):
    read_back = bonds.get_bond(fresh_bond_id)
    bond = read_back.get("response", {}).get("bond", {})
    assert bond.get("cedant") == "Test Suite Cedant"
    assert bond.get("value") == 1


def test_get_bond_on_unknown_id_returns_empty_not_an_error():
    resp = bonds.get_bond("this-id-does-not-exist-" + secrets.token_hex(4))
    assert resp.get("status") == "success"
    assert resp.get("response", {}).get("bond") == {}


def test_full_lifecycle_end_to_end():
    """Mirrors bonds.py's __main__ flow as a single assertive test."""
    bond = bonds.build_bond_payload(
        cedant="Lifecycle Test Co",
        description="Full create -> link -> status -> read cycle.",
        maturity="2027-06-30",
        value=250_000,
    )
    create_resp = bonds.create_bond(bond)
    unique_id = bonds.extract_unique_id(create_resp)
    assert unique_id

    fake_address = "0x" + secrets.token_hex(20)
    assert bonds.link_contract_address(unique_id, fake_address).get("status") == "success"
    assert bonds.update_bond_status(unique_id, bonds.STATUS_MATURED).get("status") == "success"

    final = bonds.get_bond(unique_id).get("response", {}).get("bond", {})
    assert final.get("contract-address") == fake_address
    assert final.get("status-triggered") == bonds.STATUS_MATURED
    assert final.get("cedant") == "Lifecycle Test Co"
    assert final.get("value") == 250_000
