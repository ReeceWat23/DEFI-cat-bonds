import { gsap } from './gsapSetup'

/**
 * The page's signature interaction: a mechanical snap into place.
 * Scroll (scrub) brings the block to `approach` px short of home along `axis`;
 * latch() then plays a non-scrubbed settle: decelerate, overshoot ~4px, settle in 150ms.
 * `pulse` is the junction/contact element that flashes accent blue once.
 */
export function latch(el, axis, approach, pulse) {
  const overshoot = -Math.sign(approach) * 4
  const tl = gsap.timeline()
  tl.to(el, { [axis]: overshoot, duration: 0.12, ease: 'power2.out' })
    .to(el, { [axis]: 0, duration: 0.15, ease: 'power2.out' })
  if (pulse) {
    tl.fromTo(pulse, { opacity: 1, scale: 1 }, { opacity: 0, scale: 2.4, duration: 0.5, ease: 'power2.out' }, 0.1)
  }
  return tl
}

/** Reverse scroll: put the block back at its approach position instantly. */
export function unlatch(el, axis, approach) {
  gsap.killTweensOf(el)
  gsap.set(el, { [axis]: approach })
}
