import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from '../lib/gsapSetup'
import { useReducedMotion, pinDistance } from '../lib/motion'
import { SectionMarker } from './Chain'

// R3F is code-split and mounted only when the section is within one viewport.
const ScaleScene = lazy(() => import('./ScaleScene'))

/** Section 5 — The scale of the unlock. 350vh pinned. */
export default function Scale() {
  const stage = useRef(null)
  const reduce = useReducedMotion()
  const progress = useRef(0)
  const [near, setNear] = useState(false)
  const [unit, setUnit] = useState(60)

  useEffect(() => {
    if (!stage.current) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '100% 0px' })
    io.observe(stage.current)
    return () => io.disconnect()
  }, [])

  useGSAP(() => {
    if (!stage.current) return
    if (reduce) { progress.current = 1; return }
    gsap.to(progress, {
      current: 1, ease: 'none',
      scrollTrigger: { id: 's5', trigger: stage.current, start: 'top top', end: pinDistance(350), pin: true, scrub: 0.4 },
    })
  }, { scope: stage, dependencies: [reduce] })

  const fmt = (b) => (b >= 1000 ? `$${(b / 1000).toLocaleString()}TN` : `$${b}BN`)

  return (
    <section ref={stage} id="s5" className="relative h-screen overflow-hidden px-6 md:px-14">
      {/* the scene is continuous with the page: no boxed canvas */}
      <div className="absolute inset-0 z-[1]">
        {near && (
          <Suspense fallback={null}>
            <ScaleScene progress={progress} onUnit={setUnit} />
          </Suspense>
        )}
      </div>

      <div className="pointer-events-none relative z-20 mx-auto flex h-full max-w-[1180px] flex-col justify-between py-24 text-navy">
        <div>
          <SectionMarker n="05" title="The scale of the unlock" />
          <h2 className="max-w-[22ch] text-[clamp(24px,2.8vw,38px)] font-light leading-tight">What Rhodex unlocks.</h2>
          <p className="mt-3 max-w-[44ch] text-[13px]">Capital markets are <b className="font-medium">2,678×</b> the cat bond market and <b className="font-medium">230×</b> reinsurance capital.</p>
        </div>
        <div className="flex items-end justify-between">
          <div className="label">1 unit = {fmt(unit)}</div>
          <div className="relative">
            <div className="label text-right opacity-70">True linear scale · only the camera moves</div>
          </div>
        </div>
      </div>

      <p className="sr-only">
        Cat bond capacity: $60 billion. Reinsurance capacity: $700 billion. Capital markets capacity: $160.7 trillion.
        Capital markets are 2,678 times the cat bond market and 230 times reinsurance capital.
      </p>
    </section>
  )
}
