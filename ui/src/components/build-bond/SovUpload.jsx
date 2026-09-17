import { useRef, useState } from 'react'
import { GhostButton } from './primitives'
import { REGIONS, US_STATES } from '../../data/regionTaxonomy'

let nextRegionId = 1

// Drag-and-drop + click-to-browse upload, then the anonymization preview
// (Plan-it-2 §5.2). The file itself is never parsed or persisted anywhere —
// this is a demo-posture disclosure flow, so the sponsor builds the public
// region breakdown by hand after uploading, and that breakdown (never the
// raw file) is what becomes public.
export default function SovUpload({ sov, onChange }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  function pickFile(file) {
    if (!file) return
    onChange({ fileRef: file.name, skipped: false, regions: sov.regions.length ? sov.regions : [{ id: nextRegionId++, country: 'US', state: '', perils: [], exposurePct: 0 }] })
  }

  // Never append a duplicate country — pick the first one not already in the
  // list. Root-caused a real bug in the seed disclosure data (Plan-it-2
  // dealpage doc §2): US/China/Brazil each listed twice was this exact
  // shape of append-without-checking.
  //
  // US is the one exception: it has state-level subdivision (US_STATES), so
  // multiple US rows are fine as long as each has a distinct state — "US
  // (California)" and "US (Texas)" are different layers, not a duplicate.
  // Only an exact (US, same state) pair — including two "All states" rows —
  // counts as a dupe. countryAvailable() is shared by the per-row <select>
  // (excluding the row itself, so its own current value never disables
  // itself) and the "+ Add region" button (no row to exclude, id: null).
  function countryAvailable(countryCode, excludeRegionId) {
    const others = sov.regions.filter(r => r.id !== excludeRegionId)
    if (countryCode !== 'US') return !others.some(r => r.country === countryCode)
    const usedStates = new Set(others.filter(r => r.country === 'US').map(r => r.state || ''))
    return usedStates.size < US_STATES.length + 1 // + 1 for "All states"
  }
  const availableCountries = Object.keys(REGIONS).filter(c => countryAvailable(c, null))

  function addRegion() {
    if (availableCountries.length === 0) return
    const country = availableCountries[0]
    let state = ''
    if (country === 'US') {
      const usedStates = new Set(sov.regions.filter(r => r.country === 'US').map(r => r.state || ''))
      // Prefer a real state over "All states" so a fresh row never collides
      // with an existing "All states" layer.
      state = US_STATES.find(st => !usedStates.has(st)) ?? ''
    }
    onChange({ regions: [...sov.regions, { id: nextRegionId++, country, state, perils: [], exposurePct: 0 }] })
  }
  function updateRegion(id, patch) {
    onChange({ regions: sov.regions.map(r => (r.id === id ? { ...r, ...patch } : r)) })
  }
  function removeRegion(id) {
    onChange({ regions: sov.regions.filter(r => r.id !== id) })
  }
  function togglePeril(id, peril) {
    const region = sov.regions.find(r => r.id === id)
    const has = region.perils.includes(peril)
    updateRegion(id, { perils: has ? region.perils.filter(p => p !== peril) : [...region.perils, peril] })
  }

  const totalsByCountry = sov.regions.reduce((acc, r) => {
    acc[r.country] = (acc[r.country] || 0) + (Number(r.exposurePct) || 0)
    return acc
  }, {})
  const totalExposure = sov.regions.reduce((sum, r) => sum + (Number(r.exposurePct) || 0), 0)
  const overCap = totalExposure > 100

  if (!sov.fileRef && !sov.skipped) {
    return (
      <div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]) }}
          onClick={() => inputRef.current?.click()}
          className="rounded-[10px] border border-dashed px-6 py-8 text-center cursor-pointer transition-colors"
          style={{
            borderColor: dragOver ? 'var(--wkb-ink-muted)' : 'var(--wkb-hairline)',
            transitionDuration: '200ms',
          }}
        >
          <p className="text-sm text-[var(--wkb-ink-muted)]">Drag a file here, or click to browse.</p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={e => pickFile(e.target.files?.[0])}
          />
        </div>
        <button
          type="button"
          onClick={() => onChange({ skipped: true })}
          className="text-xs text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)] underline mt-2"
        >
          Skip for now
        </button>
      </div>
    )
  }

  if (sov.skipped) {
    return (
      <div className="rounded-[10px] border border-dashed border-[var(--wkb-hairline)] px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--wkb-ink-muted)]">Skipped — no SOV uploaded.</span>
        <button type="button" onClick={() => onChange({ skipped: false })} className="text-xs underline text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)]">
          Upload one
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--wkb-hairline)] bg-[var(--wkb-panel-raised)] px-4 py-3 mb-4">
        <span className="text-sm wkb-mono text-[var(--wkb-ink)]">{sov.fileRef}</span>
        <button type="button" onClick={() => onChange({ fileRef: null, regions: [] })} className="text-xs text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)] underline">
          Remove
        </button>
      </div>

      <p className="text-xs text-[var(--wkb-ink-muted)] mb-3">
        After upload, we strip to general regions of exposure. This is exactly what will be public:
      </p>

      <p className={`text-xs mb-3 ${overCap ? 'text-red-600' : 'text-[var(--wkb-ink-muted)]'}`}>
        {overCap
          ? `Regional exposure totals ${totalExposure}%. Reduce to 100% or below to continue.`
          : `Regional exposure: ${totalExposure}%`}
      </p>

      <div className="space-y-3">
        {sov.regions.map(region => (
          <div key={region.id} className="rounded-[8px] border border-[var(--wkb-hairline)] p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <select
                value={region.country}
                onChange={e => updateRegion(region.id, { country: e.target.value, state: '' })}
                className="rounded-[6px] border border-[var(--wkb-hairline)] bg-transparent px-2 py-1 text-xs"
              >
                {Object.entries(REGIONS).map(([id, r]) => {
                  const usedElsewhere = id !== region.country && !countryAvailable(id, region.id)
                  return (
                    <option key={id} value={id} disabled={usedElsewhere}>
                      {r.label}{usedElsewhere ? ' (already added)' : ''}
                    </option>
                  )
                })}
              </select>

              {region.country === 'US' && (
                <select
                  value={region.state}
                  onChange={e => updateRegion(region.id, { state: e.target.value })}
                  className="rounded-[6px] border border-[var(--wkb-hairline)] bg-transparent px-2 py-1 text-xs"
                >
                  {(() => {
                    const usedElsewhere = (state) => sov.regions.some(other => other.id !== region.id && other.country === 'US' && (other.state || '') === state)
                    return (
                      <>
                        <option value="" disabled={usedElsewhere('')}>All states{usedElsewhere('') ? ' (already added)' : ''}</option>
                        {US_STATES.map(s => (
                          <option key={s} value={s} disabled={usedElsewhere(s)}>{s}{usedElsewhere(s) ? ' (already added)' : ''}</option>
                        ))}
                      </>
                    )
                  })()}
                </select>
              )}

              <div className="flex items-center gap-1 ml-auto">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={region.exposurePct || ''}
                  onChange={e => updateRegion(region.id, { exposurePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  className="w-16 rounded-[6px] border border-[var(--wkb-hairline)] bg-transparent px-2 py-1 text-xs wkb-tabular"
                />
                <span className="text-xs text-[var(--wkb-ink-muted)]">%</span>
              </div>

              <button type="button" onClick={() => removeRegion(region.id)} className="text-xs text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)] underline">
                Remove
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {REGIONS[region.country].perils.map(peril => (
                <button
                  key={peril}
                  type="button"
                  onClick={() => togglePeril(region.id, peril)}
                  className="text-xs rounded-full border px-2 py-0.5 transition-colors"
                  style={{
                    borderColor: region.perils.includes(peril) ? 'var(--wkb-ink)' : 'var(--wkb-hairline)',
                    color: region.perils.includes(peril) ? 'var(--wkb-ink)' : 'var(--wkb-ink-muted)',
                    transitionDuration: '150ms',
                  }}
                >
                  {peril}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <GhostButton
        className="mt-3"
        onClick={addRegion}
        disabled={availableCountries.length === 0}
        title={availableCountries.length === 0 ? 'All available regions already added.' : undefined}
      >
        + Add region
      </GhostButton>

      {Object.keys(totalsByCountry).length > 0 && (
        <div className="mt-4 rounded-[8px] border border-[var(--wkb-hairline)] bg-[var(--wkb-blue-wash)] px-4 py-3">
          <p className="text-sm text-[var(--wkb-ink)]">
            {Object.entries(totalsByCountry).map(([c, pct]) => `${REGIONS[c].label} ${pct}%`).join(' · ')}
          </p>
          <p className="text-xs text-[var(--wkb-ink-muted)] mt-1">
            Addresses, insured names, and per-location values are not published.
          </p>
        </div>
      )}
    </div>
  )
}
