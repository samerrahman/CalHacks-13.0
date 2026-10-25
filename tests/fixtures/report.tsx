import { createRoot } from 'react-dom/client';
import PulseReport from '../../src/ui/PulseReport';
import { buildPulseReport, type BreathSample, type PulseEvent, type PulseSample } from '../../src/report/analysis';
import '../../src/ui/style.css';

// Test-only entry point: the real run report from synthetic samples (no camera, no game). Two runs:
// one like a real short loss (readings only for a short stretch), one longer with patchy coverage.
const sample = (s: number, bpm: number): PulseSample => ({ capturedAtMs: 10_000 + s * 1000, gameMs: s * 1000, segment: 1, bpm, source: 'presage', accepted: true });
const breath = (s: number, rpm: number): BreathSample => ({ capturedAtMs: 10_000 + s * 1000, gameMs: s * 1000, segment: 1, rpm, source: 'presage', accepted: true });
const event = (id: string, type: string, s: number): PulseEvent => ({ id, type, capturedAtMs: 10_000 + s * 1000, gameMs: s * 1000, segment: 1 });
const short = buildPulseReport({ recordingConsent: true, source: 'presage', baselineBpm: 73,
  samples: [81, 80, 79, 78.5, 78, 77, 76, 75, 74, 73].map((bpm, i) => sample(18 + i, bpm)),
  events: [event('a', 'MISTAKE', 6), event('b', 'MISTAKE', 6.6), event('c', 'CLOSE_ENCOUNTER', 7.1), event('d', 'MISTAKE', 7.7), event('e', 'MISTAKE', 8.6), event('f', 'QUIET', 30), event('g', 'SCARE', 42), event('h', 'SCARE', 69.5)] });
const pulses: PulseSample[] = [], breaths: BreathSample[] = [];
for (let s = 4; s < 190; s++) {
  if ((s > 40 && s < 58) || (s > 120 && s < 131) || (s % 9 === 0)) continue; // dropouts like a real capture
  pulses.push(sample(s, 72 + 6 * Math.sin(s / 17) + (s > 92 && s < 112 ? 11 * Math.exp(-(s - 95) / 8) : 0)));
  if (s > 30 && s % 2 === 0) breaths.push(breath(s, 14 + 2 * Math.sin(s / 23) + (s > 92 && s < 110 ? 4 : 0)));
}
const long = buildPulseReport({ recordingConsent: true, source: 'presage', baselineBpm: 72, restingBreathingRpm: 14, samples: pulses, breathingSamples: breaths,
  events: [event('q1', 'QUIET', 25), event('m1', 'MISTAKE', 61), event('m2', 'MISTAKE', 63), event('s1', 'SCARE', 94), event('r1', 'RECOVERY', 140), event('c1', 'CLOSE_ENCOUNTER', 150), event('l1', 'LURE_SUCCESS', 170)] });
createRoot(document.getElementById('fixture-root')!).render(<div style={{ display: 'grid', gap: 20, padding: 20, background: '#0b120d', minHeight: '100vh' }}>
  <section className="modal results" style={{ width: 'min(760px,100%)', maxHeight: 'none' }} data-testid="short"><PulseReport report={short} durationMs={70_000}/></section>
  <section className="modal results" style={{ width: 'min(760px,100%)', maxHeight: 'none' }} data-testid="long"><PulseReport report={long} durationMs={196_000}/></section>
</div>);
