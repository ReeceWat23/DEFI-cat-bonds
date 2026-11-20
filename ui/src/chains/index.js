// Chain-neutral entry point. Pages import from here, never from wagmi or a
// Solana library directly (DEAL001/PLAN-multichain-ui.md §2).
//
// Every hook calls each family's hook unconditionally (rules of hooks) and
// passes null to the families the bond isn't on; the inactive ones do no
// network work. The Solana branch slots in alongside `evm` in Phase C.

import { FAMILY } from './types'
import {
  isEvmAddress, evmErrorName,
  useEvmWallet, useEvmBond, useEvmTrigger, useEvmPosition, useEvmActions,
} from './evm/adapter'

export { STATUS, FAMILY } from './types'

/** Families the UI can load bonds on. Solana is enabled in Phase C. */
export const ENABLED_FAMILIES = [FAMILY.EVM]

const ADDRESS_CHECKS = {
  [FAMILY.EVM]: isEvmAddress,
  // [FAMILY.SOLANA]: isSolanaAddress,   ← Phase C
}

/**
 * Turns a pasted address into a BondRef, or null if it isn't a valid address
 * on any enabled family.
 * @returns {import('./types').BondRef|null}
 */
export function makeBondRef(input, network = null) {
  const address = String(input ?? '').trim()
  for (const family of ENABLED_FAMILIES) {
    if (ADDRESS_CHECKS[family]?.(address)) return { family, network, address }
  }
  return null
}

const on = (ref, family) => (ref?.family === family ? ref : null)

/** The connected wallet for one chain family. */
export function useWallet(family = FAMILY.EVM) {
  const evm = useEvmWallet()
  return family === FAMILY.EVM ? evm : { address: undefined, isConnected: false, connect() {}, disconnect() {} }
}

/** @param {import('./types').BondRef|null} ref */
export function useBond(ref) {
  const evm = useEvmBond(on(ref, FAMILY.EVM))
  return evm
}

export function useBondTrigger(ref, triggerAddress) {
  const evm = useEvmTrigger(ref?.family === FAMILY.EVM ? triggerAddress : undefined)
  return evm
}

export function useBondPosition(ref, owner, mint) {
  const evm = useEvmPosition(on(ref, FAMILY.EVM), owner, mint)
  return evm
}

export function useBondActions(ref, mint) {
  const evm = useEvmActions(on(ref, FAMILY.EVM), mint)
  return evm
}

/**
 * Program/contract error name (e.g. 'NothingToClaim'). CatBond.sol and the
 * cat_bond program use the same names, so pages map them with one table.
 */
export function errorName(err) {
  return evmErrorName(err)
}
