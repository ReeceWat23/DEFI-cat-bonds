// Chain-neutral entry point. Pages import from here, never from wagmi or a
// Solana library directly (DEAL001/PLAN-multichain-ui.md §2).
//
// Every hook calls each family's hook unconditionally (rules of hooks) and
// passes null to the families it isn't for; the inactive ones do no network
// work. The Solana branch slots in alongside `evm` in Phase C.

import { FAMILY } from './types'
import {
  isEvmAddress, sameEvmAddress, evmErrorName,
  useEvmWallet, useEvmBond, useEvmTrigger, useEvmTriggerHistory, useEvmPosition,
  useEvmActions, useEvmTriggerActions, useEvmCreateTrigger, useEvmCreateBond,
} from './evm/adapter'

export { STATUS, FAMILY } from './types'

/** Families the UI can load bonds on. Solana is enabled in Phase C. */
export const ENABLED_FAMILIES = [FAMILY.EVM]

const ADDRESS_CHECKS = {
  [FAMILY.EVM]: isEvmAddress,
  // [FAMILY.SOLANA]: isSolanaAddress,   ← Phase C
}

// ── Addresses ────────────────────────────────────────────────────────────────

/** Which enabled family an address belongs to, or null if it's not valid on any. */
export function addressFamily(input) {
  const address = String(input ?? '').trim()
  return ENABLED_FAMILIES.find(f => ADDRESS_CHECKS[f]?.(address)) ?? null
}

/** Is `input` a valid address — on `family` if given, else on any enabled family? */
export function isValidAddress(input, family) {
  const f = addressFamily(input)
  return f !== null && (family === undefined || f === family)
}

/**
 * Address equality. EVM hex is case-insensitive; Solana base58 is
 * case-sensitive, so never lower-case a non-hex address.
 */
export function sameAddress(a, b) {
  if (!a || !b) return false
  if (isEvmAddress(a) && isEvmAddress(b)) return sameEvmAddress(a, b)
  return a === b
}

/**
 * Turns a pasted address into a BondRef, or null if it isn't a valid address
 * on any enabled family.
 * @returns {import('./types').BondRef|null}
 */
export function makeBondRef(input, network = null) {
  const address = String(input ?? '').trim()
  const family = addressFamily(address)
  return family ? { family, network, address } : null
}

const on = (ref, family) => (ref?.family === family ? ref : null)
const onFamily = (family, wanted, value) => (family === wanted ? value : undefined)

// ── Wallet ───────────────────────────────────────────────────────────────────

/** The connected wallet for one chain family. */
export function useWallet(family = FAMILY.EVM) {
  const evm = useEvmWallet()
  return family === FAMILY.EVM ? evm : { address: undefined, isConnected: false, connect() {}, disconnect() {} }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** @param {import('./types').BondRef|null} ref */
export function useBond(ref) {
  const evm = useEvmBond(on(ref, FAMILY.EVM))
  return evm
}

/** @returns {{ trigger: import('./types').TriggerView|undefined, refetch: Function }} */
export function useTrigger(family, triggerAddress) {
  const evm = useEvmTrigger(onFamily(family, FAMILY.EVM, triggerAddress))
  return evm
}

/** Newest-first `{value, reportedAt}` list, up to `limit`, read only while `enabled`. */
export function useTriggerHistory(family, triggerAddress, reportCount, opts) {
  const evm = useEvmTriggerHistory(onFamily(family, FAMILY.EVM, triggerAddress), reportCount, opts)
  return evm
}

export function useBondPosition(ref, owner, mint) {
  const evm = useEvmPosition(on(ref, FAMILY.EVM), owner, mint)
  return evm
}

// ── Writes ───────────────────────────────────────────────────────────────────

export function useBondActions(ref, mint) {
  const evm = useEvmActions(on(ref, FAMILY.EVM), mint)
  return evm
}

export function useTriggerActions(family = FAMILY.EVM) {
  const evm = useEvmTriggerActions()
  return family === FAMILY.EVM ? evm : undefined
}

/** `{ create(params), tx, createdAddress }`. Params: see the EVM adapter's JSDoc. */
export function useCreateTrigger(family = FAMILY.EVM) {
  const evm = useEvmCreateTrigger()
  return family === FAMILY.EVM ? evm : undefined
}

/** `{ create(params), tx, createdAddress }`. Params: see the EVM adapter's JSDoc. */
export function useCreateBond(family = FAMILY.EVM) {
  const evm = useEvmCreateBond()
  return family === FAMILY.EVM ? evm : undefined
}

/**
 * Program/contract error name (e.g. 'NothingToClaim'). CatBond.sol and the
 * cat_bond program use the same names, so pages map them with one table.
 */
export function errorName(err) {
  return evmErrorName(err)
}
