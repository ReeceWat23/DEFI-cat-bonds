import { forwardRef } from 'react'

/** Glass chain node. Sections 1, 3 and 5 all use this exact construction. */
export const Node = forwardRef(function Node({ name, desc, label, className = '', plugs, style }, ref) {
  return (
    <div ref={ref} style={style}
      className={`glass relative flex min-h-[112px] flex-col justify-between gap-3 px-5 py-4 ${plugs ? 'plugs' : ''} ${className}`}>
      {label && <span className="label opacity-70">{label}</span>}
      <div>
        <div className="text-[15px] font-medium leading-tight">{name}</div>
        {desc && <p className="mt-1.5 text-[12px] leading-snug opacity-80">{desc}</p>}
      </div>
    </div>
  )
})

/** Navy connector, scaleX/scaleY-driven. Arrowless: the chain reads by sequence, not arrows. */
export function Connector({ vertical = false, className = '' }) {
  return (
    <div
      className={`connector bg-navy ${vertical ? 'w-px h-full origin-top' : 'h-px w-full origin-left'} ${className}`}
      style={{ transform: vertical ? 'scaleY(0)' : 'scaleX(0)' }}
    />
  )
}

export function SectionMarker({ n, title }) {
  return <div className="label mb-5 text-navy">{n} / {title}</div>
}
