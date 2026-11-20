// Every network the UI knows about, keyed by CAIP-2 id (DEAL001/PLAN-multichain-ui.md §2.5).
//
// `environment` is never typed by hand anywhere else: Supabase rows copy it
// from here (Phase E), which is what lets `environment = 'local'` clean up
// every throwaway local deal on both chains.
//
// Solana localnet is only listed while DEAL001's `npm run localnet` has
// written solana/localnet.json (gitignored, regenerated every run, so its
// genesis-hash id and addresses always match the running validator).

import { FAMILY } from './types'
import { CANONICAL_TRIGGERS, LOCAL_RDX_TOKEN, RHODEX_COMPANY_WALLET, TESTNET_USDC } from '../constants/abis'

const localSolana = Object.values(
  import.meta.glob('./solana/localnet.json', { eager: true, import: 'default' }),
)[0]

const CAT_BOND_PROGRAM_ID = '3UQzswu1vGu8DoGAttWtWRm3zFvCSvreoG7HDohTqxAj'

/**
 * @typedef {object} NetworkConfig
 * @property {string} id            CAIP-2 chain id (local ids carry a per-run suffix)
 * @property {'evm'|'solana'} family
 * @property {'local'|'testnet'|'mainnet'} environment
 * @property {string} label
 * @property {string} rpcUrl
 * @property {string} [walletChain] Wallet Standard chain name (Solana), e.g. 'solana:devnet'
 * @property {number} [chainId]     EVM chain id
 * @property {string} [programId]   cat_bond program (Solana)
 * @property {string} [mint]        default collateral token
 * @property {{economic?: string, industry?: string}} triggers  canonical triggers
 * @property {string} [companyWallet]
 */

/** @type {NetworkConfig[]} */
export const NETWORKS = [
  // ── EVM ── (ids for real chains are fixed; anvil's gets a per-run suffix in Phase E)
  {
    id: 'eip155:31337', family: FAMILY.EVM, environment: 'local', label: 'Anvil (local)',
    chainId: 31337, rpcUrl: 'http://127.0.0.1:8545',
    mint: LOCAL_RDX_TOKEN, triggers: CANONICAL_TRIGGERS, companyWallet: RHODEX_COMPANY_WALLET,
  },
  {
    id: 'eip155:11155111', family: FAMILY.EVM, environment: 'testnet', label: 'Sepolia',
    chainId: 11155111, rpcUrl: '', mint: TESTNET_USDC['Sepolia'], triggers: {},
  },
  {
    id: 'eip155:84532', family: FAMILY.EVM, environment: 'testnet', label: 'Base Sepolia',
    chainId: 84532, rpcUrl: '', mint: TESTNET_USDC['Base Sepolia'], triggers: {},
  },
  {
    id: 'eip155:421614', family: FAMILY.EVM, environment: 'testnet', label: 'Arbitrum Sepolia',
    chainId: 421614, rpcUrl: '', mint: TESTNET_USDC['Arbitrum Sepolia'], triggers: {},
  },

  // ── Solana ──
  ...(localSolana ? [{
    id: localSolana.network, family: FAMILY.SOLANA, environment: 'local', label: 'Solana localnet',
    rpcUrl: localSolana.rpcUrl, walletChain: 'solana:localnet',
    programId: localSolana.programId, mint: localSolana.mint,
    triggers: localSolana.triggers, companyWallet: localSolana.companyWallet,
    bonds: localSolana.bonds,
  }] : []),
  {
    id: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', family: FAMILY.SOLANA, environment: 'testnet',
    label: 'Solana devnet', rpcUrl: 'https://api.devnet.solana.com', walletChain: 'solana:devnet',
    programId: CAT_BOND_PROGRAM_ID,
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',   // Circle devnet USDC (plan §7.2)
    triggers: {},                                          // created at devnet deploy (Phase F)
  },
]

export const networkById = (id) => NETWORKS.find(n => n.id === id) ?? null

/**
 * The network a bond is assumed to be on when only its address is known
 * (e.g. pasted into /deal). Solana: localnet while it's running, else devnet.
 * EVM keeps using the wallet's current chain until Phase E.
 */
export function defaultNetwork(family) {
  if (family === FAMILY.SOLANA) {
    return NETWORKS.find(n => n.family === FAMILY.SOLANA && n.environment === 'local')
      ?? NETWORKS.find(n => n.family === FAMILY.SOLANA)
  }
  return null
}
