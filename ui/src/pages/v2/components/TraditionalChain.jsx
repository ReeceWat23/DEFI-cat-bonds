import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from '../lib/gsapSetup'
import { useReducedMotion, pinDistance } from '../lib/motion'
import { Node, Connector, SectionMarker } from './Chain'

// Ends at Reinsurer — cat bonds get their own explainer in section 3, not a
// footnote on the end of the traditional chain.
const LINKS = [
  { name: 'Risk', desc: 'A city, a utility, a port. Exposed to flood, wind, fire.' },
  { name: 'Broker', desc: 'Places the risk. Negotiates terms and price.' },
  { name: 'Insurer', desc: 'Takes the first layer of loss on its balance sheet.' },
  { name: 'Reinsurer', desc: 'Insures the insurer. Absorbs the tail.' },
]

/** Section 1 — Traditional coverage. 250vh pinned. Establishes the chain language. */
export default function TraditionalChain() {
  const stage = useRef(null)
  const reduce = useReducedMotion()

  useGSAP(() => {
    if (!stage.current) return
    const q = gsap.utils.selector(stage)
    if (reduce) { gsap.set(q('.node'), { opacity: 1, x: 0 }); gsap.set(q('.connector'), { scale: 1 }); gsap.set(q('.after'), { opacity: 1 }); return }
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { id: 's1', trigger: stage.current, start: 'top top', end: pinDistance(250), pin: true, scrub: 0.5 },
    })
    const nodes = q('.node'), conns = q('.connector')
    nodes.forEach((n, i) => {
      const t = i * 0.2
      tl.to(n, { opacity: 1, x: 0, duration: 0.12, ease: 'power2.out' }, t)
      if (conns[i]) tl.to(conns[i], { scaleX: 1, scaleY: 1, duration: 0.08 }, t + 0.12)
    })
    tl.to(q('.after'), { opacity: 1, duration: 0.08 }, 0.9)
  }, { scope: stage, dependencies: [reduce] })

  return (
    <section ref={stage} id="s1" className="relative flex min-h-screen items-center px-8 md:px-14">
      <div className="section-frame relative z-20 mx-auto w-full max-w-none p-8 md:p-14">
        <SectionMarker n="01" title="Traditional coverage" />
        <h2 className="max-w-[24ch] text-[clamp(24px,2.8vw,38px)] font-light leading-tight text-navy">
          Risk is transferred in layers.
        </h2>
        <p className="mt-3 max-w-[46ch] text-[13px] text-navy opacity-70">
          Layer by layer, risk decreases and severity increases.
        </p>
        <div className="mt-12 grid items-center gap-y-0 md:grid-cols-[1fr_36px_1fr_36px_1fr_36px_1fr]">
          {LINKS.map((l, i) => (
            <div key={l.name} className="contents">
              <div className="node opacity-0 md:translate-x-[-24px]" style={{ transform: 'translateX(-24px)' }}>
                <Node name={l.name} desc={l.desc} className="h-full" />
              </div>
              {i < LINKS.length - 1 && (
                <div className="flex h-9 items-center justify-center md:h-auto md:pb-10">
                  <span className="hidden w-full md:block"><Connector /></span>
                  <span className="block h-full md:hidden"><Connector vertical /></span>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="after mt-10 max-w-[54ch] rounded-2xl border border-white/70 bg-transparent px-6 py-5 opacity-0 backdrop-blur-sm">
          <p className="text-[17px] leading-relaxed text-white md:text-[19px]">
            It works when there is enough capacity to cover the underlying risk.
          </p>
        </div>
      </div>
    </section>
  )
}
