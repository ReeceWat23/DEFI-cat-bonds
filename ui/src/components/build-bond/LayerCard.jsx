import { useState } from 'react'
import { GhostButton } from './primitives'
import { TRIGGER_TYPES } from '../../data/historicalLoss'

const MIN_RAISE = 1_000_000 // §9 Q2

// Log-scaled slider: linear makes everything below $50B unusable (§4.3).
const LOG_FLOOR_B = 1
function valueToSliderPos(valueB, maxB) {
  const v = Math.max(LOG_FLOOR_B, Math.min(maxB, valueB || 0))
  return (Math.log(v) - Math.log(LOG_FLOOR_B)) / (Math.log(maxB) - Math.log(LOG_FLOOR_B))
}
function sliderPosToValue(pos, maxB) {
  return Math.round(Math.exp(Math.log(LOG_FLOOR_B) + pos * (Math.log(maxB) - Math.log(LOG_FLOOR_B))))
}

function formatCompactUSD(n) {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n}`
}

// Static pricing reference points (Plan-it-2 §4.3) — 2026 market anchors,
// not a computed judgment on the sponsor's coupon. A lower attach
// probability (higher trigger level, tighter layer) generally prices
// lower than these anchors; a frequent-attach layer prices higher. Left as
// notes for the sponsor to weigh, not an automated pass/fail.
const PRICING_REFERENCE = {
  ilw: 'ILW pricing (2026): $50B attach, all perils ≈ 17%',
  catBondYield: 'Cat bond yield (2026): ~9.9% average',
}

export default function LayerCard({ layer, index, triggerTypeId, network, onChange, onConfirm, onEdit, removable, onRemove }) {
  const [finalChecked, setFinalChecked] = useState(false)
  const type = TRIGGER_TYPES[triggerTypeId]
  const maxB = type?.maxB ?? 1000
  const currencyLabel = network === 'mainnet' ? 'USDC' : 'RDX'

  const raise = layer.raise || 0
  const coupon = layer.coupon || 0
  const deposit = Math.round(raise * (coupon / 100))

  const raiseBelowMin = raise > 0 && raise < MIN_RAISE

  const canConfirm = layer.triggerLevel > 0 && raise >= MIN_RAISE && coupon > 0 && finalChecked

  // ── Collapsed summary row ──────────────────────────────────────────────
  if (layer.confirmed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--wkb-hairline)] bg-[var(--wkb-panel-raised)] px-4 py-3">
        <span className="text-sm wkb-mono text-[var(--wkb-ink)]">
          Layer {index + 1} · {type?.label} · ${layer.triggerLevel}B trigger · {formatCompactUSD(raise)} at {coupon}% · deposit {formatCompactUSD(deposit)}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)] underline transition-colors"
          style={{ transitionDuration: '200ms' }}
        >
          Edit
        </button>
      </div>
    )
  }

  // ── Open card ───────────────────────────────────────────────────────────
  return (
    <div className="rounded-[10px] border border-[var(--wkb-hairline)] bg-[var(--wkb-panel-raised)] p-5" style={{ boxShadow: 'var(--wkb-shadow)' }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs wkb-mono text-[var(--wkb-ink-muted)]">Layer {index + 1}</span>
        {removable && (
          <button type="button" onClick={onRemove} className="text-xs text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)] underline">
            Remove
          </button>
        )}
      </div>

      {/* Trigger level */}
      <div className="mb-5">
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Trigger level</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={valueToSliderPos(layer.triggerLevel, maxB)}
            onChange={e => onChange({ triggerLevel: sliderPosToValue(parseFloat(e.target.value), maxB) })}
            className="flex-1 wkb-highlight-accent"
          />
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="number"
              min={0}
              max={maxB}
              value={layer.triggerLevel || ''}
              onChange={e => onChange({ triggerLevel: Math.max(0, Math.min(maxB, Number(e.target.value) || 0)) })}
              className="w-24 rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-2 py-1.5 text-sm wkb-tabular focus:outline-none focus:border-[var(--wkb-ink-muted)] wkb-highlight-border"
            />
            <span className="text-xs text-[var(--wkb-ink-muted)]">$B</span>
          </div>
        </div>
        <p className="text-xs text-[var(--wkb-ink-muted)] mt-1">0–{maxB >= 1000 ? '1,000 ($1T)' : `${maxB} ($${maxB}B)`}</p>
      </div>

      {/* Capital to raise */}
      <div className="mb-5">
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Capital to raise</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={layer.raise || ''}
            onChange={e => onChange({ raise: Math.max(0, Number(e.target.value) || 0) })}
            placeholder="1,000,000"
            className="w-full rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm wkb-tabular focus:outline-none focus:border-[var(--wkb-ink-muted)]"
          />
          <span className="text-xs wkb-mono text-[var(--wkb-ink-muted)] shrink-0">{currencyLabel}</span>
        </div>
        {raiseBelowMin && (
          <p className="text-xs text-red-600 mt-1">Minimum raise is {formatCompactUSD(MIN_RAISE)}.</p>
        )}
      </div>

      {/* Coupon + deposit, side by side */}
      <div className="grid grid-cols-2 gap-6 mb-2">
        <div>
          <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Coupon</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={layer.coupon || ''}
              onChange={e => onChange({ coupon: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              className="w-full rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm wkb-tabular focus:outline-none focus:border-[var(--wkb-ink-muted)]"
            />
            <span className="text-xs text-[var(--wkb-ink-muted)]">%</span>
          </div>
        </div>
        <div>
          <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Required deposit</label>
          <div className="wkb-highlight-text text-2xl font-semibold wkb-tabular text-[var(--wkb-ink)]">
            {formatCompactUSD(deposit)}
          </div>
        </div>
      </div>

      <div className="text-xs text-[var(--wkb-ink-muted)] border border-[var(--wkb-hairline)] rounded-[8px] px-3 py-2 mt-2 space-y-0.5">
        <p>{PRICING_REFERENCE.ilw}</p>
        <p>{PRICING_REFERENCE.catBondYield}</p>
        <p>Anchors, not a rule — a tighter layer (higher trigger, lower attach probability) typically prices below these; a frequent-attach layer prices above.</p>
      </div>

      <p className="text-xs text-[var(--wkb-ink-muted)] mt-3">
        Worked example: $500,000 raise at 10% → $50,000 deposit. Terms run up to 12 months, so your deposit covers the whole coupon.
      </p>

      {/* Confirm row */}
      <div className="mt-5 pt-4 border-t border-[var(--wkb-hairline)] flex items-center justify-between gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-[var(--wkb-ink)] cursor-pointer">
          <input
            type="checkbox"
            checked={finalChecked}
            onChange={e => setFinalChecked(e.target.checked)}
            className="wkb-highlight-accent"
          />
          These terms are final
        </label>
        <GhostButton
          highlight
          disabled={!canConfirm}
          onClick={() => { onConfirm(); setFinalChecked(false) }}
        >
          Confirm layer
        </GhostButton>
      </div>
    </div>
  )
}
