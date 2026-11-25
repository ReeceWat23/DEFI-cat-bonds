import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWallet, useTrigger, useCreateBond, useNetworkIdentity, isValidAddress, FAMILY, defaultNetwork } from '../../chains'
import { FilledButton, GhostButton, Panel } from './primitives'
import { TESTNET_USDC, LOCAL_RDX_TOKEN, RHODEX_COMPANY_WALLET, CANONICAL_TRIGGERS } from '../../constants/abis'
import { REGIONS } from '../../data/regionTaxonomy'
import { TRIGGER_TYPES } from '../../data/historicalLoss'
import { parseUSDC, formatUSDC, daysToSeconds } from '../../lib/utils'

// Fixed, hidden-from-the-sponsor deal mechanics — the workshop's whole point
// is never showing a term sheet, so these don't get their own form fields.
const SUBSCRIPTION_DAYS = 7   // window investors have to deposit
const TERM_DAYS = 365          // §9 Q4 — yearly only
const MIN_INVESTMENT_USD = 1000

// CatBond's constructor takes sellerName/dealId (Deal Page — Dynamic Data
// v2). The workshop doesn't collect a structured company name yet (only a
// website), so this derives one the same way DisclosureSection's
// description generator does.
function guessSellerName(website) {
  try {
    const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname
    const core = host.replace(/^www\./, '').split('.')[0]
    return core.charAt(0).toUpperCase() + core.slice(1)
  } catch {
    return 'Sponsor'
  }
}

// Local Flask dev server (api/server.py) — the one sanctioned hop between
// the browser and the bond store (Supabase). Mirrors api/deploy_deal.py's two-write handshake
// (create draft record -> dealId -> deploy on-chain with it embedded ->
// link the deployed address back) but reached from the browser instead of
// a script.
const BONDS_API = 'http://localhost:5001/bonds'

// Solana network deals are posted to: localnet while DEAL001's validator
// setup has run, else devnet. Its registry entry supplies the canonical
// triggers, company wallet and collateral mint (chains/registry.js).
const SOLANA_NET = defaultNetwork(FAMILY.SOLANA)

// Default chain for Post deal (plan §7.6): Solana whenever a Solana network
// is configured.
const DEFAULT_FAMILY = SOLANA_NET ? FAMILY.SOLANA : FAMILY.EVM

function estimateMaturityDate() {
  const days = SUBSCRIPTION_DAYS + TERM_DAYS
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

async function createDealRecord({ website, description, raise, trigger, network, environment }) {
  const res = await fetch(BONDS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cedant: guessSellerName(website),
      description,
      maturity: estimateMaturityDate(),
      value: raise,
      triggerAddress: trigger.address,
      productId: trigger.productId,
      productVersion: trigger.productVersion,
      network,
      environment,
    }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error || `create-bond failed (${res.status})`)
  }
  const data = await res.json()
  if (!data.dealId) throw new Error(data.error || 'the bond store did not return a bond id')
  return data.dealId
}

function ConnectButton({ family }) {
  const { address, isConnected, connect, disconnect } = useWallet(family)
  if (isConnected) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm wkb-mono text-[var(--wkb-ink-muted)]">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
        <GhostButton onClick={() => disconnect()}>Disconnect</GhostButton>
      </div>
    )
  }
  return <GhostButton highlight onClick={() => connect()}>{family === FAMILY.SOLANA ? 'Connect Solana wallet' : 'Connect wallet'}</GhostButton>
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
  const [family, setFamily] = useState(DEFAULT_FAMILY)
  const onSolana = family === FAMILY.SOLANA
  const canonical = onSolana ? (SOLANA_NET?.triggers ?? {}) : CANONICAL_TRIGGERS
  const triggerAddr = triggerType ? canonical[triggerType.id] ?? null : null
  const companyWallet = onSolana ? SOLANA_NET?.companyWallet : RHODEX_COMPANY_WALLET
  const solanaNetId = onSolana ? SOLANA_NET?.id : undefined
  const { address, isConnected } = useWallet(family)

  // The bond record stores which trigger (and product version) the bond
  // settles on. Read from the trigger itself rather than assuming the
  // current product version: a canonical trigger can predate the latest
  // product (e.g. a v2 trigger after v3 shipped).
  const { trigger: canonicalTrigger } = useTrigger(family, triggerAddr ?? undefined, solanaNetId)
  const triggerProductId = canonicalTrigger?.productId
  const triggerProductVersion = canonicalTrigger?.version
  // CANONICAL_TRIGGERS are hard-coded per chain; after an anvil restart they
  // point at nothing, and CatBond's constructor rejects them (InvalidTrigger).
  const triggerMissing = !!triggerAddr && canonicalTrigger?.exists === false
  // Post only once the trigger is read and carries its product id + version:
  // the deal record stores them, and a still-loading or failed read would
  // save the row with both empty.
  const triggerReady = canonicalTrigger?.exists === true && !!triggerProductId && triggerProductVersion !== undefined

  // Solana: the network's collateral mint is known, so pre-fill it.
  const [usdcAddr, setUsdcAddr] = useState(onSolana ? SOLANA_NET?.mint ?? '' : '')
  function chooseChain(next) {
    if (next === family) return
    setFamily(next)
    setUsdcAddr(next === FAMILY.SOLANA ? SOLANA_NET?.mint ?? '' : '')
  }

  const createBond = useCreateBond(family, solanaNetId)
  const networkIdentity = useNetworkIdentity(family, solanaNetId)
  const [dealNetwork, setDealNetwork] = useState(null)
  const { isWriting: bondPending, isConfirming: bondConfirming, error: bondError } = createBond.tx

  const [bondAddr, setBondAddr] = useState(null)
  const [dealId, setDealId] = useState(null)
  const [creatingBond, setCreatingBond] = useState(false)
  const [recordError, setRecordError] = useState(null)

  useEffect(() => {
    if (createBond.createdAddress) {
      const addr = createBond.createdAddress
      setBondAddr(addr)
      localStorage.setItem('catbond_address', addr)
      localStorage.setItem('catbond_trigger', triggerAddr)
      // Step 3 of the handshake — link the now-deployed address back onto
      // the bond record. Fire-and-forget: the on-chain deploy already
      // succeeded and carries dealId itself, so a failed link here doesn't
      // block the UI, just logs — the record stays creatable/linkable by
      // hand later via bonds.link_contract_address(dealId, addr).
      if (dealId) {
        fetch(`${BONDS_API}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealId, contractAddress: addr, network: dealNetwork }),
        }).catch(e => console.error('[postDeal] link-bond failed', e))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createBond.createdAddress])

  if (!layer) {
    return <p className="text-sm text-[var(--wkb-ink-muted)]">Confirm a layer in Section 01 to review your deal.</p>
  }

  async function postDeal() {
    setRecordError(null)
    setCreatingBond(true)
    // No loss-history upload yet (rpos.loss_history_path is for a stored
    // file) — fold the typed text into the description rather than
    // silently dropping what the sponsor entered.
    const summary = state.disclosure.description.edited || state.disclosure.description.generated
    const lossHistory = state.disclosure.lossHistory.trim()
    const description = lossHistory ? `${summary}\n\nLoss history: ${lossHistory}` : summary
    let newDealId
    try {
      // Which chain the row lives on: CAIP-2 id + environment (plan §2.5).
      const { network, environment } = await networkIdentity()
      setDealNetwork(network)
      newDealId = await createDealRecord({
        network, environment,
        website: state.disclosure.website, description, raise: layer.raise,
        trigger: {
          address: triggerAddr,
          productId: triggerProductId,
          productVersion: triggerProductVersion !== undefined ? Number(triggerProductVersion) : undefined,
        },
      })
    } catch (e) {
      setCreatingBond(false)
      setRecordError(e.message || String(e))
      return // don't deploy on-chain without a web2 record to link it to
    }
    setDealId(newDealId)
    setCreatingBond(false)

    createBond.create({
      sponsor:              address,
      companyWallet,
      trigger:              triggerAddr,
      threshold:            BigInt(Math.round(layer.triggerLevel * 1e9)), // threshold lives on the bond, not the shared trigger
      mint:                 usdcAddr,
      couponRateBps:        Math.round(layer.coupon * 100),
      coverageAmount:       parseUSDC(String(layer.raise)),
      minInvestment:        parseUSDC(String(MIN_INVESTMENT_USD)),
      subscriptionDuration: daysToSeconds(SUBSCRIPTION_DAYS),
      termDuration:         daysToSeconds(TERM_DAYS),
      sellerName:           guessSellerName(state.disclosure.website),
      dealId:               newDealId,
      exposure:             state.disclosure.sov.regions.map(r => ({ region: r.country, pct: r.exposurePct })),
    })
  }

  const currencyLabel = network === 'mainnet' ? 'USDC' : 'RDX'
  const listingFee = Math.round(layer.raise * 0.0005)
  const isBusy = bondPending || bondConfirming || creatingBond
  const canPost = isConnected && isValidAddress(usdcAddr, family) && !!triggerAddr && triggerReady && !!companyWallet && !isBusy && !bondAddr
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
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Chain</label>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {SOLANA_NET && (
            <GhostButton highlight={onSolana} onClick={() => chooseChain(FAMILY.SOLANA)} disabled={isBusy}>
              Solana · {SOLANA_NET.label.replace(/^Solana /, '')}
            </GhostButton>
          )}
          <GhostButton highlight={!onSolana} onClick={() => chooseChain(FAMILY.EVM)} disabled={isBusy}>
            EVM
          </GhostButton>
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <ConnectButton family={family} />
        </div>
        {onSolana && (
          <p className="text-xs text-[var(--wkb-ink-muted)] mb-3">
            Your connected Solana wallet signs as the sponsor. Company wallet:{' '}
            <span className="wkb-mono">{companyWallet ? `${companyWallet.slice(0, 4)}…${companyWallet.slice(-4)}` : 'not configured'}</span>.
          </p>
        )}
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">{currencyLabel} address</label>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            type="text"
            value={usdcAddr}
            onChange={e => setUsdcAddr(e.target.value)}
            disabled={isBusy}
            placeholder={onSolana ? 'Mint address…' : '0x…'}
            className="w-full sm:w-96 rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm wkb-mono focus:outline-none focus:border-[var(--wkb-ink-muted)] disabled:opacity-50"
          />
          <select
            onChange={e => e.target.value && setUsdcAddr(e.target.value)}
            defaultValue=""
            disabled={isBusy}
            className="rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-2 py-2 text-xs text-[var(--wkb-ink-muted)] disabled:opacity-50"
          >
            <option value="" disabled>Testnet preset</option>
            {onSolana ? (
              SOLANA_NET?.mint && <option value={SOLANA_NET.mint}>{SOLANA_NET.environment === 'local' ? 'Local (Solana RDX)' : 'Circle devnet USDC'}</option>
            ) : (
              <>
                <option value={LOCAL_RDX_TOKEN}>Local (Anvil RDX)</option>
                {Object.entries(TESTNET_USDC).map(([name, addr]) => <option key={addr} value={addr}>{name}</option>)}
              </>
            )}
          </select>
        </div>

        {!usdcAddr && (
          <p className="text-xs text-red-600 mb-3">Pick a {currencyLabel} address above — "Post deal" won't do anything until it's set.</p>
        )}
        {usdcAddr && !isValidAddress(usdcAddr, family) && (
          <p className="text-xs text-red-600 mb-3">That doesn't look like a valid address.</p>
        )}
        {!triggerAddr && (
          <p className="text-xs text-red-600 mb-3">No canonical trigger configured for this deal type yet.</p>
        )}
        {triggerMissing && (
          <p className="text-xs text-red-600 mb-3">
            The canonical {triggerType?.label.toLowerCase()} trigger (<span className="wkb-mono">{triggerAddr}</span>) doesn't
            exist on the connected network —{' '}
            {onSolana
              ? <>restart the local validator with <code className="wkb-mono">npm run localnet</code> in DEAL001.</>
              : <>after an anvil restart, redeploy it and update <code className="wkb-mono">CANONICAL_TRIGGERS</code> in <code className="wkb-mono">constants/abis.js</code>.</>}
          </p>
        )}
        {recordError && (
          <p className="text-xs text-red-600 mb-3">
            Couldn't create the deal record ({recordError}) — make sure the local API server is
            running (<code className="wkb-mono">python3 api/server.py</code>). Nothing was deployed.
          </p>
        )}
        {error && <p className="text-xs text-red-600 mb-3">{error.shortMessage || error.message}</p>}
        {creatingBond && <p className="text-xs text-[var(--wkb-ink-muted)] mb-3">Creating deal record…</p>}
        {bondPending && <p className="text-xs text-[var(--wkb-ink-muted)] mb-3">Confirm the deployment in your wallet…</p>}
        {bondConfirming && <p className="text-xs text-[var(--wkb-ink-muted)] mb-3">Deploying…</p>}

        <FilledButton disabled={!canPost} onClick={postDeal}>
          Post deal
        </FilledButton>
      </Block>
    </div>
  )
}
