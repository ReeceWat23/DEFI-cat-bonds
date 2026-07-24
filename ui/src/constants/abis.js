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

export const TESTNET_USDC = {
  'Sepolia': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  'Base Sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'Arbitrum Sepolia': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
}
