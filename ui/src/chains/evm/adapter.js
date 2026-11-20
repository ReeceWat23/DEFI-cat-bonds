// EVM adapter: today's wagmi calls, moved out of the pages and mapped onto
// the chain-neutral shapes in ../types.js. Behaviour is meant to be
// byte-for-byte what the pages did inline before Phase A.

import {
  useAccount, useConnect, useDisconnect,
  useReadContracts, useWriteContract, useWaitForTransactionReceipt,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { isAddress } from 'viem'
import { CATBOND_ABI, TRIGGER_ABI, ERC20_ABI } from '../../constants/abis'

export const isEvmAddress = (s) => isAddress(s)

/** Pulls a Solidity custom-error name (e.g. 'NothingToClaim') off a viem error. */
export function evmErrorName(err) {
  return err?.cause?.data?.errorName || err?.cause?.name || ''
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
    ] : [],
  })
  let trigger
  if (data) {
    const [reportCount, latestReport, productConfig] = data.map(r => r.result)
    // latestReport() has a single struct output → viem decodes a named object.
    // productConfig() is multi-output → positional tuple.
    trigger = {
      reportCount,
      latest: latestReport && { value: latestReport.value, reportedAt: latestReport.reportedAt },
      valuePath: productConfig?.[2],
    }
  }
  return { trigger, refetch }
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

/**
 * One shared write slot per page, same as the single useWriteContract the
 * pages used before: the latest action's state drives the tx banner.
 */
export function useEvmActions(ref, mint) {
  const { writeContract, isPending, data: hash, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash })

  const bond = ref?.address
  const call = (functionName, args) =>
    writeContract({ address: bond, abi: CATBOND_ABI, functionName, ...(args ? { args } : {}) })

  return {
    tx: { isWriting: isPending, isConfirming, isConfirmed, hash, error },
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
  }
}
