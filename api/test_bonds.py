"""
Tests for bonds.py.

Unit tests stub out HTTP. The live round-trip test runs only when
SUPABASE_URL plus a service/secret key are in the environment, and it
creates and then deletes one real row in public.rpos.

Run: pytest api/test_bonds.py -v
"""

import os
import secrets

import pytest
import requests

import bonds


class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.ok = status < 400
        self.content = b"x" if payload is not None else b""
        self.text = str(payload)

    def json(self):
        return self._payload


@pytest.fixture
def captured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "eyJfake")
    calls = []
    responses = []

    def fake_request(method, url, **kw):
        calls.append({"method": method, "url": url, **kw})
        return responses.pop(0)

    monkeypatch.setattr(bonds.requests, "request", fake_request)
    return calls, responses


# ── payload ───────────────────────────────────────────────────────────────────

def test_payload_blanks_become_null_and_defaults_to_natcat():
    p = bonds.build_bond_payload(cedant="Acme", value=100)
    assert set(p) == set(bonds.WRITABLE_COLUMNS)
    assert p["maturity"] is None            # "" would be rejected by the date column
    assert p["contract_address"] is None    # "" would collide on the UNIQUE constraint
    assert p["trigger_type"] == "natcat"
    assert p["status_triggered"] == bonds.STATUS_OK


def test_payload_rejects_bad_status():
    with pytest.raises(ValueError):
        bonds.build_bond_payload(status_triggered=7)


def test_payload_rejects_unknown_environment():
    with pytest.raises(ValueError, match="environment"):
        bonds.build_bond_payload(network="eip155:1", environment="prod")


def test_create_requires_network_and_environment():
    with pytest.raises(ValueError, match="network and environment"):
        bonds.create_bond(bonds.build_bond_payload(cedant="Acme"))
    with pytest.raises(ValueError, match="environment"):
        bonds.create_bond(bonds.build_bond_payload(cedant="Acme", network="eip155:1"))


def test_create_rejects_unknown_fields():
    with pytest.raises(ValueError):
        bonds.create_bond({"contract-address": "0xabc"})  # hyphenated name, not a column


# ── headers / config ────────────────────────────────────────────────────────

def test_jwt_key_sends_bearer_but_secret_key_does_not():
    assert bonds._headers("eyJabc")["Authorization"] == "Bearer eyJabc"
    assert "Authorization" not in bonds._headers("sb_secret_abc")
    assert bonds._headers("sb_secret_abc")["apikey"] == "sb_secret_abc"


def test_missing_config_raises(monkeypatch):
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(EnvironmentError):
        bonds.get_bond(1)


# ── requests sent ────────────────────────────────────────────────────────────

def test_create_posts_and_returns_row(captured):
    calls, responses = captured
    responses.append(_FakeResp([{"id": 42, "cedant": "Acme"}], 201))
    row = bonds.create_bond(bonds.build_bond_payload(cedant="Acme", network="eip155:84532",
                                                     environment="testnet"))
    assert row["id"] == 42
    c = calls[0]
    assert c["method"] == "POST"
    assert c["url"] == "https://example.supabase.co/rest/v1/rpos"
    assert c["headers"]["Prefer"] == "return=representation"


def test_link_patches_by_id_accepting_string_id(captured):
    calls, responses = captured
    responses.append(_FakeResp([{"id": 42, "contract_address": "0xabc"}]))
    bonds.link_contract_address("42", "0xabc")
    assert calls[0]["method"] == "PATCH"
    assert calls[0]["params"] == {"id": "eq.42"}
    assert calls[0]["json"] == {"contract_address": "0xabc"}


def test_link_includes_trigger_details_when_given(captured):
    calls, responses = captured
    responses.append(_FakeResp([{"id": 42}]))
    bonds.link_contract_address(42, "0xbond", trigger_address="0xtrig",
                                product_id="natcat_loss", product_version="3")
    assert calls[0]["json"] == {"contract_address": "0xbond", "trigger_address": "0xtrig",
                                "product_id": "natcat_loss", "product_version": 3}


def test_link_can_set_network(captured):
    calls, responses = captured
    responses.append(_FakeResp([{"id": 42}]))
    bonds.link_contract_address(42, "BondPda111", network="solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")
    assert calls[0]["json"] == {"contract_address": "BondPda111",
                                "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"}


def test_list_filters_by_environment_and_network(captured):
    calls, responses = captured
    responses.append(_FakeResp([]))
    bonds.list_bonds("natcat", environment="testnet", network="eip155:84532")
    p = calls[0]["params"]
    assert (p["environment"], p["network"]) == ("eq.testnet", "eq.eip155:84532")


def test_clear_local_bonds_is_scoped_to_local_and_one_family(captured):
    calls, responses = captured
    responses.append(_FakeResp([{"id": 1}]))
    assert bonds.clear_local_bonds("eip155:31337:", keep_network="eip155:31337:abc") == [{"id": 1}]
    c = calls[0]
    assert c["method"] == "DELETE"
    assert c["params"] == {"environment": "eq.local",
                           "and": "(network.like.eip155:31337:*,network.neq.eip155:31337:abc)"}
    with pytest.raises(ValueError):
        bonds.clear_local_bonds("")


def test_link_leaves_unset_trigger_details_untouched(captured):
    calls, responses = captured
    responses.append(_FakeResp([{"id": 42}]))
    bonds.link_contract_address(42, "0xbond", trigger_address="", product_id=None)
    assert calls[0]["json"] == {"contract_address": "0xbond"}


def test_get_missing_bond_raises_not_found(captured):
    _, responses = captured
    responses.append(_FakeResp([]))
    with pytest.raises(bonds.BondNotFound):
        bonds.get_bond(999)


def test_list_filters_by_trigger_type(captured):
    calls, responses = captured
    responses.append(_FakeResp([]))
    assert bonds.list_bonds("natcat") == []
    assert calls[0]["params"]["trigger_type"] == "eq.natcat"


def test_http_error_surfaces_postgrest_message(captured):
    _, responses = captured
    responses.append(_FakeResp({"message": "violates check constraint"}, 400))
    with pytest.raises(requests.HTTPError, match="check constraint"):
        bonds.update_bond_status(1, bonds.STATUS_OK)


# ── live round-trip ──────────────────────────────────────────────────────────

_live = bool(os.environ.get("SUPABASE_URL") and
             (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY")))


@pytest.mark.skipif(not _live, reason="Supabase credentials not in env")
def test_live_round_trip():
    network = "eip155:31337:pytest" + secrets.token_hex(4)
    row = bonds.create_bond(bonds.build_bond_payload(
        cedant="pytest", description="throwaway", maturity="2027-01-01", value=1,
        network=network, environment="local"))
    try:
        addr = "0x" + secrets.token_hex(20)
        bonds.link_contract_address(row["id"], addr, trigger_address="0xtrig",
                                    product_id="natcat_loss", product_version=3)
        bonds.update_bond_status(row["id"], bonds.STATUS_TRIGGERED)
        got = bonds.get_bond(str(row["id"]))
        assert got["contract_address"] == addr
        assert (got["trigger_address"], got["product_id"], got["product_version"]) == ("0xtrig", "natcat_loss", 3)
        assert got["status_triggered"] == bonds.STATUS_TRIGGERED
        assert str(got["maturity"]) == "2027-01-01"
        assert any(b["id"] == row["id"] for b in bonds.list_bonds("natcat"))
        assert (got["network"], got["environment"]) == (network, "local")
        assert [b["id"] for b in bonds.list_bonds("natcat", network=network)] == [row["id"]]

        # The same address may exist on another network (anvil reuses
        # addresses every run); only (network, address) must be unique.
        other = bonds.create_bond(bonds.build_bond_payload(
            cedant="pytest", value=1, network=network + "x", environment="local"))
        try:
            bonds.link_contract_address(other["id"], addr)
        finally:
            bonds._request("DELETE", params={"id": f"eq.{other['id']}"})
    finally:
        bonds._request("DELETE", params={"id": f"eq.{row['id']}"})
