"""
Posting handshake orchestrator — Deal Page: Dynamic Data v2, §3.3.

Posting a deal is two writes across two systems (the web2 Deal store and
the chain). This script does the sequence in order and verifies the link
actually landed, rather than trusting a deploy receipt:

  1. Create a draft Bond record in the web2 Deal store (bonds.create_bond)
     -> dealId.
  2. Deploy CatBond via `forge script Setup.s.sol --broadcast`, with the
     DEAL_ID env var set so the contract embeds that same id — the
     bidirectional link. If step 3/4 below ever fails partway, the id
     embedded on-chain is what makes the deal recoverable rather than
     orphaned.
  3. Parse the deployed CatBond's address out of Foundry's broadcast
     artifact (not stdout — structured, not regex-fragile).
  4. Link that address back onto the Bond record (bonds.link_contract_address).
  5. Verify: read the deployed contract's dealId/sellerName back over RPC
     and confirm they match. A successful transaction proves the write
     happened, not that it landed where expected — this is the actual
     check, not an echo of the input constants.

Deal-specific content (which sponsor, what description, what value) is
NOT hardcoded here — this script is generic across deals. It's loaded
from a fixture JSON file passed as the first argument, e.g.
`DEAL 000/fixture.json`:
    {"cedant": "...", "description": "...", "maturity": "YYYY-MM-DD", "value": 500000}

Usage:
    python3 api/deploy_deal.py <fixture.json> [quick]

Requires anvil already running on 127.0.0.1:8545 (run.sh starts it before
calling this).
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bonds  # noqa: E402

DEAL_000_DIR = os.path.join(os.path.dirname(__file__), "..", "DEAL 000")
RPC_URL = "http://127.0.0.1:8545"
DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"


def load_fixture(fixture_path: str) -> dict:
    with open(fixture_path) as f:
        return json.load(f)


def run_forge_script(scenario: str, deal_id: str) -> None:
    env = os.environ.copy()
    env["QUICK"] = "1" if scenario == "quick" else "0"
    env["DEAL_ID"] = deal_id
    cmd = [
        "forge", "script", "script/Setup.s.sol:Setup",
        "--rpc-url", RPC_URL,
        "--broadcast",
        "--private-key", DEPLOYER_PK,
        "-vv",
    ]
    subprocess.run(cmd, cwd=DEAL_000_DIR, env=env, check=True)


def find_deployed_catbond_address() -> str:
    """
    Read the address of the CatBond CREATE out of Foundry's own broadcast
    artifact for the run that just happened — structured ground truth,
    not something parsed out of console output.
    """
    broadcast_path = os.path.join(DEAL_000_DIR, "broadcast", "Setup.s.sol", "31337", "run-latest.json")
    with open(broadcast_path) as f:
        data = json.load(f)
    for tx in data["transactions"]:
        if tx.get("transactionType") == "CREATE" and tx.get("contractName") == "CatBond":
            return tx["contractAddress"]
    raise RuntimeError(f"No CatBond deployment found in {broadcast_path}")


def cast_call_string(address: str, signature: str) -> str:
    result = subprocess.run(
        ["cast", "call", address, signature, "--rpc-url", RPC_URL],
        capture_output=True, text=True, check=True,
    )
    # `cast call ...(string)` returns the decoded string, quoted.
    return result.stdout.strip().strip('"')


def main():
    if len(sys.argv) < 2:
        raise SystemExit(f"Usage: python3 {sys.argv[0]} <fixture.json> [quick]")
    fixture_path = sys.argv[1]
    scenario = sys.argv[2] if len(sys.argv) > 2 else "default"

    print("── 1. Create draft bond record (web2) ──────────────────")
    fixture = load_fixture(fixture_path)
    payload = bonds.build_bond_payload(
        cedant=fixture["cedant"],
        description=fixture["description"],
        maturity=fixture["maturity"],
        value=fixture["value"],
    )
    create_resp = bonds.create_bond(payload)
    deal_id = bonds.extract_unique_id(create_resp)
    if not deal_id:
        raise SystemExit(f"create_bond didn't return a usable id: {create_resp}")
    print(f"dealId: {deal_id}")

    print("\n── 2. Deploy CatBond with dealId embedded ───────────────")
    run_forge_script(scenario, deal_id)

    print("\n── 3. Locate deployed CatBond address ───────────────────")
    bond_address = find_deployed_catbond_address()
    print(f"CatBond address: {bond_address}")

    print("\n── 4. Link address back onto the bond record (web2) ─────")
    link_resp = bonds.link_contract_address(deal_id, bond_address)
    print(json.dumps(link_resp, indent=2))

    print("\n── 5. Verify: read the deployed contract back ───────────")
    onchain_deal_id = cast_call_string(bond_address, "dealId()(string)")
    onchain_seller_name = cast_call_string(bond_address, "sellerName()(string)")
    print(f"Contract dealId:     {onchain_deal_id}")
    print(f"Contract sellerName: {onchain_seller_name}")

    if onchain_deal_id != deal_id:
        raise SystemExit(
            f"VERIFICATION FAILED: contract dealId {onchain_deal_id!r} != web2 dealId {deal_id!r}"
        )

    print("\nVerification passed — dealId embedded on-chain matches the web2 record.")
    print(f"\nDeal {deal_id}  <->  CatBond {bond_address}")


if __name__ == "__main__":
    main()
