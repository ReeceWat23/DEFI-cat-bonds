"""
Tests for api/products/ — schema validation and the registry.

Real product files under products/public/ are exercised directly (they're
part of the repo, not fixtures); duplicate/malformed/deprecated-version
scenarios are exercised against a temporary directory so they don't require
mutating the real registry to test failure paths.
"""

import json
import os

import pytest

from products import registry
from products.schema import validate, diff_versioned_fields, REQUIRED_FIELDS


VALID_DEF = {
    "product_id": "natcat_loss",
    "version": 1,
    "status": "active",
    "name": "RHODEX NatCat Loss — annual economic & industry loss",
    "endpoint": "https://example.com/api",
    "method": "POST",
    "auth": "SOME_API_KEY",
    "call_parameters": {"ALL": "yes"},
    "response_schema": {"type": "object"},
    "value_paths": {
        "economic_loss": "response.ALL-LOSSES[-1].\"economic-loss | total\"",
        "industry_loss": "response.ALL-LOSSES[-1].\"industry-loss | total\"",
    },
    "units": "usd_billions",
    "update_frequency": "quarterly",
    "max_report_age": 150,
    "data_source_description": "Test fixture.",
}


# ── schema.py ────────────────────────────────────────────────────────────

def test_valid_definition_has_no_errors():
    assert validate(VALID_DEF) == []


def test_missing_required_field_is_reported():
    for field in REQUIRED_FIELDS:
        bad = {k: v for k, v in VALID_DEF.items() if k != field}
        errors = validate(bad)
        assert any(field in e for e in errors), f"expected an error mentioning {field!r}, got {errors}"


def test_invalid_status_rejected():
    bad = {**VALID_DEF, "status": "sunset"}
    errors = validate(bad)
    assert any("status" in e for e in errors)


def test_non_positive_version_rejected():
    for bad_version in (0, -1, "1", 1.5, True):
        bad = {**VALID_DEF, "version": bad_version}
        errors = validate(bad)
        assert any("version" in e for e in errors), f"version={bad_version!r} should be rejected"


def test_endpoint_must_be_a_url():
    bad = {**VALID_DEF, "endpoint": "not-a-url"}
    errors = validate(bad)
    assert any("endpoint" in e for e in errors)


def test_value_paths_must_be_a_non_empty_object():
    for bad_value in ({}, "not-a-dict", ["a", "b"], None):
        bad = {**VALID_DEF, "value_paths": bad_value}
        errors = validate(bad)
        assert any("value_paths" in e for e in errors), f"value_paths={bad_value!r} should be rejected"


def test_value_paths_entry_must_be_a_non_empty_string():
    bad = {**VALID_DEF, "value_paths": {"economic_loss": ""}}
    errors = validate(bad)
    assert any("value_paths" in e for e in errors)


def test_value_paths_entry_may_be_a_fallback_chain_list():
    good = {**VALID_DEF, "value_paths": {"economic_loss": ["response.total", "response.q3", "response.q2"]}}
    assert validate(good) == []


def test_value_paths_fallback_chain_must_be_non_empty_list_of_strings():
    for bad_chain in ([], ["", "response.q2"], [1, 2], 42, None):
        bad = {**VALID_DEF, "value_paths": {"economic_loss": bad_chain}}
        errors = validate(bad)
        assert any("value_paths" in e for e in errors), f"chain={bad_chain!r} should be rejected"


def test_diff_versioned_fields_detects_change():
    v2 = {**VALID_DEF, "version": 2, "value_paths": {**VALID_DEF["value_paths"], "economic_loss": "response.something.else"}}
    assert diff_versioned_fields(VALID_DEF, v2) == ["value_paths"]


def test_diff_versioned_fields_ignores_non_versioned_change():
    v1_renamed = {**VALID_DEF, "name": "New name, same everything else"}
    assert diff_versioned_fields(VALID_DEF, v1_renamed) == []


# ── registry.py, against the real product files ─────────────────────────

def test_real_registry_loads_public_products():
    defs = registry.list_products(scope="public")
    ids = {d["product_id"] for d in defs}
    assert ids == {"natcat_loss"}


def test_real_registry_products_are_all_schema_valid():
    # Every file that exists must be well-formed, active or not — v1 is
    # deprecated (see natcat_loss.v1.json's own data_source_description)
    # but still has to load cleanly per the versioning rule (never delete).
    for d in registry.list_products(scope="public"):
        assert validate(d) == []


def test_real_registry_natcat_loss_v2_exposes_both_metrics_as_fallback_chains():
    d = registry.get("natcat_loss", 2)
    assert set(d["value_paths"].keys()) == {"economic_loss", "industry_loss"}
    for path in d["value_paths"].values():
        assert isinstance(path, list) and len(path) == 4  # total, Q3, Q2, Q1


def test_real_registry_get_latest_active_returns_v2_not_deprecated_v1():
    d = registry.get_latest_active("natcat_loss")
    assert d["version"] == 2
    assert d["product_id"] == "natcat_loss"
    assert d["status"] == "active"


def test_real_registry_v1_still_loads_but_is_deprecated():
    d = registry.get("natcat_loss", 1)
    assert d["status"] == "deprecated"


def test_real_registry_get_exact_version():
    d = registry.get("natcat_loss", 2)
    assert d["units"] == "usd_billions"


def test_real_registry_unknown_product_raises():
    with pytest.raises(registry.RegistryError):
        registry.get("nonexistent_product", 1)


# ── registry.py, failure paths against a temp scope ─────────────────────

@pytest.fixture
def temp_registry(tmp_path, monkeypatch):
    """Point the registry at an isolated temp directory instead of the real
    products/ folder, so duplicate/malformed/deprecated scenarios don't
    require touching real files."""
    (tmp_path / "public").mkdir()
    (tmp_path / "private").mkdir()
    monkeypatch.setattr(registry, "_PRODUCTS_DIR", str(tmp_path))
    return tmp_path


def _write(dir_path, filename, data):
    with open(os.path.join(dir_path, filename), "w") as f:
        json.dump(data, f)


def test_malformed_json_raises(temp_registry):
    with open(os.path.join(temp_registry, "public", "broken.json"), "w") as f:
        f.write("{not valid json")
    with pytest.raises(registry.RegistryError, match="invalid JSON"):
        registry.load_all()


def test_invalid_definition_raises(temp_registry):
    bad = {**VALID_DEF, "status": "sunset"}
    _write(temp_registry / "public", "bad.v1.json", bad)
    with pytest.raises(registry.RegistryError, match="invalid product definition"):
        registry.load_all()


def test_duplicate_version_across_files_raises(temp_registry):
    _write(temp_registry / "public", "a.v1.json", VALID_DEF)
    _write(temp_registry / "public", "b.v1.json", VALID_DEF)  # same product_id + version
    with pytest.raises(registry.RegistryError, match="duplicate product definition"):
        registry.load_all()


def test_duplicate_version_across_public_and_private_raises(temp_registry):
    _write(temp_registry / "public", "a.v1.json", VALID_DEF)
    _write(temp_registry / "private", "b.v1.json", VALID_DEF)
    with pytest.raises(registry.RegistryError, match="duplicate product definition"):
        registry.load_all()


def test_deprecated_version_not_offered_by_get_latest_active(temp_registry):
    v1_deprecated = {**VALID_DEF, "version": 1, "status": "deprecated"}
    v2_active = {**VALID_DEF, "version": 2, "status": "active", "value_paths": {"economic_loss": "response.new_path"}}
    _write(temp_registry / "public", "natcat_loss.v1.json", v1_deprecated)
    _write(temp_registry / "public", "natcat_loss.v2.json", v2_active)

    latest = registry.get_latest_active("natcat_loss")
    assert latest["version"] == 2

    deprecated = registry.list_products(status="deprecated")
    assert len(deprecated) == 1
    assert deprecated[0]["version"] == 1


def test_get_latest_active_raises_when_only_deprecated_exists(temp_registry):
    v1_deprecated = {**VALID_DEF, "version": 1, "status": "deprecated"}
    _write(temp_registry / "public", "natcat_loss.v1.json", v1_deprecated)
    with pytest.raises(registry.RegistryError, match="no active version"):
        registry.get_latest_active("natcat_loss")
