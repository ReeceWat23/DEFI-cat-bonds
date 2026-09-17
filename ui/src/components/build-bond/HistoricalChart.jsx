import { TRIGGER_TYPES } from '../../data/historicalLoss'

// Left column of the dual-column workspace (Plan-it-2 §4.2). Renders the
// selected trigger type's annual loss series with a live horizontal rule at
// the layer's current trigger level, plus the single derived sentence the
// doc calls "the most useful thing on the page."
export default function HistoricalChart({ triggerTypeId, triggerLevelB }) {
  const type = TRIGGER_TYPES[triggerTypeId]
  if (!type) {
    return (
      <div className="rounded-[10px] border border-dashed border-[var(--wkb-hairline)] p-6 text-sm text-[var(--wkb-ink-muted)]">
        Select a trigger type to see historical exposure.
      </div>
    )
  }

  const { history, maxB, label } = type
  const level = Number(triggerLevelB) || 0
  const levelPct = Math.min(100, (level / maxB) * 100)
  const yearsAbove = history.filter(d => d.valueB >= level).length
  const yearsSpan = history.length

  return (
    <div>
      <div className="flex items-end justify-between mb-1">
        <span className="text-xs wkb-mono text-[var(--wkb-ink-muted)]">Annual {label.toLowerCase()} (${maxB >= 1000 ? '1T' : `${maxB}B`} scale)</span>
        {level > 0 && (
          <span className="text-xs wkb-mono wkb-highlight-text text-[var(--wkb-ink-muted)]">— ${level}B your level</span>
        )}
      </div>

      <div className="relative" style={{ height: '140px' }}>
        {level > 0 && (
          <div
            className="wkb-highlight-rule absolute left-0 right-0 border-t border-dashed z-10 pointer-events-none"
            style={{ bottom: `${levelPct}%`, borderColor: 'var(--wkb-ink-muted)' }}
          />
        )}
        <div className="absolute inset-0 flex items-end gap-1">
          {history.map(d => {
            const heightPct = (d.valueB / maxB) * 100
            const isAbove = level > 0 && d.valueB >= level
            return (
              <div key={d.year} className="flex-1 flex flex-col items-center justify-end h-full group relative">
                <div
                  className="w-full origin-bottom rounded-t-[3px] transition-[filter] duration-200 group-hover:brightness-110"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: isAbove ? 'rgba(29,63,209,0.35)' : 'rgba(20,26,46,0.16)',
                  }}
                />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[var(--wkb-ink)] text-white text-xs rounded-[4px] px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20">
                  {d.year}: ${d.valueB}B
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex gap-1 mt-1">
        {history.map(d => (
          <div key={d.year} className="flex-1 text-center text-[10px] wkb-mono text-[var(--wkb-ink-muted)]">
            {String(d.year).slice(2)}
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm text-[var(--wkb-ink)]">
        {level > 0
          ? <>Events above your level: <strong className="wkb-tabular">{yearsAbove}</strong> in {yearsSpan} years.</>
          : 'Set a trigger level to see how many historical years would have breached it.'}
      </p>

      <div className="mt-2 text-xs text-[var(--wkb-ink-muted)]">Source: Gallagher Re · Swiss Re sigma (illustrative)</div>
    </div>
  )
}
