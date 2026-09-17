import SmoothScroll from './components/SmoothScroll'
import TopBar from './components/TopBar'
import SnakePath from './components/SnakePath'
import Hero from './components/Hero'
import TraditionalChain from './components/TraditionalChain'
import CoverageGap from './components/CoverageGap'
import CatBonds from './components/CatBonds'
import ReimaginedChain from './components/ReimaginedChain'
import Scale from './components/Scale'
import HowItWorks from './components/HowItWorks'
import './v2.css'

// Draft v2 homepage — pasted in from a separate Next.js/GSAP/R3F prototype
// ("rhodexv2full") and ported to this app's Vite/React stack (no Next.js,
// no TypeScript — CSS Modules and React.lazy/Suspense cover what next/font
// and next/dynamic did in the original). Deliberately isolated at its own
// route so it doesn't touch "/" — see v2.css's .rhodex-v2 scoping.
export default function HomePageV2() {
  return (
    <div className="rhodex-v2">
      <SmoothScroll>
        <main className="relative">
          <TopBar />
          <SnakePath />
          <Hero />
          <TraditionalChain />
          <CoverageGap />
          <CatBonds />
          <ReimaginedChain />
          <Scale />
          <HowItWorks />
          <footer className="mx-6 flex justify-between border-t border-ink/25 px-0 py-10 text-[10.5px] tracking-label text-ink md:mx-14">
            <span>DIGITAL / TRANSPARENT / DEMOCRATIZED</span>
            <span>NEW YORK — GLOBAL MARKETS</span>
          </footer>
        </main>
      </SmoothScroll>
    </div>
  )
}
