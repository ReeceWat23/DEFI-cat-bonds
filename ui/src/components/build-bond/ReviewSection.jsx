import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, useConnect, useDisconnect, useDeployContract, useWaitForTransactionReceipt } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { isAddress } from 'viem'
import { FilledButton, GhostButton, Panel } from './primitives'
import { CATBOND_ABI, CATBOND_BYTECODE, TESTNET_USDC, LOCAL_RDX_TOKEN, RHODEX_COMPANY_WALLET, CANONICAL_TRIGGERS } from '../../constants/abis'
import { REGIONS } from '../../data/regionTaxonomy'
import { TRIGGER_TYPES } from '../../data/historicalLoss'
import { parseUSDC, formatUSDC, daysToSeconds } from '../../lib/utils'

// Fixed, hidden-from-the-sponsor deal mechanics — the workshop's whole point
// is never showing a term sheet, so these don't get their own form fields.
const SUBSCRIPTION_DAYS = 7   // window investors have to deposit
const TERM_DAYS = 365          // §9 Q4 — yearly only
const MIN_INVESTMENT_USD = 1000

// CatBond's constructor now takes sellerName/dealId (Deal Page — Dynamic
// Data v2). The workshop doesn't collect a structured company name yet
// (only a website), so this derives one the same way DisclosureSection's
// description generator does. dealId stays empty — the live workshop
// doesn't create a web2 Deal record yet (that's api/deploy_deal.py's job
// for the DEAL 000 fixture path); wiring this flow to the bonds API is
// separate, larger work, not done here.
function guessSellerName(website) {
  try {
    const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname
    const core = host.replace(/^www\./, '').split('.')[0]
    return core.charAt(0).toUpperCase() + core.slice(1)
  } catch {
    return 'Sponsor'
  }
}

function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm wkb-mono text-[var(--wkb-ink-muted)]">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
        <GhostButton onClick={() => disconnect()}>Disconnect</GhostButton>
      </div>
    )
  }
  return <GhostButton highlight onClick={() => connect({ connector: injected() })}>Connect wallet</GhostButton>
}

function Block({ title, children }) {
  return (
    <div className="py-5 border-t border-[var(--wkb-hairline)] first:border-t-0 first:pt-0">
      <h3 className="text-xs uppercase tracking-wide text-[var(--wkb-ink-muted)] mb-3">{title}</h3>
      {children}
    </div>
  )
}

export default function ReviewSection({ state, network }) {
  const layer = state.parameters.layers.find(l => l.confirmed)
  const triggerType = TRIGGER_TYPES[state.parameters.triggerType]
  // "Select trigger" (sprint plan §2.6) collapses into the Deal Type choice
  // already made in Section 01: with exactly two public deal types, there's
  // no need for a registry enumerating every trigger ever deployed — one
  // canonical, already-reported-to trigger per type, shared by every public
  // bond of that type, is the whole feature. See constants/abis.js.
  const triggerAddr = triggerType ? CANONICAL_TRIGGERS[triggerType.id] : null
  const { address, isConnected } = useAccount()

  const [usdcAddr, setUsdcAddr] = useState('')

  const {
    deployContract: deployBond, isPending: bondPending, data: bondTxHash, error: bondError,
  } = useDeployContract()
  const { isLoading: bondConfirming, isSuccess: bondConfirmed, data: bondReceipt } =
    useWaitForTransactionReceipt({ hash: bondTxHash })

  const [bondAddr, setBondAddr] = useState(null)

  useEffect(() => {
    if (bondConfirmed && bondReceipt?.contractAddress) {
      const addr = bondReceipt.contractAddress
      console.log('[postDeal] confirmed, contract deployed at', addr, bondReceipt)
      setBondAddr(addr)
      localStorage.setItem('catbond_address', addr)
      localStorage.setItem('catbond_trigger', triggerAddr)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bondConfirmed, bondReceipt])

  // Diagnostic: log every state change in the deploy pipeline so a stuck
  // "Post deal" click is visible in the console instead of just idling.
  // Flattened to a template string (not a raw object) so it survives a
  // copy-paste out of a collapsed devtools console.
  useEffect(() => {
    console.log(
      `[postDeal] state pending=${bondPending} confirming=${bondConfirming} confirmed=${bondConfirmed} ` +
      `txHash=${bondTxHash ?? 'none'} error=${bondError ? (bondError.shortMessage || bondError.message) : 'none'}`
    )
  }, [bondPending, bondConfirming, bondConfirmed, bondTxHash, bondError])

  if (!layer) {
    return <p className="text-sm text-[var(--wkb-ink-muted)]">Confirm a layer in Section 01 to review your deal.</p>
  }

  function postDeal() {
    const args = [
      address, RHODEX_COMPANY_WALLET, triggerAddr,
      BigInt(Math.round(layer.triggerLevel * 1e9)), // threshold lives on the bond, not the shared trigger
      usdcAddr,
      Math.round(layer.coupon * 100),
      parseUSDC(String(layer.raise)),
      parseUSDC(String(MIN_INVESTMENT_USD)),
      daysToSeconds(SUBSCRIPTION_DAYS),
      daysToSeconds(TERM_DAYS),
      guessSellerName(state.disclosure.website),
      '',
      state.disclosure.sov.regions.map(r => ({ region: r.country, pct: r.exposurePct })),
    ]
    console.log(
      `[postDeal] clicked canPost=${canPost} isConnected=${isConnected} address=${address} ` +
      `usdcAddr=${usdcAddr} triggerAddr=${triggerAddr} isBusy=${isBusy} bondAddr=${bondAddr}`
    )
    console.log('[postDeal] args', args.map(a => typeof a === 'bigint' ? a.toString() + 'n' : JSON.stringify(a)).join(', '))
    try {
      deployBond({ abi: CATBOND_ABI, bytecode: CATBOND_BYTECODE, args })
      console.log('[postDeal] deployContract() called, waiting on wallet…')
    } catch (e) {
      console.error('[postDeal] deployContract() threw synchronously', e?.shortMessage || e?.message || e)
    }
  }

  const currencyLabel = network === 'mainnet' ? 'USDC' : 'RDX'
  const listingFee = Math.round(layer.raise * 0.0005)
  const isBusy = bondPending || bondConfirming
  const canPost = isConnected && isAddress(usdcAddr) && !!triggerAddr && !isBusy && !bondAddr
  const error = bondError

  if (bondAddr) {
    return (
      <Panel raised className="p-6 text-center">
        <p className="text-sm text-[var(--wkb-ink-muted)] mb-2">Deal posted.</p>
        <h3 className="text-lg font-semibold text-[var(--wkb-ink)] mb-4">
          {triggerType?.label} · ${layer.triggerLevel}B trigger · {formatUSDC(parseUSDC(String(layer.raise)))} coverage
        </h3>
        <p className="text-xs wkb-mono text-[var(--wkb-ink-muted)] break-all mb-5">{bondAddr}</p>
        <FilledButton as={Link} to="/deal">View your deal →</FilledButton>
      </Panel>
    )
  }

  return (
    <div>
      <Block title="Layer terms">
        <p className="text-sm text-[var(--wkb-ink)]">
          {triggerType?.label} · ${layer.triggerLevel}B trigger · {formatUSDC(parseUSDC(String(layer.raise)))} raise ·{' '}
          {layer.coupon}% coupon · {formatUSDC(parseUSDC(String(Math.round(layer.raise * layer.coupon / 100))))} deposit
        </p>
      </Block>

      <Block title="Disclosure">
        <p className="text-sm text-[var(--wkb-ink)]">
          {state.disclosure.website || 'No website provided'}
          {state.disclosure.sov.regions.length > 0 && (
            <> · Public exposure: {state.disclosure.sov.regions.map(r => REGIONS[r.country].label).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</>
          )}
          {' · '}Verification: {state.disclosure.verification}
        </p>
        <p className="text-xs text-[var(--wkb-ink-muted)] mt-1">
          Addresses, insured names, and per-location values stay private.
        </p>
      </Block>

      <Block title="Settlement">
        <p className="text-sm text-[var(--wkb-ink)]">Named oracle: Gallagher Re {triggerType?.label.toLowerCase()} report.</p>
        <p className="text-xs text-[var(--wkb-ink-muted)] mt-1">
          Settles when Gallagher Re's report for the covered period meets or exceeds ${layer.triggerLevel}B.
        </p>
      </Block>

      <Block title="Tenor">
        <p className="text-sm text-[var(--wkb-ink)]">12 months.</p>
        <p className="text-xs text-[var(--wkb-ink-muted)] mt-1">
          Starts when your subscription window closes and ends 12 months later. Coverage does not roll over —
          post a renewal before maturity to continue.
        </p>
      </Block>

      <Block title="Fees">
        <p className="text-xs text-[var(--wkb-ink-muted)]">
          Listing: 0.05% ({formatUSDC(parseUSDC(String(listingFee)))}) · Deposit: 0.5%, collected automatically when investors deposit.
        </p>
      </Block>

      <Block title="Ship it">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <ConnectButton />
        </div>
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">{currencyLabel} address</label>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="text"
            value={usdcAddr}
            onChange={e => setUsdcAddr(e.target.value)}
            disabled={isBusy}
            placeholder="0x…"
            className="w-full sm:w-96 rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm wkb-mono focus:outline-none focus:border-[var(--wkb-ink-muted)] disabled:opacity-50"
          />
          <select
            onChange={e => e.target.value && setUsdcAddr(e.target.value)}
            defaultValue=""
            disabled={isBusy}
            className="rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-2 py-2 text-xs text-[var(--wkb-ink-muted)] disabled:opacity-50"
          >
            <option value="" disabled>Testnet preset</option>
            <option value={LOCAL_RDX_TOKEN}>Local (Anvil RDX)</option>
            {Object.entries(TESTNET_USDC).map(([name, addr]) => <option key={addr} value={addr}>{name}</option>)}
          </select>
        </div>

        {!usdcAddr && (
          <p className="text-xs text-red-600 mb-3">Pick a {currencyLabel} address above — "Post deal" won't do anything until it's set.</p>
        )}
        {usdcAddr && !isAddress(usdcAddr) && (
          <p className="text-xs text-red-600 mb-3">That doesn't look like a valid address.</p>
        )}
        {!triggerAddr && (
          <p className="text-xs text-red-600 mb-3">No canonical trigger configured for this deal type yet.</p>
        )}
        {error && <p className="text-xs text-red-600 mb-3">{error.shortMessage || error.message}</p>}
        {bondPending && <p className="text-xs text-[var(--wkb-ink-muted)] mb-3">Confirm the deployment in your wallet…</p>}
        {bondConfirming && <p className="text-xs text-[var(--wkb-ink-muted)] mb-3">Deploying…</p>}

        <FilledButton disabled={!canPost} onClick={postDeal}>
          Post deal
        </FilledButton>
      </Block>
    </div>
  )
}
