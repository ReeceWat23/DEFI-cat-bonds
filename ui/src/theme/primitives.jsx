import { useTheme } from './ThemeProvider'

// Brutalist visual primitives, driven by the active theme's CSS custom
// properties. Flat — square corners and a thick ink-colored border, no
// drop shadow or depth — used for every button and card surface in the
// app so the rough-edge language stays consistent everywhere.

// tone -> fill/text/border. Filled (colored) buttons have no border;
// only the white/ghost button keeps a thin outline, since it has no
// fill of its own to read as a button without one.
const BUTTON_TONES = {
  primary: 'border-0 bg-[var(--rhodex-accent)] text-[var(--rhodex-text-white)] hover:brightness-110',
  accent:  'border-0 bg-[#B45309] text-white hover:brightness-110',
  success: 'border-0 bg-[#15803D] text-white hover:brightness-110',
  danger:  'border-0 bg-[#B91C1C] text-white hover:brightness-110',
  ghost:   'border border-[var(--rhodex-border-white)] bg-[var(--rhodex-ghost-fill)] text-[var(--rhodex-text-dark)] hover:bg-white/60',
}

export function BrutalButton({
  as: Comp = 'button',
  tone = 'primary',
  size = 'px-4 py-2 text-xs',
  className = '',
  disabled,
  children,
  ...props
}) {
  return (
    <Comp
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-none font-semibold uppercase tracking-wide transition-colors',
        BUTTON_TONES[tone] ?? BUTTON_TONES.primary,
        disabled ? 'cursor-not-allowed opacity-50 hover:brightness-100' : '',
        size,
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </Comp>
  )
}

// Card surface: same glass treatment as the ghost button — thin white
// border, white fill at 45% opacity — so containers read as part of the
// lapis background rather than opaque white boxes sitting on top of it.
// `rounded` defaults to square (the brutalist default) but individual
// call sites can pass a softer radius without fighting Tailwind's
// same-property class-order ambiguity.
export function BrutalCard({ as: Comp = 'div', rounded = 'rounded-none', className = '', children, ...props }) {
  return (
    <Comp className={`${rounded} border border-[var(--rhodex-border-white)] bg-[var(--rhodex-ghost-fill)] ${className}`} {...props}>
      {children}
    </Comp>
  )
}

// Small square status/tag chip — replaces rounded-full badges so pills
// don't clash with the square button/card language.
export function BrutalTag({ as: Comp = 'span', className = '', children, ...props }) {
  return (
    <Comp className={`inline-flex items-center gap-1.5 rounded-none border-2 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${className}`} {...props}>
      {children}
    </Comp>
  )
}

// ── Theme-dispatching primitives ────────────────────────────────────────
//
// One component name per role, used everywhere a page needs a button /
// surface / tag — which theme is active decides the actual rendering
// underneath. This is what makes switching between Lapis and Ghost
// seamless: the switch point lives here, once, instead of scattered
// through every page that needs to look different under each theme.

const GHOST_BUTTON_TONES = {
  primary: 'border border-[var(--rhodex-hairline)] bg-transparent text-[var(--rhodex-text-dark)] hover:border-[var(--rhodex-text-dark-muted)]',
  accent:  'border-0 bg-[var(--rhodex-accent)] text-white hover:brightness-110',
  success: 'border border-[var(--rhodex-green)] bg-transparent text-[var(--rhodex-green)] hover:bg-[var(--rhodex-green-wash)]',
  danger:  'border border-red-600 bg-transparent text-red-600 hover:bg-red-50',
  ghost:   'border border-[var(--rhodex-hairline)] bg-transparent text-[var(--rhodex-text-dark)] hover:border-[var(--rhodex-text-dark-muted)]',
}

export function ActionButton({ as: Comp = 'button', tone = 'primary', size = 'px-4 py-2 text-xs', className = '', disabled, children, ...props }) {
  const { themeId } = useTheme()
  if (themeId !== 'ghost') {
    return <BrutalButton as={Comp} tone={tone} size={size} className={className} disabled={disabled} {...props}>{children}</BrutalButton>
  }
  return (
    <Comp
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-[8px] font-medium transition-colors',
        GHOST_BUTTON_TONES[tone] ?? GHOST_BUTTON_TONES.primary,
        disabled ? 'cursor-not-allowed opacity-40 hover:brightness-100' : '',
        size,
        className,
      ].join(' ')}
      style={{ transitionDuration: '200ms' }}
      {...props}
    >
      {children}
    </Comp>
  )
}

// `rounded` has no default here — Lapis keeps BrutalCard's own default
// (square), Ghost falls back to a soft 10px radius; either theme respects
// an explicit value from the caller (several Deal Page cards intentionally
// use a softer radius already, independent of which theme is active).
export function Surface({ as: Comp = 'div', rounded, raised = false, className = '', style, children, ...props }) {
  const { themeId } = useTheme()
  if (themeId !== 'ghost') {
    return <BrutalCard as={Comp} rounded={rounded ?? 'rounded-none'} className={className} style={style} {...props}>{children}</BrutalCard>
  }
  return (
    <Comp
      className={`${rounded ?? 'rounded-[10px]'} border border-[var(--rhodex-hairline)] ${className}`}
      style={{
        background: raised ? 'var(--rhodex-panel-raised)' : 'var(--rhodex-panel)',
        boxShadow: 'var(--rhodex-shadow)',
        ...style,
      }}
      {...props}
    >
      {children}
    </Comp>
  )
}

export function Tag({ as: Comp = 'span', className = '', children, ...props }) {
  const { themeId } = useTheme()
  if (themeId !== 'ghost') {
    return <BrutalTag as={Comp} className={className} {...props}>{children}</BrutalTag>
  }
  return (
    <Comp className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`} {...props}>
      {children}
    </Comp>
  )
}
