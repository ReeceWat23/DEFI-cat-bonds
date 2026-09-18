import { Link } from 'react-router-dom'

/** Fixed top bar. Colour follows --topbar-ink, which the hero sets to white only
 *  while the storm state is on screen. */
export default function TopBar() {
  return (
    <header
      className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5 md:px-14"
      style={{ color: 'var(--topbar-ink, var(--ink))', transition: 'color .4s' }}
    >
      <Link to="/" className="font-mono text-[15px] font-semibold tracking-wide">RHODEX.</Link>
      <div className="flex items-center gap-3">
        <Link to="/build" className="rounded-md px-3 py-1.5 font-mono text-[11px] font-medium">
          Build a bond
        </Link>
        <Link to="/build" className="rounded-md bg-navy px-3 py-1.5 font-mono text-[11px] font-medium text-white">
          Get started
        </Link>
      </div>
    </header>
  )
}
