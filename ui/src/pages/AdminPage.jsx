import { useState, useEffect } from 'react'
import {
  useAccount, useConnect, useDisconnect,
  useReadContracts, useReadContract,
  useWriteContract, useWaitForTransactionReceipt,
  useDeployContract,
} from 'wagmi'
import { injected } from 'wagmi/connectors'
import { Link } from 'react-router-dom'
import { isAddress } from 'viem'
import { CATBOND_ABI, CATBOND_BYTECODE, TRIGGER_ABI, TRIGGER_BYTECODE, ERC20_ABI, TESTNET_USDC } from '../constants/abis'
import {
  formatUSDC, safeParseUSDC, parseUSDC, formatDate, formatBps,
  statusLabel, statusColorDark, daysToSeconds,
} from '../lib/utils'
import { checkPassword } from '../adminConfig'

// ── Shared components ─────────────────────────────────────────────────────────

function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono text-gray-400">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
        <button
          onClick={() => disconnect()}
          className="text-sm px-3 py-1.5 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors"
        >
          Disconnect
        </button>
      </div>
    )
  }
  return (
    <button
      onClick={() => connect({ connector: injected() })}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
    >
      Connect Wallet
    </button>
  )
}

function FormField({ label, value, onChange, type = 'text', placeholder = '', hint, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500"
      />
      {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
    </div>
  )
}

function TxBanner({ isWriting, isConfirming, isConfirmed, hash, error }) {
  if (error) {
    const msg = error?.shortMessage || error?.message || String(error)
    return (
      <div className="rounded-lg p-3 text-sm bg-red-900/40 border border-red-700 text-red-300 mt-3">
        Error: {msg}
      </div>
    )
  }
  if (isWriting) return <div className="rounded-lg p-3 text-sm bg-yellow-900/40 border border-yellow-700 text-yellow-300 mt-3">Waiting for wallet confirmation...</div>
  if (isConfirming) return <div className="rounded-lg p-3 text-sm bg-yellow-900/40 border border-yellow-700 text-yellow-300 mt-3">Confirming on-chain... <span className="font-mono">{hash?.slice(0, 12)}...</span></div>
  if (isConfirmed) return <div className="rounded-lg p-3 text-sm bg-green-900/40 border border-green-700 text-green-300 mt-3">Transaction confirmed! <span className="font-mono">{hash?.slice(0, 12)}...</span></div>
  return null
}

// ── Password gate ─────────────────────────────────────────────────────────────

function PasswordGate({ onUnlock }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const ok = await checkPassword(pw)
    if (ok) { onUnlock() } else { setError(true) }
  }

  return (
    <div className="max-w-sm mx-auto mt-24">
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-8">
        <div className="text-center mb-6">
          <div className="text-3xl mb-3">🔒</div>
          <h2 className="text-lg font-semibold">Admin Access</h2>
          <p className="text-sm text-gray-400 mt-1">Enter your admin password to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(false) }}
            placeholder="Password"
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-400 text-sm">Incorrect password.</p>}
          <button
            type="submit"
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Unlock
          </button>
        </form>
        <p className="text-xs text-gray-600 text-center mt-4">
          Change password in <code className="text-gray-500">src/adminConfig.js</code> before launch.
        </p>
      </div>
    </div>
  )
}

// ── Deploy Section ────────────────────────────────────────────────────────────

function DeploySection() {
  const { address, isConnected } = useAccount()

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
  })

  const [triggerAddr, setTriggerAddr] = useState(localStorage.getItem('catbond_trigger') || '')
  const [bondAddr, setBondAddr] = useState(localStorage.getItem('catbond_address') || '')

  // Pre-fill sponsor + company wallet from connected address
  useEffect(() => {
    if (address) {
      setForm(f => ({
        ...f,
        sponsor: f.sponsor || address,
        companyWallet: f.companyWallet || address,
      }))
    }
  }, [address])

  // Trigger deploy
  const {
    deployContract: deployTrigger,
    isPending: triggerPending,
    data: triggerTxHash,
    error: triggerError,
  } = useDeployContract()
  const {
    isLoading: triggerConfirming,
    isSuccess: triggerConfirmed,
    data: triggerReceipt,
  } = useWaitForTransactionReceipt({ hash: triggerTxHash })

  useEffect(() => {
    if (triggerConfirmed && triggerReceipt?.contractAddress) {
      const addr = triggerReceipt.contractAddress
      setTriggerAddr(addr)
      localStorage.setItem('catbond_trigger', addr)
    }
  }, [triggerConfirmed, triggerReceipt])

  // Bond deploy
  const {
    deployContract: deployBond,
    isPending: bondPending,
    data: bondTxHash,
    error: bondError,
  } = useDeployContract()
  const {
    isLoading: bondConfirming,
    isSuccess: bondConfirmed,
    data: bondReceipt,
  } = useWaitForTransactionReceipt({ hash: bondTxHash })

  useEffect(() => {
    if (bondConfirmed && bondReceipt?.contractAddress) {
      const addr = bondReceipt.contractAddress
      setBondAddr(addr)
      localStorage.setItem('catbond_address', addr)
    }
  }, [bondConfirmed, bondReceipt])

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  function handleDeployTrigger() {
    if (!isAddress(form.companyWallet)) return alert('Enter a valid company wallet address')
    const thresholdB = parseFloat(form.lossThresholdB)
    if (!form.lossThresholdB || isNaN(thresholdB) || thresholdB <= 0)
      return alert('Enter a loss threshold in billions (e.g. 370 for $370B)')
    const lossLimit = BigInt(Math.round(thresholdB * 1e9))  // whole USD
    deployTrigger({
      abi: TRIGGER_ABI,
      bytecode: TRIGGER_BYTECODE,
      args: [form.companyWallet, lossLimit, parseInt(form.dealType)],
    })
  }

  function handleDeployBond() {
    if (!triggerAddr) return alert('Deploy trigger first (Step 1)')
    if (!isAddress(form.sponsor)) return alert('Invalid sponsor address')
    if (!isAddress(form.companyWallet)) return alert('Invalid company wallet address')
    if (!isAddress(form.usdc)) return alert('Invalid USDC address')
    try {
      const couponBps = parseInt(form.couponBps)
      const coverage = parseUSDC(form.coverage)
      const minInv = parseUSDC(form.minInvestment)
      const subDur = daysToSeconds(form.subDays)
      const termDur = daysToSeconds(form.termDays)
      deployBond({
        abi: CATBOND_ABI,
        bytecode: CATBOND_BYTECODE,
        args: [form.sponsor, form.companyWallet, triggerAddr, form.usdc, couponBps, coverage, minInv, subDur, termDur],
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
    <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
      <h2 className="text-lg font-semibold mb-5">Deploy New CAT Bond</h2>

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
          <label className="block text-xs text-gray-400 mb-1">USDC Address</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.usdc}
              onChange={set('usdc')}
              placeholder="0x..."
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500 font-mono"
            />
            <select
              onChange={e => e.target.value && setForm(f => ({ ...f, usdc: e.target.value }))}
              className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-300 cursor-pointer"
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

        {/* Trigger configuration */}
        <div className="sm:col-span-2 border border-gray-600 rounded-xl p-4 space-y-3">
          <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Trigger Configuration</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Deal Type</label>
              <select
                value={form.dealType}
                onChange={set('dealType')}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1">Economic Loss (total)</option>
                <option value="0">Industry Loss (insured)</option>
              </select>
              <p className="text-xs text-gray-500 mt-0.5">
                {form.dealType === '0' ? 'Uses insured loss figures' : 'Uses total economic loss figures'}
              </p>
            </div>
            <FormField
              label="Loss Threshold ($B)"
              value={form.lossThresholdB}
              onChange={set('lossThresholdB')}
              type="number"
              placeholder="e.g. 370"
              hint={`Trigger fires when reported ${dealTypeLabel} ≥ this amount`}
            />
          </div>
        </div>

        {/* Estimated budget */}
        {estimatedBudget !== null && (
          <div className="sm:col-span-2 bg-gray-700/60 rounded-xl p-4 text-sm border border-gray-600">
            <div className="flex justify-between">
              <span className="text-gray-400">Estimated coupon budget sponsor must deposit:</span>
              <span className="font-semibold text-white">{formatUSDC(estimatedBudget)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-500 text-xs">+ 0.5% origination fee on top</span>
              <span className="text-gray-400 text-xs">{formatUSDC((estimatedBudget * 10050n) / 10000n)} total USDC needed</span>
            </div>
          </div>
        )}
      </div>

      {/* Step 1: Deploy Trigger */}
      <div className="rounded-xl border border-gray-600 p-4 mb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Step 1 — Deploy Trigger</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Owner: Company Wallet.
              {form.lossThresholdB && ` Threshold: $${form.lossThresholdB}B ${dealTypeLabel}.`}
            </div>
            {triggerAddr && (
              <div className="font-mono text-xs text-green-400 mt-1 break-all">✓ {triggerAddr}</div>
            )}
          </div>
          <button
            onClick={handleDeployTrigger}
            disabled={!isConnected || triggerPending || triggerConfirming}
            className="flex-shrink-0 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {triggerPending ? 'Confirm...' : triggerConfirming ? 'Deploying...' : triggerAddr ? 'Re-deploy' : 'Deploy Trigger'}
          </button>
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
      <div className={`rounded-xl border p-4 ${triggerAddr ? 'border-gray-600' : 'border-gray-700 opacity-60'}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium">Step 2 — Deploy CatBond</div>
            <div className="text-xs text-gray-400 mt-0.5">Uses trigger address from Step 1.</div>
            {bondAddr && (
              <div className="font-mono text-xs text-green-400 mt-1 break-all">✓ {bondAddr}</div>
            )}
          </div>
          <button
            onClick={handleDeployBond}
            disabled={!isConnected || !triggerAddr || bondPending || bondConfirming}
            className="flex-shrink-0 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {bondPending ? 'Confirm...' : bondConfirming ? 'Deploying...' : bondAddr ? 'Re-deploy' : 'Deploy Bond'}
          </button>
        </div>
        <TxBanner
          isWriting={bondPending}
          isConfirming={bondConfirming}
          isConfirmed={bondConfirmed}
          hash={bondTxHash}
          error={bondError}
        />
      </div>

      {bondAddr && (
        <div className="mt-4 bg-emerald-900/30 border border-emerald-700 rounded-xl p-4 text-sm">
          <div className="font-semibold text-emerald-400 mb-2">Deployment complete — addresses saved.</div>
          <div className="space-y-1 font-mono text-xs text-gray-300">
            <div>Trigger: <span className="text-emerald-300">{triggerAddr}</span></div>
            <div>Bond:    <span className="text-emerald-300">{bondAddr}</span></div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Deal Page will load this bond automatically. Sponsor must now call{' '}
            <strong className="text-gray-400">Fund Coupon Budget</strong> in the Manage section below.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Manage Section ────────────────────────────────────────────────────────────

function AdminAction({ title, description, onClick, disabled, label, danger = false }) {
  return (
    <div className="bg-gray-700/60 rounded-xl border border-gray-600 p-4">
      <div className="font-medium text-sm mb-1">{title}</div>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">{description}</p>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors ${
          danger
            ? 'bg-red-700 hover:bg-red-600 text-white'
            : 'bg-gray-600 hover:bg-gray-500 text-white'
        }`}
      >
        {label}
      </button>
    </div>
  )
}

const DEAL_TYPE_LABEL = { 0: 'Industry Loss (insured)', 1: 'Economic Loss (total)' }

function formatUSDWhole(n) {
  if (n == null) return '—'
  const b = Number(n) / 1e9
  if (b >= 1) return `$${b.toFixed(0)}B`
  const m = Number(n) / 1e6
  return `$${m.toFixed(0)}M`
}

function ManageSection() {
  const { address, isConnected } = useAccount()

  const [bondAddress, setBondAddress] = useState(localStorage.getItem('catbond_address') || '')
  const [triggerAddress, setTriggerAddress] = useState(localStorage.getItem('catbond_trigger') || '')
  const [reportLossB, setReportLossB] = useState('')
  const [reportSource, setReportSource] = useState('')

  const validBond = isAddress(bondAddress)
  const validTrigger = isAddress(triggerAddress)

  // Bond reads — includes the bond's own trigger address so we always check the right contract
  const { data: bondData, refetch: refetchBond } = useReadContracts({
    contracts: validBond
      ? [
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'status' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'sponsor' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'companyWallet' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'usdc' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'requiredCouponBudget' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'totalDeposited' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'coverageAmount' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'maturity' },
          { address: bondAddress, abi: CATBOND_ABI, functionName: 'trigger' },
        ]
      : [],
  })

  const [bondStatus, bondSponsor, bondCompany, bondUsdc, requiredCouponBudget, totalDeposited, coverageAmount, maturity, bondTriggerAddr] =
    bondData?.map(r => r.result) ?? []

  // Always read from the address the bond holds — never the UI input — to prevent mismatches.
  const effectiveTriggerAddr = bondTriggerAddr ?? (validTrigger ? triggerAddress : undefined)

  const { data: triggerData, refetch: refetchTrigger } = useReadContracts({
    contracts: effectiveTriggerAddr
      ? [
          { address: effectiveTriggerAddr, abi: TRIGGER_ABI, functionName: 'isTriggered' },
          { address: effectiveTriggerAddr, abi: TRIGGER_ABI, functionName: 'lossLimit' },
          { address: effectiveTriggerAddr, abi: TRIGGER_ABI, functionName: 'dealType' },
          { address: effectiveTriggerAddr, abi: TRIGGER_ABI, functionName: 'reportedValue' },
          { address: effectiveTriggerAddr, abi: TRIGGER_ABI, functionName: 'reportedSource' },
        ]
      : [],
  })
  const [triggerFired, triggerLossLimit, triggerDealType, triggerReportedValue, triggerReportedSource] =
    triggerData?.map(r => r.result) ?? []

  // USDC allowance/balance for the connected wallet (sponsor flow)
  const { data: usdcData, refetch: refetchUsdc } = useReadContracts({
    contracts: bondUsdc && address && validBond
      ? [
          { address: bondUsdc, abi: ERC20_ABI, functionName: 'allowance', args: [address, bondAddress] },
          { address: bondUsdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] },
        ]
      : [],
  })
  const [usdcAllowance, usdcBalance] = usdcData?.map(r => r.result) ?? []

  const { writeContract, isPending, data: txHash, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash })
  const isBusy = isPending || isConfirming

  useEffect(() => {
    if (isConfirmed) { refetchBond(); refetchTrigger(); refetchUsdc(); setReportLossB(''); setReportSource('') }
  }, [isConfirmed])

  const statusNum = Number(bondStatus ?? 0)
  const isCompanyWallet = address && bondCompany && address.toLowerCase() === bondCompany.toLowerCase()
  const isSponsor = address && bondSponsor && address.toLowerCase() === bondSponsor.toLowerCase()
  const now = BigInt(Math.floor(Date.now() / 1000))
  const pastMaturity = maturity && Number(maturity) > 0 && now >= maturity

  function fundBudget() {
    if (!requiredCouponBudget) return
    const totalNeeded = (requiredCouponBudget * 10050n) / 10000n
    if ((usdcAllowance ?? 0n) < totalNeeded) {
      writeContract({ address: bondUsdc, abi: ERC20_ABI, functionName: 'approve', args: [bondAddress, totalNeeded * 2n] })
    } else {
      writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'fundCouponBudget' })
    }
  }

  const needsBudgetApprove = requiredCouponBudget && (usdcAllowance ?? 0n) < (requiredCouponBudget * 10050n) / 10000n

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
      <h2 className="text-lg font-semibold mb-5">Manage Bond</h2>

      {/* Address inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Bond Address</label>
          <input
            type="text"
            value={bondAddress}
            onChange={e => { setBondAddress(e.target.value); localStorage.setItem('catbond_address', e.target.value) }}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
            placeholder="0x..."
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Trigger Address</label>
          <input
            type="text"
            value={triggerAddress}
            onChange={e => { setTriggerAddress(e.target.value); localStorage.setItem('catbond_trigger', e.target.value) }}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
            placeholder="0x..."
          />
        </div>
      </div>

      {/* Bond state summary */}
      {bondData && validBond && (
        <div className="bg-gray-700/50 rounded-xl p-4 mb-5 border border-gray-600 text-sm space-y-2">
          <div className="flex flex-wrap gap-3 items-center">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusColorDark(bondStatus)}`}>
              {statusLabel(bondStatus)}
            </span>
            <span className="text-gray-300">
              {formatUSDC(totalDeposited)} / {formatUSDC(coverageAmount)} deposited
            </span>
            {maturity && Number(maturity) > 0 && (
              <span className="text-gray-400 text-xs">Maturity: {formatDate(maturity)}</span>
            )}
          </div>
          <div className="text-xs text-gray-400 space-y-0.5">
            <div>Sponsor: <span className="font-mono text-gray-300">{bondSponsor}</span></div>
            <div>Company wallet: <span className="font-mono text-gray-300">{bondCompany}</span></div>
            <div>
              Bond trigger:{' '}
              <span className="font-mono text-gray-300">{bondTriggerAddr ?? '—'}</span>
              {' '}
              <span className={triggerFired ? 'text-red-400 font-semibold' : 'text-green-400'}>
                {triggerFired === undefined ? '(loading…)' : triggerFired ? '🔴 FIRED' : '🟢 Not fired'}
              </span>
            </div>
            {triggerLossLimit != null && (
              <div>
                Trigger type:{' '}
                <span className="text-gray-300">{DEAL_TYPE_LABEL[Number(triggerDealType)] ?? '—'}</span>
                {' · '}
                Threshold:{' '}
                <span className="text-gray-300">{formatUSDWhole(triggerLossLimit)}</span>
              </div>
            )}
            {triggerReportedValue != null && triggerReportedValue > 0n && (
              <div>
                Last report:{' '}
                <span className="text-gray-300">{formatUSDWhole(triggerReportedValue)}</span>
                {triggerReportedSource ? <span className="text-gray-500"> — {triggerReportedSource}</span> : null}
              </div>
            )}
            {bondTriggerAddr && validTrigger &&
              bondTriggerAddr.toLowerCase() !== triggerAddress.toLowerCase() && (
              <div className="text-yellow-400 mt-1">
                ⚠ Trigger address field doesn't match the bond's trigger. Actions will use your field value; status above reflects the bond's actual trigger.
              </div>
            )}
          </div>

          {isConnected && !isCompanyWallet && !isSponsor && (
            <p className="text-yellow-400 text-xs pt-1">
              Connected wallet is neither sponsor nor company wallet — some actions will revert.
            </p>
          )}
          {!isConnected && (
            <p className="text-yellow-400 text-xs pt-1">Connect wallet to take actions.</p>
          )}
          <div className="text-xs text-gray-500 pt-1">
            USDC balance: {formatUSDC(usdcBalance)} · Allowance to bond: {formatUSDC(usdcAllowance)}
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
          label={needsBudgetApprove ? '① Approve USDC' : '② Fund Coupon Budget'}
        />

        {/* Close Subscription */}
        <AdminAction
          title="Close Subscription"
          description="Anyone can call this once the subscription window closes. Starts the active bond phase and refunds unused coupon budget."
          onClick={() => writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'closeSubscription' })}
          disabled={isBusy || !isConnected || statusNum !== 1}
          label="Close Subscription"
        />

        {/* Mark Matured */}
        <AdminAction
          title="Mark Matured"
          description={`Company wallet confirms the bond has matured (after ${maturity && Number(maturity) > 0 ? formatDate(maturity) : 'maturity'}). Enables investor principal withdrawals.`}
          onClick={() => writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'markMatured' })}
          disabled={isBusy || !isConnected || !isCompanyWallet || statusNum !== 2 || !pastMaturity}
          label="Mark Matured"
        />

        {/* Settle */}
        <AdminAction
          title="Settle (Trigger Fired)"
          description="Company wallet confirms trigger has fired and transfers all investor principal to the sponsor."
          onClick={() => writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'settle' })}
          disabled={isBusy || !isConnected || !isCompanyWallet || statusNum !== 2 || !triggerFired}
          label="Settle — Send Principal to Sponsor"
          danger
        />

        {/* Report Loss (primary trigger path) — only active when bond is Active */}
        <div className="bg-gray-700/60 rounded-xl border border-gray-600 p-4 sm:col-span-2">
          <div className="font-medium text-sm mb-1">Report Loss Event</div>

          {statusNum !== 2 ? (
            <p className="text-xs text-yellow-400 leading-relaxed">
              Reporting is only available once the bond is <strong>Active</strong>.
              {statusNum === 1 && ' Close the subscription window first.'}
              {statusNum === 0 && ' Sponsor must fund the coupon budget first.'}
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                Company wallet only. Submit a confirmed loss figure and its source.
                If the value meets or exceeds the trigger threshold the bond fires automatically.
                {triggerLossLimit != null && (
                  <span className="text-gray-300">
                    {' '}Threshold: <strong>{formatUSDWhole(triggerLossLimit)}</strong> ({DEAL_TYPE_LABEL[Number(triggerDealType)]}).
                  </span>
                )}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Loss Value ($B)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={reportLossB}
                    onChange={e => setReportLossB(e.target.value)}
                    placeholder="e.g. 142"
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">Total in billions of USD</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Source</label>
                  <input
                    type="text"
                    value={reportSource}
                    onChange={e => setReportSource(e.target.value)}
                    placeholder="e.g. Gallagher Re H1 2026"
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  const lossB = parseFloat(reportLossB)
                  if (isNaN(lossB) || lossB <= 0) return alert('Enter a loss value in billions')
                  if (!reportSource.trim()) return alert('Enter a source (e.g. Gallagher Re H1 2026)')
                  const lossUSD = BigInt(Math.round(lossB * 1e9))
                  writeContract({
                    address: triggerAddress,
                    abi: TRIGGER_ABI,
                    functionName: 'report',
                    args: [lossUSD, reportSource.trim()],
                  })
                }}
                disabled={isBusy || !isConnected || !validTrigger || triggerFired === true}
                className="w-full py-2 rounded-lg text-sm font-semibold bg-orange-700 hover:bg-orange-600 text-white disabled:opacity-40 transition-colors"
              >
                {triggerFired ? 'Trigger already fired' : 'Submit Report'}
              </button>
            </>
          )}
        </div>

        {/* Reset Trigger (override / correction) */}
        <AdminAction
          title="Reset Trigger"
          description="Override trigger back to not-fired. Company wallet only. Use for corrections — report() is the standard path."
          onClick={() => writeContract({ address: triggerAddress, abi: TRIGGER_ABI, functionName: 'setTriggered', args: [false] })}
          disabled={isBusy || !isConnected || !validTrigger || triggerFired !== true}
          label="Reset Trigger"
        />

        {/* Ping Trigger */}
        <AdminAction
          title="Ping Trigger Oracle"
          description="Emits TriggerDetected event on-chain if trigger has fired but bond is still Active. Used by off-chain monitors."
          onClick={() => writeContract({ address: bondAddress, abi: CATBOND_ABI, functionName: 'pingTrigger' })}
          disabled={isBusy || !isConnected || statusNum !== 2}
          label="Ping Trigger"
        />
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={() => { refetchBond(); refetchTrigger(); refetchUsdc(); }}
          className="text-xs text-gray-500 hover:text-gray-300 underline"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [unlocked, setUnlocked] = useState(false)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-700">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link to="/" className="text-sm text-gray-400 hover:text-white transition-colors">
              ← Deal Page
            </Link>
            <h1 className="text-lg font-bold">Admin</h1>
            {unlocked && (
              <span className="text-xs px-2 py-0.5 bg-green-900 text-green-400 rounded font-medium">Unlocked</span>
            )}
          </div>
          <ConnectButton />
        </div>
      </header>

      {!unlocked ? (
        <PasswordGate onUnlock={() => setUnlocked(true)} />
      ) : (
        <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          <DeploySection />
          <ManageSection />
        </main>
      )}
    </div>
  )
}
