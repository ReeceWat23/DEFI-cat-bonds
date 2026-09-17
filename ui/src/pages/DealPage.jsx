import { useState, useEffect } from 'react'
import {
  useAccount, useConnect, useDisconnect,
  useReadContracts, useWriteContract, useWaitForTransactionReceipt,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { Link } from 'react-router-dom'
import { isAddress } from 'viem'
import { CATBOND_ABI, TRIGGER_ABI, ERC20_ABI } from '../constants/abis'
import { ActionButton, Surface, Tag } from '../theme/primitives'
import { useTheme } from '../theme/ThemeProvider'
import ThemeSwitcher from '../theme/ThemeSwitcher'
import { TRIGGER_TYPES } from '../data/historicalLoss'
import {
  formatUSDC, safeParseUSDC, formatDate, formatBps, formatAge,
  statusLabel,
} from '../lib/utils'

// Text-only color per bond status, for the ghost status badge (no flat
// fill — just current-color text/border over the translucent white).
const STATUS_TEXT_COLOR = ['#374151', '#1e40af', '#166534', '#6b21a8', '#991b1b']

// Cycling palette for the exposure chart — the contract stores region/pct
// pairs only, no color, so colors are assigned by position here.
const EXPOSURE_PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4']

const NEWS = [
  {
    title:   'Natural Catastrophe & Climate Report — H1 2026',
    source:  'Gallagher Re',
    date:    'July 2026',
    url:     'https://www.ajg.com/gallagherre/news-and-insights/natural-catastrophe-and-climate-report-h1-2026/',
    summary: 'Atlantic hurricane season forecast remains above average with elevated La Niña conditions.',
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
  StaleReport:          "The trigger's latest report is older than its refresh window — ask the company wallet to post a fresh one.",
  NoReports:            'No report has been posted to this trigger since the bond went active yet.',
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
      <ActionButton tone="ghost" size="px-3 py-1.5 text-xs" onClick={() => disconnect()}>
        Disconnect
      </ActionButton>
    </div>
  )
  return (
    <ActionButton size="px-4 py-2 text-sm" onClick={() => connect({ connector: injected() })}>
      Connect Wallet
    </ActionButton>
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

// ── Sponsor identity logo ─────────────────────────────────────────────────────
// Solid accent-color square, first letter of the seller name, white,
// IBM Plex Mono, uppercase. Empty/non-alphabetic name -> blank square,
// never a broken glyph.

function SponsorLogo({ name, size = 40 }) {
  const letter = name && /[a-zA-Z]/.test(name.charAt(0)) ? name.charAt(0).toUpperCase() : null
  return (
    <div
      className="rhodex-mono flex items-center justify-center shrink-0 rounded-[4px] font-bold text-white"
      style={{
        width: size, height: size,
        backgroundColor: 'var(--rhodex-accent)',
        fontSize: Math.round(size * 0.45),
      }}
    >
      {letter}
    </div>
  )
}

// ── Historical loss chart ─────────────────────────────────────────────────────
// Data-driven by the bond's own on-chain trigger type — dealType picks the
// series and scale from TRIGGER_TYPES (shared with the /build workshop's
// chart, same convention: illustrative until a real feed backs it).

function HistoricalChart({ triggerType, thresholdB, reportedB }) {
  if (!triggerType) return null
  const { history, maxB } = triggerType
  const thresholdPct = maxB ? (thresholdB / maxB) * 100 : 0
  const reportedPct  = reportedB > 0 && maxB ? (reportedB / maxB) * 100 : null

  return (
    <div>
      <div className="flex items-end justify-between mb-1">
        <span className="text-xs text-[var(--rhodex-text-dark-muted)]">Annual {triggerType.label.toLowerCase()} ($B)</span>
        <span className="text-xs text-red-500 font-medium">— ${thresholdB}B trigger</span>
      </div>
      <div className="relative" style={{ height: '120px' }}>
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 z-10 pointer-events-none"
          style={{ bottom: `${Math.min(100, thresholdPct)}%` }}
        />
        {reportedPct !== null && (
          <div
            className="absolute left-0 right-0 border-t-2 border-dashed border-blue-400 z-10 pointer-events-none"
            style={{ bottom: `${Math.min(100, reportedPct)}%` }}
          />
        )}
        <div className="absolute inset-0 flex items-end gap-1">
          {history.map((d, i) => {
            const heightPct = (d.valueB / maxB) * 100
            const isHigh    = d.valueB >= thresholdB
            return (
              <div key={d.year} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className="w-full origin-bottom rounded-t-md transition-[filter] duration-200 group-hover:brightness-110 animate-bar-grow"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: isHigh ? 'rgba(248,113,113,0.55)' : 'rgba(47,83,148,0.55)',
                    animationDelay: `${i * 35}ms`,
                  }}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[var(--rhodex-text-dark)] text-white text-xs rounded-none px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20">
                  {d.year}: ${d.valueB}B
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex gap-1 mt-1">
        {history.map(d => (
          <div key={d.year} className="flex-1 text-center text-xs text-[var(--rhodex-text-dark-muted)]">{String(d.year).slice(2)}</div>
        ))}
      </div>
      {reportedB > 0 && (
        <div className="mt-2 text-xs text-[var(--rhodex-accent)] font-medium">— ${reportedB}B latest reported</div>
      )}
      <div className="mt-2 text-xs text-[var(--rhodex-text-dark-muted)]">Source: Gallagher Re · Swiss Re sigma (illustrative)</div>
    </div>
  )
}

// ── Geographic exposure ───────────────────────────────────────────────────────
// Renders the region array read straight off the contract's getExposure().
// Under 100%, the remainder shows as an explicit "Unallocated" segment
// rather than silently scaling the chart to fill — a gap is information.

function ExposureMap({ regions }) {
  if (!regions || regions.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-[var(--rhodex-text-dark)]/20 p-6 text-center text-sm text-[var(--rhodex-text-dark-muted)]">
        No exposure breakdown disclosed for this deal.
      </div>
    )
  }

  const colored = regions.map((r, i) => ({ ...r, color: EXPOSURE_PALETTE[i % EXPOSURE_PALETTE.length] }))
  const totalPct = colored.reduce((sum, r) => sum + r.pct, 0)
  const unallocated = Math.max(0, 100 - totalPct)

  return (
    <div>
      {/* Proportional area chart — each block's width (and so its area,
          since height is shared) matches its share of the portfolio. */}
      <div className="flex w-full h-36 gap-0.5 overflow-hidden border border-[var(--rhodex-text-dark)]/20">
        {colored.map(e => (
          <div
            key={e.region}
            title={`${e.region}: ${e.pct}%`}
            className="relative flex flex-col justify-end overflow-hidden p-2"
            style={{ width: `${e.pct}%`, backgroundColor: e.color }}
          >
            {e.pct >= 10 && (
              <>
                <span className="text-xs font-semibold leading-tight text-white">{e.region}</span>
                <span className="text-[11px] text-white/85">{e.pct}%</span>
              </>
            )}
          </div>
        ))}
        {unallocated > 0 && (
          <div
            title={`Unallocated: ${unallocated}%`}
            className="relative flex flex-col justify-end overflow-hidden p-2 bg-[var(--rhodex-text-dark)]/10"
            style={{ width: `${unallocated}%` }}
          >
            {unallocated >= 10 && <span className="text-[11px] text-[var(--rhodex-text-dark-muted)]">Unallocated</span>}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {colored.map(e => (
          <div key={e.region} className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 inline-block shrink-0" style={{ backgroundColor: e.color }} />
            <span className="text-[var(--rhodex-text-dark)] font-medium">{e.region}</span>
            <span className="text-[var(--rhodex-text-dark-muted)]">{e.pct}%</span>
          </div>
        ))}
        {unallocated > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 inline-block shrink-0 bg-[var(--rhodex-text-dark)]/10" />
            <span className="text-[var(--rhodex-text-dark-muted)]">Unallocated</span>
            <span className="text-[var(--rhodex-text-dark-muted)]">{unallocated}%</span>
          </div>
        )}
      </div>
      <p className="text-xs text-[var(--rhodex-text-dark-muted)] pt-3">
        Anonymized portfolio · Gross written premium basis — this chart is the disclosure, there's no separate SOV download.
      </p>
    </div>
  )
}

// ── Trigger status widget ─────────────────────────────────────────────────────
// Three states, each its own visual treatment (Plan-it-2 dealpage §5.4).
// Post-§2.4 rewrite: "triggered" is no longer a stored flag — it's the
// bond's own lastCheck.triggered, only as fresh as the last confirmed
// checkTrigger() call (see the Self-check button below).
//   not_triggered — lastCheck.triggered false, or never checked yet
//   triggered     — lastCheck.triggered true but settle() hasn't run yet
//   settled       — bond status is Status.Triggered (settle() has run)

const TRIGGER_STATE_STYLE = {
  not_triggered: { label: 'Safe',      dot: 'bg-green-500', tag: 'border-green-600 text-green-700 bg-green-50' },
  triggered:     { label: 'Triggered', dot: 'bg-amber-500', tag: 'border-amber-600 text-amber-700 bg-amber-50' },
  settled:       { label: 'Settled',   dot: 'bg-red-500',   tag: 'border-red-600 text-red-700 bg-red-50' },
}

function TriggerWidget({ triggerType, thresholdB, reportedB, hasBeenChecked, lastCheckAge, likelyTriggered, onSelfCheck, canSelfCheck, isBusy, triggerState }) {
  const pct = thresholdB > 0 ? Math.min(100, Math.round((reportedB / thresholdB) * 100)) : 0
  const style = TRIGGER_STATE_STYLE[triggerState] ?? TRIGGER_STATE_STYLE.not_triggered
  const unitLabel = triggerType ? `${triggerType.label}, USD` : '—'

  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-[var(--rhodex-text-dark)]">Trigger Status</span>
        <Tag className={style.tag}>
          <span className={`w-2 h-2 rounded-full inline-block ${style.dot}`} /> {style.label}
        </Tag>
      </div>

      <p className="text-xs text-[var(--rhodex-text-dark-muted)] mb-3 leading-relaxed">
        {triggerType ? `${triggerType.label} ≥` : 'Loss'} <strong>${thresholdB}B</strong> ({unitLabel}), per Gallagher Re report — annual aggregate.
      </p>

      <div className="mb-3">
        <div className="flex justify-between text-xs text-[var(--rhodex-text-dark-muted)] mb-1">
          <span>{reportedB > 0 ? `$${reportedB}B latest reported` : 'No report yet'}</span>
          <span>{pct}% of threshold</span>
        </div>
        <div className="w-full border border-[var(--rhodex-text-dark)]/20 bg-black/5 h-2.5">
          <div className="h-2.5 transition-all bg-[var(--rhodex-accent)]" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-xs text-[var(--rhodex-text-dark-muted)] mt-1">
          <span>$0</span>
          <span>${thresholdB}B</span>
        </div>
      </div>

      <div className="border-t-2 border-[var(--rhodex-text-dark)]/10 pt-3 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--rhodex-text-dark-muted)]">Latest reported</span>
          <span className="font-semibold text-[var(--rhodex-text-dark)]">{reportedB > 0 ? `$${reportedB}B` : '—'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-[var(--rhodex-text-dark-muted)]">Remaining to trigger</span>
          <span className="font-semibold text-[var(--rhodex-text-dark)]">{reportedB < thresholdB ? `$${thresholdB - reportedB}B` : '$0B'}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t-2 border-[var(--rhodex-text-dark)]/10 flex items-center gap-2">
        <div className="w-5 h-5 border-2 border-orange-300 bg-orange-50 flex items-center justify-center text-xs font-bold text-orange-600">G</div>
        <span className="text-xs text-[var(--rhodex-text-dark-muted)]">Verified by Gallagher Re</span>
      </div>

      {/* Two distinct signals — never trust the company wallet's word alone.
          hasBeenChecked/triggerState is the bond's own on-chain-confirmed
          answer from lastCheck; likelyTriggered is a free, unconfirmed
          client-side comparison. Self-check lets any connected wallet pay
          their own gas to bring lastCheck up to date — the same mechanic
          this project verified live with an investor independently
          confirming a trigger fired rather than trusting the sponsor. */}
      <div className="mt-3 pt-3 border-t-2 border-[var(--rhodex-text-dark)]/10">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-[var(--rhodex-text-dark-muted)]">
            {hasBeenChecked ? `On-chain confirmed ${lastCheckAge}` : 'Not yet confirmed on-chain'}
          </span>
          {likelyTriggered !== undefined && (
            <span className={likelyTriggered ? 'text-amber-600 font-medium' : 'text-[var(--rhodex-text-dark-muted)]'}>
              {likelyTriggered ? 'Latest report: at/above threshold' : 'Latest report: below threshold'}
            </span>
          )}
        </div>
        <button
          onClick={onSelfCheck}
          disabled={!canSelfCheck || isBusy}
          className="w-full py-1.5 text-xs font-medium border-2 border-[var(--rhodex-text-dark)]/20 hover:border-[var(--rhodex-text-dark)]/40 disabled:opacity-40 transition-colors"
        >
          {isBusy ? 'Confirming…' : 'Self-check (checkTrigger)'}
        </button>
      </div>
    </Surface>
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
              <ActionButton
                tone="accent"
                onClick={() => { setFlow('approving'); writeContract({ address: usdcAddr, abi: ERC20_ABI, functionName: 'approve', args: [bondAddress, depositTotal * 10n] }) }}
                disabled={isBusy}
              >
                {flow === 'approving' && isBusy ? 'Approving…' : '① Approve Token'}
              </ActionButton>
            )}
            {approveConfirmed && (
              <span className="text-xs text-green-600 font-medium bg-green-50 border-2 border-green-200 px-2 py-1">✓ Approved</span>
            )}
            <ActionButton
              onClick={() => { setFlow('depositing'); writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'deposit', args: [depositAmount, depositAmount] }) }}
              disabled={isBusy || needsApprove}
            >
              {flow === 'depositing' && isBusy ? 'Depositing…' : '② Deposit'}
            </ActionButton>
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
          <ActionButton
            tone="accent"
            onClick={() => { setFlow('approving'); writeContract({ address: usdcAddr, abi: ERC20_ABI, functionName: 'approve', args: [bondAddress, budgetWithFee * 10n] }) }}
            disabled={isBusy}
          >
            {flow === 'approving' && isBusy ? 'Approving…' : '① Approve Token'}
          </ActionButton>
        )}
        {approveConfirmed && (
          <span className="text-xs text-green-600 font-medium bg-green-50 border-2 border-green-200 px-2 py-1">✓ Approved</span>
        )}
        <ActionButton
          onClick={() => { setFlow('funding'); writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'fundCouponBudget' }) }}
          disabled={isBusy || needsApprove}
        >
          {flow === 'funding' && isBusy ? 'Funding…' : '② Fund Coupon Budget'}
        </ActionButton>
      </div>
      {needsApprove && <p className="text-xs text-[var(--rhodex-text-dark-muted)] mt-2">Approve first so the bond contract can pull the coupon budget.</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const INPUT_CLASS = {
  lapis: 'border-2 border-[var(--rhodex-text-dark)] bg-white rounded-none focus:outline-none focus:ring-2 focus:ring-[var(--rhodex-accent)]',
  ghost: 'border border-[var(--rhodex-hairline)] bg-transparent rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[var(--rhodex-accent)]',
}

export default function DealPage() {
  const { themeId } = useTheme()
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
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'trigger' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'threshold' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'lastCheck' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'sellerName' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'verified' },
      { address: bondAddress, abi: CATBOND_ABI, functionName: 'getExposure' },
    ] : [],
  })

  const [
    status, sponsor, companyWallet, usdcAddr,
    couponRateBps, coverageAmount, minInvestment, requiredCouponBudget,
    subscriptionEnd, maturity, settlementTime, totalDeposited, termDuration,
    triggerAddr, bondThreshold, lastCheck, sellerName, verified, exposureRaw,
  ] = bondData?.map(r => r.result) ?? []

  const [, , lastCheckTriggered, lastCheckAt] = lastCheck ?? []

  const exposureRegions = (exposureRaw ?? []).map(r => ({ region: r.region, pct: Number(r.pct) }))

  // ── Trigger contract reads — the trigger is now an append-only report log
  // (§2.4), not a triggered flag. reportCount/latestReport/productConfig
  // replace dealType/lossLimit/reportedValue/reportedSource/isTriggered —
  // same source AdminPage's ManageSection reads. ──
  const { data: triggerData, refetch: refetchTrigger } = useReadContracts({
    contracts: triggerAddr ? [
      { address: triggerAddr, abi: TRIGGER_ABI, functionName: 'reportCount' },
      { address: triggerAddr, abi: TRIGGER_ABI, functionName: 'latestReport' },
      { address: triggerAddr, abi: TRIGGER_ABI, functionName: 'productConfig' },
    ] : [],
  })
  const [reportCount, latestReport, productConfig] = triggerData?.map(r => r.result) ?? []
  // latestReport() has a single Report-struct output, so viem decodes it as
  // a named object ({value, reportedAt, ...}), not an array like the
  // multi-output productConfig()/lastCheck() below — read fields by name.
  const latestValue = latestReport?.value
  const latestReportedAt = latestReport?.reportedAt
  const [, , valuePath] = productConfig ?? []
  const hasReports = reportCount !== undefined && Number(reportCount) > 0
  const hasBeenChecked = lastCheckAt !== undefined && Number(lastCheckAt) > 0

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

  useEffect(() => { if (isConfirmed) { refetchBond(); refetchUser(); refetchTrigger() } }, [isConfirmed])

  useEffect(() => {
    const s = Number(status ?? 0)
    if (s !== 1 && s !== 2) return
    const id = setInterval(() => { refetchBond(); refetchUser(); refetchTrigger() }, 15_000)
    return () => clearInterval(id)
  }, [status])

  // ── Derived ───────────────────────────────────────────────────────────────
  const statusNum  = Number(status ?? 0)
  const isBusy     = isWriting || isConfirming
  const now        = BigInt(Math.floor(Date.now() / 1000))
  const isSponsor  = !!address && !!sponsor  && address.toLowerCase() === sponsor.toLowerCase()
  const isCompany  = !!address && !!companyWallet && address.toLowerCase() === companyWallet.toLowerCase()

  // Trigger type + threshold — threshold now lives on the bond (§2.5), not
  // the trigger; dealType is gone entirely, replaced by matching the
  // trigger's productConfig.valuePath back against TRIGGER_TYPES. Both are
  // stored as whole USD on-chain (e.g. 370_000_000_000 = $370B); divide to
  // the $B scale the chart/copy work in.
  const triggerType  = valuePath !== undefined
    ? Object.values(TRIGGER_TYPES).find(t => t.valuePath === valuePath)
    : undefined
  const thresholdB   = bondThreshold ? Number(bondThreshold) / 1e9 : 0
  const reportedB    = hasReports ? Number(latestValue) / 1e9 : 0

  // Two distinct signals, not collapsed into one (§2.6 audit, TESTING.md):
  // `triggerState` is the on-chain CONFIRMED answer from the bond's own
  // lastCheck — only as fresh as the last time anyone paid gas to call
  // checkTrigger(). `likelyTriggered` is a free, client-side comparison of
  // the latest report against the threshold, for display only.
  const likelyTriggered = hasReports && bondThreshold !== undefined ? latestValue >= bondThreshold : undefined
  const triggerState = statusNum === 4
    ? 'settled'
    : (hasBeenChecked && lastCheckTriggered ? 'triggered' : 'not_triggered')

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
    <div className="min-h-screen text-[var(--rhodex-text-dark)]" style={{ fontFamily: 'var(--rhodex-font)' }}>
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
            <Tag className="translate-y-[3px] border-orange-400 bg-transparent text-orange-600 shadow-[0_0_6px_1px_rgba(249,115,22,0.6)]">Testnet</Tag>
          </div>
          <div className="flex items-center gap-5">
            <ThemeSwitcher />
            <Link to="/admin" className="text-sm text-[var(--rhodex-text-dark-muted)] hover:text-[var(--rhodex-text-dark)] transition-colors">Admin ›</Link>
            <ConnectButton />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-5">

        {/* Load bond — thin ghost bar, width pinned to column 1 via the same
            grid the content below uses (a fixed max-width drifts out of
            sync with column 1's actual fluid width at narrower viewports). */}
        <div className="grid lg:grid-cols-3 gap-5">
          <Surface rounded="rounded-[10px]" className="lg:col-span-2 flex items-center gap-3 px-4 py-2">
            <input
              type="text"
              value={bondInput}
              onChange={e => setBondInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadBond()}
              placeholder="Paste CatBond contract address to load deal…"
              className="flex-1 min-w-0 bg-transparent font-mono text-sm text-[var(--rhodex-text-dark)] placeholder:text-[var(--rhodex-text-dark-muted)] outline-none"
            />
            <ActionButton size="px-3 py-1.5 text-xs" onClick={loadBond}>
              Load
            </ActionButton>
          </Surface>
        </div>

        {/* Tx banner — spans full width */}
        {bondAddress && <TxBanner isWriting={isWriting} isConfirming={isConfirming} isConfirmed={isConfirmed} hash={txHash} error={writeError} />}

        {bondAddress && bondData && (
          <div className="grid lg:grid-cols-3 gap-5">

            {/* ── LEFT COLUMN (2/3) ────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-5">

              {/* ── Section 1: deal hero (funding overview) + historical chart ──
                  60% white fill (vs. the 45% default) so the border pops
                  a bit more against the page gradient. */}
              <Surface rounded="rounded-[12px]" className="p-6" style={{ backgroundColor: 'rgba(255,255,255,0.6)' }}>
                <div className="flex items-start justify-between gap-4 mb-6">
                  <div>
                    <p className="text-xs font-medium text-[var(--rhodex-text-dark-muted)] uppercase tracking-wide mb-1">
                      Sponsor · {sellerName || 'Unnamed sponsor'}
                    </p>
                    <h2 className="text-xl font-bold text-[var(--rhodex-text-dark)] mb-3">
                      {triggerType ? triggerType.label : 'Loss'} {new Date().getFullYear()}
                    </h2>

                    {/* Trigger condition, verified by the data-source oracle */}
                    <div className="flex items-center gap-6">
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-[var(--rhodex-text-dark-muted)]">Verified by</span>
                        <img
                          src="/gallagher-re-logo.png"
                          alt="Gallagher Re"
                          className="h-4 w-auto"
                          onError={e => { e.currentTarget.style.display = 'none' }}
                        />
                      </div>
                      <p className="text-sm text-[var(--rhodex-text-dark-muted)] leading-relaxed">
                        If {triggerType ? triggerType.label.toLowerCase() : 'loss'} exceeds{' '}
                        <strong className="text-[var(--rhodex-text-dark)]">${thresholdB}B</strong> (annual aggregate), this deal triggers.
                      </p>
                    </div>
                  </div>
                  <span className="flex-shrink-0 border border-current bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-wide" style={{ color: STATUS_TEXT_COLOR[Number(status ?? 0)] ?? STATUS_TEXT_COLOR[0] }}>
                    {statusLabel(status)}
                  </span>
                </div>

                {/* Fill bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-xs text-[var(--rhodex-text-dark-muted)] mb-1.5">
                    <span>Principal subscribed</span>
                    <span>{pctFilled}% · {formatUSDC(totalDeposited)} of {formatUSDC(coverageAmount)}</span>
                  </div>
                  <div className="w-full border border-[var(--rhodex-text-dark)]/20 h-2">
                    <div className="bg-[var(--rhodex-accent)] h-full transition-all" style={{ width: `${pctFilled}%` }} />
                  </div>
                </div>

                {/* Key stats — ghost box, higher opacity than the parent card */}
                <div className="grid grid-cols-4 gap-4 rounded-[10px] border border-white/80 bg-white/60 p-4">
                  <StatChip label="Coverage"   value={formatUSDC(coverageAmount)} />
                  <StatChip label="Coupon"     value={formatBps(couponRateBps)} />
                  <StatChip label="Term"       value={termDays ? `${termDays} days` : '—'} />
                  <StatChip label="Min invest" value={formatUSDC(minInvestment)} />
                </div>

                <div className="mt-[80px]">
                  <h3 className="font-semibold text-[var(--rhodex-text-dark)] mb-4">Historical Insured Losses vs Trigger</h3>
                  <HistoricalChart triggerType={triggerType} thresholdB={thresholdB} reportedB={reportedB} />
                </div>
              </Surface>

              {/* ── Section 2: Investment layer / action card ───────────────
                  Internal look stays as-is for now — an "options set" style
                  pass is planned separately. */}
              <Surface rounded="rounded-[12px]" className="p-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-[var(--rhodex-text-dark)]">Investment Layer</h3>
                  <span className="text-xs text-[var(--rhodex-text-dark-muted)]">Layer 1 of 1</span>
                </div>
                <p className="text-xs text-[var(--rhodex-text-dark-muted)] mb-5">
                  {triggerType ? triggerType.label : 'Loss'} ≥ ${thresholdB}B · {formatUSDC(coverageAmount)} coverage · {formatBps(couponRateBps)} coupon · {termDays}-day term
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
                          className={`w-full sm:w-64 px-4 py-2.5 text-sm ${INPUT_CLASS[themeId] ?? INPUT_CLASS.lapis}`}
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
                            <ActionButton size="px-4 py-2 text-sm" onClick={() => write('closeSubscription')} disabled={isBusy}>
                              Close Subscription &amp; Activate Bond
                            </ActionButton>
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
              </Surface>

              {/* ── Section 3: seller info + exposure + deal details ────────
                  Company-specific info first, then exposure, then details.
                  No SOV download — the exposure chart below is the
                  disclosure; there's nothing else to hand out. */}
              <Surface rounded="rounded-[12px]" className="p-6">
                <div className="flex items-center gap-3 mb-3">
                  <SponsorLogo name={sellerName} size={40} />
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-[var(--rhodex-text-dark)]">{sellerName || 'Unnamed sponsor'}</div>
                    {verified && (
                      <span title="Verified by RHODEX" className="text-[var(--rhodex-accent)] font-bold">✚</span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-[var(--rhodex-text-dark-muted)] leading-relaxed mb-4 italic">
                  Description not yet available.
                </p>

                <div className="pt-2 border-t-2 border-[var(--rhodex-text-dark)]/10">
                  <h3 className="font-semibold text-[var(--rhodex-text-dark)] mb-4 mt-4">Portfolio Exposure</h3>
                  <ExposureMap regions={exposureRegions} />
                </div>
              </Surface>

            </div>

            {/* ── RIGHT COLUMN (1/3) ───────────────────────────────────── */}
            <div className="space-y-4">

              {/* Your position — only when invested */}
              {isConnected && principalOf !== undefined && principalOf > 0n && (
                <Surface className="p-5">
                  <h3 className="font-semibold text-[var(--rhodex-text-dark)] mb-1">Your Position</h3>
                  {/* Ghost theme: green on the number only — value the viewer
                      owns. Lapis is untouched (not part of this redesign). */}
                  <div
                    className="text-3xl font-bold mb-0.5 tabular-nums"
                    style={{ color: themeId === 'ghost' ? 'var(--rhodex-green)' : 'var(--rhodex-text-dark)' }}
                  >
                    {formatUSDC(principalOf)}
                  </div>
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

                  {/* Coupon claim — Active or Triggered. success tone: this is
                      value the investor can take, same as Withdraw below. */}
                  {(statusNum === 2 || statusNum === 4) && (
                    <ActionButton tone="success" size="w-full py-2.5 text-sm" onClick={() => write('claimCoupon')} disabled={isBusy} className="mb-2">
                      Claim Coupon
                    </ActionButton>
                  )}

                  {/* Withdraw principal — Matured */}
                  {statusNum === 3 && (
                    <>
                      <ActionButton
                        tone="success"
                        size="w-full py-2.5 text-sm"
                        onClick={() => write('withdrawPrincipal')}
                        disabled={isBusy || !!principalWithdrawn}
                        className="mb-2"
                      >
                        {principalWithdrawn ? 'Principal Withdrawn ✓' : 'Withdraw Principal'}
                      </ActionButton>
                      <ActionButton tone="success" size="w-full py-2.5 text-sm" onClick={() => write('claimCoupon')} disabled={isBusy}>
                        Claim Remaining Coupon
                      </ActionButton>
                    </>
                  )}
                </Surface>
              )}

              {/* Connect prompt when not connected */}
              {!isConnected && (
                <Surface className="p-5 text-center">
                  <p className="text-sm text-[var(--rhodex-text-dark-muted)] mb-3">Connect your wallet to see your position.</p>
                  <ConnectButton />
                </Surface>
              )}

              {/* Trigger status */}
              {bondAddress && (
                <TriggerWidget
                  triggerType={triggerType}
                  thresholdB={thresholdB}
                  reportedB={reportedB}
                  hasBeenChecked={hasBeenChecked}
                  lastCheckAge={formatAge(lastCheckAt)}
                  likelyTriggered={likelyTriggered}
                  triggerState={triggerState}
                  canSelfCheck={isConnected && statusNum >= 2}
                  isBusy={isBusy}
                  onSelfCheck={() => writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'checkTrigger' })}
                />
              )}

              {/* Related news */}
              <Surface className="p-5">
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
              </Surface>

              {/* Refresh */}
              <div className="text-center">
                <button onClick={() => { refetchBond(); refetchUser(); refetchTrigger() }} className="text-xs text-[var(--rhodex-text-dark-muted)] hover:text-[var(--rhodex-text-dark)] underline">
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
