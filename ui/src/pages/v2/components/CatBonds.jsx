import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from '../lib/gsapSetup'
import { useReducedMotion, pinDistance } from '../lib/motion'
import { SectionMarker } from './Chain'

const STATS = [
  { value: '$2–3M', label: 'Startup costs', desc: 'Paying for the expertise of brokers, banks, lawyers, and cat modelers.' },
  { value: '$Ms', label: 'In premiums', desc: "That's a given." },
  { value: '4–5 mo.', label: 'To construct', desc: 'From term sheet to close.' },
]

/** Section 3 — Catastrophe bonds. 220vh pinned. Introduces cat bonds on their own terms. */
export default function CatBonds() {
  const stage = useRef(null)
  const reduce = useReducedMotion()

  useGSAP(() => {
    if (!stage.current) return
    const q = gsap.utils.selector(stage)
    if (reduce) { gsap.set(q('.intro, .stat, .closing'), { opacity: 1, y: 0 }); return }
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { id: 's3', trigger: stage.current, start: 'top top', end: pinDistance(220), pin: true, scrub: 0.5 },
    })
    tl.to(q('.intro'), { opacity: 1, y: 0, duration: 0.16, ease: 'power2.out' }, 0)
    const stats = q('.stat')
    stats.forEach((el, i) => {
      tl.to(el, { opacity: 1, y: 0, duration: 0.12, ease: 'power2.out' }, 0.36 + i * 0.14)
    })
    tl.to(q('.closing'), { opacity: 1, duration: 0.08 }, 0.92)
  }, { scope: stage, dependencies: [reduce] })

  return (
    <section ref={stage} id="s3" className="relative flex min-h-screen items-center px-8 md:px-14">
      <div className="section-frame relative z-20 mx-auto w-full max-w-none p-8 text-navy md:p-14">
        <SectionMarker n="03" title="Catastrophe bonds" />

        <div className="intro opacity-0" style={{ transform: 'translateY(16px)' }}>
          <h2 className="max-w-[22ch] text-[clamp(26px,3.6vw,42px)] font-light leading-tight">
            Let the capital markets cover risk.
          </h2>
          <p className="mt-3 max-w-[50ch] text-[15px] opacity-80">Institutional investors become insurers.</p>
          <p className="mt-4 max-w-[56ch] text-[13px] opacity-70">
            Fully collateralized coverage, and now a $60B market for offloading risk. <b className="font-semibold opacity-100">Cat bonds are expensive.</b>
          </p>
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {STATS.map((s) => (
            <div key={s.label} className="stat opacity-0" style={{ transform: 'translateY(20px)' }}>
              <div className="text-[clamp(36px,5vw,56px)] font-light leading-none tabular-nums text-accent">{s.value}</div>
              <div className="label mt-3">{s.label}</div>
              <p className="mt-2 max-w-[26ch] text-[12px] leading-snug opacity-70">{s.desc}</p>
            </div>
          ))}
        </div>

        <p className="closing mt-10 max-w-[52ch] text-[15px] font-light leading-snug opacity-0">
          So Rhodex made cat bonds cheaper and faster by standardizing them.
        </p>
      </div>
    </section>
  )
}
