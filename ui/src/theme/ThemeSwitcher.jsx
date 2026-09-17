import { useTheme } from './ThemeProvider'

// Small segmented toggle so Lapis <-> Ghost can be compared live during
// feedback rather than committing to one via a one-way migration. Styled
// off the *currently active* theme's tokens so it never looks broken in
// either direction of the switch.
export default function ThemeSwitcher() {
  const { themeId, setTheme, themes } = useTheme()

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border p-0.5 text-xs"
      style={{ borderColor: 'var(--rhodex-border-white)', background: 'var(--rhodex-ghost-fill)' }}
    >
      {themes.map(t => {
        const active = t.id === themeId
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            aria-pressed={active}
            className="rounded-full px-2.5 py-1 font-medium transition-colors"
            style={{
              transitionDuration: '150ms',
              background: active ? 'var(--rhodex-accent)' : 'transparent',
              color: active ? 'var(--rhodex-text-white)' : 'var(--rhodex-text-dark-muted)',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
