// Solana adapter: React hooks over ./core.js, mapped onto the same
// chain-neutral shapes the EVM adapter uses (../types.js).
//
// Reads use react-query against the network's RPC. Writes are signed by the
// connected Solana wallet through core.js's send pipeline, which simulates
// every transaction first, so program errors (e.g. BelowMinInvestment)
// surface by name before the wallet ever prompts. All transaction logic
// lives in core.js so it can be exercised from Node against a live
// validator; this file only adds React state and the wallet.

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { address as toAddress, createSolanaRpc, isAddress, unwrapOption } from '@solana/kit'
import { useWallet as useAdapterWallet } from '@solana/wallet-adapter'
import { createSignerFromWalletAccount } from '@solana/wallet-account-signer'
import { useWalletModal } from '@solana/wallet-adapter/ui'
import {
  BOND_DISCRIMINATOR, POSITION_DISCRIMINATOR, REPORT_DISCRIMINATOR, TRIGGER_DISCRIMINATOR,
  decodeBond, decodePosition, decodeReport, decodeTrigger, findPositionPda,
} from './generated'
import { ata, build, chainError, fetchAllTyped, fetchTyped, reportPda, sendInstructions } from './core'
import { NETWORKS, defaultNetwork, networkById } from '../registry'
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

/**
 * Which Solana network a bare bond address lives on: a bond the registry
 * already lists for a network, else the first network whose RPC holds a
 * cat_bond Bond account at that address (localnet first, then devnet).
 * Unreachable RPCs (localnet not running) are skipped. null if none has it.
 */
export async function findSolanaBondNetwork(bondAddress) {
  const nets = NETWORKS.filter(n => n.family === FAMILY.SOLANA)
  const listed = nets.find(n => (n.bonds ?? []).some(b => b.address === bondAddress))
  if (listed) return listed.id
  for (const net of nets) {
    try {
      const { rpc } = rpcFor(net.id)
      if ((await fetchTyped(rpc, bondAddress, BOND_DISCRIMINATOR, decodeBond)).exists) return net.id
    } catch { /* RPC down or account unreadable: try the next network */ }
  }
  return null
}

/** Network id a ref resolves to (its own, or the Solana default). */
const netIdOf = (ref) => ref?.network ?? defaultNetwork(FAMILY.SOLANA)?.id ?? null
const netIdOr = (networkId) => networkId ?? defaultNetwork(FAMILY.SOLANA)?.id ?? null

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
      const acct = await fetchTyped(rpc, ref.address, BOND_DISCRIMINATOR, decodeBond)
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
  const netId = netIdOr(networkId)
  const q = useQuery({
    queryKey: ['solana', 'trigger', netId, triggerAddress],
    enabled: !!triggerAddress && isAddress(triggerAddress),
    queryFn: async () => {
      const { rpc } = rpcFor(netId)
      const acct = await fetchTyped(rpc, triggerAddress, TRIGGER_DISCRIMINATOR, decodeTrigger)
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

/** Newest-first `{value, reportedAt}` list, read from the trigger's Report PDAs. */
export function useSolanaTriggerHistory(triggerAddress, reportCount, { limit = 10, enabled = true } = {}, networkId) {
  const netId = netIdOr(networkId)
  const count = Number(reportCount ?? 0)
  const q = useQuery({
    queryKey: ['solana', 'reports', netId, triggerAddress, count, limit],
    enabled: !!triggerAddress && enabled && count > 0,
    queryFn: async () => {
      const { rpc } = rpcFor(netId)
      const indexes = Array.from({ length: Math.min(count, limit) }, (_, i) => BigInt(count - 1 - i))
      const pdas = await Promise.all(indexes.map(i => reportPda(triggerAddress, i)))
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
      const [positionAddr] = await findPositionPda({ bond: toAddress(ref.address), investor: toAddress(owner) })
      const tokenAccount = await ata(owner, mint)
      const [position, balance] = await Promise.all([
        fetchTyped(rpc, positionAddr, POSITION_DISCRIMINATOR, decodePosition),
        rpc.getTokenAccountBalance(tokenAccount).send().then(r => BigInt(r.value.amount)).catch(() => 0n),  // no ATA yet → 0
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

// ── Writes ───────────────────────────────────────────────────────────────────

const IDLE = { isWriting: false, isConfirming: false, isConfirmed: false, hash: undefined, error: null }

/**
 * One write slot, mirroring the EVM adapter's: the latest call drives one tx
 * banner. `run(netId, buildFn)` builds instructions with the wallet's signer
 * and sends them via core.sendInstructions. Resolves to the signature, or
 * undefined on error (the error lands in `tx.error`).
 *
 * The signer is made per write for that network's wallet chain (e.g.
 * 'solana:devnet'), so the wallet always signs for the network the bond or
 * trigger lives on, whatever the provider's default chain is. One page can
 * write to localnet and devnet side by side (the Admin page does).
 */
function signerFor(account, net) {
  if (!account) throw chainError('Connect a Solana wallet first.')
  try {
    return createSignerFromWalletAccount(account, net.walletChain)
  } catch {
    throw chainError(`Your wallet can't sign for ${net.label} (${net.walletChain}). Switch wallets or use a wallet that supports it.`)
  }
}

function useSolanaWriteSlot() {
  const { account } = useAdapterWallet()
  const [tx, setTx] = useState(IDLE)

  const run = useCallback(async (netId, buildFn) => {
    setTx({ ...IDLE, isWriting: true })
    try {
      const { rpc, net } = rpcFor(netId)
      const signer = signerFor(account, net)
      const instructions = await buildFn(signer, rpc)
      const signature = await sendInstructions(rpc, signer, instructions, {
        onSent: (sig) => setTx({ ...IDLE, isConfirming: true, hash: sig }),
      })
      setTx({ ...IDLE, isConfirmed: true, hash: signature })
      return signature
    } catch (e) {
      const err = e?.cause?.data ? e : chainError(e?.shortMessage || e?.message || String(e))
      setTx({ ...IDLE, error: err })
      return undefined
    }
  }, [account])

  return { run, tx }
}

/** Bond actions (same surface as the EVM adapter's useEvmActions). */
export function useSolanaActions(ref) {
  const { run, tx } = useSolanaWriteSlot()
  const netId = netIdOf(ref)
  const bond = ref?.address
  const act = (fn, ...args) => run(netId, (signer, rpc) => build[fn](signer, rpc, bond, ...args))

  return {
    tx,
    /** SPL tokens move with the signer's own signature: there's no approve step. */
    requiresApproval: false,
    approve: () => undefined,
    fundCouponBudget:  () => act('fundCouponBudget'),
    deposit:           (amount, maxAccepted) => act('deposit', amount, maxAccepted),
    closeSubscription: () => act('closeSubscription'),
    claimCoupon:       () => act('claimCoupon'),
    withdrawPrincipal: () => act('withdrawPrincipal'),
    checkTrigger:      () => act('checkTrigger'),
    markMatured:       () => act('markMatured'),
    settle:            () => act('settle'),
    postReport: (triggerAddress, value, note) =>
      run(netId, (signer, rpc) => build.postReport(signer, rpc, triggerAddress, value, note)),
  }
}

/** Trigger-only actions, for screens with no bond in context. */
export function useSolanaTriggerActions(networkId) {
  const { run, tx } = useSolanaWriteSlot()
  const netId = netIdOr(networkId)
  return {
    tx,
    postReport: (triggerAddress, value, note) =>
      run(netId, (signer, rpc) => build.postReport(signer, rpc, triggerAddress, value, note)),
  }
}

// ── Creation ─────────────────────────────────────────────────────────────────
// Solana bonds and triggers are PDAs: creating one is an instruction signed
// (and paid for) by the connected wallet. A bond's sponsor is whatever
// address is passed, as on EVM; a trigger's owner is the signer.
// `createdAddress` is the new PDA once confirmed.

function useSolanaCreate(networkId, builderName) {
  const { run, tx } = useSolanaWriteSlot()
  const [createdAddress, setCreatedAddress] = useState(undefined)
  const netId = netIdOr(networkId)

  const create = async (params) => {
    setCreatedAddress(undefined)
    let address
    const signature = await run(netId, async (signer) => {
      const built = await build[builderName](signer, params)
      address = built.address
      return built.instructions
    })
    if (signature) setCreatedAddress(address)
  }
  return { tx, createdAddress, create }
}

/** Same params as the EVM useEvmCreateBond; `sponsor` is any address (defaults to the wallet). */
export const useSolanaCreateBond = (networkId) => useSolanaCreate(networkId, 'createBond')

/** Same params as the EVM useEvmCreateTrigger; the connected wallet is the owner. */
export const useSolanaCreateTrigger = (networkId) => useSolanaCreate(networkId, 'createTrigger')
