// ── Theme registry ────────────────────────────────────────────────────────
//
// Each theme is a flat map of CSS custom-property names -> values. A theme
// is "installed" by writing its map onto :root as `--rhodex-*` variables
// (see ThemeProvider.jsx), so every component just reads `var(--rhodex-x)`
// via Tailwind's arbitrary-value syntax and never hardcodes a color.

// ── Lapis ────────────────────────────────────────────────────────────────
//
// Light blue-gray hero theme: dark navy ink on a soft blue-gray gradient
// backdrop, with a single brand blue reserved for buttons/small containers
// per spec. Secondary ("ghost") buttons are a white-bordered, white-filled
// pill at low opacity rather than a second gradient system.
const lapis = {
  font: `'IBM Plex Mono', monospace`,

  // Page background — a soft diagonal blend of the three gray-blues.
  bg: 'linear-gradient(165deg, #AEBECC 0%, #8CA1B6 55%, #7C94A8 100%)',

  // Brand blue — buttons and small key containers only, per spec.
  accent: '#2F5394',
  'gradient-btn': '#2F5394',
  'gradient-btn-border': '#2F5394',

  // Ink (headings/body) on the light gradient background.
  'text-dark': '#1E2A47',
  'text-dark-muted': 'rgba(30, 42, 71, 0.68)',

  // White text used on navy surfaces (primary button, library card footers).
  'text-white': '#FFFFFF',
  'text-white-muted': 'rgba(255, 255, 255, 0.75)',

  // Secondary/ghost button: white border, white fill @ 45% opacity.
  'border-white': 'rgba(255, 255, 255, 0.85)',
  'ghost-fill': 'rgba(255, 255, 255, 0.45)',

  // Technology-library card footer bars.
  'card-footer-bg': '#1E2A47',

  // Footer strip divider.
  'rule-color': 'rgba(30, 42, 71, 0.25)',

  // Soft decorative glow behind the hero copy.
  'orb-gradient': 'radial-gradient(circle at 60% 40%, rgba(255,255,255,0.55), rgba(255,255,255,0.05) 55%, transparent 72%)',
}

export const themes = {
  lapis: {
    id: 'lapis',
    label: 'Lapis',
    swatch: ['#7C94A8', '#AEBECC', '#2F5394'],
    tokens: lapis,
  },
}

export const DEFAULT_THEME = 'lapis'
