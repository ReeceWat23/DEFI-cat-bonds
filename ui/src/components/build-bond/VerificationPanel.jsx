import { GhostButton } from './primitives'

const BADGE = {
  unverified: null,
  pending: { label: 'Verification requested', color: 'var(--wkb-ink-muted)' },
  verified: { label: '✚ Verified', color: 'var(--wkb-ink)' },
}

// Verification is off-platform and manual — the sponsor can only request
// it, never flip the badge themselves (Plan-it-2 §5.4). There's no ticketing
// backend in this project, so "Request verification" opens a mailto: contact
// affordance rather than a self-serve toggle.
export default function VerificationPanel({ verification, onChange }) {
  const badge = BADGE[verification]

  return (
    <div className="rounded-[10px] border border-dashed border-[var(--wkb-hairline)] p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-medium text-[var(--wkb-ink)]">RHODEX verification</span>
        {badge && (
          <span
            className="wkb-highlight-fill text-xs font-medium rounded-full border px-2.5 py-0.5"
            style={{ borderColor: badge.color, color: badge.color }}
          >
            {badge.label}
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--wkb-ink-muted)] mb-3 leading-relaxed">
        Sponsors who want a verified stamp contact us first — we verify and stamp the deal with the black cross.
      </p>
      {verification === 'unverified' && (
        <GhostButton
          as="a"
          href="mailto:verify@rhodex.markets?subject=Deal%20verification%20request"
          onClick={() => onChange('pending')}
        >
          Request verification
        </GhostButton>
      )}
    </div>
  )
}
