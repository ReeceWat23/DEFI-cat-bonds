import { GhostButton } from './primitives'
import SovUpload from './SovUpload'
import VerificationPanel from './VerificationPanel'

// Builds a plausible 2–3 sentence company summary from the entered website,
// client-side only. This is a static Vite frontend with no backend to
// safely proxy a real LLM call (an API key can't live in the bundle), so
// this iteration ships a template-based mock rather than a live generator —
// the textarea stays fully editable either way, per §5.1.
function guessCompanyName(website) {
  try {
    const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname
    const core = host.replace(/^www\./, '').split('.')[0]
    return core.charAt(0).toUpperCase() + core.slice(1)
  } catch {
    return 'This sponsor'
  }
}

function generateDescription(website) {
  const name = guessCompanyName(website)
  return `${name} is a risk sponsor bringing catastrophe exposure to the RHODEX market. ` +
    `The disclosure below reflects ${name}'s own submission and is not independently validated by RHODEX. ` +
    `Investors are encouraged to review the exposure and loss history sections before committing capital.`
}

export default function DisclosureSection({ disclosure, onChange }) {
  const { website, description, sov, lossHistory, verification } = disclosure

  function generate() {
    if (!website.trim()) return
    onChange({ description: { ...description, generated: generateDescription(website) } })
  }

  return (
    <div>
      <p className="text-sm text-[var(--wkb-ink)] mb-6 max-w-xl">
        The more you disclose, the more investors trust the deal.
      </p>

      {/* 5.1 Company basics */}
      <div className="mb-8">
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Company website</label>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={website}
            onChange={e => onChange({ website: e.target.value })}
            placeholder="https://yourcompany.com"
            className="w-full sm:w-96 rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm focus:outline-none focus:border-[var(--wkb-ink-muted)]"
          />
          <GhostButton onClick={generate} disabled={!website.trim()}>
            Generate description
          </GhostButton>
        </div>

        {(description.generated || description.edited) && (
          <div>
            <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Company summary</label>
            <textarea
              rows={3}
              value={description.edited || description.generated}
              onChange={e => onChange({ description: { ...description, edited: e.target.value, accepted: false } })}
              className="w-full rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-[var(--wkb-ink-muted)]"
            />
            <label className="flex items-center gap-2 text-xs text-[var(--wkb-ink-muted)] mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={description.accepted}
                onChange={e => onChange({ description: { ...description, accepted: e.target.checked } })}
              />
              Accept this summary
            </label>
          </div>
        )}
      </div>

      {/* 5.2 Schedule of values */}
      <div className="mb-8 pt-6 border-t border-[var(--wkb-hairline)]">
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Schedule of values</label>
        <SovUpload sov={sov} onChange={patch => onChange({ sov: { ...sov, ...patch } })} />
      </div>

      {/* 5.3 Loss history */}
      <div className="mb-8 pt-6 border-t border-[var(--wkb-hairline)]">
        <label className="block text-xs text-[var(--wkb-ink-muted)] mb-1.5">Loss history</label>
        <textarea
          rows={4}
          value={lossHistory}
          onChange={e => onChange({ lossHistory: e.target.value })}
          placeholder="Describe your loss history — free form."
          className="w-full rounded-[8px] border border-[var(--wkb-hairline)] bg-transparent px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-[var(--wkb-ink-muted)]"
        />
        <p className="text-xs text-[var(--wkb-ink-muted)] mt-1.5">Investors can audit what you post here.</p>
      </div>

      {/* 5.4 RHODEX verification */}
      <div className="pt-6 border-t border-[var(--wkb-hairline)]">
        <VerificationPanel verification={verification} onChange={v => onChange({ verification: v })} />
      </div>
    </div>
  )
}
