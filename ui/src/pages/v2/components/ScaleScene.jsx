import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Html } from '@react-three/drei'
import * as THREE from 'three'

export const UNIT_B = 60 // $bn per unit block
export const BARS = [
  { key: 'cat', label: 'Cat bond capacity', value: 60 },
  { key: 're', label: 'Reinsurance capacity', value: 700 },
  { key: 'fi', label: 'Capital markets capacity', value: 160700 },
]
const H = BARS.map((b) => b.value / UNIT_B) // 1, 11.67, 2678.3 — true linear scale
const W = 6, GAP = 7
const X = [-(W + GAP), 0, W + GAP]
const LEVELS = [1, 10, 100, 1000]
const CAP = 400 // hard instance cap per bar
const FOV = 35
const FIELD = '#b0bcc9'

/** Camera dolly: only the camera moves. View height grows exponentially in scroll so each
 *  order of magnitude gets equal screen time. Returns current view height. */
function useDolly(progress) {
  const view = useRef(3)
  useFrame(({ camera, scene }) => {
    const p = progress.current
    const viewH = Math.exp(THREE.MathUtils.lerp(Math.log(3), Math.log(H[2] * 1.18), p))
    view.current = viewH
    const d = (viewH / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const ty = viewH * 0.38
    camera.position.set(d * 0.32, ty + d * 0.2, d * 0.94)
    camera.lookAt(X[1] * 0.3, ty, 0)
    camera.near = Math.max(0.05, d * 0.005)
    camera.far = d * 8
    camera.updateProjectionMatrix()
    if (!scene.fog) scene.fog = new THREE.Fog(FIELD, d * 0.6, d * 3.2)
    else { scene.fog.near = d * 0.7; scene.fog.far = d * 3.4 }
  })
  return view
}

/** Block size that keeps a unit ≥ ~8px on screen. */
function legibleLevel(viewH, vpH) {
  const min = (viewH * 8) / vpH
  return LEVELS.find((l) => l >= min) ?? 1000
}

function Bar({ i, view }) {
  const mesh = useRef(null)
  const last = useRef(-1)
  const { size } = useThree()
  const geo = useMemo(() => { const g = new THREE.BoxGeometry(W, 1, W); g.translate(0, 0.5, 0); return g }, [])
  const m = useMemo(() => new THREE.Matrix4(), [])

  useFrame(() => {
    if (!mesh.current) return
    // per-bar LOD: legible level, raised until instance count fits the cap
    let b = legibleLevel(view.current, size.height)
    while (Math.ceil(H[i] / b) > CAP) b = LEVELS[LEVELS.indexOf(b) + 1] ?? 1000
    if (b === last.current) return
    last.current = b
    const n = Math.ceil(H[i] / b)
    for (let k = 0; k < n; k++) {
      const h = Math.min(b, H[i] - k * b)
      m.makeScale(1, h * 0.94, 1) // 6% gap so the subdivision reads
      m.setPosition(X[i], k * b, 0)
      mesh.current.setMatrixAt(k, m)
    }
    mesh.current.count = n
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[geo, undefined, CAP]} frustumCulled={false}>
      {/* soft-gradient material: white core to light blue, translucent, no specular */}
      <meshStandardMaterial color="#d6e2f3" emissive="#ffffff" emissiveIntensity={0.42}
        transparent opacity={0.84} roughness={1} metalness={0} depthWrite={false} />
    </instancedMesh>
  )
}

function Scene({ progress, onUnit }) {
  const view = useDolly(progress)
  const { size } = useThree()
  const unit = useRef(0)
  const cell = useRef(1)
  useFrame(() => {
    const b = legibleLevel(view.current, size.height)
    if (b !== unit.current) { unit.current = b; onUnit(b * UNIT_B) }
    cell.current = b
  })
  return (
    <>
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#ffffff', '#8ea3bd', 0.6]} />
      {BARS.map((_, i) => <Bar key={i} i={i} view={view} />)}
      {/* ground grid: cells shrink as the camera retreats — this is what makes the zoom-out legible */}
      <GridPair cell={cell} />
      {BARS.map((b, i) => (
        <Html key={b.key} position={[X[i], H[i], 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="whitespace-nowrap text-center font-mono text-navy" style={{ transform: 'translateY(-120%)' }}>
            <div className="text-[12px] font-medium">{b.label}</div>
            <div className="text-[11px] tabular-nums">{b.value >= 1000 ? `$${(b.value / 1000).toFixed(1)}T` : `$${b.value}B`}</div>
          </div>
        </Html>
      ))}
    </>
  )
}

/** Ground + back wall grids; cell size follows the LOD so the grid stays countable. */
function GridPair({ cell }) {
  const g1 = useRef(null), g2 = useRef(null)
  useFrame(({ camera }) => {
    const c = cell.current
    const d = camera.position.length()
    for (const g of [g1.current, g2.current]) {
      if (!g) continue
      g.material.uniforms.cellSize.value = c
      g.material.uniforms.sectionSize.value = c * 10
      g.material.uniforms.fadeDistance.value = d * 3
    }
  })
  const common = { cellColor: '#9caabc', sectionColor: '#8997b0', cellThickness: 0.6, sectionThickness: 1, infiniteGrid: true, fadeStrength: 1.2 }
  return (
    <>
      <Grid ref={g1} position={[0, 0, 0]} {...common} />
      <Grid ref={g2} position={[0, 0, -W * 2.5]} rotation={[Math.PI / 2, 0, 0]} {...common} fadeStrength={2} />
    </>
  )
}

export default function ScaleScene(props) {
  return (
    <Canvas dpr={[1, 1.5]} camera={{ fov: FOV, near: 0.1, far: 5000, position: [2, 2, 6] }}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}>
      <Scene {...props} />
    </Canvas>
  )
}
