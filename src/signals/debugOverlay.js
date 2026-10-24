import { signalBus } from './bus.js'
import { MOCK_KEYS } from './mock.js'

/**
 * Live readout of the latest SignalFrame, top-left. Toggle with the backtick key.
 * @returns {() => void} remove
 */
export function mountSignalOverlay() {
  const el = document.createElement('pre')
  el.style.cssText =
    'position:fixed;top:8px;left:8px;margin:0;padding:8px 10px;font:12px/1.4 ui-monospace,monospace;' +
    'color:#9f9;background:rgba(0,0,0,.7);border:1px solid #363;border-radius:4px;pointer-events:none;z-index:10'
  document.body.appendChild(el)

  const legend = MOCK_KEYS.map(([key, label]) => `  ${key}  ${label}`).join('\n')
  const unsubscribe = signalBus.subscribe((f) => {
    const fmt = (v) => (v === null ? '—' : typeof v === 'number' ? v.toFixed(1) : String(v))
    el.textContent =
      `signals: ${f.source}${f.faceDetected ? '' : '  (NO FACE)'}\n` +
      `pulse    ${fmt(f.pulseBpm)} bpm  (base ${fmt(f.baselinePulseBpm)}, conf ${fmt(f.pulseConfidence)})\n` +
      `breath   ${fmt(f.breath)}  rate ${fmt(f.breathRate)}${f.breathHeld ? '  HELD' : ''}\n` +
      `hrv      ${fmt(f.hrvMs)} ms\n` +
      `fear     ${fmt(f.fear)}\n` +
      `blink ${f.blink ? '●' : '○'}  talking ${f.talking ? '●' : '○'}` +
      (f.source === 'mock' ? `\n\nmock keys:\n${legend}` : '')
  })

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (e.code === 'Backquote') el.hidden = !el.hidden
  }
  window.addEventListener('keydown', onKey)

  return () => {
    unsubscribe()
    window.removeEventListener('keydown', onKey)
    el.remove()
  }
}
