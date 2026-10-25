import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import VideoCheck from '../../src/ui/VideoCheck';
import VitalsPanel from '../../src/ui/VitalsPanel';
import { NativeMetricStream } from '../../src/sensing/nativeMetrics';
import { simulatedSignals, simulatedWaveforms } from '../../src/sensing/simulated';
import type { SensorView } from '../../src/sensing/types';
import '../../src/ui/style.css';
import '../../src/ui/survival.css';
// TEMPORARY visual fixture; not committed.
const base: SensorView = { source: 'presage', status: 'calibrating', trend: 'UNKNOWN', quality: 'unknown', hint: '', baselineBpm: null, pulseBpm: null, ageMs: null, acceptedSeconds: 0, canContinueManual: true, sampleAtMs: null, captureSegment: 1 };
const epoch = 1_790_000_000_000, us = (ms: number) => (epoch + ms) * 1000;
function presageStream(code: number) {
  const s = new NativeMetricStream(); s.processing(3); s.setValidation(0, 'ok'); s.frame(true, us(0), 0);
  for (let at = 1000; at <= 70_000; at += 1000) {
    const ticks = Array.from({ length: 10 }, (_, i) => at - 900 + i * 100);
    s.ingest({ cardio: { pulseRate: [{ value: 74, stable: true, confidence: 80, timestamp: us(at) }], arterialPressureTrace: ticks.map(t => ({ value: Math.sin(t / 130) + .4 * Math.sin(t / 65), stable: true, confidence: 70, timestamp: us(t) })) }, breathing: { rate: [{ value: 15, stable: true, confidence: 70, timestamp: us(at) }], upperTrace: ticks.map(t => ({ value: Math.sin(t / 640), stable: t < 60_000 || t > 63_000, timestamp: us(t) })), lowerTrace: ticks.map(t => ({ value: .5 * Math.sin(t / 640 - .3), stable: true, timestamp: us(t) })) },
      face: { blinking: ticks.map(t => ({ detected: t % 4000 < 200, stable: true, timestamp: us(t) })), expression: [{ stable: true, timestamp: us(at), scores: [{ type: 4, confidence: 30 }, { type: 6, confidence: 55 }, { type: 8, confidence: 15 }] }] } }, at, epoch + at);
  }
  if (code) s.setValidation(code, 'SDK fixture hint');
  return s;
}
function App() {
  const mode = location.hash.slice(1) || 'sim';
  const [now, setNow] = useState(performance.now());
  useEffect(() => { const t = setInterval(() => setNow(performance.now()), 500); return () => clearInterval(t); }, []);
  const noop = () => console.log('action');
  if (mode === 'panel-sim') return <VitalsPanel initiallyOpen sensor={{ ...base, source: 'simulated', status: 'ready', quality: 'accepted', pulseBpm: 72, signals: simulatedSignals(now) }} waves={{ waveforms: () => simulatedWaveforms(performance.now()) }} />;
  if (mode === 'panel-live') { const s = presageStream(0); return <VitalsPanel initiallyOpen sensor={{ ...base, status: 'ready', quality: 'accepted', pulseBpm: 74, diagnostics: s.view(70_000, 'live'), signals: s.signalView(70_000, 'live') }} waves={{ waveforms: () => s.waveforms(70_000) }} />; }
  const s = presageStream(mode === 'adjust' ? 5 : 0);
  const warm = new NativeMetricStream(); warm.processing(3); warm.setValidation(0, 'ok'); warm.frame(true, us(0), 0);
  const views: Record<string, [SensorView, boolean]> = {
    desktop: [base, false], camera: [{ ...base, source: 'manual', status: 'manual' }, true],
    warming: [{ ...base, diagnostics: warm.view(6000, 'live') }, true],
    adjust: [{ ...base, diagnostics: s.view(70_000, 'live') }, true],
    ok: [{ ...base, quality: 'accepted', pulseBpm: 74, acceptedSeconds: 9, diagnostics: s.view(70_000, 'live') }, true],
    failed: [{ ...base, status: 'unavailable', hint: 'Sensor error 2: Authentication failed · capture stopped' }, true],
    sim: [{ ...base, source: 'simulated', status: 'calibrating', quality: 'accepted', pulseBpm: 72 }, false],
  };
  const [view, desktop] = views[mode] ?? views.sim!;
  return <VideoCheck sensor={view} stream={null} desktop={desktop} onEnable={noop} onSimulated={noop} onSkip={noop} onContinue={noop} onBack={noop} />;
}
createRoot(document.getElementById('root')!).render(<App />);
