import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Accordion, AccordionSection } from '../components/build-bond/Accordion'
import { GhostButton } from '../components/build-bond/primitives'
import TriggerTypeSelect from '../components/build-bond/TriggerTypeSelect'
import HistoricalChart from '../components/build-bond/HistoricalChart'
import LayerCard from '../components/build-bond/LayerCard'
import DisclosureSection from '../components/build-bond/DisclosureSection'
import ReviewSection from '../components/build-bond/ReviewSection'

const STORAGE_KEY = 'rhodex_build_bond_draft'

function makeLayer() {
  return { id: crypto.randomUUID(), triggerLevel: 0, raise: 0, coupon: 0, confirmed: false }
}

function initialState() {
  const saved = typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try { return JSON.parse(saved) } catch { /* fall through to fresh state */ }
  }
  return {
    step: 'parameters',
    network: 'testnet',
    highlight: false,
    parameters: { triggerType: null, layers: [] },
    disclosure: {
      website: '',
      description: { generated: '', edited: '', accepted: false },
      sov: { fileRef: null, regions: [], skipped: false },
      lossHistory: '',
      verification: 'unverified',
    },
    settlement: { oracle: 'gallagher_re', startDate: null, endDate: null, termMonths: 12 },
    renewalOf: null,
  }
}

export default function BuildBondPage() {
  const [state, setState] = useState(initialState)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // ── Layer helpers ──────────────────────────────────────────────────────
  function setTriggerType(id) {
    setState(s => ({ ...s, parameters: { triggerType: id, layers: [] } }))
  }
  function addLayer() {
    setState(s => ({ ...s, parameters: { ...s.parameters, layers: [...s.parameters.layers, makeLayer()] } }))
  }
  function updateLayer(id, patch) {
    setState(s => ({
      ...s,
      parameters: { ...s.parameters, layers: s.parameters.layers.map(l => (l.id === id ? { ...l, ...patch } : l)) },
    }))
  }
  function removeLayer(id) {
    setState(s => ({ ...s, parameters: { ...s.parameters, layers: s.parameters.layers.filter(l => l.id !== id) } }))
  }
  function patchDisclosure(patch) {
    setState(s => ({ ...s, disclosure: { ...s.disclosure, ...patch } }))
  }

  // ── Gating (Plan-it-2 §2) ──────────────────────────────────────────────
  const confirmedLayer = state.parameters.layers.find(l => l.confirmed)
  const section1Complete = !!confirmedLayer
  const sovExposureTotal = state.disclosure.sov.regions.reduce((sum, r) => sum + (Number(r.exposurePct) || 0), 0)
  const section2Complete =
    state.disclosure.website.trim() !== '' &&
    state.disclosure.description.accepted &&
    (!!state.disclosure.sov.fileRef || state.disclosure.sov.skipped) &&
    sovExposureTotal <= 100
  const section3Unlocked = section1Complete && section2Complete
  const layerCapReached = state.parameters.layers.length >= 1

  return (
    <div className="workshop-page min-h-screen" data-highlight={state.highlight ? 'on' : 'off'}>
      <header className="max-w-3xl mx-auto px-6 pt-8 pb-2 flex items-start justify-between gap-6">
        <div>
          <Link to="/" className="text-xs wkb-mono text-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)]">← RHODEX.</Link>
          <h1 className="text-2xl font-semibold text-[var(--wkb-ink)] mt-2">Build a bond</h1>
          <p className="text-sm text-[var(--wkb-ink-muted)] mt-1">Set your terms, disclose your exposure, ship.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--wkb-ink-muted)] cursor-pointer shrink-0 mt-1">
          <input
            type="checkbox"
            checked={state.highlight}
            onChange={e => setState(s => ({ ...s, highlight: e.target.checked }))}
          />
          Highlight key fields
        </label>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-24 pt-6">
        <Accordion className="space-y-4">
          <AccordionSection id="parameters" number="01" title="Deal parameters">
            <div className="pt-4">
              <TriggerTypeSelect
                value={state.parameters.triggerType}
                onChange={setTriggerType}
                hasLayers={state.parameters.layers.length > 0}
              />

              <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-8 mt-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--wkb-ink-muted)] mb-3">Historical</p>
                  <HistoricalChart
                    triggerTypeId={state.parameters.triggerType}
                    triggerLevelB={confirmedLayer?.triggerLevel ?? state.parameters.layers[0]?.triggerLevel ?? 0}
                  />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--wkb-ink-muted)] mb-3">Your layer</p>
                  {state.parameters.layers.length === 0 ? (
                    <div className="rounded-[10px] border border-dashed border-[var(--wkb-hairline)] p-6 text-sm text-[var(--wkb-ink-muted)]">
                      No layer yet. Add one to set your terms.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {state.parameters.layers.map((layer, i) => (
                        <LayerCard
                          key={layer.id}
                          layer={layer}
                          index={i}
                          triggerTypeId={state.parameters.triggerType}
                          network={state.network}
                          onChange={patch => updateLayer(layer.id, patch)}
                          onConfirm={() => updateLayer(layer.id, { confirmed: true })}
                          onEdit={() => updateLayer(layer.id, { confirmed: false })}
                          removable={!layer.confirmed}
                          onRemove={() => removeLayer(layer.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-center mt-6">
                <GhostButton
                  onClick={addLayer}
                  disabled={!state.parameters.triggerType || layerCapReached}
                  title={layerCapReached ? 'Multi-layer deals are coming. One layer per deal for now.' : undefined}
                >
                  + Add layer
                </GhostButton>
              </div>
            </div>
          </AccordionSection>

          <AccordionSection id="disclosure" number="02" title="Disclosure" state={section1Complete ? 'unlocked' : 'locked'}>
            <div className="pt-4">
              <DisclosureSection disclosure={state.disclosure} onChange={patchDisclosure} />
            </div>
          </AccordionSection>

          <AccordionSection
            id="review"
            number="03"
            title="Review and sign"
            state={section3Unlocked ? 'unlocked' : 'locked'}
            note={section2Complete && !section1Complete ? 'Re-confirm your layer to continue.' : null}
          >
            <div className="pt-4">
              <ReviewSection state={state} network={state.network} />
            </div>
          </AccordionSection>
        </Accordion>
      </main>
    </div>
  )
}
