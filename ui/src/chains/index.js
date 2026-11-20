// Chain-neutral entry point. Pages import from here, never from wagmi or a
// Solana library directly (DEAL001/PLAN-multichain-ui.md §2).
//
// Every hook calls each family's hook unconditionally (rules of hooks) and
// passes null to the families it isn't for; the inactive ones do no network
// work, and the hook returns whichever family the bond/address is on.

import { FAMILY } from './types'
import {
  isEvmAddress, sameEvmAddress, evmErrorName,
  useEvmWallet, useEvmBond, useEvmTrigger, useEvmTriggerHistory, useEvmPosition,
  useEvmActions, useEvmTriggerActions, useEvmCreateTrigger, useEvmCreateBond,
} from './evm/adapter'
import {
  isSolanaAddress, useSolanaWallet, useSolanaBond, useSolanaTrigger, useSolanaTriggerHistory,
  useSolanaPosition, useSolanaActions, useSolanaTriggerActions, useSolanaCreate,
} from './solana/adapter'
import { defaultNetwork } from './registry'

export { STATUS, FAMILY } from './types'
export { NETWORKS, networkById, defaultNetwork } from './registry'

/** Families the UI can load bonds on. Solana is read-only until Phase D. */
export const ENABLED_FAMILIES = [FAMILY.EVM, FAMILY.SOLANA]

const ADDRESS_CHECKS = {
  [FAMILY.EVM]: isEvmAddress,
  [FAMILY.SOLANA]: isSolanaAddress,
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
  if (!family) return null
  // A bare Solana address is assumed to be on the default Solana network
  // (localnet while it's running, else devnet). EVM keeps `null` = the
  // wallet's current chain until bonds carry their network (Phase E).
  const net = network ?? (family === FAMILY.SOLANA ? defaultNetwork(FAMILY.SOLANA)?.id ?? null : null)
  return { family, network: net, address }
}

const on = (ref, family) => (ref?.family === family ? ref : null)
const onFamily = (family, wanted, value) => (family === wanted ? value : undefined)
const pick = (family, byFamily) => byFamily[family] ?? byFamily[FAMILY.EVM]

// ── Wallet ───────────────────────────────────────────────────────────────────

/** The connected wallet for one chain family. */
export function useWallet(family = FAMILY.EVM) {
  const evm = useEvmWallet()
  const solana = useSolanaWallet()
  return pick(family, { evm, solana })
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** @param {import('./types').BondRef|null} ref */
export function useBond(ref) {
  const evm = useEvmBond(on(ref, FAMILY.EVM))
  const solana = useSolanaBond(on(ref, FAMILY.SOLANA))
  return pick(ref?.family, { evm, solana })
}

/** @returns {{ trigger: import('./types').TriggerView|undefined, refetch: Function }} */
export function useTrigger(family, triggerAddress, network) {
  const evm = useEvmTrigger(onFamily(family, FAMILY.EVM, triggerAddress))
  const solana = useSolanaTrigger(onFamily(family, FAMILY.SOLANA, triggerAddress), network)
  return pick(family, { evm, solana })
}

/** Newest-first `{value, reportedAt}` list, up to `limit`, read only while `enabled`. */
export function useTriggerHistory(family, triggerAddress, reportCount, opts, network) {
  const evm = useEvmTriggerHistory(onFamily(family, FAMILY.EVM, triggerAddress), reportCount, opts)
  const solana = useSolanaTriggerHistory(onFamily(family, FAMILY.SOLANA, triggerAddress), reportCount, opts, network)
  return pick(family, { evm, solana })
}

export function useBondPosition(ref, owner, mint) {
  const evm = useEvmPosition(on(ref, FAMILY.EVM), owner, mint)
  const solana = useSolanaPosition(on(ref, FAMILY.SOLANA), owner, mint)
  return pick(ref?.family, { evm, solana })
}

// ── Writes ───────────────────────────────────────────────────────────────────

export function useBondActions(ref, mint) {
  const evm = useEvmActions(on(ref, FAMILY.EVM), mint)
  const solana = useSolanaActions()
  return pick(ref?.family, { evm, solana })
}

export function useTriggerActions(family = FAMILY.EVM) {
  const evm = useEvmTriggerActions()
  const solana = useSolanaTriggerActions()
  return pick(family, { evm, solana })
}

/** `{ create(params), tx, createdAddress }`. Params: see the EVM adapter's JSDoc. */
export function useCreateTrigger(family = FAMILY.EVM) {
  const evm = useEvmCreateTrigger()
  const solana = useSolanaCreate()
  return pick(family, { evm, solana })
}

/** `{ create(params), tx, createdAddress }`. Params: see the EVM adapter's JSDoc. */
export function useCreateBond(family = FAMILY.EVM) {
  const evm = useEvmCreateBond()
  const solana = useSolanaCreate()
  return pick(family, { evm, solana })
}

/**
 * Program/contract error name (e.g. 'NothingToClaim'). CatBond.sol and the
 * cat_bond program use the same names, so pages map them with one table.
 */
export function errorName(err) {
  return evmErrorName(err)
}
