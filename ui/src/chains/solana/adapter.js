// Solana adapter: reads the cat_bond program's accounts (via the
// Codama-generated client in ./generated) and maps them onto the same
// chain-neutral shapes the EVM adapter returns (../types.js).
//
// Phase C = read-only. Writes are stubs that report a clear "not yet" error;
// they're wired to the generated instruction builders in Phase D.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  address as toAddress, createSolanaRpc, fetchEncodedAccount, fetchEncodedAccounts,
  getAddressEncoder, getProgramDerivedAddress, getU64Encoder, isAddress, unwrapOption,
} from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS, findAssociatedTokenPda } from '@solana-program/token'
import { useWallet as useAdapterWallet } from '@solana/wallet-adapter'
import { useWalletModal } from '@solana/wallet-adapter/ui'
import {
  BOND_DISCRIMINATOR, CAT_BOND_PROGRAM_ADDRESS, POSITION_DISCRIMINATOR, REPORT_DISCRIMINATOR,
  TRIGGER_DISCRIMINATOR, decodeBond, decodePosition, decodeReport, decodeTrigger, findPositionPda,
} from './generated'
import { defaultNetwork, networkById } from '../registry'
import { FAMILY } from '../types'

export const isSolanaAddress = (s) => isAddress(s)

// ── RPC ──────────────────────────────────────────────────────────────────────

const rpcCache = new Map()
function rpcFor(networkId) {
  const net = (networkId && networkById(networkId)) || defaultNetwork(FAMILY.SOLANA)
  if (!net) throw new Error('No Solana network configured')
  if (!rpcCache.has(net.rpcUrl)) rpcCache.set(net.rpcUrl, createSolanaRpc(net.rpcUrl))
  return { rpc: rpcCache.get(net.rpcUrl), net }
}

// ── Typed account fetch ──────────────────────────────────────────────────────
// The generated decoders don't check the account's owner or Anchor
// discriminator: decoding a Trigger as a Bond throws, and an unrelated
// account of the right size could decode as garbage. So only decode an
// account this program owns whose first 8 bytes are the expected type tag;
// anything else is reported as "doesn't exist" (same as an empty address).

function isTyped(encoded, discriminator) {
  if (!encoded.exists || encoded.programAddress !== CAT_BOND_PROGRAM_ADDRESS) return false
  const data = encoded.data
  if (data.length < discriminator.length) return false
  return discriminator.every((byte, i) => data[i] === byte)
}

async function fetchTyped(rpc, addr, discriminator, decode) {
  const encoded = await fetchEncodedAccount(rpc, addr)
  return isTyped(encoded, discriminator) ? { exists: true, data: decode(encoded).data } : { exists: false }
}

async function fetchAllTyped(rpc, addrs, discriminator, decode) {
  const encoded = await fetchEncodedAccounts(rpc, addrs)
  return encoded.map(e => (isTyped(e, discriminator) ? { exists: true, data: decode(e).data } : { exists: false }))
}

/** Network id a ref resolves to (its own, or the Solana default). */
const netIdOf = (ref) => ref?.network ?? defaultNetwork(FAMILY.SOLANA)?.id ?? null

// ── Wallet ───────────────────────────────────────────────────────────────────

export function useSolanaWallet() {
  const w = useAdapterWallet()
  const { setVisible } = useWalletModal()
  return {
    address: w.address ?? undefined,
    isConnected: w.connected,
    connect: () => setVisible(true),          // opens the wallet picker
    disconnect: () => w.disconnect(),
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** @param {import('../types').BondRef|null} ref */
export function useSolanaBond(ref) {
  const netId = netIdOf(ref)
  const q = useQuery({
    queryKey: ['solana', 'bond', netId, ref?.address],
    enabled: !!ref?.address,
    queryFn: async () => {
      const { rpc } = rpcFor(netId)
      const acct = await fetchTyped(rpc, toAddress(ref.address), BOND_DISCRIMINATOR, decodeBond)
      if (!acct.exists) return { exists: false }
      const d = acct.data
      return {
        exists:               true,
        status:               Number(d.status),          // generated enum: same 0–4 order as STATUS
        sponsor:              d.sponsor,
        companyWallet:        d.companyWallet,
        mint:                 d.mint,
        couponRateBps:        d.couponRateBps,
        coverageAmount:       d.coverageAmount,
        minInvestment:        d.minInvestment,
        requiredCouponBudget: d.requiredCouponBudget,
        subscriptionEnd:      d.subscriptionEnd,
        maturity:             d.maturity,
        settlementTime:       d.settlementTime,
        totalDeposited:       d.totalDeposited,
        termDuration:         d.termDuration,
        trigger:              d.trigger,
        threshold:            d.threshold,
        lastCheck: {
          value:      d.lastCheck.value,
          reportedAt: d.lastCheck.reportedAt,
          triggered:  d.lastCheck.triggered,
          checkedAt:  d.lastCheck.checkedAt,
          checkedBy:  d.lastCheck.checkedBy,
        },
        sellerName:           d.sellerName,
        verified:             d.verified,
        exposure:             d.exposure.map(e => ({ region: e.region, pct: Number(e.pct) })),
        dealId:               d.dealId,
        // Solana-only extras
        vault:                d.vault,
        investorCount:        d.investorCount,
      }
    },
  })
  return { bond: q.data, refetch: q.refetch }
}

export function useSolanaTrigger(triggerAddress, networkId) {
  const netId = networkId ?? defaultNetwork(FAMILY.SOLANA)?.id ?? null
  const q = useQuery({
    queryKey: ['solana', 'trigger', netId, triggerAddress],
    enabled: !!triggerAddress && isAddress(triggerAddress),
    queryFn: async () => {
      const { rpc } = rpcFor(netId)
      const acct = await fetchTyped(rpc, toAddress(triggerAddress), TRIGGER_DISCRIMINATOR, decodeTrigger)
      if (!acct.exists) return { exists: false }
      const d = acct.data
      const latest = unwrapOption(d.latest)               // Option<ReportData> → ReportData | null
      return {
        exists:       true,
        reportCount:  d.reportCount,
        latest:       latest ? { value: latest.value, reportedAt: latest.reportedAt } : undefined,
        productId:    d.productId,
        version:      d.version,
        valuePath:    d.valuePath,
        units:        d.units,
        maxReportAge: d.maxReportAge,
        reporter:     d.reporter,
        owner:        d.owner,
      }
    },
  })
  return { trigger: q.data, refetch: q.refetch }
}

const reportPda = async (trigger, index) => (await getProgramDerivedAddress({
  programAddress: CAT_BOND_PROGRAM_ADDRESS,
  seeds: ['report', getAddressEncoder().encode(trigger), getU64Encoder().encode(index)],
}))[0]

/** Newest-first `{value, reportedAt}` list, read from the trigger's Report PDAs. */
export function useSolanaTriggerHistory(triggerAddress, reportCount, { limit = 10, enabled = true } = {}, networkId) {
  const netId = networkId ?? defaultNetwork(FAMILY.SOLANA)?.id ?? null
  const count = Number(reportCount ?? 0)
  const q = useQuery({
    queryKey: ['solana', 'reports', netId, triggerAddress, count, limit],
    enabled: !!triggerAddress && enabled && count > 0,
    queryFn: async () => {
      const { rpc } = rpcFor(netId)
      const trigger = toAddress(triggerAddress)
      const indexes = Array.from({ length: Math.min(count, limit) }, (_, i) => BigInt(count - 1 - i))
      const pdas = await Promise.all(indexes.map(i => reportPda(trigger, i)))
      const accounts = await fetchAllTyped(rpc, pdas, REPORT_DISCRIMINATOR, decodeReport)
      return accounts.map(a => a.exists ? { value: a.data.data.value, reportedAt: a.data.data.reportedAt } : undefined)
    },
  })
  return q.data ?? []
}

export function useSolanaPosition(ref, owner, mint) {
  const netId = netIdOf(ref)
  const q = useQuery({
    queryKey: ['solana', 'position', netId, ref?.address, owner, mint],
    enabled: !!ref?.address && !!owner && !!mint,
    queryFn: async () => {
      const { rpc } = rpcFor(netId)
      const bond = toAddress(ref.address)
      const investor = toAddress(owner)
      const [positionAddr] = await findPositionPda({ bond, investor })
      const [ata] = await findAssociatedTokenPda({ owner: investor, mint: toAddress(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS })
      const [position, balance] = await Promise.all([
        fetchTyped(rpc, positionAddr, POSITION_DISCRIMINATOR, decodePosition),
        rpc.getTokenAccountBalance(ata).send().then(r => BigInt(r.value.amount)).catch(() => 0n),  // no ATA yet → 0
      ])
      // No Position account = never deposited, same as principalOf() == 0 on EVM.
      const p = position.exists ? position.data : { principal: 0n, claimed: 0n, withdrawn: false }
      return {
        principal: p.principal,
        claimed: p.claimed,
        withdrawn: p.withdrawn,
        tokenBalance: balance,
        tokenAllowance: null,                             // SPL transfers are signed directly; no approve step
      }
    },
  })
  return { position: q.data, refetch: q.refetch }
}

// ── Writes (Phase D) ─────────────────────────────────────────────────────────

const NOT_YET = 'Solana transactions arrive in Phase D. This bond is read-only in the UI for now.'

function useNotYetSlot() {
  const [error, setError] = useState(null)
  const fail = () => {
    const err = new Error(NOT_YET)
    err.shortMessage = NOT_YET
    setError(err)
  }
  const tx = useMemo(
    () => ({ isWriting: false, isConfirming: false, isConfirmed: false, hash: undefined, error }),
    [error],
  )
  return { tx, fail }
}

export function useSolanaActions() {
  const { tx, fail } = useNotYetSlot()
  return {
    tx,
    requiresApproval: false,
    approve: fail, fundCouponBudget: fail, deposit: fail, closeSubscription: fail,
    claimCoupon: fail, withdrawPrincipal: fail, checkTrigger: fail, markMatured: fail,
    settle: fail, postReport: fail,
  }
}

export function useSolanaTriggerActions() {
  const { tx, fail } = useNotYetSlot()
  return { tx, postReport: fail }
}

export function useSolanaCreate() {
  const { tx, fail } = useNotYetSlot()
  return { tx, createdAddress: undefined, create: fail }
}
