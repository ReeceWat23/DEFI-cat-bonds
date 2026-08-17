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
export function BrutalCard({ as: Comp = 'div', className = '', children, ...props }) {
  return (
    <Comp className={`rounded-none border border-[var(--rhodex-border-white)] bg-[var(--rhodex-ghost-fill)] ${className}`} {...props}>
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
