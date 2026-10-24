import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CameraPanel from '../../src/ui/CameraPanel';
import CornerVitals from '../../src/ui/CornerVitals';
import { resumeSensorCapture } from '../../src/ui/sensorHandoff';
import type { SensorView } from '../../src/sensing/types';
import { NativeMetricStream } from '../../src/sensing/nativeMetrics';
import WirePuzzle from '../../src/ui/WirePuzzle';
import '../../src/ui/style.css';
import '../../src/ui/survival.css';

// Test-only entry point. It never imports App, starts the SDK, or requests a camera.
const initial: SensorView = {
  source: 'presage', status: 'calibrating', trend: 'UNKNOWN', quality: 'accepted',
  hint: 'TEST FIXTURE — synthetic accepted sample; no live Presage or camera',
  baselineBpm: null, pulseBpm: 72, ageMs: 0, acceptedSeconds: 29,
  canContinueManual: true, sampleAtMs: 1000, captureSegment: 1,
};
function metricFixture(ageMs = 0) {
  const metrics = new NativeMetricStream(), wall = 1_790_000_000_000;
  metrics.processing(3); metrics.setValidation(0, 'Test framing accepted'); metrics.frame(true, wall * 1000, 0);
  metrics.ingest({ cardio: { pulseRate: [{ value: 84, confidence: 50, stable: true, timestamp: (wall + 30_000) * 1000 }] }, breathing: { rate: [{ value: 16, confidence: 50, stable: true, timestamp: (wall + 30_000) * 1000 }] } }, 30_000, wall + 30_000);
  return metrics.view(30_000 + ageMs, 'live');
}

function VitalsFixture() {
  const [sensor, setSensor] = useState<SensorView>(initial);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [playing, setPlaying] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const [wires, setWires] = useState({ targetOrder: [2, 0, 3, 1], connections: [-1, -1, -1, -1] });
  const [additionalStarts, setAdditionalStarts] = useState(0);
  const [handoffs, setHandoffs] = useState(0);
  const [stopped, setStopped] = useState(false);
  const stopCapture = useRef<() => void>(() => {});
  const controller = useRef({ start: async () => { setAdditionalStarts(value => value + 1); } });

  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d')!;
    let frame = 0, stopped = false, raf = 0;
    const draw = () => {
      if (stopped) return;
      context.fillStyle = '#10241d'; context.fillRect(0, 0, 640, 360);
      context.strokeStyle = '#325645'; context.lineWidth = 1;
      for (let x = 0; x < 640; x += 40) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 360); context.stroke(); }
      for (let y = 0; y < 360; y += 40) { context.beginPath(); context.moveTo(0, y); context.lineTo(640, y); context.stroke(); }
      context.fillStyle = '#8fa97d'; context.beginPath(); context.arc(320 + Math.sin(frame / 30) * 25, 125, 47, 0, Math.PI * 2); context.fill();
      context.fillRect(255, 185, 130, 110); context.fillStyle = '#fff0cd'; context.font = '22px monospace'; context.textAlign = 'center';
      context.fillText('SYNTHETIC TEST VIDEO', 320, 32); context.fillText('NO CAMERA / NO LIVE SENSOR', 320, 336);
      frame++; raf = requestAnimationFrame(draw);
    };
    draw();
    const generated = canvas.captureStream(12);
    const stop = () => { stopped = true; cancelAnimationFrame(raf); generated.getTracks().forEach(track => track.stop()); };
    stopCapture.current = stop; setStream(generated);
    return stop;
  }, []);

  const stop = () => {
    stopCapture.current(); setStream(null); setStopped(true);
    setSensor(value => ({ ...value, source: 'manual', status: 'manual', quality: 'unknown', trend: 'UNKNOWN', pulseBpm: null, sampleAtMs: null, hint: 'TEST FIXTURE — synthetic capture stopped' }));
  };
  const enter = () => {
    resumeSensorCapture(controller.current, sensor, 'presage', true);
    setHandoffs(value => value + 1); setPlaying(true);
  };
  return <div className={playing ? 'fixture-playing' : 'fixture-calibrating'}>
    <header className="fixture-banner">TEST FIXTURE · SYNTHETIC VIDEO + PULSE · NOT LIVE PRESAGE</header>
    <main className="fixture-controls">
      <h1>{playing ? 'Synthetic in-game handoff' : 'Synthetic calibration fixture'}</h1>
      <p className="fixture-note">Real UI components, a canvas-generated video stream, and explicit test samples. No webcam permission, SDK session, or live physiological measurement.</p>
      <output className="fixture-state" data-testid="fixture-state">{`Additional capture starts: ${additionalStarts}\nCalibrated handoffs: ${handoffs}\nSynthetic stream: ${stopped ? 'stopped' : stream ? 'running' : 'starting'}`}</output>
      <div className="fixture-actions">
        {!playing && <button onClick={() => setSensor(value => ({ ...value, status: 'ready', baselineBpm: 72, acceptedSeconds: 30, trend: 'STEADY' }))}>Complete 30-second test calibration</button>}
        {playing && <><button onClick={() => setSensor(value => ({ ...value, status: 'ready', quality: 'accepted', pulseBpm: 84, ageMs: 0, trend: 'ELEVATED', sampleAtMs: 2000 }))}>Inject accepted 84 BPM test sample</button>
          <button onClick={() => setSensor(value => ({ ...value, diagnostics: metricFixture() }))}>Inject accepted 16 breaths/min test sample</button>
          <button onClick={() => setSensor(value => ({ ...value, diagnostics: metricFixture(6000), quality: 'unknown', pulseBpm: null, ageMs: 6000, trend: 'UNKNOWN', sampleAtMs: null, hint: 'TEST FIXTURE — sample stale; no accepted reading' }))}>Expire test sample at 6 seconds</button>
          <button onClick={() => setPlaying(false)}>Return to test calibration</button>
          <button onClick={() => setTerminal(true)}>Show terminal test panel</button>
          <button onClick={stop}>Stop synthetic stream</button></>}
      </div>
      {!playing && <CameraPanel sensor={sensor} stream={stream} desktop deviceId="" onDevice={() => {}} onStart={() => { void controller.current.start(); }} onStop={stop} onReadyStart={enter}/>} 
      {playing && <CornerVitals sensor={sensor} stream={stream} onOpen={() => setPlaying(false)}/>}
      {playing && terminal && <section className="task-panel terminal-inspection" role="dialog" aria-label="Fixture terminal"><button className="inspection-close" onClick={() => setTerminal(false)}>Close terminal test panel</button><h2>Reconnect the relay.</h2><WirePuzzle wires={wires} connect={(from, to) => { if (wires.targetOrder[to] === from) setWires(value => ({ ...value, connections: value.connections.map((old, index) => index === from ? to : old) })); }}/></section>}
    </main>
  </div>;
}

createRoot(document.getElementById('fixture-root')!).render(<VitalsFixture/>);
