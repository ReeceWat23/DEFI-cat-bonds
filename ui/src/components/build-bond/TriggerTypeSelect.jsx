import { useEffect, useRef, useState } from 'react'
import { TRIGGER_TYPES } from '../../data/historicalLoss'

// Custom (non-native) dropdown — Plan-it-2 §4.1 calls out that a native
// <select> won't take the styling this page needs.
export default function TriggerTypeSelect({ value, onChange, hasLayers }) {
  const [openMenu, setOpenMenu] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    function onClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpenMenu(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function selectType(id) {
    setOpenMenu(false)
    if (id === value) return
    if (hasLayers) {
      const ok = window.confirm('Changing trigger type resets your layers. Continue?')
      if (!ok) return
    }
    onChange(id)
  }

  const current = value ? TRIGGER_TYPES[value] : null

  return (
    <div ref={rootRef} className="relative w-full sm:w-80">
      <button
        type="button"
        onClick={() => setOpenMenu(o => !o)}
        aria-expanded={openMenu}
        className="w-full flex items-center justify-between gap-3 rounded-[10px] border border-[var(--wkb-hairline)] bg-[var(--wkb-panel-raised)] px-4 py-3 text-left transition-colors hover:border-[var(--wkb-ink-muted)]"
        style={{ transitionDuration: '200ms', transitionTimingFunction: 'var(--wkb-ease)' }}
      >
        <span>
          {current ? (
            <>
              <span className="block text-sm font-medium text-[var(--wkb-ink)]">{current.label}</span>
              <span className="block text-xs text-[var(--wkb-ink-muted)] mt-0.5">{current.description}</span>
            </>
          ) : (
            <span className="text-sm text-[var(--wkb-ink-muted)]">Select a trigger type…</span>
          )}
        </span>
        <span
          aria-hidden
          className="text-[var(--wkb-ink-muted)] text-xs"
          style={{
            transform: openMenu ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms var(--wkb-ease)',
          }}
        >
          ▾
        </span>
      </button>

      {openMenu && (
        <div
          className="absolute z-20 mt-2 w-full rounded-[10px] border border-[var(--wkb-hairline)] bg-[var(--wkb-panel-raised)] overflow-hidden"
          style={{ boxShadow: 'var(--wkb-shadow)' }}
        >
          {Object.values(TRIGGER_TYPES).map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectType(t.id)}
              className="w-full text-left px-4 py-3 transition-colors hover:bg-[var(--wkb-blue-wash)]"
              style={{ transitionDuration: '150ms' }}
            >
              <span className="block text-sm font-medium text-[var(--wkb-ink)]">{t.label}</span>
              <span className="block text-xs text-[var(--wkb-ink-muted)] mt-0.5">{t.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
