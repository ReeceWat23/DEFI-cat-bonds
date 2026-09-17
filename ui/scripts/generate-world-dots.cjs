// Regenerates src/data/worldDots.json — a real dot-matrix world landmass
// dataset (via the `dotted-map` package), used by LiveBondsMap.jsx.
//
// dotted-map (and its @turf/proj4 deps) is a devDependency only: it runs
// here, once, at dev time — the app never imports it, so none of its
// runtime weight reaches the browser bundle. Re-run this after changing
// resolution/projection settings below.
//
//   node scripts/generate-world-dots.cjs

const fs = require('fs')
const path = require('path')
const DottedMap = require('dotted-map').default

const map = new DottedMap({ height: 100, grid: 'vertical' })
const points = map.getPoints().map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])

const outPath = path.join(__dirname, '..', 'src', 'data', 'worldDots.json')
fs.writeFileSync(outPath, JSON.stringify(points))
console.log(`Wrote ${points.length} points to ${outPath}`)
