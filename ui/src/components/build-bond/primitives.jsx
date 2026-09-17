// Ghost-only button/panel primitives for the "Build a bond" workshop.
// Per Plan-it-2 §7: buttons are ghost (1px hairline, transparent fill) with
// exactly one exception (FilledButton, used only for "Post deal"). Panels
// are white-border / 45%-opacity white fill / 10px radius "ghost containers".

export function GhostButton({
  as: Comp = 'button',
  className = '',
  disabled,
  highlight = false,
  children,
  ...props
}) {
  return (
    <Comp
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-[10px] border px-4 py-2 text-sm font-medium transition-colors',
        'border-[var(--wkb-hairline)] bg-transparent text-[var(--wkb-ink)]',
        'hover:border-[var(--wkb-ink-muted)] hover:text-[var(--wkb-ink)]',
        disabled ? 'cursor-not-allowed opacity-40' : '',
        highlight ? 'wkb-highlight-border wkb-highlight-text' : '',
        className,
      ].join(' ')}
      style={{ transitionDuration: '200ms', transitionTimingFunction: 'var(--wkb-ease)' }}
      {...props}
    >
      {children}
    </Comp>
  )
}

// The one filled button on the page — "Post deal". No border, solid ink/blue
// fill depending on highlight mode; still square corners to match the panel
// radius elsewhere rather than a pill.
export function FilledButton({ as: Comp = 'button', className = '', disabled, children, ...props }) {
  return (
    <Comp
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-[10px] px-5 py-2.5 text-sm font-semibold transition-colors',
        'bg-[var(--wkb-ink)] text-white hover:brightness-110',
        'wkb-highlight-fill',
        disabled ? 'cursor-not-allowed opacity-40 hover:brightness-100' : '',
        className,
      ].join(' ')}
      style={{ transitionDuration: '200ms', transitionTimingFunction: 'var(--wkb-ease)' }}
      {...props}
    >
      {children}
    </Comp>
  )
}

export function GhostPanel({ as: Comp = 'div', className = '', children, ...props }) {
  return (
    <Comp
      className={`rounded-[10px] border border-[var(--wkb-border-white)] bg-[var(--wkb-ghost-fill)] ${className}`}
      {...props}
    >
      {children}
    </Comp>
  )
}

// Standard panel surface for section bodies/cards (non-ghost, higher-opacity
// white per §7's --panel / --panel-raised tokens).
export function Panel({ as: Comp = 'div', raised = false, className = '', children, ...props }) {
  return (
    <Comp
      className={`rounded-[10px] border border-[var(--wkb-hairline)] ${className}`}
      style={{
        background: raised ? 'var(--wkb-panel-raised)' : 'var(--wkb-panel)',
        boxShadow: 'var(--wkb-shadow)',
      }}
      {...props}
    >
      {children}
    </Comp>
  )
}
