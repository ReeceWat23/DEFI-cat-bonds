import { lazy, Suspense, useEffect, useRef, useState } from 'react'

// Three.js (via HowItWorksBlock) is code-split and mounted only when the
// section is within one viewport — same pattern as Scale.jsx/ScaleScene,
// so `three` never lands in the main bundle every route pays for.
const HowItWorksBlock = lazy(() => import('./HowItWorksBlock'))

export default function HowItWorks() {
  const wrap = useRef(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    if (!wrap.current) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '100% 0px' })
    io.observe(wrap.current)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={wrap} className="relative h-screen">
      {near && (
        <Suspense fallback={null}>
          <HowItWorksBlock />
        </Suspense>
      )}
    </div>
  )
}
