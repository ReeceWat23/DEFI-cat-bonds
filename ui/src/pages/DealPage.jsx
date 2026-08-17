import { useState, useEffect } from 'react'
import {
  useAccount, useConnect, useDisconnect,
  useReadContracts, useWriteContract, useWaitForTransactionReceipt,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { Link } from 'react-router-dom'
import { isAddress } from 'viem'
import { CATBOND_ABI, ERC20_ABI } from '../constants/abis'
import { BrutalButton, BrutalCard, BrutalTag } from '../theme/primitives'
import {
  formatUSDC, safeParseUSDC, formatDate, formatBps,
  statusLabel, statusColor,
} from '../lib/utils'

// ── Static deal content (DEAL 000 — Raydion) ─────────────────────────────────

const SPONSOR = {
  name:   'Raydion',
  hq:     'Bermuda',
  description:
    'Raydion is a Bermuda-based specialty reinsurer providing capacity across global ' +
    'natural catastrophe perils. With $2.4B in managed assets and over a decade ' +
    'operating across emerging and developed markets, Raydion seeks fully collateralised ' +
    'protection against extreme loss years that exceed their internal risk tolerance. ' +
    'This bond covers Raydion\'s net retained exposure across their global property ' +
    'catastrophe book.',
}

const EXPOSURE = [
  { region: 'United States', pct: 50, color: '#3b82f6' },
  { region: 'China',         pct: 30, color: '#f59e0b' },
  { region: 'Brazil',        pct: 15, color: '#10b981' },
  { region: 'European Union', pct: 5, color: '#8b5cf6' },
]

const TRIGGER_THRESHOLD_B = 370   // $B total economic nat cat losses
const H1_INSURED_B        = 46    // $B insured losses H1 2026 (Gallagher Re — for reference)
const H1_TOTAL_B          = 142   // $B total economic losses H1 2026 — primary trigger metric

// Annual total economic losses ($B) — Gallagher Re / Swiss Re sigma
const HISTORICAL = [
  { year: 2016, total: 175 },
  { year: 2017, total: 344 },
  { year: 2018, total: 165 },
  { year: 2019, total: 150 },
  { year: 2020, total: 202 },
  { year: 2021, total: 270 },
  { year: 2022, total: 313 },
  { year: 2023, total: 280 },
  { year: 2024, total: 368 },
  { year: 2025, total: 310 },
]

const NEWS = [
  {
    title:   'Natural Catastrophe & Climate Report — H1 2026',
    source:  'Gallagher Re',
    date:    'July 2026',
    url:     'https://www.ajg.com/gallagherre/news-and-insights/natural-catastrophe-and-climate-report-h1-2026/',
    summary: `$${H1_INSURED_B}B in insured losses recorded through H1 2026. Atlantic hurricane season forecast remains above average with elevated La Niña conditions.`,
  },
  {
    title:   'Natural Catastrophe Report — Full Year 2025',
    source:  'Gallagher Re',
    date:    'January 2026',
    url:     'https://www.ajg.com/gallagherre/news-and-insights/',
    summary: '2025 full-year insured losses reached $137B, driven by US severe convective storm outbreaks and record wildfire activity in southern Europe.',
  },
]

// ── Error mapping ─────────────────────────────────────────────────────────────

const REVERT_MESSAGES = {
  BelowMinInvestment:   'Amount is below the minimum investment for this bond.',
  ExceedsMaxAccepted:   'Amount exceeds what the bond can still accept.',
  SubscriptionExpired:  'The subscription window has closed.',
  SubscriptionStillOpen:'Subscription is still open — not yet eligible to close.',
  NothingToClaim:       'No coupon has accrued yet. Wait a bit longer and try again.',
  NotInvestor:          'Your wallet has no position in this bond.',
  AlreadyWithdrawn:     'Principal has already been withdrawn.',
  NotYetMatured:        'The bond has not yet reached maturity.',
  WrongStatus:          'This action is not available in the current bond status.',
  NotSponsor:           'Only the sponsor wallet can perform this action.',
  NotCompanyWallet:     'Only the company wallet can perform this action.',
  TriggerNotFired:      'The trigger has not fired.',
  TriggerAlreadyFired:  'The trigger has already fired.',
  ConflictOfInterest:   'The sponsor and company wallet cannot invest in the bond.',
}

function parseError(err) {
  if (!err) return null
  const name = err?.cause?.data?.errorName || err?.cause?.name || ''
  return REVERT_MESSAGES[name] || err?.shortMessage || err?.message || String(err)
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect }    = useConnect()
  const { disconnect } = useDisconnect()
  if (isConnected) return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-mono text-[var(--rhodex-text-dark-muted)]">{address?.slice(0,6)}...{address?.slice(-4)}</span>
      <BrutalButton tone="ghost" size="px-3 py-1.5 text-xs" onClick={() => disconnect()}>
        Disconnect
      </BrutalButton>
    </div>
  )
  return (
    <BrutalButton size="px-4 py-2 text-sm" onClick={() => connect({ connector: injected() })}>
      Connect Wallet
    </BrutalButton>
  )
}

function StatChip({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-[var(--rhodex-text-dark)]">{value}</div>
      <div className="text-xs text-[var(--rhodex-text-dark-muted)] mt-0.5">{label}</div>
    </div>
  )
}

function TxBanner({ isWriting, isConfirming, isConfirmed, hash, error }) {
  if (error)       return <div className="rounded-none border-2 border-red-300 bg-red-50 p-3 text-sm text-red-700"><strong>Error:</strong> {parseError(error)}</div>
  if (isWriting)   return <div className="rounded-none border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">Waiting for wallet confirmation…</div>
  if (isConfirming) return <div className="rounded-none border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">Confirming on-chain — <span className="font-mono">{hash?.slice(0,12)}…</span></div>
  if (isConfirmed)  return <div className="rounded-none border-2 border-green-300 bg-green-50 p-3 text-sm text-green-700">Transaction confirmed! <span className="font-mono text-xs">{hash?.slice(0,14)}…</span></div>
  return null
}

// ── Historical loss chart ─────────────────────────────────────────────────────

function HistoricalChart() {
  const maxVal       = 420
  const threshold    = TRIGGER_THRESHOLD_B
  const thresholdPct = (threshold / maxVal) * 100

  return (
    <div>
      <div className="flex items-end justify-between mb-1">
        <span className="text-xs text-[var(--rhodex-text-dark-muted)]">Annual total economic nat cat losses ($B)</span>
        <span className="text-xs text-red-500 font-medium">— ${threshold}B trigger</span>
      </div>
      <div className="relative" style={{ height: '120px' }}>
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 z-10 pointer-events-none"
          style={{ bottom: `${thresholdPct}%` }}
        />
        <div className="absolute inset-0 flex items-end gap-1">
          {HISTORICAL.map(d => {
            const heightPct = (d.total / maxVal) * 100
            const isHigh    = d.total >= threshold
            return (
              <div key={d.year} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className={`w-full transition-colors ${isHigh ? 'bg-red-400' : 'bg-[var(--rhodex-accent)] group-hover:brightness-110'}`}
                  style={{ height: `${heightPct}%` }}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[var(--rhodex-text-dark)] text-white text-xs rounded-none px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20">
                  {d.year}: ${d.total}B
                </div>
              </div>
            )
          })}
          {/* H1 2026 partial */}
          <div className="flex-1 flex flex-col items-center justify-end h-full group relative">
            <div
              className="w-full bg-blue-200 border-t-2 border-dashed border-blue-400"
              style={{ height: `${(H1_TOTAL_B / maxVal) * 100}%` }}
            />
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[var(--rhodex-text-dark)] text-white text-xs rounded-none px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20">
              H1 2026: ${H1_TOTAL_B}B (partial)
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-1 mt-1">
        {HISTORICAL.map(d => (
          <div key={d.year} className="flex-1 text-center text-xs text-[var(--rhodex-text-dark-muted)]">{String(d.year).slice(2)}</div>
        ))}
        <div className="flex-1 text-center text-xs text-[var(--rhodex-accent)] font-medium">H1'26</div>
      </div>
      <div className="mt-2 text-xs text-[var(--rhodex-text-dark-muted)]">Source: Gallagher Re · Swiss Re sigma</div>
    </div>
  )
}

// ── Geographic exposure ───────────────────────────────────────────────────────

function ExposureMap() {
  return (
    <div className="space-y-3">
      {EXPOSURE.map(e => (
        <div key={e.region}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-[var(--rhodex-text-dark)] font-medium">{e.region}</span>
            <span className="text-[var(--rhodex-text-dark-muted)]">{e.pct}%</span>
          </div>
          <div className="w-full border border-[var(--rhodex-text-dark)]/20 bg-black/5 h-2">
            <div
              className="h-full"
              style={{ width: `${e.pct}%`, backgroundColor: e.color }}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-[var(--rhodex-text-dark-muted)] pt-1">Anonymized portfolio · Gross written premium basis</p>
    </div>
  )
}

// ── Trigger status widget ─────────────────────────────────────────────────────

function TriggerWidget({ bondStatus }) {
  const triggered = Number(bondStatus) === 4
  const pct       = Math.min(100, Math.round((H1_TOTAL_B / TRIGGER_THRESHOLD_B) * 100))

  return (
    <BrutalCard className="p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-[var(--rhodex-text-dark)]">Trigger Status</span>
        {triggered ? (
          <BrutalTag className="border-red-600 text-red-700 bg-red-50">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Triggered
          </BrutalTag>
        ) : (
          <BrutalTag className="border-green-600 text-green-700 bg-green-50">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Safe
          </BrutalTag>
        )}
      </div>

      <p className="text-xs text-[var(--rhodex-text-dark-muted)] mb-3 leading-relaxed">
        Total economic nat cat losses ≥ <strong>${TRIGGER_THRESHOLD_B}B</strong> for calendar year 2026, per Gallagher Re Annual Report.
      </p>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-[var(--rhodex-text-dark-muted)] mb-1">
          <span>${H1_TOTAL_B}B confirmed (H1 2026)</span>
          <span>{pct}% of threshold</span>
        </div>
        <div className="w-full border border-[var(--rhodex-text-dark)]/20 bg-black/5 h-2.5">
          <div
            className="h-2.5 transition-all bg-[var(--rhodex-accent)]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--rhodex-text-dark-muted)] mt-1">
          <span>$0</span>
          <span>${TRIGGER_THRESHOLD_B}B</span>
        </div>
      </div>

      <div className="border-t-2 border-[var(--rhodex-text-dark)]/10 pt-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--rhodex-text-dark-muted)]">Total economic losses H1</span>
          <span className="font-semibold text-[var(--rhodex-text-dark)]">${H1_TOTAL_B}B</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[var(--rhodex-text-dark-muted)]">Insured losses H1 (ref.)</span>
          <span className="font-medium text-[var(--rhodex-text-dark-muted)]">${H1_INSURED_B}B</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[var(--rhodex-text-dark-muted)]">Remaining to trigger</span>
          <span className="font-semibold text-[var(--rhodex-text-dark)]">${TRIGGER_THRESHOLD_B - H1_TOTAL_B}B</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t-2 border-[var(--rhodex-text-dark)]/10 flex items-center gap-2">
        <div className="w-5 h-5 border-2 border-orange-300 bg-orange-50 flex items-center justify-center text-xs font-bold text-orange-600">G</div>
        <a
          href="https://www.ajg.com/gallagherre/news-and-insights/natural-catastrophe-and-climate-report-h1-2026/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[var(--rhodex-accent)] hover:underline"
        >
          Gallagher Re H1 2026 Report ›
        </a>
      </div>
    </BrutalCard>
  )
}

// ── Deposit two-step ──────────────────────────────────────────────────────────

function DepositFlow({ bondAddress, usdcAddr, depositAmount, depositTotal, tokenAllowance, tokenBalance, minInvestment, coverageAmount, totalDeposited, writeContract, isBusy, isConfirmed, writeError }) {
  const [flow, setFlow] = useState('idle')

  useEffect(() => {
    if (depositAmount > 0n && (tokenAllowance ?? 0n) >= depositTotal) setFlow('ready')
    else if (depositAmount > 0n) setFlow('idle')
  }, [depositAmount.toString(), tokenAllowance?.toString()])

  useEffect(() => {
    if (!isConfirmed) return
    if (flow === 'approving') setFlow('ready')
    if (flow === 'depositing') setFlow('idle')
  }, [isConfirmed])

  let validationError = null
  if (depositAmount > 0n) {
    if (minInvestment && depositAmount < minInvestment)
      validationError = `Below minimum: ${formatUSDC(minInvestment)}`
    else if (tokenBalance !== undefined && tokenBalance < depositTotal)
      validationError = `Insufficient balance — need ${formatUSDC(depositTotal)}, have ${formatUSDC(tokenBalance)}`
    else if (coverageAmount && totalDeposited !== undefined && depositAmount > coverageAmount - totalDeposited)
      validationError = `Exceeds remaining capacity — max ${formatUSDC(coverageAmount - totalDeposited)}`
  }

  const needsApprove    = flow === 'idle' || flow === 'approving'
  const approveConfirmed = flow === 'ready' || flow === 'depositing'

  if (depositAmount === 0n) return null

  return (
    <div className="space-y-3 mt-4">
      {validationError && (
        <div className="text-xs text-red-600 bg-red-50 border-2 border-red-200 p-2">{validationError}</div>
      )}
      {writeError && (
        <div className="text-xs text-red-600 bg-red-50 border-2 border-red-200 p-2">{parseError(writeError)}</div>
      )}
      {!validationError && (
        <>
          <div className="flex items-center gap-2 text-xs text-[var(--rhodex-text-dark-muted)]">
            <span className={`font-medium ${approveConfirmed ? 'text-green-600' : 'text-[var(--rhodex-accent)]'}`}>
              {approveConfirmed ? '✓' : '①'} Approve
            </span>
            <span className="text-[var(--rhodex-text-dark-muted)]">→</span>
            <span className={`font-medium ${approveConfirmed ? 'text-[var(--rhodex-accent)]' : 'text-[var(--rhodex-text-dark-muted)]'}`}>
              ② Deposit
            </span>
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            {needsApprove && (
              <BrutalButton
                tone="accent"
                onClick={() => { setFlow('approving'); writeContract({ address: usdcAddr, abi: ERC20_ABI, functionName: 'approve', args: [bondAddress, depositTotal * 10n] }) }}
                disabled={isBusy}
              >
                {flow === 'approving' && isBusy ? 'Approving…' : '① Approve Token'}
              </BrutalButton>
            )}
            {approveConfirmed && (
              <span className="text-xs text-green-600 font-medium bg-green-50 border-2 border-green-200 px-2 py-1">✓ Approved</span>
            )}
            <BrutalButton
              onClick={() => { setFlow('depositing'); writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'deposit', args: [depositAmount, depositAmount] }) }}
              disabled={isBusy || needsApprove}
            >
              {flow === 'depositing' && isBusy ? 'Depositing…' : '② Deposit'}
            </BrutalButton>
          </div>
          {needsApprove && <p className="text-xs text-[var(--rhodex-text-dark-muted)]">Approve first, then Deposit will unlock.</p>}
        </>
      )}
    </div>
  )
}

// ── Fund coupon budget two-step ───────────────────────────────────────────────

function FundFlow({ bondAddress, usdcAddr, budgetWithFee, tokenAllowance, writeContract, isBusy, isConfirmed }) {
  const [flow, setFlow] = useState('idle')

  useEffect(() => {
    if ((tokenAllowance ?? 0n) >= budgetWithFee && budgetWithFee > 0n) setFlow('ready')
    else setFlow('idle')
  }, [tokenAllowance?.toString(), budgetWithFee?.toString()])

  useEffect(() => {
    if (!isConfirmed) return
    if (flow === 'approving') setFlow('ready')
    if (flow === 'funding')   setFlow('idle')
  }, [isConfirmed])

  const needsApprove    = flow === 'idle' || flow === 'approving'
  const approveConfirmed = flow === 'ready' || flow === 'funding'

  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-[var(--rhodex-text-dark-muted)] mb-3">
        <span className={`font-medium ${approveConfirmed ? 'text-green-600' : 'text-[var(--rhodex-accent)]'}`}>
          {approveConfirmed ? '✓' : '①'} Approve token
        </span>
        <span className="text-[var(--rhodex-text-dark-muted)]">→</span>
        <span className={`font-medium ${approveConfirmed ? 'text-[var(--rhodex-accent)]' : 'text-[var(--rhodex-text-dark-muted)]'}`}>
          ② Fund Coupon Budget
        </span>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {needsApprove && (
          <BrutalButton
            tone="accent"
            onClick={() => { setFlow('approving'); writeContract({ address: usdcAddr, abi: ERC20_ABI, functionName: 'approve', args: [bondAddress, budgetWithFee * 10n] }) }}
            disabled={isBusy}
          >
            {flow === 'approving' && isBusy ? 'Approving…' : '① Approve Token'}
          </BrutalButton>
        )}
        {approveConfirmed && (
          <span className="text-xs text-green-600 font-medium bg-green-50 border-2 border-green-200 px-2 py-1">✓ Approved</span>
        )}
        <BrutalButton
          onClick={() => { setFlow('funding'); writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'fundCouponBudget' }) }}
          disabled={isBusy || needsApprove}
        >
          {flow === 'funding' && isBusy ? 'Funding…' : '② Fund Coupon Budget'}
        </BrutalButton>
      </div>
      {needsApprove && <p className="text-xs text-[var(--rhodex-text-dark-muted)] mt-2">Approve first so the bond contract can pull the coupon budget.</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const INPUT_CLASS = 'border-2 border-[var(--rhodex-text-dark)] bg-white rounded-none focus:outline-none focus:ring-2 focus:ring-[var(--rhodex-accent)]'

export default function DealPage() {
  const { address, isConnected } = useAccount()
  const [bondInput,   setBondInput]   = useState('')
  const [bondAddress, setBondAddress] = useState(null)
  const [depositInput, setDepositInput] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('catbond_address')
    if (saved && isAddress(saved)) { setBondAddress(saved); setBondInput(saved) }
  }, [])

  // ── Contract reads ────────────────────────────────────────────────────────
  const { data: bondData, refetch: refetchBond } = useReadContracts({
    contracts: bondAddress ? [
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'status' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'sponsor' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'companyWallet' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'usdc' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'couponRateBps' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'coverageAmount' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'minInvestment' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'requiredCouponBudget' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'subscriptionEnd' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'maturity' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'settlementTime' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'totalDeposited' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'termDuration' },
    ] : [],
  })

  const [
    status, sponsor, companyWallet, usdcAddr,
    couponRateBps, coverageAmount, minInvestment, requiredCouponBudget,
    subscriptionEnd, maturity, settlementTime, totalDeposited, termDuration,
  ] = bondData?.map(r => r.result) ?? []

  const { data: userData, refetch: refetchUser } = useReadContracts({
    contracts: bondAddress && address && usdcAddr ? [
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'principalOf',        args: [address] },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'alreadyClaimed',     args: [address] },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'principalWithdrawn', args: [address] },
      { address: usdcAddr,    abi: ERC20_ABI,   functionName: 'balanceOf',          args: [address] },
      { address: usdcAddr,    abi: ERC20_ABI,   functionName: 'allowance',          args: [address, bondAddress] },
    ] : [],
  })
  const [principalOf, alreadyClaimed, principalWithdrawn, tokenBalance, tokenAllowance] =
    userData?.map(r => r.result) ?? []

  const { writeContract, isPending: isWriting, data: txHash, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => { if (isConfirmed) { refetchBond(); refetchUser() } }, [isConfirmed])

  useEffect(() => {
    const s = Number(status ?? 0)
    if (s !== 1 && s !== 2) return
    const id = setInterval(() => { refetchBond(); refetchUser() }, 15_000)
    return () => clearInterval(id)
  }, [status])

  // ── Derived ───────────────────────────────────────────────────────────────
  const statusNum  = Number(status ?? 0)
  const isBusy     = isWriting || isConfirming
  const now        = BigInt(Math.floor(Date.now() / 1000))
  const isSponsor  = !!address && !!sponsor  && address.toLowerCase() === sponsor.toLowerCase()
  const isCompany  = !!address && !!companyWallet && address.toLowerCase() === companyWallet.toLowerCase()

  const pctFilled = coverageAmount && coverageAmount > 0n
    ? Math.min(100, Number((totalDeposited ?? 0n) * 100n / coverageAmount))
    : 0
  const fullySubscribed = coverageAmount && totalDeposited ? totalDeposited >= coverageAmount : false

  const budgetWithFee = requiredCouponBudget ? (requiredCouponBudget * 10050n) / 10000n : 0n
  const depositAmount = safeParseUSDC(depositInput)
  const depositTotal  = depositAmount > 0n ? (depositAmount * 10050n) / 10000n : 0n
  const termDays      = termDuration ? Math.round(Number(termDuration) / 86400) : null

  // Total coupon an investor earns over the full term (flat rate × principal)
  const totalCoupon   = principalOf && couponRateBps
    ? (principalOf * BigInt(Number(couponRateBps))) / 10000n
    : 0n
  const claimedPct    = totalCoupon > 0n
    ? Math.min(100, Number((alreadyClaimed ?? 0n) * 100n / totalCoupon))
    : 0

  function loadBond() {
    if (!isAddress(bondInput)) return alert('Invalid Ethereum address')
    setBondAddress(bondInput)
    localStorage.setItem('catbond_address', bondInput)
    setDepositInput('')
  }

  function write(fn, args) {
    writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: fn, ...(args ? { args } : {}) })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen font-mono text-[var(--rhodex-text-dark)]">
      {/* Fixed full-viewport gradient layer — keeps the gradient visually
          consistent as the (much taller than one screen) deal page scrolls,
          instead of the gradient stretching thin across the whole content
          height and reading as flat near-white at the top. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background: 'var(--rhodex-bg)' }} />

      {/* Header */}
      <header className="sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold tracking-tight text-[var(--rhodex-text-dark)]">
              RHODEX.
            </h1>
            <BrutalTag className="translate-y-[3px] border-orange-400 bg-transparent text-orange-600 shadow-[0_0_6px_1px_rgba(249,115,22,0.6)]">Testnet</BrutalTag>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/admin" className="text-sm text-[var(--rhodex-text-dark-muted)] hover:text-[var(--rhodex-text-dark)] transition-colors">Admin ›</Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-5">

        {/* Load bond */}
        <BrutalCard className="p-5">
          <div className="flex gap-3">
            <input
              type="text"
              value={bondInput}
              onChange={e => setBondInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadBond()}
              placeholder="Paste CatBond contract address to load deal…"
              className={`flex-1 px-4 py-2.5 font-mono text-sm ${INPUT_CLASS}`}
            />
            <BrutalButton onClick={loadBond}>
              Load
            </BrutalButton>
          </div>
        </BrutalCard>

        {/* Tx banner — spans full width */}
        {bondAddress && <TxBanner isWriting={isWriting} isConfirming={isConfirming} isConfirmed={isConfirmed} hash={txHash} error={writeError} />}

        {bondAddress && bondData && (
          <div className="grid lg:grid-cols-3 gap-5">

            {/* ── LEFT COLUMN (2/3) ────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* Deal hero */}
              <BrutalCard className="p-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <p className="text-xs font-medium text-[var(--rhodex-text-dark-muted)] uppercase tracking-wide mb-1">
                      Sponsor · {SPONSOR.name}, {SPONSOR.hq}
                    </p>
                    <h2 className="text-xl font-bold text-[var(--rhodex-text-dark)]">Global Natural Catastrophe Loss 2026</h2>
                    <p className="text-sm text-[var(--rhodex-text-dark-muted)] mt-1 leading-relaxed">
                      Fires if global total economic natural catastrophe losses exceed{' '}
                      <strong>${TRIGGER_THRESHOLD_B}B</strong> for calendar year 2026,
                      as confirmed by the Gallagher Re Annual Report.
                    </p>
                  </div>
                  <span className={`flex-shrink-0 border-2 border-current px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusColor(status)}`}>
                    {statusLabel(status)}
                  </span>
                </div>

                {/* Fill bar */}
                <div className="mb-5">
                  <div className="flex justify-between text-xs text-[var(--rhodex-text-dark-muted)] mb-1.5">
                    <span>Principal subscribed</span>
                    <span>{pctFilled}% · {formatUSDC(totalDeposited)} of {formatUSDC(coverageAmount)}</span>
                  </div>
                  <div className="w-full border border-[var(--rhodex-text-dark)]/20 bg-black/5 h-2">
                    <div className="bg-[var(--rhodex-accent)] h-full transition-all" style={{ width: `${pctFilled}%` }} />
                  </div>
                </div>

                {/* Key stats */}
                <div className="grid grid-cols-4 gap-4 pt-4 border-t-2 border-[var(--rhodex-text-dark)]/10">
                  <StatChip label="Coverage"   value={formatUSDC(coverageAmount)} />
                  <StatChip label="Coupon"     value={formatBps(couponRateBps)} />
                  <StatChip label="Term"       value={termDays ? `${termDays} days` : '—'} />
                  <StatChip label="Min invest" value={formatUSDC(minInvestment)} />
                </div>
              </BrutalCard>

              {/* Historical chart */}
              <BrutalCard className="p-6">
                <h3 className="font-semibold text-[var(--rhodex-text-dark)] mb-4">Historical Insured Losses vs Trigger</h3>
                <HistoricalChart />
              </BrutalCard>

              {/* Investment layer / action card */}
              <BrutalCard className="p-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-[var(--rhodex-text-dark)]">Investment Layer</h3>
                  <span className="text-xs text-[var(--rhodex-text-dark-muted)]">Layer 1 of 1</span>
                </div>
                <p className="text-xs text-[var(--rhodex-text-dark-muted)] mb-5">
                  Insured losses ≥ ${TRIGGER_THRESHOLD_B}B · {formatUSDC(coverageAmount)} coverage · {formatBps(couponRateBps)} coupon · {termDays}-day term
                </p>

                {/* Phase 0: Funding */}
                {statusNum === 0 && isSponsor && (
                  <div>
                    <p className="text-sm text-[var(--rhodex-text-dark-muted)] mb-4">
                      Deposit the coupon budget to open the subscription window.
                    </p>
                    <div className="grid grid-cols-3 gap-4 text-sm mb-5 p-3 border-2 border-[var(--rhodex-text-dark)]/15 bg-black/5">
                      <div><div className="text-xs text-[var(--rhodex-text-dark-muted)]">Coupon budget</div><div className="font-semibold">{formatUSDC(requiredCouponBudget)}</div></div>
                      <div><div className="text-xs text-[var(--rhodex-text-dark-muted)]">0.5% fee</div><div className="font-semibold">{formatUSDC(budgetWithFee > 0n ? budgetWithFee - requiredCouponBudget : 0n)}</div></div>
                      <div><div className="text-xs text-[var(--rhodex-accent)]">You pay</div><div className="font-semibold text-[var(--rhodex-accent)]">{formatUSDC(budgetWithFee)}</div></div>
                    </div>
                    <FundFlow
                      bondAddress={bondAddress}
                      usdcAddr={usdcAddr}
                      budgetWithFee={budgetWithFee}
                      tokenAllowance={tokenAllowance}
                      writeContract={writeContract}
                      isBusy={isBusy}
                      isConfirmed={isConfirmed}
                    />
                  </div>
                )}

                {statusNum === 0 && !isSponsor && (
                  <div className="flex items-center gap-3 text-[var(--rhodex-text-dark-muted)] text-sm">
                    <span className="text-xl">⏳</span>
                    <span>Awaiting sponsor funding — subscription not yet open.</span>
                  </div>
                )}

                {/* Phase 1: Subscription — deposit flow */}
                {statusNum === 1 && (
                  <div>
                    {isConnected ? (
                      <>
                        <div className="flex justify-between text-xs text-[var(--rhodex-text-dark-muted)] mb-3">
                          <span>Closes {subscriptionEnd ? formatDate(subscriptionEnd) : '—'}</span>
                          <span>Remaining: {formatUSDC(coverageAmount && totalDeposited ? coverageAmount - totalDeposited : 0n)}</span>
                        </div>
                        <label className="block text-xs text-[var(--rhodex-text-dark-muted)] mb-1">Amount (RDX)</label>
                        <input
                          type="number"
                          value={depositInput}
                          onChange={e => setDepositInput(e.target.value)}
                          placeholder={`Min ${formatUSDC(minInvestment)}`}
                          className={`w-full sm:w-64 px-4 py-2.5 text-sm ${INPUT_CLASS}`}
                        />
                        {depositAmount > 0n && (
                          <p className="text-xs text-[var(--rhodex-text-dark-muted)] mt-1">
                            Total incl. 0.5% fee: <strong>{formatUSDC(depositTotal)}</strong>
                          </p>
                        )}
                        <DepositFlow
                          bondAddress={bondAddress}
                          usdcAddr={usdcAddr}
                          depositAmount={depositAmount}
                          depositTotal={depositTotal}
                          tokenAllowance={tokenAllowance}
                          tokenBalance={tokenBalance}
                          minInvestment={minInvestment}
                          coverageAmount={coverageAmount}
                          totalDeposited={totalDeposited}
                          writeContract={writeContract}
                          isBusy={isBusy}
                          isConfirmed={isConfirmed}
                          writeError={writeError}
                        />

                        {/* Close subscription — anyone can call once full or expired */}
                        {(fullySubscribed || (subscriptionEnd && now >= subscriptionEnd)) && (
                          <div className="mt-5 pt-5 border-t-2 border-[var(--rhodex-text-dark)]/10">
                            <BrutalButton size="px-4 py-2 text-sm" onClick={() => write('closeSubscription')} disabled={isBusy}>
                              Close Subscription &amp; Activate Bond
                            </BrutalButton>
                            <p className="text-xs text-[var(--rhodex-text-dark-muted)] mt-1">
                              {fullySubscribed
                                ? 'Coverage fully subscribed — no need to wait for the window to expire.'
                                : 'Subscription window expired.'}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-[var(--rhodex-text-dark-muted)] mb-3">Connect your wallet to invest in this bond.</p>
                        <ConnectButton />
                      </div>
                    )}
                  </div>
                )}

                {/* Phase 2: Active */}
                {statusNum === 2 && (
                  <div className="flex items-center gap-3 text-[var(--rhodex-text-dark-muted)] text-sm">
                    <span className="text-xl">🔒</span>
                    <span>Bond is active. Subscription closed {formatDate(subscriptionEnd)}.</span>
                  </div>
                )}

                {/* Phase 3: Matured */}
                {statusNum === 3 && (
                  <div className="flex items-center gap-3 text-green-700 text-sm">
                    <span className="text-xl">✓</span>
                    <span>Bond matured successfully. No trigger event occurred.</span>
                  </div>
                )}

                {/* Phase 4: Triggered */}
                {statusNum === 4 && (
                  <div className="flex items-center gap-3 text-red-700 text-sm">
                    <span className="text-xl">🔴</span>
                    <span>Trigger fired. Principal transferred to sponsor at settlement.</span>
                  </div>
                )}
              </BrutalCard>

              {/* Deal disclosure strip */}
              <div
                className="rounded-none border-2 border-[var(--rhodex-text-dark)] shadow-[4px_4px_0_0_var(--rhodex-text-dark)] p-5 text-white"
                style={{ background: 'var(--rhodex-card-footer-bg)' }}
              >
                <h3 className="text-xs font-semibold mb-4 text-white/50 tracking-widest uppercase">
                  Deal Disclosure
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Coverage', value: formatUSDC(coverageAmount) },
                    { label: 'Layers',   value: '1' },
                    { label: 'Coupon',   value: formatBps(couponRateBps) },
                    { label: 'Term',     value: termDays ? `${termDays}d` : '—' },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="text-xs text-white/50 mb-0.5">{label}</div>
                      <div className="font-bold text-lg text-white">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sponsor summary */}
              <BrutalCard className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 border-2 border-[var(--rhodex-text-dark)] bg-[var(--rhodex-accent)] flex items-center justify-center text-white font-bold text-lg">R</div>
                  <div>
                    <div className="font-semibold text-[var(--rhodex-text-dark)]">{SPONSOR.name}</div>
                    <div className="text-xs text-[var(--rhodex-text-dark-muted)]">{SPONSOR.hq} · Specialty Reinsurer</div>
                  </div>
                </div>
                <p className="text-sm text-[var(--rhodex-text-dark-muted)] leading-relaxed mb-4">{SPONSOR.description}</p>
                <BrutalButton
                  tone="ghost"
                  size="px-4 py-2 text-sm"
                  disabled
                  title="Document upload coming soon"
                >
                  ↓ Statement of Values (SOV)
                </BrutalButton>
              </BrutalCard>

              {/* Exposure map */}
              <BrutalCard className="p-6">
                <h3 className="font-semibold text-[var(--rhodex-text-dark)] mb-4">Portfolio Exposure</h3>
                <ExposureMap />
              </BrutalCard>

            </div>

            {/* ── RIGHT COLUMN (1/3) ───────────────────────────────────── */}
            <div className="space-y-4">

              {/* Your position — only when invested */}
              {isConnected && principalOf !== undefined && principalOf > 0n && (
                <BrutalCard className="p-5">
                  <h3 className="font-semibold text-[var(--rhodex-text-dark)] mb-1">Your Position</h3>
                  <div className="text-3xl font-bold text-[var(--rhodex-text-dark)] mb-0.5">{formatUSDC(principalOf)}</div>
                  <div className="text-xs text-[var(--rhodex-text-dark-muted)] mb-4">Principal deposited</div>

                  {/* Coupon progress bar */}
                  {totalCoupon > 0n && (
                    <div className="mb-4 p-3 border-2 border-green-200 bg-green-50">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-green-700 font-medium">Coupon earned</span>
                        <span className="text-green-700 font-semibold">{claimedPct}%</span>
                      </div>
                      <div className="w-full border border-green-300 bg-green-100/50 h-2.5 mb-2">
                        <div
                          className="h-full bg-green-500 transition-all"
                          style={{ width: `${claimedPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-green-600">
                        <span>{formatUSDC(alreadyClaimed ?? 0n)} claimed</span>
                        <span>{formatUSDC(totalCoupon)} total</span>
                      </div>
                      <div className="text-xs text-green-500 mt-1">
                        {formatUSDC(totalCoupon - (alreadyClaimed ?? 0n))} remaining
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--rhodex-text-dark-muted)]">Wallet balance</span>
                      <span className="font-medium">{formatUSDC(tokenBalance)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--rhodex-text-dark-muted)]">Principal withdrawn</span>
                      <span className="font-medium">{principalWithdrawn ? 'Yes ✓' : 'No'}</span>
                    </div>
                  </div>

                  {/* Coupon claim — Active or Triggered */}
                  {(statusNum === 2 || statusNum === 4) && (
                    <BrutalButton size="w-full py-2.5 text-sm" onClick={() => write('claimCoupon')} disabled={isBusy} className="mb-2">
                      Claim Coupon
                    </BrutalButton>
                  )}

                  {/* Withdraw principal — Matured */}
                  {statusNum === 3 && (
                    <>
                      <BrutalButton
                        tone="success"
                        size="w-full py-2.5 text-sm"
                        onClick={() => write('withdrawPrincipal')}
                        disabled={isBusy || !!principalWithdrawn}
                        className="mb-2"
                      >
                        {principalWithdrawn ? 'Principal Withdrawn ✓' : 'Withdraw Principal'}
                      </BrutalButton>
                      <BrutalButton size="w-full py-2.5 text-sm" onClick={() => write('claimCoupon')} disabled={isBusy}>
                        Claim Remaining Coupon
                      </BrutalButton>
                    </>
                  )}
                </BrutalCard>
              )}

              {/* Connect prompt when not connected */}
              {!isConnected && (
                <BrutalCard className="p-5 text-center">
                  <p className="text-sm text-[var(--rhodex-text-dark-muted)] mb-3">Connect your wallet to see your position.</p>
                  <ConnectButton />
                </BrutalCard>
              )}

              {/* Trigger status */}
              {bondAddress && <TriggerWidget bondStatus={status} />}

              {/* Related news */}
              <BrutalCard className="p-5">
                <h3 className="font-semibold text-[var(--rhodex-text-dark)] mb-3">Related Reports</h3>
                <div className="space-y-4">
                  {NEWS.map((n, i) => (
                    <div key={i} className="border-b-2 border-[var(--rhodex-text-dark)]/10 last:border-0 pb-4 last:pb-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs font-medium text-orange-600">{n.source}</span>
                        <span className="text-xs text-[var(--rhodex-text-dark-muted)]">· {n.date}</span>
                      </div>
                      <a href={n.url} target="_blank" rel="noopener noreferrer"
                        className="text-sm font-medium text-[var(--rhodex-text-dark)] hover:text-[var(--rhodex-accent)] block mb-1">
                        {n.title} ›
                      </a>
                      <p className="text-xs text-[var(--rhodex-text-dark-muted)] leading-relaxed">{n.summary}</p>
                    </div>
                  ))}
                </div>
              </BrutalCard>

              {/* Refresh */}
              <div className="text-center">
                <button onClick={() => { refetchBond(); refetchUser() }} className="text-xs text-[var(--rhodex-text-dark-muted)] hover:text-[var(--rhodex-text-dark)] underline">
                  Refresh data
                </button>
              </div>

            </div>
          </div>
        )}
      </main>
    </div>
  )
}
