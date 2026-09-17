"""
Tests for the testable half of report_trigger.py: compare() (pure) and
build_report_payload() (reads the monitor's store). The CLI wrapper
(report()) shells out to `cast`/anvil and isn't covered here — same
boundary test_monitor.py draws around live network calls.
"""

import pytest

from monitor import store
from report_trigger import build_report_payload, compare


def test_compare_at_above_below_threshold():
    assert compare(100, 100) is True
    assert compare(101, 100) is True
    assert compare(99, 100) is False


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "test.db")


def test_build_report_payload_uses_latest_successful_entry(db_path):
    store.record_entry("natcat_loss", 2, "economic_loss", value=100.0, http_status=200, raw_response_hash="a" * 64, db_path=db_path)
    store.record_entry("natcat_loss", 2, "economic_loss", value=200.0, http_status=200, raw_response_hash="b" * 64, db_path=db_path)

    payload = build_report_payload("natcat_loss", 2, "economic_loss", db_path=db_path)
    # units=usd_billions -> on-chain integer is billions * 1e9, matching
    # every other corner of this codebase's "usd_billions" convention.
    assert payload["value"] == 200_000_000_000
    assert payload["monitor_ref"] == "0x" + "b" * 64


def test_build_report_payload_skips_failed_entries(db_path):
    store.record_entry("natcat_loss", 2, "economic_loss", value=100.0, http_status=200, raw_response_hash="a" * 64, db_path=db_path)
    store.record_entry("natcat_loss", 2, "economic_loss", value=None, http_status=500, raw_response_hash=None, error="boom", db_path=db_path)

    payload = build_report_payload("natcat_loss", 2, "economic_loss", db_path=db_path)
    assert payload["value"] == 100_000_000_000  # the failed entry is skipped, not treated as "latest"


def test_build_report_payload_raises_when_nothing_successful(db_path):
    store.record_entry("natcat_loss", 2, "economic_loss", value=None, http_status=500, raw_response_hash=None, error="boom", db_path=db_path)
    with pytest.raises(RuntimeError, match="no successful monitor entry"):
        build_report_payload("natcat_loss", 2, "economic_loss", db_path=db_path)


def test_build_report_payload_raises_when_empty(db_path):
    with pytest.raises(RuntimeError, match="no successful monitor entry"):
        build_report_payload("natcat_loss", 2, "economic_loss", db_path=db_path)


def test_monitor_ref_is_exactly_32_bytes(db_path):
    store.record_entry("natcat_loss", 2, "economic_loss", value=1.0, http_status=200, raw_response_hash="c" * 64, db_path=db_path)
    payload = build_report_payload("natcat_loss", 2, "economic_loss", db_path=db_path)
    # "0x" + 64 hex chars = 32 bytes — must fit bytes32 exactly, no truncation/padding.
    assert len(payload["monitor_ref"]) == 66
    assert bytes.fromhex(payload["monitor_ref"][2:])
