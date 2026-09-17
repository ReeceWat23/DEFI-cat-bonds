import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from '../lib/gsapSetup'
import { useReducedMotion, pinDistance } from '../lib/motion'
import s from './Hero.module.css'

/** Drop your hero visual at /hero-cyclone.jpg (<200KB) and set this. */
const HEROIMAGE = null
const HEADLINE = 'Where there is risk, there is coverage.'

/**
 * Section 0 — Cyclone. 150vh pinned (90vh mobile).
 * Opens on the storm with the intro text in view. Scroll tightens and rotates the cyclone,
 * lightning at 60% and 85%, the second line resolves at 70%. The bolt's foot is the snake origin.
 */
export default function Hero() {
  const stage = useRef(null)
  const reduce = useReducedMotion()

  useGSAP(() => {
    if (reduce || !stage.current) return
    const q = gsap.utils.selector(stage)

    // No more --topbar-ink toggling: that existed only to keep the wordmark
    // legible over the old dark storm field. The field is the page's own
    // light gradient now, so the topbar's default ink color already works
    // throughout.
    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        id: 's0', trigger: stage.current, start: 'top top', end: pinDistance(150), pin: true, scrub: 0.5,
      },
    })

    tl.to(q(`.${s.hint}`), { opacity: 0, duration: 0.08 }, 0)
      .to(q(`.${s.intro}`), { opacity: 0, y: -30, duration: 0.25, ease: 'power1.in' }, 0.2)
      // cyclone organizes: tightens and turns for the whole pin
      .to(q(`.${s.cyclone}`), { scale: 1.05, duration: 1 }, 0)
      .to(q(`.${s.arms}`), { rotation: 480, duration: 1 }, 0)
      .to(q(`.${s.armsInner}`), { rotation: -380, duration: 1 }, 0)
      .to(q(`.${s.core}`), { rotation: 160, scale: 1.1, duration: 1 }, 0)
      .to(q(`.${s.wind}`), { opacity: 1, duration: 0.2 }, 0.25)
      .to(q(`.${s.wind}`), { xPercent: 30, duration: 0.75 }, 0.25)
      // lightning 1 (weak)
      .to(q(`.${s.flash}`), { opacity: 0.35, duration: 0.012 }, 0.6)
      .to(q(`.${s.flash}`), { opacity: 0, duration: 0.035 }, 0.612)
      // second line, word by word
      .to(q(`.${s.word}`), { opacity: 1, y: 0, duration: 0.05, stagger: 0.02, ease: 'power2.out' }, 0.7)
      // lightning 2 (strong) — bolt draws and stays
      .set(q(`.${s.bolt}`), { opacity: 1 }, 0.84)
      .to(q(`.${s.bolt} polyline`), { strokeDashoffset: 0, duration: 0.03, ease: 'power4.in' }, 0.84)
      .to(q(`.${s.flash}`), { opacity: 0.7, duration: 0.012 }, 0.855)
      .to(q(`.${s.flash}`), { opacity: 0, duration: 0.06 }, 0.867)
      .to(q(`.${s.bolt}`), { opacity: 0.55, duration: 0.1 }, 0.9)
  }, { scope: stage, dependencies: [reduce] })

  return (
    <section ref={stage} className={`${s.stage} ${reduce ? s.static : ''}`} aria-label="Rhodex">
      <div className={`${s.layer} ${s.field}`} />
      {HEROIMAGE && <div className={s.layer}><img className={s.image} src={HEROIMAGE} alt="" fetchPriority="high" /></div>}
      <div className={s.cyclone} aria-hidden>
        <div className={s.core} /><div className={s.arms} /><div className={`${s.arms} ${s.armsInner}`} /><div className={s.eye} />
      </div>
      <div className={`${s.layer} ${s.wind}`} />
      <div className={`${s.layer} ${s.flash}`} />
      <svg className={s.bolt} viewBox="0 0 100 400" preserveAspectRatio="none" aria-hidden>
        <polyline pathLength="1" points="52,0 44,120 60,132 38,250 56,262 50,400" />
      </svg>
      <div className={s.origin} data-snake-origin />

      <div className={s.intro}>
        <h1>The future of reinsurance.</h1>
        <p className={s.lead}>RHODEX. Build, issue, manage &amp; invest in Catastrophe bonds. All in one spot.</p>
        <p className={s.tagline}>Tech for ILS brokers</p>
        <div className={s.cta}>
          <a className={`${s.btn} ${s.btnSolid}`} href="#s1">Explore the system</a>
          <a className={s.btn} href="#s1">Read the thesis</a>
        </div>
      </div>
      <h2 className={s.headline}>
        {HEADLINE.split(' ').map((w, i) => <span key={i} className={s.word}>{w}</span>)}
      </h2>
      <div className={s.hint} aria-hidden>Scroll</div>
    </section>
  )
}
