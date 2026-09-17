import { useEffect, useRef } from 'react'
import { ScrollTrigger } from '../lib/gsapSetup'

/**
 * The snake progress path. One SVG <path>, full-document layer at z-10 beneath content,
 * drawn by stroke-dashoffset against overall page progress.
 * Angular only: vertical / horizontal / 45° chamfers. The traverse at each boundary IS the section divider.
 * Origin: the hero bolt's foot. Terminus: Section 6 (the interactive block).
 * Nodes at each section entry fill accent on arrival.
 */
export default function SnakePath() {
  const svg = useRef(null)
  const path = useRef(null)
  const nodesG = useRef(null)
  const len = useRef(0)
  const nodeYs = useRef([])
  const heroEnd = useRef(0)

  useEffect(() => {
    const build = () => {
      const sv = svg.current, p = path.current, ng = nodesG.current
      if (!sv || !p || !ng) return
      const vw = innerWidth, vh = innerHeight, docH = document.documentElement.scrollHeight
      const mobile = matchMedia('(max-width: 820px)').matches
      const gutter = mobile ? 18 : Math.max(24, vw * 0.035)
      const xL = gutter, xR = vw - gutter, ch = 22 // chamfer size
      sv.setAttribute('viewBox', `0 0 ${vw} ${docH}`); sv.style.height = docH + 'px'

      const hero = ScrollTrigger.getById('s0')
      const origin = document.querySelector('[data-snake-origin]')
      const stage = origin?.closest('section')
      if (!hero || !origin || !stage) return
      const oy = origin.getBoundingClientRect().top - stage.getBoundingClientRect().top + hero.start
      const ox = origin.getBoundingClientRect().left
      heroEnd.current = hero.end

      let d = `M ${ox} ${oy}`, px = ox
      const ys = []
      ;['s1', 's2', 's3', 's4', 's5', 's6'].forEach((id, i) => {
        const t = ScrollTrigger.getById(id); if (!t) return
        const gx = mobile ? xL : i % 2 === 0 ? xL : xR
        const yb = t.start // section boundary in document space
        // vertical to boundary, then chamfered traverse to the section's gutter
        const dir = Math.sign(gx - px) || 1
        if (Math.abs(gx - px) > ch * 2) d += ` L ${px} ${yb - ch} L ${px + dir * ch} ${yb} L ${gx - dir * ch} ${yb} L ${gx} ${yb + ch}`
        else d += ` L ${px} ${yb}`
        ys.push(yb + 48)
        if (id === 's6') {
          const term = document.querySelector('[data-snake-terminus]')
          const s6 = term?.closest('section')
          const ty = term && s6 ? term.getBoundingClientRect().top - s6.getBoundingClientRect().top + t.start : t.start + vh * 0.8
          const tx = term ? term.getBoundingClientRect().left : gx
          const tdir = Math.sign(tx - gx) || 1
          d += ` L ${gx} ${ty - ch} L ${gx + tdir * ch} ${ty} L ${tx} ${ty}`
        }
        px = gx
      })
      p.setAttribute('d', d)
      len.current = p.getTotalLength()
      p.style.strokeDasharray = `${len.current}`
      ng.innerHTML = ys.map((y, i) => {
        const gx = mobile ? xL : i % 2 === 0 ? xL : xR
        return `<circle cx="${gx}" cy="${y}" r="4" fill="#b0bcc9" stroke="#2d4274" stroke-width="1"/>`
      }).join('')
      nodeYs.current = ys
      update()
    }
    const update = () => {
      const p = path.current, ng = nodesG.current; if (!p || !ng) return
      const max = document.documentElement.scrollHeight - innerHeight
      const f = Math.min(1, Math.max(0, scrollY / max))
      p.style.strokeDashoffset = `${len.current * (1 - f)}`
      // navy on the pale field; white only inside the hero's dark storm state
      const inStorm = scrollY < heroEnd.current - innerHeight * 0.3
      p.style.stroke = inStorm ? '#ffffff' : '#2d4274'
      ng.querySelectorAll('circle').forEach((c, i) => {
        c.setAttribute('fill', scrollY + innerHeight * 0.55 >= nodeYs.current[i] ? '#4a6fc4' : '#b0bcc9')
      })
    }
    ScrollTrigger.addEventListener('refresh', build)
    addEventListener('scroll', update, { passive: true })
    const t = setTimeout(() => { ScrollTrigger.refresh(); build() }, 300)
    return () => { clearTimeout(t); ScrollTrigger.removeEventListener('refresh', build); removeEventListener('scroll', update) }
  }, [])

  return (
    <svg ref={svg} aria-hidden className="pointer-events-none absolute left-0 top-0 z-10 w-full" preserveAspectRatio="none">
      <path ref={path} fill="none" stroke="#2d4274" strokeWidth="1.25" strokeLinejoin="miter" style={{ transition: 'stroke .4s' }} />
      <g ref={nodesG} />
    </svg>
  )
}
