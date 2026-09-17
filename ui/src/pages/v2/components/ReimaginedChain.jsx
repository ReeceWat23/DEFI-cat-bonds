import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from '../lib/gsapSetup'
import { useReducedMotion, pinDistance } from '../lib/motion'
import { latch, unlatch } from '../lib/latch'
import { Node, Connector, SectionMarker } from './Chain'

/**
 * Section 4 — The reimagined chain. 300vh pinned.
 * Risk → Broker → X (closed — cat bonds today: a private, bespoke deal) →
 * the X rotates 45° into a + — that junction IS Rhodex, a straight rail
 * into the capital markets → Cat bonds (digital) latches on it.
 * One path this time, not a fork: cat bonds already got their own section.
 */
export default function ReimaginedChain() {
  const stage = useRef(null)
  const reduce = useReducedMotion()

  useGSAP(() => {
    if (!stage.current) return
    const q = gsap.utils.selector(stage)
    const [risk, broker, bond] = ['risk', 'broker', 'bond'].map((k) => q(`.n-${k}`)[0])
    const junction = q('.junction')[0], pulse = q('.pulse')[0]
    const mobile = window.matchMedia('(max-width: 820px)').matches
    const axis = mobile ? 'y' : 'x'

    if (reduce) {
      gsap.set([risk, broker, bond], { opacity: 1, x: 0, y: 0 })
      gsap.set(q('.connector, .rail'), { scaleX: 1, scaleY: 1 }); gsap.set(junction, { opacity: 1, rotation: 0 }); gsap.set(q('.note, .rhodex-tag'), { opacity: 1 })
      return
    }
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { id: 's4', trigger: stage.current, start: 'top top', end: pinDistance(300), pin: true, scrub: 0.5 },
    })
    const dir = () => tl.scrollTrigger.direction

    tl.to(risk, { opacity: 1, x: 0, duration: 0.12, ease: 'power2.out' }, 0)
      .to(q('.l1'), { scaleX: 1, scaleY: 1, duration: 0.07 }, 0.12)
      .to(broker, { opacity: 1, x: 0, duration: 0.12, ease: 'power2.out' }, 0.2)
      // X appears — closed path. Today, a cat bond is a private, bespoke deal.
      .to(junction, { opacity: 1, duration: 0.07 }, 0.36)
      .to(q('.cap1'), { opacity: 1, duration: 0.06 }, 0.42)
      .to(q('.cap1'), { opacity: 0, duration: 0.06 }, 0.52)
      // the X is Rhodex. Rotated a quarter, the stop becomes a rail.
      .to(junction, { rotation: 0, duration: 0.22, ease: 'power2.inOut' }, 0.56)
      .to(q('.rhodex-tag'), { opacity: 1, duration: 0.07 }, 0.66)
      .to(q('.rail'), { scaleX: 1, scaleY: 1, duration: 0.08 }, 0.72)
      .to(bond, { opacity: 1, [axis]: 12, duration: 0.14, ease: 'power1.out' }, 0.78)
      .call(() => (dir() > 0 ? latch(bond, axis, 12, pulse) : unlatch(bond, axis, 12)), [], 0.92)
      .to(q('.note'), { opacity: 1, duration: 0.06 }, 0.96)
  }, { scope: stage, dependencies: [reduce] })

  return (
    <section ref={stage} id="s4" className="relative flex min-h-screen items-center px-8 md:px-14">
      <div className="section-frame relative z-20 mx-auto w-full max-w-none p-8 text-navy md:p-14">
        <SectionMarker n="04" title="The reimagined chain" />
        <h2 className="max-w-[26ch] text-[clamp(24px,2.8vw,38px)] font-light leading-tight">
          Rhodex adds a rail straight to the capital markets.
        </h2>

        <div className="rail-grid mt-16 grid items-center
          grid-cols-1 grid-rows-[auto_36px_auto_36px_72px_48px_auto] gap-y-0
          md:grid-cols-[1fr_36px_1fr_72px_60px_1fr] md:grid-rows-1">
          <Node name="Risk" desc="Same city. Same flood." className="n-risk opacity-0 md:col-start-1" style={{ transform: 'translateX(-40px)' }} />
          <div className="l1 flex h-full items-center md:col-start-2"><Connector className="hidden md:block" /><Connector vertical className="mx-auto md:hidden" /></div>
          <Node name="Broker" desc="Places the risk on Rhodex." className="n-broker opacity-0 md:col-start-3" style={{ transform: 'translateX(-40px)' }} />

          {/* junction: two crossed strokes. Starts as X (closed — a private,
              bespoke deal), rotates to + (Rhodex: open, a rail). */}
          <div className="relative flex h-[72px] w-[72px] items-center justify-center justify-self-center md:col-start-4">
            <div className="junction absolute inset-0 opacity-0" style={{ transform: 'rotate(45deg)' }} aria-hidden>
              <span className="absolute left-2 right-2 top-1/2 h-[2px] -translate-y-1/2 bg-navy" />
              <span className="absolute bottom-2 top-2 left-1/2 w-[2px] -translate-x-1/2 bg-navy" />
            </div>
            <span className="pulse absolute h-3 w-3 rounded-full bg-accent opacity-0" aria-hidden />
            <span className="rhodex-tag label absolute -bottom-6 whitespace-nowrap text-accent opacity-0" aria-hidden>Rhodex</span>
          </div>

          <div className="flex h-full items-center md:col-start-5">
            <div className="rail hidden h-px w-full origin-left bg-accent md:block" style={{ transform: 'scaleX(0)' }} />
            <div className="rail mx-auto h-full w-[2px] origin-top bg-accent md:hidden" style={{ transform: 'scaleY(0)' }} />
          </div>

          <Node name="Cat bonds (digital)" desc="Standardized, collateralized, and settled on-chain." className="n-bond opacity-0 md:col-start-6"
            style={{ transform: 'translateX(260px)' }} />
        </div>

        <div className="relative mt-8 h-10 max-w-[56ch] text-[13px]">
          <p className="cap1 absolute inset-0 opacity-0">Today, a cat bond is a private, bespoke deal — a stop, not a through-road.</p>
        </div>
        <p className="note mt-2 max-w-[56ch] text-[13px] opacity-0">
          The X is Rhodex.
        </p>
      </div>
    </section>
  )
}
