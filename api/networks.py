"""
Network ids for bond rows (DEAL001/PLAN-multichain-ui.md §2.5).

Every rpos row stores a CAIP-2 chain id in `network`. Real chains have fixed
ids; local chains get a per-run id so a fresh chain's reused addresses never
collide with rows from the last run:

    anvil                   eip155:31337:<first 16 hex of the block-0 hash>
    solana-test-validator   solana:<first 32 chars of the genesis hash>

Anvil's block 0 includes its start time, so it changes every run. The
browser computes the same ids (ui/src/chains/), so rows written by scripts
and by the UI agree.
"""

import requests

ANVIL_CHAIN_ID = 31337


def _rpc(url: str, method: str, params: list | None = None):
    resp = requests.post(url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []},
                         timeout=10)
    resp.raise_for_status()
    body = resp.json()
    if "error" in body:
        raise RuntimeError(f"{method} on {url}: {body['error']}")
    return body["result"]


def evm_network_id(rpc_url: str) -> str:
    """CAIP-2 id of the EVM chain at rpc_url, with the per-run suffix on anvil."""
    chain_id = int(_rpc(rpc_url, "eth_chainId"), 16)
    if chain_id != ANVIL_CHAIN_ID:
        return f"eip155:{chain_id}"
    block0 = _rpc(rpc_url, "eth_getBlockByNumber", ["0x0", False])
    return f"eip155:{chain_id}:{block0['hash'][2:18]}"


def solana_network_id(rpc_url: str) -> str:
    """CAIP-2 id of the Solana cluster at rpc_url (unique per local validator run)."""
    return f"solana:{_rpc(rpc_url, 'getGenesisHash')[:32]}"
