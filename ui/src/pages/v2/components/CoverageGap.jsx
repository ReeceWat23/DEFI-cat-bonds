import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from '../lib/gsapSetup'
import { useReducedMotion, pinDistance } from '../lib/motion'
import { SectionMarker } from './Chain'

// LA fires, January 2025 (USD bn). Band drawn on a 0–131 scale.
const TOTAL_LO = 76, TOTAL_HI = 131, INSURED = 22
const px = (v) => (v / TOTAL_HI) * 1000
// Ten-year averages, annual: total economic loss (Gallagher Re) vs. what
// actually gets insured (Verisk). The gap between the two is the insurance gap.
const AVG_ECONOMIC_LOSS = 361
const AVG_INSURED_LOSS = 134
const GALLAGHER_URL = 'https://www.ajg.com/gallagherre/news-and-insights/gallagherre-natural-catastrophe-and-climate-report-2025/'
const CA_INSURANCE_URL = 'https://insurance.ca.gov/01-consumers/180-climate-change/Wildfire-Claims-Tracker.cfm'

/** Section 2 — The coverage gap. 200vh pinned. */
export default function CoverageGap() {
  const stage = useRef(null)
  const reduce = useReducedMotion()

  useGSAP(() => {
    if (!stage.current) return
    const q = gsap.utils.selector(stage)
    const big = q('.big')[0]
    const big2 = q('.big2')[0]
    const setBig = (v) => (big.textContent = `$${Math.round(v)}B`)
    const setBig2 = (v) => (big2.textContent = `$${Math.round(v)}B`)
    if (reduce) {
      setBig(AVG_ECONOMIC_LOSS); setBig2(AVG_INSURED_LOSS)
      gsap.set(q('.b1, .catclear, .b2, .band-outline, .band-fill, .band-hatch, .band-range, .legend, .closing'), { opacity: 1, scaleX: 1, strokeDashoffset: 0 })
      return
    }
    const c = { v: 0 }, c2 = { v: 0 }
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { id: 's2', trigger: stage.current, start: 'top top', end: pinDistance(200), pin: true, scrub: 0.5 },
    })
    tl.to(q('.b1'), { opacity: 1, duration: 0.1 }, 0)
      .to(c, { v: AVG_ECONOMIC_LOSS, duration: 0.2, ease: 'power2.out', onUpdate: () => setBig(c.v) }, 0.04)
      .to(c2, { v: AVG_INSURED_LOSS, duration: 0.2, ease: 'power2.out', onUpdate: () => setBig2(c2.v) }, 0.16)
      .to(q('.catclear'), { opacity: 1, duration: 0.08 }, 0.36)
      .to(q('.b1'), { opacity: 0.35, duration: 0.1 }, 0.5)
      .to(q('.b2'), { opacity: 1, duration: 0.1 }, 0.5)
      .to(q('.band-outline'), { strokeDashoffset: 0, duration: 0.15 }, 0.55)
      .to(q('.band-fill'), { scaleX: 1, duration: 0.12, ease: 'power2.out' }, 0.66)
      .to(q('.band-hatch'), { opacity: 1, duration: 0.12 }, 0.76)
      .to(q('.band-range'), { opacity: 1, duration: 0.1 }, 0.84)
      .to(q('.legend'), { opacity: 1, duration: 0.06 }, 0.9)
      .to(q('.closing'), { opacity: 1, duration: 0.06 }, 0.96)
  }, { scope: stage, dependencies: [reduce] })

  return (
    <section ref={stage} id="s2" className="relative flex min-h-screen items-center px-8 md:px-14">
      <div className="section-frame relative z-20 mx-auto w-full max-w-none p-8 text-navy md:p-14">
        <SectionMarker n="02" title="The coverage gap" />
        <h2 className="max-w-[20ch] text-[clamp(28px,4.2vw,48px)] font-light leading-tight">
          Traditional coverage is failing.
        </h2>

        {/* beat one — left-aligned stats */}
        <div className="b1 mt-8 opacity-0">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <a className="big block text-[clamp(56px,9vw,132px)] font-light leading-none tabular-nums underline-offset-8 hover:underline"
                href={GALLAGHER_URL} target="_blank" rel="noreferrer">$0B</a>
              <p className="label mt-2 opacity-70">Avg. annual economic loss · ten-year mean</p>
            </div>
            <div>
              <div className="big2 text-[clamp(30px,4.6vw,60px)] font-light leading-none tabular-nums text-accent">$0B</div>
              <p className="label mt-2 opacity-70">Avg. annual insured · ten-year mean</p>
            </div>
          </div>
          <p className="mt-4 max-w-[46ch] text-[13px]">There&rsquo;s an insurance gap.</p>
          <p className="label mt-2 opacity-70">
            Source: Gallagher Re, Natural Catastrophe and Climate Report 2025 ·{' '}
            <a className="underline-offset-4 hover:underline" target="_blank" rel="noreferrer"
              href="https://www.verisk.com/4a5589/siteassets/media/campaigns/gated/catastrophe-and-risk-solutions/verisk-2026-global-modeled-catastrophe-losses-report.pdf">
              Verisk, 2026 Global Modeled Catastrophe Losses Report
            </a>
          </p>
        </div>

        {/* right-aligned turn: from the general stat to the extreme case */}
        <p className="catclear mt-8 max-w-[28ch] text-right text-[15px] font-light leading-snug opacity-0 md:ml-auto">
          At catastrophic levels, this is even clearer.
        </p>

        {/* beat two — LA fires, the catastrophic-level example. Deliberately
            smaller and shifted right, so the section reads left-to-right
            without filling the full width the section-frame now spans. */}
        <div className="b2 mt-8 max-w-[520px] opacity-0 md:ml-auto">
          <h2 className="max-w-[26ch] text-[clamp(17px,1.8vw,22px)] font-light leading-tight">
            One event. Los Angeles, January 2025.
          </h2>
          <svg className="mt-6 w-full max-w-[520px]" viewBox="-2 -2 1004 150" aria-hidden>
            <defs>
              <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="#2d4274" strokeWidth="1" />
              </pattern>
            </defs>
            {/* total loss outline, hairline, drawn */}
            <rect className="band-outline" x="0" y="0" width="1000" height="110" rx="14" fill="none" stroke="#2d4274" strokeWidth="1"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1} />
            {/* insured: solid navy */}
            <rect className="band-fill origin-left" x="0" y="0" width={px(INSURED)} height="110" rx="14" fill="#2d4274" style={{ transform: 'scaleX(0)' }} />
            {/* certainly uninsured: hatch, never filled */}
            <rect className="band-hatch opacity-0" x={px(INSURED)} y="0" width={px(TOTAL_LO) - px(INSURED)} height="110" fill="url(#hatch)" />
            {/* range: 76–131, outline only */}
            <g className="band-range opacity-0">
              <line x1={px(TOTAL_LO)} y1="0" x2={px(TOTAL_LO)} y2="110" stroke="#2d4274" strokeWidth="1" strokeDasharray="3 4" />
              <text x={px(TOTAL_LO) + 10} y="128" fontSize="9" fill="#2d4274" fontFamily="inherit">loss range $76–131B</text>
            </g>
            <text x="10" y="128" fontSize="9" fill="#2d4274">$22B insured</text>
          </svg>
          <div className="legend mt-5 grid gap-4 opacity-0 sm:grid-cols-3">
            <div><div className="text-[16px] font-light tabular-nums">$76–131B</div><div className="label opacity-70">Total economic loss</div></div>
            <div><a className="block text-[16px] font-light tabular-nums underline-offset-4 hover:underline" href={CA_INSURANCE_URL} target="_blank" rel="noreferrer">$22B</a><div className="label opacity-70">Insured</div></div>
            <div><div className="text-[16px] font-medium tabular-nums text-accent">70–83%</div><div className="label opacity-70">Uninsured</div></div>
          </div>
          <a className="label mt-6 inline-block opacity-70 underline-offset-4 hover:underline" target="_blank" rel="noreferrer"
            href="https://insurance.ca.gov/01-consumers/180-climate-change/Wildfire-Claims-Tracker.cfm">
            insurance.ca.gov/01-consumers/180-climate-change/Wildfire-Claims-Tracker.cfm
          </a>
          <p className="closing mt-8 max-w-[40ch] text-[clamp(20px,2.6vw,30px)] font-semibold leading-snug opacity-0">
            There is a need for alternative risk capital, and indeed for catastrophic risk.
          </p>
        </div>
      </div>
    </section>
  )
}
