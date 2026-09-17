"""
Generic trigger-reporting helpers (sprint plan `api/it3_plan_triggers_n_mgmnt.md`
§2.6). Reworked from the pre-sprint version, which read a trigger's own
`dealType()`/`lossLimit()` and called `natcat_loss.py` directly at report
time. Neither exists anymore: `dealType`/`lossLimit` were removed from the
trigger in §2.4 (the trigger's `productConfig.valuePath` encodes the same
choice now, and the threshold moved to the bond), and every report must now
be traceable to a specific monitor-buffer entry rather than a live API call
made at the moment of reporting (§2.3).

Two pieces, meant to be used independently:

  compare(value, threshold) -> bool
      The one comparison rule every settlement path uses. A pure function —
      no I/O, easy to reuse anywhere a "does this value clear this bond's
      threshold" question comes up (e.g. building a UI hint).

  build_report_payload(product_id, metric) -> dict
      Pulls the latest *successful* monitor-buffer entry for a product's
      metric and shapes it into what a trigger's postReport(value,
      monitorRef) needs. Raises if there's nothing successful to report
      from — never fabricates a value. This is the one place a report's
      value comes from; nothing here calls a live API.

The module's `__main__` CLI (`report(trigger_address, ...)`) is the
dev/local-anvil convenience wrapper used by `DEAL 000/run-insured-test.sh`:
it resolves which product/metric a trigger reports on by reading its
on-chain `productConfig()`, makes sure the monitor has polled at least once,
builds the payload, and posts it via `cast send` (impersonation-based,
anvil-only — see deploy_deal.py for the same pattern). On any real network
this posting step would be the admin UI's own signed `postReport()`
transaction instead, not this script.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from monitor import scheduler, store  # noqa: E402
from products import registry  # noqa: E402

DEFAULT_RPC = "http://127.0.0.1:8545"
DEFAULT_COMPANY = "0xE1ea925Bc3Ef4706ca6a22E72FC83828098377B9"  # DEAL 000's COMPANY constant


def compare(value: int, threshold: int) -> bool:
    """The one comparison rule every settlement path uses: value >= threshold."""
    return value >= threshold


# On-chain values are always a plain integer, never a decimal — every other
# corner of this codebase (AdminPage's Post Report input, formatUSDWhole,
# CatBond's threshold) treats "usd_billions" as "multiply by 1e9 to get the
# on-chain integer". The monitor buffer stores the raw float straight off
# the API (e.g. 46.0 meaning $46B) — un-scaled. This is the one place that
# gap gets closed, right before the value becomes postReport()'s argument.
_ONCHAIN_SCALE = {"usd_billions": 1_000_000_000}


def build_report_payload(product_id: str, version: int, metric: str, db_path: str | None = None) -> dict:
    """
    Shape the latest successful monitor entry for (product_id, metric) into
    what postReport(value, monitorRef) needs.

    Raises RuntimeError if there's no successful entry — a monitor that's
    never run, or has only ever failed, has nothing to report and this
    never invents a value to fill the gap.
    """
    entry = store.latest_successful_entry(product_id, metric, db_path=db_path)
    if entry is None:
        raise RuntimeError(
            f"no successful monitor entry for {product_id}.{metric} — "
            "run the monitor (scheduler.poll_all_active_products()) first"
        )
    units = registry.get(product_id, version)["units"]
    if units not in _ONCHAIN_SCALE:
        raise RuntimeError(f"no on-chain scale defined for units {units!r} ({product_id} v{version})")
    return {
        "value": round(entry["value"] * _ONCHAIN_SCALE[units]),
        # The monitor's raw_response_hash is already a 32-byte sha256 hex
        # digest — exactly what bytes32 needs, no reshaping required.
        "monitor_ref": "0x" + entry["raw_response_hash"],
        "monitor_entry_id": entry["id"],
        "fetched_at": entry["fetched_at"],
    }


# ── Dev/local-anvil CLI wrapper ──────────────────────────────────────────

def _metric_for_trigger(trigger_address: str, rpc: str) -> tuple[str, int, str]:
    """
    Read a deployed trigger's on-chain productConfig() and match its
    valuePath back against the registry to find which product + metric it
    reports on. Lets this script work from just a trigger address, the
    same CLI shape the pre-sprint version had.

    Uses `cast call --json` rather than parsing the default human-readable
    output: cast's text mode wraps every string in its own display quotes
    and backslash-escapes any quotes *inside* the value (e.g. valuePath is
    literally `response.reports."economic-loss | total"` — it has embedded
    quotes). A naive `.strip('"')` on that text leaves stray backslashes
    behind instead of the real string, so the registry lookup below never
    matches. `--json` emits a real JSON array, which `json.loads` decodes
    correctly regardless of what characters are inside the strings.
    """
    raw = subprocess.run(
        ["cast", "call", trigger_address,
         "productConfig()(string,uint256,string,string,uint256,bytes32)",
         "--rpc-url", rpc, "--json"],
        capture_output=True, text=True, check=True,
    ).stdout

    product_id, version, value_path, *_ = json.loads(raw)
    version = int(version)

    product = registry.get(product_id, version)
    for metric, path in product["value_paths"].items():
        # path is a single string, or a fallback chain (list) — the
        # on-chain snapshot always stores the chain's primary (first)
        # entry as its identifying valuePath, so match against either shape.
        candidates = path if isinstance(path, list) else [path]
        if value_path in candidates:
            return product_id, version, metric
    raise RuntimeError(f"no metric on {product_id} v{version} matches on-chain valuePath {value_path!r}")


def report(trigger_address: str, rpc: str = DEFAULT_RPC, company: str = DEFAULT_COMPANY) -> dict:
    """
    Resolve which product/metric `trigger_address` reports on, make sure
    the monitor has polled it at least once, then post the latest
    successful entry via an impersonated `cast send` (anvil dev-only).

    Deliberately does not report whether any particular bond is
    "triggered" — that's threshold-dependent, and a trigger can now back
    multiple bonds at different thresholds (§2.5). Call a bond's own
    checkTrigger() (or read its lastCheck) for that.
    """
    product_id, version, metric = _metric_for_trigger(trigger_address, rpc)

    # The monitor is the only thing that calls the live API (§2.3) — this
    # script never does, it only ensures the buffer is current before
    # reading from it.
    scheduler.poll_all_active_products()

    payload = build_report_payload(product_id, version, metric)

    subprocess.run(["cast", "rpc", "anvil_impersonateAccount", company, "--rpc-url", rpc],
                    check=True, capture_output=True)
    try:
        subprocess.run(
            ["cast", "send", trigger_address, "postReport(uint256,bytes32)",
             str(payload["value"]), payload["monitor_ref"],
             "--from", company, "--unlocked", "--rpc-url", rpc],
            check=True, capture_output=True, text=True,
        )
    finally:
        subprocess.run(["cast", "rpc", "anvil_stopImpersonatingAccount", company, "--rpc-url", rpc],
                        check=True, capture_output=True)

    payload["product_id"] = product_id
    payload["metric"] = metric
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trigger_address")
    parser.add_argument("--rpc", default=DEFAULT_RPC)
    parser.add_argument("--company", default=DEFAULT_COMPANY)
    args = parser.parse_args()

    result = report(args.trigger_address, args.rpc, args.company)
    print(json.dumps(result, indent=2))
    print()
    print(f"Reported ${int(result['value']) / 1e9}B for {result['product_id']}.{result['metric']} "
          f"(monitor entry #{result['monitor_entry_id']}, fetched {result['fetched_at']}).")
