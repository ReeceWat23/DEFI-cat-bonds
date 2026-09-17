import { useEffect, useState } from 'react'

/** True when the user prefers reduced motion. Sections render a static keyframe in that case. */
export function useReducedMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduce(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduce
}

/** Pin distance helper: mobile gets ~40% less scroll per section. */
export function pinDistance(vh) {
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches
  return `+=${Math.round(mobile ? vh * 0.6 : vh)}%`
}
