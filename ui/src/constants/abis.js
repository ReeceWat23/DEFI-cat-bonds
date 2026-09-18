import CatBondArtifact from '../artifacts/CatBond.json'
import ManualTriggerArtifact from '../artifacts/ManualTrigger.json'

export const CATBOND_ABI = CatBondArtifact.abi
export const CATBOND_BYTECODE = CatBondArtifact.bytecode.object

export const TRIGGER_ABI = ManualTriggerArtifact.abi
export const TRIGGER_BYTECODE = ManualTriggerArtifact.bytecode.object

export const ERC20_ABI = [
  {
    type: 'function', name: 'approve',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable',
  },
  {
    type: 'function', name: 'allowance',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view',
  },
  {
    type: 'function', name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view',
  },
]

// The company/trigger-owner wallet — the only address ever authorized to
// call report()/setTriggered() on a Trigger contract, and CatBond's
// _companyWallet. Must never be the seller's own connected wallet: that
// would let a seller self-report a loss and trigger their own payout.
export const RHODEX_COMPANY_WALLET = '0xE1ea925Bc3Ef4706ca6a22E72FC83828098377B9'

export const TESTNET_USDC = {
  'Sepolia': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'Base Sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'Arbitrum Sepolia': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
}

// The RDX test token from `DEAL 000/script/Setup.s.sol`, deployed against
// the currently-running local anvil (chain id 31337). Unlike the testnet
// presets above, this address only works while that specific anvil process
// is alive — a fresh `run.sh` or a restarted anvil deploys RDX to a new
// address (deterministic per-anvil, but not stable across restarts), so
// update this after re-running the fixture. ANVIL/LOCAL ONLY.
export const LOCAL_RDX_TOKEN = '0x8a791620dd6260079bf849dc5567adc3f2fdc318'

// One canonical, already-deployed public trigger per deal type — reported
// to by the company wallet, shared by every public bond of that type,
// rather than every "Post deal" deploying (and needing to independently
// keep fresh) its own trigger. This is the whole "Select trigger" step
// from the sprint plan (§2.6): with only two possible public choices, the
// existing Deal Type dropdown already *is* trigger selection — no registry
// enumerating "every trigger ever deployed" is needed for that.
//
// TESTNET/ANVIL ONLY — these are local chain-id-31337 addresses. Like
// LOCAL_RDX_TOKEN above, these only resolve while the specific anvil
// process they were deployed against stays alive — anvil restarts wipe
// state, so a dead "InvalidTrigger()" revert on Post deal almost always
// means these are stale and need redeploying (DEAL 000/script/Setup.s.sol,
// TRIGGER_TYPE=1 for economic / 0 for industry) and pasting back in here.
// Redeploy and replace before any real network launch, the same way
// RHODEX_COMPANY_WALLET above is a placeholder to replace.
export const CANONICAL_TRIGGERS = {
  economic: '0x4A679253410272dd5232B3Ff7cF5dbB88f295319',
  industry: '0x959922bE3CAee4b8Cd9a407cc3ac1C251C2007B1',
}
