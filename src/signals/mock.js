import { SIGNAL_HZ } from '../../shared/types/signals.js'
import { signalBus } from './bus.js'

/** Keyboard controls for the mock source. Digits so they don't collide with game keys. */
export const MOCK_KEYS = [
  ['1', 'raise pulse'],
  ['2', 'blink'],
  ['3', 'hold breath (hold key)'],
  ['4', 'talk (hold key)'],
  ['5', 'fear spike'],
  ['0', 'toggle face lost'],
]

const BOOST_HALF_LIFE_S = 8

/**
 * Fake SignalFrames at SIGNAL_HZ so everyone can build without a camera.
 * @param {{ baselineBpm?: number }} [options]
 * @returns {() => void} stop
 */
export function startMockSignals({ baselineBpm = 72 } = {}) {
  let pulseBoost = 0
  let fearBoost = 0
  let breathPhase = 0
  let breath = 0
  let holding = false
  let talking = false
  let faceDetected = true
  let blinkQueued = false
  let nextNaturalBlink = 0

  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.repeat) return
    switch (e.code) {
      case 'Digit1': pulseBoost = Math.min(pulseBoost + 20, 70); break
      case 'Digit2': blinkQueued = true; break
      case 'Digit3': holding = true; break
      case 'Digit4': talking = true; break
      case 'Digit5': fearBoost = Math.min(fearBoost + 0.4, 0.9); break
      case 'Digit0': faceDetected = !faceDetected; break
    }
  }
  /** @param {KeyboardEvent} e */
  const onKeyUp = (e) => {
    if (e.code === 'Digit3') holding = false
    if (e.code === 'Digit4') talking = false
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const dt = 1 / SIGNAL_HZ
  const decay = Math.pow(0.5, dt / BOOST_HALF_LIFE_S)

  const timer = setInterval(() => {
    const now = Date.now()
    pulseBoost *= decay
    fearBoost *= decay

    const breathRate = holding ? null : 14 + pulseBoost * 0.1
    if (breathRate !== null) {
      breathPhase += 2 * Math.PI * (breathRate / 60) * dt
      breath = Math.sin(breathPhase)
    }

    const blink = blinkQueued || now >= nextNaturalBlink
    if (blink) {
      blinkQueued = false
      nextNaturalBlink = now + 2500 + Math.random() * 3000
    }

    const confidence = faceDetected ? 0.9 : 0
    signalBus.publish({
      t: now,
      source: 'mock',
      faceDetected,
      pulseBpm: faceDetected ? Math.round((baselineBpm + pulseBoost + (Math.random() - 0.5) * 2) * 10) / 10 : null,
      pulseConfidence: confidence,
      breath,
      breathRate: faceDetected ? breathRate : null,
      breathHeld: holding,
      breathConfidence: confidence,
      hrvMs: faceDetected ? Math.max(10, 50 - pulseBoost * 0.5) : null,
      blink: faceDetected && blink,
      talking,
      fear: Math.min(1, 0.1 + fearBoost + pulseBoost / 150),
      baselinePulseBpm: baselineBpm,
    })
  }, 1000 / SIGNAL_HZ)

  return () => {
    clearInterval(timer)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}
