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

// One canonical, already-deployed public trigger per deal type — reported
// to by the company wallet, shared by every public bond of that type,
// rather than every "Post deal" deploying (and needing to independently
// keep fresh) its own trigger. This is the whole "Select trigger" step
// from the sprint plan (§2.6): with only two possible public choices, the
// existing Deal Type dropdown already *is* trigger selection — no registry
// enumerating "every trigger ever deployed" is needed for that.
//
// TESTNET/ANVIL ONLY — these are local chain-id-31337 addresses, deployed
// live during this session (DEAL 000/script/Setup.s.sol:Deal000Trigger,
// natcat_loss v2). Redeploy and replace before any real network launch,
// the same way RHODEX_COMPANY_WALLET above is a placeholder to replace.
export const CANONICAL_TRIGGERS = {
  economic: '0x593C66DBf77348920DA8C2c47d23390781a53656',
  industry: '0xC8615da9d2511b7B6fD0C07DFdC52005cA26ECEE',
}
