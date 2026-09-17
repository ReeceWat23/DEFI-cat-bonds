import { useEffect, useRef, useState } from 'react'
import { useReadContracts } from 'wagmi'
import { TRIGGER_ABI, CANONICAL_TRIGGERS } from '../../constants/abis'
import { NATCAT_LOSS_PRODUCT } from '../../data/historicalLoss'
import { formatUSDWhole, formatAge } from '../../lib/utils'
import DOTS from '../../data/worldDots.json'

// Real dot-matrix world landmass data (via the `dotted-map` package, a
// devDependency — see ui/scripts/generate-world-dots.cjs). The first pass
// hand-approximated continents as ellipses; this replaced it once it was
// clear ellipses don't read as an actual world map. viewBox matches the
// generator's coordinate space (~197 x 99 at height:100).
const VIEWBOX = '0 0 198 100'

const WEATHER_LAB_URL = 'https://deepmind.google.com/science/weatherlab'
const BONDS_API = 'http://localhost:5001/bonds'

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (target == null) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { setValue(target); return }
    let raf
    const start = performance.now()
    function tick(now) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      setValue(target * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function useNatcatBonds() {
  const [bonds, setBonds] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(`${BONDS_API}?type=natcat`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { if (!cancelled) setBonds(Array.isArray(data) ? data : []) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])
  return { bonds, error }
}

function latestOf(reports) {
  return reports.reduce((best, r) => {
    if (!r) return best
    if (!best || Number(r[1]) > Number(best[1])) return r
    return best
  }, null)
}

export default function LiveBondsMap() {
  const containerRef = useRef(null)
  const spotlightRef = useRef(null)

  function handleMouseMove(e) {
    const rect = containerRef.current.getBoundingClientRect()
    spotlightRef.current.style.setProperty('--spot-x', `${e.clientX - rect.left}px`)
    spotlightRef.current.style.setProperty('--spot-y', `${e.clientY - rect.top}px`)
    spotlightRef.current.style.opacity = '1'
  }
  function handleMouseLeave() {
    spotlightRef.current.style.opacity = '0'
  }

  const { bonds, error } = useNatcatBonds()
  const count = bonds?.length ?? 0
  const totalValue = (bonds ?? []).reduce((sum, b) => sum + (Number(b.value) || 0), 0)
  const animatedValue = useCountUp(bonds ? totalValue : null)

  const { data: reportData } = useReadContracts({
    contracts: [
      { address: CANONICAL_TRIGGERS.economic, abi: TRIGGER_ABI, functionName: 'latestReport' },
      { address: CANONICAL_TRIGGERS.industry, abi: TRIGGER_ABI, functionName: 'latestReport' },
    ],
  })
  const latest = latestOf(reportData?.map(r => r.result) ?? [])

  return (
    <div className="mb-8">
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="wkb-map-grid-bg relative overflow-hidden rounded-[10px] border border-[var(--wkb-hairline)]"
        style={{ boxShadow: 'var(--wkb-shadow)' }}
      >
        <a href={WEATHER_LAB_URL} target="_blank" rel="noopener noreferrer" className="block" aria-label="Google DeepMind Weather Lab">
          <svg viewBox={VIEWBOX} className="w-full h-auto block" role="img">
            {DOTS.map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={0.45} className="wkb-world-map-dot" />
            ))}
          </svg>
        </a>
        {/* Small cursor-following area where the same dots render brighter —
            a masked copy of the dot layer, not a color-blend (blending a
            blue glow onto already-blue dots was too subtle to read). */}
        <svg ref={spotlightRef} viewBox={VIEWBOX} className="wkb-map-spotlight w-full h-auto block" role="presentation">
          {DOTS.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={0.45} className="wkb-map-spotlight-dot" />
          ))}
        </svg>

        {/* Headline stat — top-left overlay */}
        <div className="absolute top-4 left-4 sm:top-6 sm:left-6 pointer-events-none">
          <div className="text-2xl sm:text-3xl font-semibold text-[var(--wkb-ink)] wkb-tabular">
            {bonds ? formatCompactUSD(animatedValue) : '—'}
          </div>
          <div className="text-xs text-[var(--wkb-ink-muted)] mt-0.5">
            {bonds ? `${count} bond${count === 1 ? '' : 's'} relying on NatCat triggers` : error ? 'Live bonds unavailable' : 'Loading…'}
          </div>
        </div>

        {/* Latest report — bottom-right ghost container */}
        <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6">
          <a
            href={NATCAT_LOSS_PRODUCT.endpoint}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--wkb-hairline)] px-3 py-1.5 text-xs font-medium hover:border-[var(--wkb-blue)] transition-colors"
            style={{ background: 'var(--wkb-panel-raised)', color: 'var(--wkb-blue)' }}
          >
            {latest ? (
              <>Latest report: {formatUSDWhole(latest[0])} ({formatAge(latest[1])}) →</>
            ) : (
              <>Latest report →</>
            )}
          </a>
        </div>
      </div>

      <a href={WEATHER_LAB_URL} target="_blank" rel="noopener noreferrer" className="wkb-rainbow-link inline-block text-xs font-medium mt-2">
        Explore live weather forecasts — Google DeepMind Weather Lab
      </a>
    </div>
  )
}

function formatCompactUSD(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
  }).format(n)
}
