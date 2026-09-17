import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { gsap, ScrollTrigger } from '../lib/gsapSetup'
import { useReducedMotion } from '../lib/motion'
import { SectionMarker } from './Chain'
import s from './HowItWorks.module.css'

const BLOCKS = {
  trigger: {
    title: 'Trigger', col: { x: -1, z: 1 },
    body: 'Connects to an API for the covered risk and fires the claim automatically.',
    meta: 'Current trigger blocks: Nat cat, Cyber, Bank failure',
  },
  risk: {
    title: 'Risk monitoring', col: { x: -1, z: -1 },
    body: 'Watches the underlying risk and serves that data to users for daily risk pricing.',
    meta: 'Industry reporting, exposure data, and more',
  },
  finance: {
    title: 'Finance', col: { x: 1, z: 1 },
    body: 'All transaction logic for the bond: deposits, coupon payouts, and return of principal at maturity or trigger.',
    meta: 'Settled on-chain',
  },
  customizable: {
    title: 'Customizable', col: { x: 1, z: -1 },
    body: 'Need to cover a new risk? Rhodex can build a new, custom trigger for your bond.',
    meta: 'Indemnity or parametric deals',
  },
}

const BLOCK_COLOR = 0x7c94a8 // lighter blue

function roundedBox(size, radius, seg = 6) {
  const inset = size - 2 * radius, h = inset / 2
  const shape = new THREE.Shape()
  shape.moveTo(-h + radius, -h)
  shape.lineTo(h - radius, -h); shape.quadraticCurveTo(h, -h, h, -h + radius)
  shape.lineTo(h, h - radius); shape.quadraticCurveTo(h, h, h - radius, h)
  shape.lineTo(-h + radius, h); shape.quadraticCurveTo(-h, h, -h, h - radius)
  shape.lineTo(-h, -h + radius); shape.quadraticCurveTo(-h, -h, -h + radius, -h)
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: inset, bevelEnabled: true, bevelThickness: radius, bevelSize: radius,
    bevelSegments: seg, curveSegments: seg, steps: 1,
  })
  g.center(); g.computeVertexNormals()
  return g
}

/**
 * Section 6 — How it works. An interactive 3D block: four automated layers
 * (Trigger, Risk monitoring, Finance, Customizable), click to open. Ported
 * from a standalone Three.js/vanilla-JS prototype (howitworksv2) — same
 * mechanics (pointer tilt, raycast pick, GSAP open/close, typewriter detail,
 * leader line), scoped to this section's own bounding box instead of the
 * whole window, since here it's one section among many rather than the
 * whole page. Not pinned/scrubbed like the other sections — just a plain
 * in-flow block that happens to be interactive once it's in view — so it
 * registers its own lightweight boundary marker (see `boundary` below) purely
 * so SnakePath, which otherwise only reads pinned sections' start/end, has
 * somewhere to route the path through this last section.
 */
export default function HowItWorksBlock() {
  const stageRef = useRef(null)
  const hostRef = useRef(null)
  const svgRef = useRef(null)
  const pathRef = useRef(null)
  const dotRef = useRef(null)
  const stateNameRef = useRef(null)
  const introRef = useRef(null)
  const detailRef = useRef(null)
  const closeRef = useRef(null)
  const titleRef = useRef(null)
  const bodyRef = useRef(null)
  const metaRef = useRef(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const stage = stageRef.current, host = hostRef.current
    if (!stage || !host) return

    // No pin here (this section isn't scroll-scrubbed) — this ScrollTrigger
    // exists purely so SnakePath can read a document-space boundary for 's6'
    // the same way it reads the pinned sections' .start/.end.
    const boundary = ScrollTrigger.create({ id: 's6', trigger: stage, start: 'top top', end: 'bottom top' })

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
    camera.position.set(0, 0.6, 9.5)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7bbd, 0.95))
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(-3, 6, 4); scene.add(key)
    const rim = new THREE.DirectionalLight(0xcfd9ff, 0.55); rim.position.set(4, 2, -5); scene.add(rim)
    const fill = new THREE.DirectionalLight(0xa9bcd8, 0.25); fill.position.set(3, -2, 3); scene.add(fill)

    const SIZE = 1, GAP = 0.07, R = 0.12
    const geo = roundedBox(SIZE, R)
    const baseMat = () => new THREE.MeshStandardMaterial({ color: BLOCK_COLOR, roughness: 0.36, metalness: 0, emissive: 0x000000 })

    const rig = new THREE.Group()
    const cube = new THREE.Group()
    rig.add(cube); scene.add(rig)
    rig.rotation.set(0.42, -0.62, 0)

    const blocks = []
    const off = (SIZE + GAP) / 2
    for (const [id, def] of Object.entries(BLOCKS)) {
      def.meshes = []
      for (const y of [-1, 1]) {
        const m = new THREE.Mesh(geo, baseMat())
        m.position.set(def.col.x * off, y * off, def.col.z * off)
        m.userData = { id, home: m.position.clone() }
        cube.add(m); blocks.push(m); def.meshes.push(m)
      }
    }

    const target = { x: 0.42, y: -0.62 }
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2()
    let hovered = null, open = null, typeRAF = null, raf = null, alive = true

    const rect = () => stage.getBoundingClientRect()

    function pick(clientX, clientY) {
      const r = rect()
      ptr.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ptr, camera)
      const hit = ray.intersectObjects(blocks)[0]
      const id = hit ? hit.object.userData.id : null
      if (id !== hovered) {
        hovered = id
        stage.style.cursor = id ? 'pointer' : 'default'
        blocks.forEach((b) => {
          const on = b.userData.id === id
          gsap.to(b.material.emissive, { r: on ? 0.05 : 0, g: on ? 0.06 : 0, b: on ? 0.14 : 0, duration: 0.25 })
        })
      }
    }

    function onPointerMove(e) {
      if (!reduce) {
        const r = rect()
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1
        target.y = -0.62 + nx * 0.45
        target.x = 0.42 + ny * 0.28
      }
      pick(e.clientX, e.clientY)
    }

    function typeInto(bodyEl, metaEl, bodyText, metaText) {
      cancelAnimationFrame(typeRAF)
      const CPS = 55
      const start = performance.now()
      const total = bodyText.length + metaText.length
      bodyEl.textContent = ''; metaEl.textContent = ''
      const caret = document.createElement('span')
      caret.className = s.caret; caret.textContent = '▌'
      bodyEl.appendChild(caret)
      function step(now) {
        const n = Math.min(total, Math.floor(((now - start) / 1000) * CPS))
        const b = bodyText.slice(0, Math.min(n, bodyText.length))
        const m = n > bodyText.length ? metaText.slice(0, n - bodyText.length) : ''
        bodyEl.textContent = b
        if (n < total) bodyEl.appendChild(caret)
        metaEl.textContent = m
        if (n < total) typeRAF = requestAnimationFrame(step)
      }
      typeRAF = requestAnimationFrame(step)
    }

    function toggle(id) {
      const def = BLOCKS[id]
      const opening = open !== id
      if (open) {
        BLOCKS[open].meshes.forEach((m) => gsap.to(m.position, {
          x: m.userData.home.x, y: m.userData.home.y, z: m.userData.home.z,
          duration: 0.6, ease: 'power3.inOut',
        }))
      }
      open = opening ? id : null

      if (opening) {
        const dir = new THREE.Vector3(def.col.x, 0, def.col.z).normalize().multiplyScalar(0.9)
        def.meshes.forEach((m, i) => gsap.to(m.position, {
          x: m.userData.home.x + dir.x, y: m.userData.home.y + 1.25, z: m.userData.home.z + dir.z,
          duration: 0.7, ease: 'back.out(1.4)', delay: i * 0.05,
        }))
      }

      stateNameRef.current.textContent = open ? def.title.toLowerCase() : '1'

      if (open) {
        introRef.current.style.display = 'none'
        detailRef.current.classList.add(s.on); closeRef.current.classList.add(s.on)
        titleRef.current.textContent = def.title
        setTimeout(() => typeInto(bodyRef.current, metaRef.current, def.body, def.meta), 180)
      } else {
        cancelAnimationFrame(typeRAF)
        detailRef.current.classList.remove(s.on); closeRef.current.classList.remove(s.on)
        setTimeout(() => { if (!open) introRef.current.style.display = '' }, 200)
      }
    }

    const onClick = () => { if (hovered) toggle(hovered); else if (open) toggle(open) }
    const onCloseClick = () => { if (open) toggle(open) }
    const onKeydown = (e) => { if (e.key === 'Escape' && open) toggle(open) }

    stage.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('click', onClick)
    closeRef.current.addEventListener('click', onCloseClick)
    window.addEventListener('keydown', onKeydown)

    const v = new THREE.Vector3()
    function drawLeader() {
      const r = rect()
      if (!open || r.width < 820) { pathRef.current.setAttribute('d', ''); dotRef.current.setAttribute('r', 0); return }
      const m = BLOCKS[open].meshes[1]
      v.set(0.5, -0.1, 0.45).applyMatrix4(m.matrixWorld).project(camera)
      const ax = ((v.x + 1) / 2) * r.width
      const ay = ((1 - v.y) / 2) * r.height
      const t = titleRef.current.getBoundingClientRect()
      const tx = t.left - r.left - 22, ty = t.top - r.top + t.height / 2
      pathRef.current.setAttribute('d', `M ${ax} ${ay} C ${ax + 60} ${ay}, ${tx - 60} ${ty}, ${tx} ${ty}`)
      dotRef.current.setAttribute('cx', ax); dotRef.current.setAttribute('cy', ay); dotRef.current.setAttribute('r', 3)
    }

    function resize() {
      const r = rect()
      if (!r.width || !r.height) return
      renderer.setSize(r.width, r.height, false)
      camera.aspect = r.width / r.height
      camera.updateProjectionMatrix()
      svgRef.current.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`)
      const narrow = r.width < 820
      camera.position.z = narrow ? 12.5 : 9.5
      camera.position.x = narrow ? 0 : 1.9
      camera.lookAt(narrow ? 0 : 1.9, narrow ? 0.6 : 0, 0)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(stage)
    resize()

    const clock = new THREE.Clock()
    function tick() {
      if (!alive) return
      const t = clock.getElapsedTime()
      rig.rotation.x += (target.x - rig.rotation.x) * 0.06
      rig.rotation.y += (target.y - rig.rotation.y) * 0.06
      if (!reduce) cube.position.y = Math.sin(t * 0.8) * 0.04
      renderer.render(scene, camera)
      drawLeader()
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      alive = false
      boundary.kill()
      cancelAnimationFrame(raf)
      cancelAnimationFrame(typeRAF)
      ro.disconnect()
      stage.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('click', onClick)
      closeRef.current?.removeEventListener('click', onCloseClick)
      window.removeEventListener('keydown', onKeydown)
      geo.dispose()
      blocks.forEach((b) => b.material.dispose())
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
    }
  }, [reduce])

  return (
    <section ref={stageRef} id="s6" className={`${s.stage} relative h-screen overflow-hidden`}>
      <div className="absolute left-6 top-8 z-20 md:left-14 md:top-10">
        <SectionMarker n="06" title="Modularity" />
      </div>

      <div ref={hostRef} className="absolute inset-0 z-[1] [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full" />

      <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-[2]" aria-hidden>
        <path ref={pathRef} fill="none" stroke="rgba(45,66,116,.6)" strokeWidth="1.2" />
        <circle ref={dotRef} r="0" fill="#2d4274" />
      </svg>

      <div className="section-frame pointer-events-none absolute inset-8 z-[3]" aria-hidden />

      <div className={`${s.rail} pointer-events-none absolute inset-y-0 right-0 z-20 flex w-full flex-col justify-between px-6 py-[9vh] md:w-[38vw] md:px-[6vw]`}>
        <div className={`${s.stateLabel} pointer-events-auto`}>State <span ref={stateNameRef}>1</span></div>

        <div className="pointer-events-auto">
          <div ref={introRef} className={s.copy}>
            <h2>A Rhodex bond runs itself. From the moment capital is raised to maturity or trigger, every step is automated.</h2>
            <p>Click a block to see what it does.</p>
          </div>
          <div ref={detailRef} className={s.detail} role="status" aria-live="polite">
            <h3 ref={titleRef} />
            <div ref={bodyRef} className={s.body} />
            <div ref={metaRef} className={s.meta} />
            <button ref={closeRef} className={s.close} type="button">Back to state 1</button>
          </div>
        </div>

        <div className={`${s.hint} pointer-events-none`}>Click a block · move to rotate</div>
        {/* snake terminus: the path ends here, at the last section */}
        <span data-snake-terminus className="absolute bottom-8 right-8" aria-hidden />
      </div>
    </section>
  )
}
