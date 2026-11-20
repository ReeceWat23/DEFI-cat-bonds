// EVM adapter: today's wagmi calls, moved out of the pages and mapped onto
// the chain-neutral shapes in ../types.js. Behaviour matches what the pages
// did inline before Phase A, except that reverted transactions are now
// reported as errors rather than as confirmed (see useEvmReceipt).

import { useEffect, useState } from 'react'
import {
  useAccount, useConnect, useDisconnect,
  useReadContracts, useWriteContract, useWaitForTransactionReceipt,
  useDeployContract, usePublicClient,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { isAddress, keccak256, toHex, decodeErrorResult } from 'viem'
import {
  CATBOND_ABI, CATBOND_BYTECODE, TRIGGER_ABI, TRIGGER_BYTECODE, ERC20_ABI,
} from '../../constants/abis'

export const isEvmAddress = (s) => isAddress(s)

/** Hex addresses are case-insensitive (checksum casing is cosmetic). */
export const sameEvmAddress = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** A free-text note → the bytes32 monitorRef postReport() takes. */
const noteToMonitorRef = (note) => keccak256(toHex(note.trim() || 'manual-admin-report'))

/** Pulls a Solidity custom-error name (e.g. 'NothingToClaim') off a viem error. */
export function evmErrorName(err) {
  return err?.cause?.data?.errorName || err?.cause?.name || ''
}

// Custom errors from every contract the UI talks to, for decoding reverts.
const REVERT_ABI = [...CATBOND_ABI, ...TRIGGER_ABI].filter(x => x.type === 'error')

/** An Error shaped like viem's, so evmErrorName() and page error tables work on it. */
function revertedError(errorName) {
  const msg = errorName ? `Transaction reverted on-chain: ${errorName}` : 'Transaction reverted on-chain.'
  const err = new Error(msg)
  err.shortMessage = msg
  err.cause = { data: { errorName }, name: errorName }
  return err
}

/**
 * Waits for a receipt and reports a revert as an error. wagmi's
 * useWaitForTransactionReceipt alone reports success for ANY mined receipt,
 * including reverted ones, so the pages used to show "confirmed" (and, for
 * deploys, a non-existent contract address) when a transaction had failed.
 * On revert, the tx is replayed at the previous block to recover the
 * contract's custom error name (e.g. InvalidTrigger).
 */
function useEvmReceipt(hash) {
  const client = usePublicClient()
  const { isLoading, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash })
  const reverted = isSuccess && receipt?.status === 'reverted'
  const [revertName, setRevertName] = useState(null)

  useEffect(() => {
    setRevertName(null)
    if (!reverted || !client) return
    let cancelled = false
    ;(async () => {
      let name = ''
      try {
        const tx = await client.getTransaction({ hash })
        await client.call({
          account: tx.from, to: tx.to ?? undefined, data: tx.input, value: tx.value, gas: tx.gas,
          blockNumber: receipt.blockNumber - 1n,
        })
      } catch (e) {
        const data = typeof e?.walk === 'function'
          ? e.walk(x => typeof x?.data === 'string' && x.data.startsWith('0x'))?.data
          : e?.data
        try { name = decodeErrorResult({ abi: REVERT_ABI, data }).errorName } catch { /* unknown error */ }
      }
      if (!cancelled) setRevertName(name)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reverted, hash])

  return {
    isConfirming: isLoading,
    isConfirmed: isSuccess && receipt?.status === 'success',
    receipt,
    revertError: reverted ? revertedError(revertName ?? '') : null,
  }
}

// ── Wallet ───────────────────────────────────────────────────────────────────

export function useEvmWallet() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  return {
    address,
    isConnected,
    connect: () => connect({ connector: injected() }),
    disconnect: () => disconnect(),
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

const BOND_FIELDS = [
  'status', 'sponsor', 'companyWallet', 'usdc', 'couponRateBps', 'coverageAmount',
  'minInvestment', 'requiredCouponBudget', 'subscriptionEnd', 'maturity',
  'settlementTime', 'totalDeposited', 'termDuration', 'trigger', 'threshold',
  'lastCheck', 'sellerName', 'verified', 'getExposure', 'dealId',
]

/** @param {import('../types').BondRef|null} ref */
export function useEvmBond(ref) {
  const address = ref?.address
  const { data, refetch } = useReadContracts({
    contracts: address
      ? BOND_FIELDS.map(functionName => ({ address, abi: CATBOND_ABI, functionName }))
      : [],
  })

  let bond
  if (data) {
    const r = Object.fromEntries(BOND_FIELDS.map((f, i) => [f, data[i]?.result]))
    // lastCheck() is a multi-output getter → viem returns a positional tuple.
    const lc = r.lastCheck
    bond = {
      // false = nothing CatBond-shaped at this address on the connected
      // network (wrong chain, stale address, or a failed deploy).
      exists:               data.some(x => x.status === 'success'),
      status:               r.status === undefined ? undefined : Number(r.status),
      sponsor:              r.sponsor,
      companyWallet:        r.companyWallet,
      mint:                 r.usdc,
      couponRateBps:        r.couponRateBps,
      coverageAmount:       r.coverageAmount,
      minInvestment:        r.minInvestment,
      requiredCouponBudget: r.requiredCouponBudget,
      subscriptionEnd:      r.subscriptionEnd,
      maturity:             r.maturity,
      settlementTime:       r.settlementTime,
      totalDeposited:       r.totalDeposited,
      termDuration:         r.termDuration,
      trigger:              r.trigger,
      threshold:            r.threshold,
      lastCheck: lc && {
        value: lc[0], reportedAt: lc[1], triggered: lc[2], checkedAt: lc[3], checkedBy: lc[4],
      },
      sellerName:           r.sellerName,
      verified:             r.verified,
      exposure:             (r.getExposure ?? []).map(e => ({ region: e.region, pct: Number(e.pct) })),
      dealId:               r.dealId,
    }
  }
  return { bond, refetch }
}

export function useEvmTrigger(triggerAddress) {
  const { data, refetch } = useReadContracts({
    contracts: triggerAddress ? [
      { address: triggerAddress, abi: TRIGGER_ABI, functionName: 'reportCount' },
      { address: triggerAddress, abi: TRIGGER_ABI, functionName: 'latestReport' },
      { address: triggerAddress, abi: TRIGGER_ABI, functionName: 'productConfig' },
      { address: triggerAddress, abi: TRIGGER_ABI, functionName: 'reporter' },
      { address: triggerAddress, abi: TRIGGER_ABI, functionName: 'owner' },
    ] : [],
  })
  let trigger
  if (data) {
    const [reportCount, latestReport, productConfig, reporter, owner] = data.map(r => r.result)
    // latestReport() has a single struct output → viem decodes a named object.
    // It reverts (→ undefined) while the log is empty.
    // productConfig() is multi-output → positional tuple:
    //   [productId, version, valuePath, units, maxReportAge, endpointHash]
    const pc = productConfig ?? []
    trigger = {
      exists:       data.some(x => x.status === 'success'),
      reportCount,
      latest: latestReport && { value: latestReport.value, reportedAt: latestReport.reportedAt },
      productId:    pc[0],
      version:      pc[1],
      valuePath:    pc[2],
      units:        pc[3],
      maxReportAge: pc[4],
      reporter,
      owner,
    }
  }
  return { trigger, refetch }
}

/** Newest-first slice of a trigger's report log. Only reads while `enabled`. */
export function useEvmTriggerHistory(triggerAddress, reportCount, { limit = 10, enabled = true } = {}) {
  const count = Number(reportCount ?? 0)
  const { data } = useReadContracts({
    contracts: triggerAddress && enabled
      ? Array.from({ length: Math.min(count, limit) }, (_, i) => ({
          address: triggerAddress, abi: TRIGGER_ABI, functionName: 'reports', args: [BigInt(count - 1 - i)],
        }))
      : [],
  })
  // reports(i) is a public-array getter → positional tuple [value, reportedAt, reporter, monitorRef].
  return (data ?? []).map(r => r.result && { value: r.result[0], reportedAt: r.result[1] })
}

export function useEvmPosition(ref, owner, mint) {
  const bond = ref?.address
  const { data, refetch } = useReadContracts({
    contracts: bond && owner && mint ? [
      { address: bond, abi: CATBOND_ABI, functionName: 'principalOf',        args: [owner] },
      { address: bond, abi: CATBOND_ABI, functionName: 'alreadyClaimed',     args: [owner] },
      { address: bond, abi: CATBOND_ABI, functionName: 'principalWithdrawn', args: [owner] },
      { address: mint, abi: ERC20_ABI,   functionName: 'balanceOf',          args: [owner] },
      { address: mint, abi: ERC20_ABI,   functionName: 'allowance',          args: [owner, bond] },
    ] : [],
  })
  let position
  if (data) {
    const [principal, claimed, withdrawn, tokenBalance, tokenAllowance] = data.map(r => r.result)
    position = { principal, claimed, withdrawn, tokenBalance, tokenAllowance }
  }
  return { position, refetch }
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** One write slot: the latest call's state drives one tx banner. */
function useEvmWriteSlot() {
  const { writeContract, isPending, data: hash, error } = useWriteContract()
  const { isConfirming, isConfirmed, revertError } = useEvmReceipt(hash)
  return { writeContract, tx: { isWriting: isPending, isConfirming, isConfirmed, hash, error: error ?? revertError } }
}

const postReportCall = (triggerAddress, value, note) => ({
  address: triggerAddress, abi: TRIGGER_ABI, functionName: 'postReport',
  args: [value, noteToMonitorRef(note)],
})

/**
 * Bond actions sharing one write slot, same as the single useWriteContract
 * each page used before. postReport lives here too so the Admin manage
 * panel's report button shares the bond actions' banner, as it always has.
 */
export function useEvmActions(ref, mint) {
  const { writeContract, tx } = useEvmWriteSlot()

  const bond = ref?.address
  const call = (functionName, args) =>
    writeContract({ address: bond, abi: CATBOND_ABI, functionName, ...(args ? { args } : {}) })

  return {
    tx,
    /** ERC-20 needs an allowance before the bond can pull tokens. */
    requiresApproval: true,
    approve: (amount) =>
      writeContract({ address: mint, abi: ERC20_ABI, functionName: 'approve', args: [bond, amount] }),
    fundCouponBudget:  () => call('fundCouponBudget'),
    deposit:           (amount, maxAccepted) => call('deposit', [amount, maxAccepted]),
    closeSubscription: () => call('closeSubscription'),
    claimCoupon:       () => call('claimCoupon'),
    withdrawPrincipal: () => call('withdrawPrincipal'),
    checkTrigger:      () => call('checkTrigger'),
    markMatured:       () => call('markMatured'),
    settle:            () => call('settle'),
    postReport: (triggerAddress, value, note) => writeContract(postReportCall(triggerAddress, value, note)),
  }
}

/** Trigger-only actions, for screens with no bond in context. */
export function useEvmTriggerActions() {
  const { writeContract, tx } = useEvmWriteSlot()
  return {
    tx,
    postReport: (triggerAddress, value, note) => writeContract(postReportCall(triggerAddress, value, note)),
  }
}

// ── Creation ─────────────────────────────────────────────────────────────────
// On EVM, creating a trigger or bond means deploying a contract; on Solana it
// will be an instruction that initialises a PDA. Either way the page gets
// back the new address once it's confirmed.

function useEvmDeploySlot() {
  const { deployContract, isPending, data: hash, error } = useDeployContract()
  const { isConfirming, isConfirmed, receipt, revertError } = useEvmReceipt(hash)
  return {
    deployContract,
    tx: { isWriting: isPending, isConfirming, isConfirmed, hash, error: error ?? revertError },
    // A reverted deploy still carries the address the contract *would* have
    // had; only report one when the deploy actually succeeded.
    createdAddress: isConfirmed ? receipt?.contractAddress : undefined,
  }
}

/**
 * @param {object} p
 * @param {string} p.owner  @param {string} p.reporter
 * @param {string} p.productId  @param {number|bigint} p.version
 * @param {string} p.valuePath  @param {string} p.units
 * @param {number|bigint} p.maxReportAge  seconds
 * @param {string} p.endpoint  product endpoint URL (hashed on-chain)
 */
export function useEvmCreateTrigger() {
  const { deployContract, tx, createdAddress } = useEvmDeploySlot()
  return {
    tx,
    createdAddress,
    create: (p) => deployContract({
      abi: TRIGGER_ABI,
      bytecode: TRIGGER_BYTECODE,
      args: [p.owner, p.reporter, p.productId, p.version, p.valuePath, p.units, p.maxReportAge, p.endpoint],
    }),
  }
}

/**
 * @param {object} p  sponsor, companyWallet, trigger, threshold, mint,
 *   couponRateBps, coverageAmount, minInvestment, subscriptionDuration,
 *   termDuration, sellerName, dealId, exposure: [{region, pct}]
 */
export function useEvmCreateBond() {
  const { deployContract, tx, createdAddress } = useEvmDeploySlot()
  return {
    tx,
    createdAddress,
    create: (p) => deployContract({
      abi: CATBOND_ABI,
      bytecode: CATBOND_BYTECODE,
      args: [
        p.sponsor, p.companyWallet, p.trigger, p.threshold, p.mint, p.couponRateBps,
        p.coverageAmount, p.minInvestment, p.subscriptionDuration, p.termDuration,
        p.sellerName, p.dealId, p.exposure,
      ],
    }),
  }
}
