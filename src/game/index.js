import * as THREE from 'three'
import { DIRECTOR_MENU } from '../../shared/types/director.js'
import { signalBus } from '../signals/index.js'

/** @typedef {import('../../shared/types/director.js').DirectorRequest} DirectorRequest */

const DIRECTOR_INTERVAL_MS = 8000

// Placeholder booth: primitives until real models land in assets/manifest.json.
/** @param {string} parentId id of the DOM element to mount into */
export function startGame(parentId) {
  const parent = document.getElementById(parentId)
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  parent.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x05060a)
  scene.fog = new THREE.Fog(0x05060a, 3, 12)

  // Meters, Y up. Seated eye height looking at the desk.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 1.65, 1.4)
  camera.lookAt(0, 1.1, -1.7)

  scene.add(new THREE.AmbientLight(0x2a3a40, 0.6))
  const lamp = new THREE.PointLight(0xffd27a, 4, 6)
  lamp.position.set(-0.6, 1.35, -1.5)
  scene.add(lamp)

  const box = (w, h, d, color, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
    mesh.position.set(x, y, z)
    scene.add(mesh)
    return mesh
  }
  box(8, 0.05, 6, 0x1b2224, 0, 0, 0) // floor
  box(2.4, 0.08, 0.9, 0x2a1d14, 0, 0.9, -1.7) // desk
  box(0.08, 0.4, 0.08, 0x6b5a3a, -0.6, 1.14, -1.5) // lamp post
  box(0.45, 0.22, 0.2, 0x3a3a3a, 0.6, 1.05, -1.7) // radio

  const status = document.createElement('div')
  status.style.cssText = 'position:fixed;top:8px;right:12px;font:13px ui-monospace,monospace;color:#c9b;z-index:10'
  status.textContent = 'director: waiting…'
  document.body.appendChild(status)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = parent
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(parent)
  resize()

  renderer.setAnimationLoop(() => {
    // Lamp breathes with the player — proves signals reach the render loop.
    const frame = signalBus.latest()
    if (frame) lamp.intensity = 3 + 1.5 * (frame.breath + 1)
    renderer.render(scene, camera)
  })

  const nightStartedAt = Date.now()
  const askDirector = async () => {
    const frame = signalBus.latest()
    /** @type {DirectorRequest} */
    const req = {
      night: 1,
      elapsedMs: Date.now() - nightStartedAt,
      player: {
        pulseBpm: frame?.pulseBpm ?? null,
        baselinePulseBpm: frame?.baselinePulseBpm ?? null,
        fear: frame?.fear ?? 0,
        breathRate: frame?.breathRate ?? null,
        blinksPerMin: 0,
        talkingRatio: 0,
        faceDetected: frame?.faceDetected ?? false,
      },
      resources: { lampOn: true, radioOn: false, oil: 1 },
      activeCreatures: [],
      recentEvents: [],
      menu: [...DIRECTOR_MENU],
    }
    const res = await window.scary.director.decide(req)
    status.textContent = `director: ${res.event} (${res.source}) — ${res.reason}`
  }
  const directorTimer = setInterval(askDirector, DIRECTOR_INTERVAL_MS)

  return () => {
    clearInterval(directorTimer)
    observer.disconnect()
    renderer.setAnimationLoop(null)
    renderer.dispose()
    renderer.domElement.remove()
    status.remove()
  }
}
