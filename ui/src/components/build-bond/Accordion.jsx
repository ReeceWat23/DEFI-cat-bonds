import { createContext, useContext, useLayoutEffect, useRef, useState, useEffect } from 'react'

// Accordion primitive for the "Build a bond" workshop (Plan-it-2 §3).
// One component, used three times. Only one section is ever expanded;
// opening a new one closes the current one 40ms before the new one starts
// expanding, so the two transitions never overlap at full height.

const OPEN_MS = 240
const CLOSE_MS = 200
const OPEN_CLOSE_OVERLAP_MS = 40
const CONTENT_OPACITY_LAG_MS = 60

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setReduced(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

const AccordionCtx = createContext(null)

export function Accordion({ children, className = '' }) {
  const [activeId, setActiveId] = useState(null)
  const reducedMotion = usePrefersReducedMotion()

  function open(id) {
    if (activeId === id) { setActiveId(null); return }
    if (activeId !== null) {
      setActiveId(null)
      if (reducedMotion) setActiveId(id)
      else window.setTimeout(() => setActiveId(id), OPEN_CLOSE_OVERLAP_MS)
    } else {
      setActiveId(id)
    }
  }

  return (
    <AccordionCtx.Provider value={{ activeId, open, reducedMotion }}>
      <div className={className}>{children}</div>
    </AccordionCtx.Provider>
  )
}

function PlusIcon({ open, reducedMotion }) {
  return (
    <span
      aria-hidden
      className="inline-block w-4 text-center text-lg leading-none text-[var(--wkb-ink-muted)] select-none"
      style={{
        transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
        transition: reducedMotion ? 'none' : 'transform 200ms var(--wkb-ease)',
      }}
    >
      +
    </span>
  )
}

function MeasuredPanel({ isOpen, reducedMotion, children }) {
  const innerRef = useRef(null)
  const [maxHeight, setMaxHeight] = useState(isOpen ? 'none' : '0px')
  const [contentOpacity, setContentOpacity] = useState(isOpen ? 1 : 0)
  const [duration, setDuration] = useState(isOpen ? OPEN_MS : CLOSE_MS)

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const d = reducedMotion ? 0 : (isOpen ? OPEN_MS : CLOSE_MS)
    setDuration(d)

    if (isOpen) {
      setMaxHeight(el.scrollHeight + 'px')
      const opacityTimer = window.setTimeout(
        () => setContentOpacity(1),
        reducedMotion ? 0 : CONTENT_OPACITY_LAG_MS
      )
      const settleTimer = window.setTimeout(() => setMaxHeight('none'), d)
      return () => { window.clearTimeout(opacityTimer); window.clearTimeout(settleTimer) }
    } else {
      setContentOpacity(0)
      setMaxHeight(el.scrollHeight + 'px')
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => setMaxHeight('0px'))
        return raf2
      })
      return () => cancelAnimationFrame(raf1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  return (
    <div
      style={{
        maxHeight,
        overflow: 'hidden',
        transition: reducedMotion ? 'none' : `max-height ${duration}ms var(--wkb-ease)`,
      }}
    >
      <div
        ref={innerRef}
        style={{
          opacity: contentOpacity,
          transition: reducedMotion ? 'none' : 'opacity 180ms var(--wkb-ease)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// state: 'unlocked' (clickable, default) | 'locked' (reduced opacity, no
// icon slot, not clickable/focusable — never a padlock glyph).
export function AccordionSection({ id, number, title, state = 'unlocked', note, children }) {
  const { activeId, open, reducedMotion } = useContext(AccordionCtx)
  const locked = state === 'locked'
  const isOpen = !locked && activeId === id

  return (
    <div className="rounded-[10px] border border-[var(--wkb-hairline)] overflow-hidden" style={{ background: 'var(--wkb-panel)', boxShadow: 'var(--wkb-shadow)' }}>
      <button
        type="button"
        onClick={() => !locked && open(id)}
        disabled={locked}
        aria-expanded={isOpen}
        className={[
          'w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors',
          locked ? 'opacity-40 cursor-not-allowed' : 'hover:border-[var(--wkb-ink-muted)] cursor-pointer',
        ].join(' ')}
        style={{ transitionDuration: '200ms', transitionTimingFunction: 'var(--wkb-ease)' }}
      >
        <span className="flex items-center gap-3">
          <span className="wkb-mono text-xs text-[var(--wkb-ink-muted)]">{number}</span>
          <span className="font-medium text-[var(--wkb-ink)]">{title}</span>
        </span>
        {!locked && <PlusIcon open={isOpen} reducedMotion={reducedMotion} />}
      </button>

      {note && (
        <div className="px-5 pb-3 -mt-2 text-xs text-[var(--wkb-ink-muted)]">{note}</div>
      )}

      <MeasuredPanel isOpen={isOpen} reducedMotion={reducedMotion}>
        <div className="px-5 pb-6 pt-1 border-t border-[var(--wkb-hairline)]">{children}</div>
      </MeasuredPanel>
    </div>
  )
}
