import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap, ScrollTrigger } from '../lib/gsapSetup'

/** Lenis smooth scroll wired into GSAP's ticker so ScrollTrigger and Lenis share one clock. */
export default function SmoothScroll({ children }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (t) => lenis.raf(t * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
      ScrollTrigger.getAll().forEach((t) => t.kill()) // route change / unmount
    }
  }, [])
  return <>{children}</>
}
