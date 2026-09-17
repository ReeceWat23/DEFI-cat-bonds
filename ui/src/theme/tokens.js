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

// ── Ghost ────────────────────────────────────────────────────────────────
//
// White/hairline "clean room" theme — the second, switchable option
// alongside Lapis so design feedback can be tried on and compared live
// rather than committing to a one-way migration. Same white/transparent-
// white/hairline system as the "Build a bond" workshop page, but wired
// through the shared ThemeProvider (--rhodex-*) instead of that page's
// isolated .workshop-page CSS scope, since it needs to apply to existing
// pages like Deal Page rather than living in isolation.
const ghost = {
  font: `'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif`,

  bg: 'linear-gradient(180deg, #FFFFFF 0%, #F4F6FB 100%)',

  accent: '#1D3FD1',
  'accent-wash': 'rgba(29, 63, 209, 0.06)',
  'gradient-btn': '#1D3FD1',
  'gradient-btn-border': '#1D3FD1',

  'text-dark': '#141A2E',
  'text-dark-muted': '#5B627C',
  'text-white': '#FFFFFF',
  'text-white-muted': 'rgba(255, 255, 255, 0.75)',

  'border-white': 'rgba(255, 255, 255, 0.85)',
  'ghost-fill': 'rgba(255, 255, 255, 0.45)',

  hairline: 'rgba(11, 31, 91, 0.10)',
  panel: 'rgba(255, 255, 255, 0.72)',
  'panel-raised': 'rgba(255, 255, 255, 0.92)',
  shadow: '0 1px 2px rgba(11,31,91,.04), 0 8px 24px rgba(11,31,91,.04)',

  // The one departure from a pure white/hairline surface — reserved for
  // value the viewer owns or can take (Withdraw, Claim coupon, portfolio
  // value). Nowhere else.
  green: '#0E8F5E',
  'green-wash': 'rgba(14, 143, 94, 0.06)',
}

export const themes = {
  lapis: {
    id: 'lapis',
    label: 'Lapis',
    swatch: ['#7C94A8', '#AEBECC', '#2F5394'],
    tokens: lapis,
  },
  ghost: {
    id: 'ghost',
    label: 'Ghost',
    swatch: ['#FFFFFF', '#F4F6FB', '#1D3FD1'],
    tokens: ghost,
  },
}

export const DEFAULT_THEME = 'lapis'
