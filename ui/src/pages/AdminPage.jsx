import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  useWallet, useBond, useTrigger, useTriggerHistory, useBondPosition,
  useBondActions, useTriggerActions, useCreateTrigger, useCreateBond,
  makeBondRef, isValidAddress, sameAddress, FAMILY, NETWORKS,
} from '../chains'
import { TESTNET_USDC, RHODEX_COMPANY_WALLET } from '../constants/abis'
import {
  formatUSDC, safeParseUSDC, parseUSDC, formatDate, formatBps, formatAge,
  statusLabel, statusColor, daysToSeconds, formatUSDWhole,
} from '../lib/utils'
import { checkPassword, nicknameGreeting } from '../adminConfig'
import { TRIGGER_TYPES, NATCAT_LOSS_PRODUCT } from '../data/historicalLoss'
import { Accordion, AccordionSection } from '../components/build-bond/Accordion'
import { GhostButton, FilledButton, Panel } from '../components/build-bond/primitives'
import LiveBondsMap from '../components/build-bond/LiveBondsMap'

// Iteration 2 (sprint plan §3): "use the ghost design system already
// applied on the Build page... match its tokens, spacing and typography
// exactly — no new visual language." Reusing .workshop-page as the scoping
// class (not just copying its look) means this page automatically gets
// every --wkb-* token and helper class index.css already defines, with
// zero duplication and zero drift if that palette ever changes.

// Chain the Deploy section creates on. Manage and Trigger status follow the
// chain of whatever bond/trigger they're showing; Solana bonds are created
// from Post deal (/build) or DEAL001's `npm run localnet`.
const ADMIN_FAMILY = FAMILY.EVM

// ── Shared components ─────────────────────────────────────────────────────────

function ConnectButton({ family = ADMIN_FAMILY, label }) {
  const { address, isConnected, connect, disconnect } = useWallet(family)

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm wkb-mono text-[var(--wkb-ink-muted)]">
          {label && <span className="font-sans mr-1.5">{label}</span>}
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
        <GhostButton onClick={() => disconnect()}>Disconnect</GhostButton>
      </div>
    )
  }
  return <GhostButton highlight onClick={() => connect()}>{label ? `Connect ${label}` : 'Connect wallet'}</GhostButton>
}

function FormField({ label, value, onChange, type = 'text', placeholder = '', hint, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm text-[var(--wkb-ink)] placeholder-[var(--wkb-ink-muted)] focus:outline-none focus:border-[var(--wkb-ink-muted)]"
      />
      {hint && <p className="text-xs text-[var(--wkb-ink-muted)] mt-0.5">{hint}</p>}
    </div>
  )
}

function TxBanner({ isWriting, isConfirming, isConfirmed, hash, error }) {
  if (error) {
    const msg = error?.shortMessage || error?.message || String(error)
    return (
      <div className="rounded-[8px] p-3 text-sm bg-red-50 border border-red-200 text-red-700 mt-3">
        Error: {msg}
      </div>
    )
  }
  if (isWriting) return <div className="rounded-[8px] p-3 text-sm bg-[var(--wkb-blue-wash)] border border-[var(--wkb-hairline)] text-[var(--wkb-ink-muted)] mt-3">Waiting for wallet confirmation…</div>
  if (isConfirming) return <div className="rounded-[8px] p-3 text-sm bg-[var(--wkb-blue-wash)] border border-[var(--wkb-hairline)] text-[var(--wkb-ink-muted)] mt-3">Confirming on-chain… <span className="wkb-mono">{hash?.slice(0, 12)}...</span></div>
  if (isConfirmed) return <div className="rounded-[8px] p-3 text-sm bg-green-50 border border-green-200 text-green-700 mt-3">Transaction confirmed! <span className="wkb-mono">{hash?.slice(0, 12)}...</span></div>
  return null
}

// ── Password gate ─────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }) {
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const ok = await checkPassword(pw)
    // "Who are you" is purely cosmetic — never a second factor. A blank or
    // unrecognized name still unlocks fine with no greeting, same as before
    // this field existed.
    if (ok) { onUnlock(nicknameGreeting(name)) } else { setError(true) }
  }

  return (
    <div className="max-w-sm mx-auto mt-24">
      <Panel raised className="p-8">
        <div className="text-center mb-6">
          <div className="text-3xl mb-3">🔒</div>
          <h2 className="text-lg font-semibold text-[var(--wkb-ink)]">Admin Access</h2>
          <p className="text-sm text-[var(--wkb-ink-muted)] mt-1">Enter your admin password to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1">Who are you?</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Optional"
              className="w-full px-4 py-3 rounded-[10px] border border-[var(--wkb-hairline)] bg-transparent text-[var(--wkb-ink)] placeholder-[var(--wkb-ink-muted)] focus:outline-none focus:border-[var(--wkb-ink-muted)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1">Password</label>
            <input
              type="password"
              value={pw}
              onChange={e => { setPw(e.target.value); setError(false) }}
              placeholder="Password"
              className="w-full px-4 py-3 rounded-[10px] border border-[var(--wkb-hairline)] bg-transparent text-[var(--wkb-ink)] placeholder-[var(--wkb-ink-muted)] focus:outline-none focus:border-[var(--wkb-ink-muted)]"
            />
          </div>
          {error && <p className="text-red-600 text-sm">Incorrect password.</p>}
          <FilledButton type="submit" className="w-full">Unlock</FilledButton>
        </form>
        <p className="text-xs text-[var(--wkb-ink-muted)] text-center mt-4 opacity-70">
          Change password in <code className="wkb-mono">src/adminConfig.js</code> before launch.
        </p>
      </Panel>
    </div>
  )
}

// ── Deploy Section ────────────────────────────────────────────────────────────

function DeploySection() {
  const { address, isConnected } = useWallet(ADMIN_FAMILY)

  const [form, setForm] = useState({
    sponsor: '',
    companyWallet: '',
    usdc: '',
    couponBps: '500',
    coverage: '75000',
    minInvestment: '25000',
    subDays: '7',
    termDays: '365',
    dealType: '1',       // 0 = IndustryLoss, 1 = EconomicLoss
    lossThresholdB: '',  // threshold in billions of USD
    sellerName: '',       // CatBond.sellerName
    dealId: '',           // CatBond.dealId — web2 Deal store record id, if any
  })

  const [triggerAddr, setTriggerAddr] = useState(localStorage.getItem('catbond_trigger') || '')
  const [bondAddr, setBondAddr] = useState(localStorage.getItem('catbond_address') || '')

  // Pre-fill sponsor from the connected address, company wallet from the
  // fixed constant — never the connected address. That field stays editable
  // (this is a manual/admin tool), but the default must never default to
  // whoever happens to be connected, or a manual deploy could silently give
  // the seller's own wallet trigger-owner rights.
  useEffect(() => {
    if (address) {
      setForm(f => ({
        ...f,
        sponsor: f.sponsor || address,
        companyWallet: f.companyWallet || RHODEX_COMPANY_WALLET,
      }))
    }
  }, [address])

  // Trigger creation (a contract deploy on EVM)
  const createTrigger = useCreateTrigger(ADMIN_FAMILY)
  const {
    isWriting: triggerPending, isConfirming: triggerConfirming, isConfirmed: triggerConfirmed,
    hash: triggerTxHash, error: triggerError,
  } = createTrigger.tx

  useEffect(() => {
    if (createTrigger.createdAddress) {
      const addr = createTrigger.createdAddress
      setTriggerAddr(addr)
      localStorage.setItem('catbond_trigger', addr)
    }
  }, [createTrigger.createdAddress])

  // Bond creation
  const createBond = useCreateBond(ADMIN_FAMILY)
  const {
    isWriting: bondPending, isConfirming: bondConfirming, isConfirmed: bondConfirmed,
    hash: bondTxHash, error: bondError,
  } = createBond.tx

  useEffect(() => {
    if (createBond.createdAddress) {
      const addr = createBond.createdAddress
      setBondAddr(addr)
      localStorage.setItem('catbond_address', addr)
    }
  }, [createBond.createdAddress])

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  // Saved addresses can outlive the chain they were deployed on (every anvil
  // restart wipes state), so check something actually lives at each one.
  // `exists` is undefined while loading, false when nothing is there.
  const { trigger: savedTrigger } = useTrigger(ADMIN_FAMILY, isValidAddress(triggerAddr, ADMIN_FAMILY) ? triggerAddr : undefined)
  const { bond: savedBond } = useBond(makeBondRef(bondAddr))
  const triggerMissing = !!triggerAddr && savedTrigger?.exists === false
  const bondMissing    = !!bondAddr && savedBond?.exists === false

  function handleDeployTrigger() {
    if (!isValidAddress(form.companyWallet, ADMIN_FAMILY)) return alert('Enter a valid company wallet address')
    // dealType still selects which of the product's two metrics this
    // trigger reports on — it's just a valuePath snapshot now, not a
    // constructor arg the trigger stores directly. See historicalLoss.js.
    const triggerType = form.dealType === '0' ? TRIGGER_TYPES.industry : TRIGGER_TYPES.economic
    createTrigger.create({
      owner:        form.companyWallet,   // owner and reporter — single wallet for now
      reporter:     form.companyWallet,
      productId:    NATCAT_LOSS_PRODUCT.productId,
      version:      NATCAT_LOSS_PRODUCT.version,
      valuePath:    triggerType.valuePath,
      units:        NATCAT_LOSS_PRODUCT.units,
      maxReportAge: NATCAT_LOSS_PRODUCT.maxReportAgeSeconds,
      endpoint:     NATCAT_LOSS_PRODUCT.endpoint,
    })
  }

  function handleDeployBond() {
    if (!triggerAddr) return alert('Deploy trigger first (Step 1)')
    if (triggerMissing) return alert(`No trigger found at ${triggerAddr} on the connected network — it's probably from an earlier chain. Run Step 1 to deploy a fresh one.`)
    if (!isValidAddress(form.sponsor, ADMIN_FAMILY)) return alert('Invalid sponsor address')
    if (!isValidAddress(form.companyWallet, ADMIN_FAMILY)) return alert('Invalid company wallet address')
    if (!isValidAddress(form.usdc, ADMIN_FAMILY)) return alert('Invalid USDC address')
    const thresholdB = parseFloat(form.lossThresholdB)
    if (!form.lossThresholdB || isNaN(thresholdB) || thresholdB <= 0)
      return alert('Enter a loss threshold in billions (e.g. 370 for $370B)')
    try {
      const threshold = BigInt(Math.round(thresholdB * 1e9)) // whole USD — now lives on the bond, not the trigger
      const couponBps = parseInt(form.couponBps)
      const coverage = parseUSDC(form.coverage)
      const minInv = parseUSDC(form.minInvestment)
      const subDur = daysToSeconds(form.subDays)
      const termDur = daysToSeconds(form.termDays)
      // Same sanity rules the Solana program enforces in create_bond. On EVM a
      // negative value otherwise only fails inside viem's uint256 encoder,
      // with an unhelpful "not in safe 256-bit unsigned integer range" error.
      if (!(subDur > 0n)) return alert('Subscription duration must be more than 0 days')
      if (!(termDur > 0n)) return alert('Term duration must be more than 0 days')
      if (!(coverage > 0n)) return alert('Coverage amount must be more than 0')
      if (!(minInv > 0n) || minInv > coverage) return alert('Min investment must be more than 0 and no larger than the coverage amount')
      if (isNaN(couponBps) || couponBps < 0 || couponBps > 10000) return alert('Coupon rate must be between 0 and 10000 BPS')
      createBond.create({
        sponsor:              form.sponsor,
        companyWallet:        form.companyWallet,
        trigger:              triggerAddr,
        threshold,
        mint:                 form.usdc,
        couponRateBps:        couponBps,
        coverageAmount:       coverage,
        minInvestment:        minInv,
        subscriptionDuration: subDur,
        termDuration:         termDur,
        sellerName:           form.sellerName,
        dealId:               form.dealId,
        exposure:             [],
      })
    } catch (e) {
      alert('Invalid parameter: ' + e.message)
    }
  }

  const dealTypeLabel = form.dealType === '0' ? 'Industry Loss (insured)' : 'Economic Loss (total)'

  const estimatedBudget = (() => {
    try {
      const cov = parseUSDC(form.coverage)
      const bps = BigInt(parseInt(form.couponBps) || 0)
      return cov * bps / 10000n   // flat rate on coverage, not annualised
    } catch { return null }
  })()

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <FormField
          label="Sponsor Address"
          value={form.sponsor}
          onChange={set('sponsor')}
          placeholder="0x..."
          hint="Deposits coupon budget; receives principal if triggered"
        />
        <FormField
          label="Company Wallet"
          value={form.companyWallet}
          onChange={set('companyWallet')}
          placeholder="0x..."
          hint="Authorized to call settle() and markMatured()"
        />

        {/* USDC with testnet presets */}
        <div className="sm:col-span-2">
          <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1">USDC Address</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.usdc}
              onChange={set('usdc')}
              placeholder="0x..."
              className="flex-1 rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm wkb-mono text-[var(--wkb-ink)] placeholder-[var(--wkb-ink-muted)] focus:outline-none focus:border-[var(--wkb-ink-muted)]"
            />
            <select
              onChange={e => e.target.value && setForm(f => ({ ...f, usdc: e.target.value }))}
              className="rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-xs text-[var(--wkb-ink-muted)] cursor-pointer focus:outline-none focus:border-[var(--wkb-ink-muted)]"
              defaultValue=""
            >
              <option value="" disabled>Testnet preset</option>
              {Object.entries(TESTNET_USDC).map(([name, addr]) => (
                <option key={addr} value={addr}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        <FormField
          label="Coupon Rate (BPS)"
          value={form.couponBps}
          onChange={set('couponBps')}
          type="number"
          hint="800 = 8% flat on total coverage for the full term"
        />
        <FormField
          label="Coverage Amount (USDC)"
          value={form.coverage}
          onChange={set('coverage')}
          type="number"
          hint="Max principal the bond accepts (e.g. 75000)"
        />
        <FormField
          label="Min Investment (USDC)"
          value={form.minInvestment}
          onChange={set('minInvestment')}
          type="number"
          hint="Minimum per-investor deposit"
        />
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-2">
          <FormField
            label="Subscription Duration (days)"
            value={form.subDays}
            onChange={set('subDays')}
            type="number"
            hint="Window investors have to deposit"
          />
          <FormField
            label="Term Duration (days)"
            value={form.termDays}
            onChange={set('termDays')}
            type="number"
            hint="Bond term after subscription closes"
          />
        </div>
        <FormField
          label="Seller Name"
          value={form.sellerName}
          onChange={set('sellerName')}
          placeholder="Raydion"
          hint="CatBond.sellerName — shown on the deal page"
        />
        <FormField
          label="Deal ID (optional)"
          value={form.dealId}
          onChange={set('dealId')}
          placeholder="web2 Deal store record id, if any"
          hint="CatBond.dealId — the bidirectional link; leave blank for a manual test deploy"
        />

        {/* Trigger + threshold configuration — dealType picks the trigger's
            metric (Step 1); threshold is a bond-level field (Step 2). Kept
            in one panel since they're one conceptual decision to the admin. */}
        <div className="sm:col-span-2 rounded-[10px] border border-[var(--wkb-hairline)] p-4 space-y-3" style={{ background: 'var(--wkb-panel)' }}>
          <div className="text-xs font-semibold text-[var(--wkb-ink-muted)] uppercase tracking-wide">Trigger &amp; Threshold</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1">Deal Type</label>
              <select
                value={form.dealType}
                onChange={set('dealType')}
                className="w-full rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm text-[var(--wkb-ink)] focus:outline-none focus:border-[var(--wkb-ink-muted)]"
              >
                <option value="1">Economic Loss (total)</option>
                <option value="0">Industry Loss (insured)</option>
              </select>
              <p className="text-xs text-[var(--wkb-ink-muted)] mt-0.5">
                {form.dealType === '0' ? 'Uses insured loss figures' : 'Uses total economic loss figures'} — sets the trigger's value_path (Step 1)
              </p>
            </div>
            <FormField
              label="Loss Threshold ($B)"
              value={form.lossThresholdB}
              onChange={set('lossThresholdB')}
              type="number"
              placeholder="e.g. 370"
              hint={`Bond fires when reported ${dealTypeLabel} ≥ this amount (Step 2)`}
            />
          </div>
        </div>

        {/* Estimated budget */}
        {estimatedBudget !== null && (
          <div className="sm:col-span-2 rounded-[10px] p-4 text-sm border border-[var(--wkb-hairline)]" style={{ background: 'var(--wkb-blue-wash)' }}>
            <div className="flex justify-between">
              <span className="text-[var(--wkb-ink-muted)]">Estimated coupon budget sponsor must deposit:</span>
              <span className="font-semibold text-[var(--wkb-ink)]">{formatUSDC(estimatedBudget)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[var(--wkb-ink-muted)] text-xs opacity-70">+ 0.5% origination fee on top</span>
              <span className="text-[var(--wkb-ink-muted)] text-xs">{formatUSDC((estimatedBudget * 10050n) / 10000n)} total USDC needed</span>
            </div>
          </div>
        )}
      </div>

      {/* Step 1: Deploy Trigger */}
      <div className="rounded-[10px] border border-[var(--wkb-hairline)] p-4 mb-3" style={{ background: 'var(--wkb-panel)' }}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--wkb-ink)]">Step 1 — Deploy Trigger</div>
            <div className="text-xs text-[var(--wkb-ink-muted)] mt-0.5">
              Owner &amp; reporter: Company Wallet. Reports {dealTypeLabel.toLowerCase()} from the{' '}
              <span className="wkb-mono">natcat_loss</span> product.
              Threshold is set on the bond in Step 2, not here — one trigger can back bonds at different thresholds.
            </div>
            {triggerAddr && !triggerMissing && (
              <div className="wkb-mono text-xs text-[var(--wkb-blue)] mt-1 break-all">✓ {triggerAddr}</div>
            )}
            {triggerMissing && (
              <div className="text-xs text-red-600 mt-1 break-all">
                ✗ <span className="wkb-mono">{triggerAddr}</span> — no trigger at this address on the connected network
                (saved from an earlier chain?). Deploy a fresh one.
              </div>
            )}
          </div>
          <GhostButton
            highlight
            className="flex-shrink-0"
            onClick={handleDeployTrigger}
            disabled={!isConnected || triggerPending || triggerConfirming}
          >
            {triggerPending ? 'Confirm...' : triggerConfirming ? 'Deploying...' : triggerAddr ? 'Re-deploy' : 'Deploy Trigger'}
          </GhostButton>
        </div>
        <TxBanner
          isWriting={triggerPending}
          isConfirming={triggerConfirming}
          isConfirmed={triggerConfirmed}
          hash={triggerTxHash}
          error={triggerError}
        />
      </div>

      {/* Step 2: Deploy Bond */}
      <div className="rounded-[10px] border border-[var(--wkb-hairline)] p-4" style={{ background: 'var(--wkb-panel)', opacity: triggerAddr && !triggerMissing ? 1 : 0.5 }}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--wkb-ink)]">Step 2 — Deploy CatBond</div>
            <div className="text-xs text-[var(--wkb-ink-muted)] mt-0.5">Uses trigger address from Step 1.</div>
            {bondAddr && !bondMissing && (
              <div className="wkb-mono text-xs text-[var(--wkb-blue)] mt-1 break-all">✓ {bondAddr}</div>
            )}
            {bondMissing && (
              <div className="text-xs text-red-600 mt-1 break-all">
                ✗ <span className="wkb-mono">{bondAddr}</span> — no bond at this address on the connected network.
              </div>
            )}
          </div>
          <FilledButton
            className="flex-shrink-0"
            onClick={handleDeployBond}
            disabled={!isConnected || !triggerAddr || bondPending || bondConfirming}
          >
            {bondPending ? 'Confirm...' : bondConfirming ? 'Deploying...' : bondAddr ? 'Re-deploy' : 'Deploy Bond'}
          </FilledButton>
        </div>
        <TxBanner
          isWriting={bondPending}
          isConfirming={bondConfirming}
          isConfirmed={bondConfirmed}
          hash={bondTxHash}
          error={bondError}
        />
      </div>

      {bondAddr && !bondMissing && !triggerMissing && (
        <div className="mt-4 rounded-[10px] border border-green-200 bg-green-50 p-4 text-sm">
          <div className="font-semibold text-green-700 mb-2">Deployment complete — addresses saved.</div>
          <div className="space-y-1 wkb-mono text-xs text-[var(--wkb-ink-muted)]">
            <div>Trigger: <span className="text-green-700">{triggerAddr}</span></div>
            <div>Bond:    <span className="text-green-700">{bondAddr}</span></div>
          </div>
          <p className="text-xs text-[var(--wkb-ink-muted)] mt-2">
            Deal Page will load this bond automatically. Sponsor must now call{' '}
            <strong className="text-[var(--wkb-ink)]">Fund Coupon Budget</strong> in the Manage section below.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Manage Section ────────────────────────────────────────────────────────────

function AdminAction({ title, description, onClick, disabled, label, danger = false }) {
  return (
    <div className="rounded-[10px] border border-[var(--wkb-hairline)] p-4" style={{ background: 'var(--wkb-panel)' }}>
      <div className="font-medium text-sm mb-1 text-[var(--wkb-ink)]">{title}</div>
      <p className="text-xs text-[var(--wkb-ink-muted)] mb-3 leading-relaxed">{description}</p>
      {danger ? (
        <button
          onClick={onClick}
          disabled={disabled}
          className="w-full py-2 rounded-[8px] text-sm font-semibold disabled:opacity-40 transition-colors bg-red-600 hover:bg-red-700 text-white"
        >
          {label}
        </button>
      ) : (
        <GhostButton className="w-full" onClick={onClick} disabled={disabled}>
          {label}
        </GhostButton>
      )}
    </div>
  )
}

/** dealType no longer exists on-chain (§2.4) — the trigger's productConfig
 *  snapshots a valuePath instead, which encodes the same choice. Matches it
 *  back against historicalLoss.js's TRIGGER_TYPES for display purposes. */
function triggerTypeLabelFromValuePath(valuePath) {
  const match = Object.values(TRIGGER_TYPES).find(t => t.valuePath === valuePath)
  return match?.label ?? valuePath ?? '—'
}

function ManageSection() {
  const [bondAddress, setBondAddress] = useState(localStorage.getItem('catbond_address') || '')
  const [triggerAddress, setTriggerAddress] = useState(localStorage.getItem('catbond_trigger') || '')
  const [reportLossB, setReportLossB] = useState('')
  const [reportNote, setReportNote] = useState('')

  // The pasted bond address decides the chain (0x… = EVM, base58 = Solana),
  // and with it which wallet acts.
  const bondRef = makeBondRef(bondAddress)
  const family = bondRef?.family ?? ADMIN_FAMILY
  const { address, isConnected } = useWallet(family)
  const validBond = !!bondRef
  const validTrigger = isValidAddress(triggerAddress, family)

  // Bond reads — includes the bond's own trigger address so we always check the right contract.
  // threshold/lastCheck are new (§2.5) — the bond now owns its own threshold
  // and records the result of every checkTrigger() call.
  const { bond: bondData, refetch: refetchBond } = useBond(validBond ? bondRef : null)
  const {
    status: bondStatus, sponsor: bondSponsor, companyWallet: bondCompany, mint: bondUsdc,
    requiredCouponBudget, totalDeposited, coverageAmount, maturity,
    trigger: bondTriggerAddr, threshold: bondThreshold, lastCheck,
  } = bondData ?? {}
  const lastCheckTriggered = lastCheck?.triggered
  const lastCheckAt        = lastCheck?.checkedAt
  const hasBeenChecked = lastCheckAt !== undefined && Number(lastCheckAt) > 0

  // Always read from the address the bond holds — never the UI input — to prevent mismatches.
  const effectiveTriggerAddr = bondTriggerAddr ?? (validTrigger ? triggerAddress : undefined)

  // `latest` is undefined while the report log is empty, so check hasReports
  // before trusting it.
  const { trigger: triggerData, refetch: refetchTrigger } = useTrigger(family, effectiveTriggerAddr, bondRef?.network)
  const reportCount      = triggerData?.reportCount
  const latestValue      = triggerData?.latest?.value
  const latestReportedAt = triggerData?.latest?.reportedAt
  const productId        = triggerData?.productId
  const productVersion   = triggerData?.version
  const valuePath        = triggerData?.valuePath
  const hasReports = reportCount !== undefined && Number(reportCount) > 0

  // Gas-free, client-side comparison — NOT the on-chain confirmed answer.
  // Distinct from lastCheck (below), which only updates when someone actually
  // pays gas to call checkTrigger(). Surfacing both, clearly labeled, is the
  // design call from this session's §2.6 audit (see TESTING.md).
  const likelyTriggered = hasReports && bondThreshold !== undefined ? latestValue >= bondThreshold : undefined

  // §3.4 "health label... show the margin" — reuses the same values as
  // likelyTriggered above, just bucketed into three bands instead of two.
  const marginPct = hasReports && bondThreshold ? (Number(latestValue) / Number(bondThreshold)) * 100 : undefined
  const health = marginPct === undefined ? undefined : marginPct >= 100 ? 'Triggered' : marginPct >= 80 ? 'Watch' : 'Healthy'
  const healthColor = { Healthy: 'bg-green-100 text-green-800', Watch: 'bg-amber-100 text-amber-800', Triggered: 'bg-red-100 text-red-800' }[health]

  // USDC allowance/balance for the connected wallet (sponsor flow)
  const { position, refetch: refetchUsdc } = useBondPosition(validBond ? bondRef : null, address, bondUsdc)
  const usdcAllowance = position?.tokenAllowance
  const usdcBalance   = position?.tokenBalance

  const actions = useBondActions(validBond ? bondRef : null, bondUsdc)
  const { isWriting: isPending, isConfirming, isConfirmed, hash: txHash, error: writeError } = actions.tx
  const isBusy = isPending || isConfirming

  useEffect(() => {
    if (isConfirmed) { refetchBond(); refetchTrigger(); refetchUsdc(); setReportLossB(''); setReportNote('') }
  }, [isConfirmed])

  const statusNum = Number(bondStatus ?? 0)
  const isCompanyWallet = sameAddress(address, bondCompany)
  const isSponsor = sameAddress(address, bondSponsor)
  const now = BigInt(Math.floor(Date.now() / 1000))
  const pastMaturity = maturity && Number(maturity) > 0 && now >= maturity

  function fundBudget() {
    if (!requiredCouponBudget) return
    const totalNeeded = (requiredCouponBudget * 10050n) / 10000n
    if (actions.requiresApproval && (usdcAllowance ?? 0n) < totalNeeded) {
      actions.approve(totalNeeded * 2n)
    } else {
      actions.fundCouponBudget()
    }
  }

  const needsBudgetApprove = actions.requiresApproval && requiredCouponBudget && (usdcAllowance ?? 0n) < (requiredCouponBudget * 10050n) / 10000n

  return (
    <div>
      {/* Address inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <FormField
          label="Bond Address"
          value={bondAddress}
          onChange={e => { setBondAddress(e.target.value); localStorage.setItem('catbond_address', e.target.value) }}
          placeholder="0x..."
        />
        <FormField
          label="Trigger Address"
          value={triggerAddress}
          onChange={e => { setTriggerAddress(e.target.value); localStorage.setItem('catbond_trigger', e.target.value) }}
          placeholder="0x..."
        />
      </div>

      {/* Bond state summary */}
      {bondData && validBond && bondData.exists === false && (
        <div className="rounded-[10px] p-4 mb-5 border border-red-200 bg-red-50 text-sm text-red-700">
          No CatBond found at <span className="wkb-mono">{bondAddress}</span> on the connected network.
          It may be from an earlier anvil run, a deploy that reverted, or a different chain — check
          the address, or deploy a new bond in section 01.
        </div>
      )}

      {bondData && validBond && bondData.exists && (
        <div className="rounded-[10px] p-4 mb-5 border border-[var(--wkb-hairline)] text-sm space-y-2" style={{ background: 'var(--wkb-panel)' }}>
          <div className="flex flex-wrap gap-3 items-center">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColor(bondStatus)}`}>
              {statusLabel(bondStatus)}
            </span>
            <span className="text-[var(--wkb-ink)]">
              {formatUSDC(totalDeposited)} / {formatUSDC(coverageAmount)} deposited
            </span>
            {maturity && Number(maturity) > 0 && (
              <span className="text-[var(--wkb-ink-muted)] text-xs">Maturity: {formatDate(maturity)}</span>
            )}
          </div>
          <div className="text-xs text-[var(--wkb-ink-muted)] space-y-0.5">
            <div>Sponsor: <span className="wkb-mono text-[var(--wkb-ink)]">{bondSponsor}</span></div>
            <div>Company wallet: <span className="wkb-mono text-[var(--wkb-ink)]">{bondCompany}</span></div>
            <div>Bond trigger: <span className="wkb-mono text-[var(--wkb-ink)]">{bondTriggerAddr ?? '—'}</span></div>

            {/* Two distinct answers, deliberately not collapsed into one —
                see this session's §2.6 audit in TESTING.md. lastCheck is the
                on-chain confirmed answer (only as fresh as the last time
                anyone paid gas to call checkTrigger()); the line below it is
                a free, client-side comparison against the latest report. */}
            <div>
              On-chain check:{' '}
              {hasBeenChecked ? (
                <span className={lastCheckTriggered ? 'text-red-600 font-semibold' : 'text-green-700'}>
                  {lastCheckTriggered ? '🔴 FIRED' : '🟢 Not fired'} (checked {formatAge(lastCheckAt)})
                </span>
              ) : (
                <span className="text-[var(--wkb-ink-muted)]">never checked yet</span>
              )}
            </div>
            {bondThreshold != null && (
              <div>
                Threshold: <span className="text-[var(--wkb-ink)]">{formatUSDWhole(bondThreshold)}</span>
                {productId && (
                  <>
                    {' · '}Reports <span className="text-[var(--wkb-ink)]">{triggerTypeLabelFromValuePath(valuePath)}</span>
                    {' '}via <span className="wkb-mono text-[var(--wkb-ink)]">{productId}</span> v{Number(productVersion ?? 0)}
                  </>
                )}
              </div>
            )}
            {hasReports ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  Latest report: <span className="text-[var(--wkb-ink)]">{formatUSDWhole(latestValue)}</span>
                  {' '}({formatAge(latestReportedAt)})
                  {' — '}
                  <span className={likelyTriggered ? 'text-amber-600' : 'text-[var(--wkb-ink-muted)]'}>
                    {likelyTriggered ? 'at/above threshold, unconfirmed' : 'below threshold'}
                  </span>
                </span>
                {health && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${healthColor}`}>
                    {health} ({marginPct.toFixed(0)}%)
                  </span>
                )}
              </div>
            ) : (
              <div className="text-[var(--wkb-ink-muted)]">No reports posted to this trigger yet.</div>
            )}
            {bondTriggerAddr && validTrigger &&
              !sameAddress(bondTriggerAddr, triggerAddress) && (
              <div className="text-amber-600 mt-1">
                ⚠ Trigger address field doesn't match the bond's trigger. Actions will use your field value; status above reflects the bond's actual trigger.
              </div>
            )}
          </div>

          {isConnected && !isCompanyWallet && !isSponsor && (
            <p className="text-amber-600 text-xs pt-1">
              Connected wallet is neither sponsor nor company wallet — some actions will revert.
            </p>
          )}
          {!isConnected && (
            <p className="text-amber-600 text-xs pt-1">Connect wallet to take actions.</p>
          )}
          <div className="text-xs text-[var(--wkb-ink-muted)] pt-1">
            {family === FAMILY.SOLANA ? 'Your token balance' : 'USDC balance'}: {formatUSDC(usdcBalance)} ·{' '}
            {actions.requiresApproval ? <>Allowance to bond: {formatUSDC(usdcAllowance)}</> : 'No approval needed (Solana)'}
          </div>
        </div>
      )}

      <TxBanner
        isWriting={isPending}
        isConfirming={isConfirming}
        isConfirmed={isConfirmed}
        hash={txHash}
        error={writeError}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
        {/* Fund Coupon Budget */}
        <AdminAction
          title="Fund Coupon Budget"
          description={`Sponsor deposits coupon budget to open subscription window. Required: ${formatUSDC(requiredCouponBudget)} + 0.5% fee. Your USDC balance: ${formatUSDC(usdcBalance)}.`}
          onClick={fundBudget}
          disabled={isBusy || !isConnected || statusNum !== 0}
          label={needsBudgetApprove ? '① Approve USDC' : actions.requiresApproval ? '② Fund Coupon Budget' : 'Fund Coupon Budget'}
        />

        {/* Close Subscription */}
        <AdminAction
          title="Close Subscription"
          description="Anyone can call this once the subscription window closes. Starts the active bond phase and refunds unused coupon budget."
          onClick={() => actions.closeSubscription()}
          disabled={isBusy || !isConnected || statusNum !== 1}
          label="Close Subscription"
        />

        {/* Mark Matured */}
        <AdminAction
          title="Mark Matured"
          description={`Company wallet confirms the bond has matured (after ${maturity && Number(maturity) > 0 ? formatDate(maturity) : 'maturity'}). Enables investor principal withdrawals.`}
          onClick={() => actions.markMatured()}
          disabled={isBusy || !isConnected || !isCompanyWallet || statusNum !== 2 || !pastMaturity}
          label="Mark Matured"
        />

        {/* Settle */}
        <AdminAction
          title="Settle (Trigger Fired)"
          description={`Company wallet calls checkTrigger() and, if it comes back true, transfers all investor principal to the sponsor. Reverts on-chain if the trigger hasn't actually fired — the button doesn't pre-block on a possibly-stale local read.${likelyTriggered === false ? ' Latest report is currently below threshold.' : ''}`}
          onClick={() => actions.settle()}
          disabled={isBusy || !isConnected || !isCompanyWallet || statusNum !== 2}
          label="Settle — Send Principal to Sponsor"
          danger
        />

        {/* Self-check — callable by anyone, not just the company wallet. This
            is the §2.6 "Self-check button calls checkTrigger()" — also the
            same mechanic this session verified live with an investor
            independently confirming a trigger fired rather than trusting
            the company wallet's word. */}
        <AdminAction
          title="Self-check (checkTrigger)"
          description="Anyone can call this — pulls the trigger's latest report since this bond went Active, reverts if stale or missing, and records the confirmed result as lastCheck above."
          onClick={() => actions.checkTrigger()}
          disabled={isBusy || !isConnected || statusNum < 2}
          label="Run checkTrigger()"
        />

        {/* Post Report (primary trigger path) — only active when bond is Active */}
        <div className="rounded-[10px] border border-[var(--wkb-hairline)] p-4 sm:col-span-2" style={{ background: 'var(--wkb-panel)' }}>
          <div className="font-medium text-sm mb-1 text-[var(--wkb-ink)]">Post Report</div>

          {statusNum !== 2 ? (
            <p className="text-xs text-amber-600 leading-relaxed">
              Reporting is only available once the bond is <strong>Active</strong>.
              {statusNum === 1 && ' Close the subscription window first.'}
              {statusNum === 0 && ' Sponsor must fund the coupon budget first.'}
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--wkb-ink-muted)] mb-3 leading-relaxed">
                Calls the trigger's own <span className="wkb-mono">postReport()</span> — reporter wallet only
                (the company wallet, for a trigger deployed here). This is a manual test report, not one pulled
                from the automated monitor (<span className="wkb-mono">api/monitor/</span>), so the note below
                is hashed into <span className="wkb-mono">monitorRef</span> just to label it — it isn't a real
                traceable monitor-buffer entry the way a production report would be.
                {bondThreshold != null && (
                  <span className="text-[var(--wkb-ink)]"> Threshold: <strong>{formatUSDWhole(bondThreshold)}</strong>.</span>
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <FormField
                  label="Loss Value ($B)"
                  type="number"
                  value={reportLossB}
                  onChange={e => setReportLossB(e.target.value)}
                  placeholder="e.g. 142"
                  hint="Total in billions of USD"
                />
                <FormField
                  className="sm:col-span-2"
                  label="Note (hashed into monitorRef)"
                  value={reportNote}
                  onChange={e => setReportNote(e.target.value)}
                  placeholder="e.g. manual test — Gallagher Re H1 2026"
                />
              </div>
              <FilledButton
                className="w-full"
                onClick={() => {
                  const lossB = parseFloat(reportLossB)
                  if (isNaN(lossB) || lossB <= 0) return alert('Enter a loss value in billions')
                  const lossUSD = BigInt(Math.round(lossB * 1e9))
                  actions.postReport(triggerAddress, lossUSD, reportNote)
                }}
                disabled={isBusy || !isConnected || !validTrigger}
              >
                Post Report
              </FilledButton>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={() => { refetchBond(); refetchTrigger(); refetchUsdc(); }}
          className="text-xs text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)] underline"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}

function formatDuration(seconds) {
  const s = Math.abs(Math.round(seconds))
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** §3.2 dashboard-lite for the two canonical public triggers — the only
 *  triggers enumerable without a registry backend (deferred, see plan).
 *  Everything here is a plain on-chain read; no server involved. */
function TriggerCard({ label, address, family = ADMIN_FAMILY, network }) {
  const [expanded, setExpanded] = useState(false)
  const [testThreshold, setTestThreshold] = useState('')
  const triggerActions = useTriggerActions(family, network)
  const { isWriting: isPending, isConfirming, isConfirmed, hash: txHash, error: writeError } = triggerActions.tx
  const [reportLossB, setReportLossB] = useState('')
  const [reportNote, setReportNote] = useState('')

  const { trigger, refetch } = useTrigger(family, address, network)
  const {
    productId, version: productVersion, valuePath, units, maxReportAge,
    reportCount, reporter, owner,
  } = trigger ?? {}
  const latestValue = trigger?.latest?.value
  const latestReportedAt = trigger?.latest?.reportedAt
  const hasReports = reportCount !== undefined && Number(reportCount) > 0

  const history = useTriggerHistory(family, address, reportCount, { limit: 10, enabled: expanded }, network)

  const now = Math.floor(Date.now() / 1000)
  const secondsUntilStale = hasReports && maxReportAge !== undefined
    ? Number(maxReportAge) - (now - Number(latestReportedAt))
    : undefined
  const isStale = secondsUntilStale !== undefined && secondsUntilStale <= 0
  const isOutdated = productVersion !== undefined && Number(productVersion) < NATCAT_LOSS_PRODUCT.version

  useEffect(() => {
    if (isConfirmed) { refetch(); setReportLossB(''); setReportNote('') }
  }, [isConfirmed])

  const testResult = testThreshold !== '' && !isNaN(parseFloat(testThreshold)) && hasReports
    ? latestValue >= BigInt(Math.round(parseFloat(testThreshold) * 1e9))
    : undefined

  return (
    <div className="rounded-[10px] border border-[var(--wkb-hairline)] p-4" style={{ background: 'var(--wkb-panel)' }}>
      <button onClick={() => setExpanded(e => !e)} className="w-full flex items-center justify-between gap-4 text-left">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--wkb-ink)] flex items-center gap-2 flex-wrap">
            {label}
            {isStale && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">STALE</span>}
            {isOutdated && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">outdated version</span>}
          </div>
          <div className="text-xs text-[var(--wkb-ink-muted)] mt-0.5 wkb-mono break-all">{address}</div>
        </div>
        <span className="flex-shrink-0 text-xs text-[var(--wkb-ink-muted)]">{expanded ? 'Close' : 'Expand'}</span>
      </button>

      <div className="text-xs text-[var(--wkb-ink-muted)] mt-2 space-y-0.5">
        {hasReports ? (
          <div>
            Latest report: <span className="text-[var(--wkb-ink)]">{formatUSDWhole(latestValue)}</span>
            {' '}({formatAge(latestReportedAt)})
            {secondsUntilStale !== undefined && (
              <> · {isStale ? <span className="text-red-600">stale by {formatDuration(secondsUntilStale)}</span> : <>stale in {formatDuration(secondsUntilStale)}</>}</>
            )}
          </div>
        ) : (
          <div>No reports posted to this trigger yet.</div>
        )}
        <div>Linked bonds: <span className="text-[var(--wkb-ink-muted)]">needs a live bonds directory — not wired up yet</span></div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-[var(--wkb-hairline)] space-y-4">
          <div className="text-xs text-[var(--wkb-ink-muted)] space-y-0.5">
            <div>Product: <span className="wkb-mono text-[var(--wkb-ink)]">{productId}</span> v{Number(productVersion ?? 0)}</div>
            <div>Value path: <span className="wkb-mono text-[var(--wkb-ink)]">{valuePath}</span></div>
            <div>Units: {units} · Max report age: {maxReportAge !== undefined ? formatDuration(Number(maxReportAge)) : '—'}</div>
            <div>Reporter: <span className="wkb-mono text-[var(--wkb-ink)]">{reporter}</span></div>
            <div>Owner: <span className="wkb-mono text-[var(--wkb-ink)]">{owner}</span></div>
          </div>

          <div>
            <div className="text-xs font-semibold text-[var(--wkb-ink-muted)] uppercase tracking-wide mb-2">Report history</div>
            {history.length === 0 ? (
              <p className="text-xs text-[var(--wkb-ink-muted)]">No reports yet.</p>
            ) : (
              <div className="space-y-1 text-xs">
                {history.map((r, i) => {
                  const { value, reportedAt } = r ?? {}
                  return (
                    <div key={i} className="flex justify-between wkb-tabular">
                      <span className="text-[var(--wkb-ink)]">{formatUSDWhole(value)}</span>
                      <span className="text-[var(--wkb-ink-muted)]">{formatDate(reportedAt)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-[10px] border border-[var(--wkb-hairline)] p-3" style={{ background: 'var(--wkb-blue-wash)' }}>
            <div className="text-xs font-semibold text-[var(--wkb-ink-muted)] uppercase tracking-wide mb-2">Test trigger</div>
            <p className="text-xs text-[var(--wkb-ink-muted)] mb-2">Dry check against the latest report — no transaction, no gas.</p>
            <div className="flex items-center gap-2">
              <input
                type="number" step="0.1" value={testThreshold} onChange={e => setTestThreshold(e.target.value)}
                placeholder="Threshold ($B)"
                className="w-40 rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-1.5 text-sm text-[var(--wkb-ink)] placeholder-[var(--wkb-ink-muted)] focus:outline-none focus:border-[var(--wkb-ink-muted)]"
              />
              {testResult !== undefined && (
                <span className={testResult ? 'text-red-600 text-sm font-semibold' : 'text-green-700 text-sm font-semibold'}>
                  {testResult ? 'Would trigger' : 'Would not trigger'}
                </span>
              )}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-[var(--wkb-ink-muted)] uppercase tracking-wide mb-2">Post report</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <FormField label="Loss Value ($B)" type="number" value={reportLossB} onChange={e => setReportLossB(e.target.value)} placeholder="e.g. 142" />
              <FormField className="sm:col-span-2" label="Note" value={reportNote} onChange={e => setReportNote(e.target.value)} placeholder="e.g. manual test — Gallagher Re H1 2026" />
            </div>
            <FilledButton
              className="w-full"
              onClick={() => {
                const lossB = parseFloat(reportLossB)
                if (isNaN(lossB) || lossB <= 0) return
                const lossUSD = BigInt(Math.round(lossB * 1e9))
                triggerActions.postReport(address, lossUSD, reportNote)
              }}
              disabled={isPending || isConfirming || !reportLossB}
            >
              Post Report
            </FilledButton>
            <TxBanner isWriting={isPending} isConfirming={isConfirming} isConfirmed={isConfirmed} hash={txHash} error={writeError} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Canonical triggers for every network that has them (chains/registry.js). */
function TriggerStatusSection() {
  const networks = NETWORKS.filter(n => n.triggers?.economic || n.triggers?.industry)
  return (
    <div className="space-y-6">
      {networks.map(n => (
        <div key={n.id} className="space-y-4">
          <div className="text-xs font-semibold text-[var(--wkb-ink-muted)] uppercase tracking-wide">{n.label}</div>
          {['economic', 'industry'].filter(k => n.triggers[k]).map(k => (
            <TriggerCard
              key={k}
              label={TRIGGER_TYPES[k].label}
              address={n.triggers[k]}
              family={n.family}
              network={n.family === FAMILY.SOLANA ? n.id : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [unlocked, setUnlocked] = useState(false)
  const [greeting, setGreeting] = useState(null)

  return (
    <div className="workshop-page min-h-screen">
      <header className="max-w-3xl mx-auto px-6 pt-8 pb-2 flex items-start justify-between gap-6">
        <div>
          <Link to="/deal" className="text-xs wkb-mono text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)]">← Deal Page</Link>
          <h1 className="text-2xl font-semibold text-[var(--wkb-ink)] mt-2 flex items-center gap-3">
            Admin
            {unlocked && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">Unlocked</span>
            )}
          </h1>
          {greeting && <p className="text-sm text-[var(--wkb-ink-muted)] mt-1">{greeting}</p>}
        </div>
        {unlocked && (
          <div className="flex flex-col items-end gap-2">
            <ConnectButton family={FAMILY.EVM} label="EVM" />
            <ConnectButton family={FAMILY.SOLANA} label="Solana" />
          </div>
        )}
      </header>

      {!unlocked ? (
        <PasswordGate onUnlock={g => { setGreeting(g); setUnlocked(true) }} />
      ) : (
        <main className="max-w-3xl mx-auto px-6 pb-24 pt-6">
          <LiveBondsMap />
          <Accordion className="space-y-4">
            <AccordionSection id="deploy" number="01" title="Deploy new bond">
              <div className="pt-4">
                <DeploySection />
              </div>
            </AccordionSection>
            <AccordionSection id="manage" number="02" title="Manage bond">
              <div className="pt-4">
                <ManageSection />
              </div>
            </AccordionSection>
            <AccordionSection id="triggers" number="03" title="Trigger status">
              <div className="pt-4">
                <TriggerStatusSection />
              </div>
            </AccordionSection>
          </Accordion>
        </main>
      )}
    </div>
  )
}
