import { Link } from 'react-router-dom'
import { BrutalButton } from '../theme/primitives'

const LIBRARY_ITEMS = [
  {
    title: 'Cat Bonds',
    to: '/deal',
    art: 'radial-gradient(circle at 30% 25%, #4a685f, #1b2620 65%, #0e1512)',
  },
  {
    title: 'Pre-Event Monitoring',
    to: '/deal',
    art: 'linear-gradient(150deg, #e4e9ef 0%, #8493ac 55%, #202b45 100%)',
  },
  {
    title: 'Services',
    to: '/deal',
    art: 'linear-gradient(180deg, #0b1220 0%, #1c2c47 55%, #4d6484 100%)',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen w-full font-mono text-[var(--rhodex-text-dark)]">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background: 'var(--rhodex-bg)' }} />
      <div className="relative mx-auto max-w-6xl px-6 py-8 sm:px-10 lg:px-16">
        {/* decorative glow behind the hero */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-10 right-0 h-[420px] w-[420px] rounded-full blur-2xl lg:right-[6%]"
          style={{ background: 'var(--rhodex-orb-gradient)' }}
        />

        {/* header */}
        <header className="relative z-10 flex items-center justify-between">
          <div className="text-lg font-bold tracking-tight">RHODEX.</div>
          <BrutalButton as={Link} to="/deal" size="px-4 py-2 text-xs">
            Get Started
          </BrutalButton>
        </header>

        {/* hero */}
        <section className="relative z-10 mt-20 max-w-2xl sm:mt-28">
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            The future of reinsurance.
          </h1>
        </section>

        <section className="relative z-10 mt-16 max-w-xl sm:mt-24">
          <p className="text-[var(--rhodex-text-dark-muted)]">
            RHODEX. is end-to-end digital infrastructure for ILS brokers
            issuing, collateralizing, and settling catastrophe bonds on-chain.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <BrutalButton as={Link} to="/deal">
              Explore the system →
            </BrutalButton>
            <BrutalButton as="a" href="#library" tone="ghost">
              Read the thesis ↓
            </BrutalButton>
          </div>
        </section>

        {/* technology library */}
        <section id="library" className="relative z-10 mt-24 sm:mt-32">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--rhodex-accent)]">
            04 / The technology library
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            {LIBRARY_ITEMS.map((item) => (
              <Link
                key={item.title}
                to={item.to}
                className="group overflow-hidden rounded-2xl shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="relative aspect-[4/3] w-full" style={{ background: item.art }}>
                  <span className="absolute left-3 top-3 text-[10px] font-semibold uppercase tracking-wide text-white/80">
                    Offer / 0
                  </span>
                </div>
                <div
                  className="px-4 py-3.5 text-[var(--rhodex-text-white)]"
                  style={{ background: 'var(--rhodex-card-footer-bg)' }}
                >
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--rhodex-text-white-muted)]">
                    Open dossier ↗
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* footer strip */}
        <footer
          className="relative z-10 mt-16 border-t pb-10 pt-4 text-[10px] font-semibold uppercase tracking-wide"
          style={{ borderColor: 'var(--rhodex-rule-color)' }}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>Digital / Transparent / Democratized</span>
            <span>New York — Global markets</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
