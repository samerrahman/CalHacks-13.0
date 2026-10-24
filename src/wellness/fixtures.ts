import type { NativeWellnessMetrics, SignalObservation, Metric, SignalValue } from './signals';

export const COMPLETE_SIGNAL_FIXTURE_LABEL = 'SIMULATED COMPLETE-SIGNAL DEVELOPMENT FIXTURE';

/** Test input only. Every value is explicitly simulated and never a camera measurement. */
export function completeSignalFixture(): SignalObservation[] {
  const make = (metric: Metric, time: number, value: SignalValue, confidence: number | null = null): SignalObservation => ({
    metric, source: 'simulated', receivedAtMs: time, measuredAtMs: time, captureElapsedMs: time,
    validationOk: true, stable: true, confidence, value,
  });
  const observations: SignalObservation[] = [];
  for (let time = 12_000; time <= 70_000; time += 1000) observations.push(make('pulse', time, time < 45_000 ? 70 : 76, 90));
  for (let time = 30_000; time <= 70_000; time += 1000) observations.push(make('breathingRate', time, time < 50_000 ? 14 : 16, 75));
  observations.push(
    make('chestWave', 70_000, true), make('abdomenWave', 70_000, true),
    make('hrv', 70_000, { rmssd: 42, meanNn: 850, sdnn: 55, baevsky: 1.2 }, 70),
    make('blink', 70_000, true), make('blink', 71_000, false), make('blink', 72_000, true),
    make('talking', 70_000, true),
    make('expression', 70_000, { label: 'neutral', score: 88 }),
    make('edaProxy', 70_000, true), make('arterialWave', 70_000, true, 70),
  );
  return observations.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
}

/** Decoded Node/Electron SDK shape, including fields the current bridge does not yet request. */
export function completeNativePayloadFixture(wallMs: number): NativeWellnessMetrics {
  const timestamp = wallMs * 1000;
  const measurement = (value: number, confidence?: number) => ({ value, stable: true, confidence, timestamp });
  return {
    cardio: { pulseRate: [measurement(74, 90)], arterialPressureTrace: [measurement(0.42, 80)], hrv: [{ ...measurement(0, 70), rmssd: 42, meanNn: 850, sdnn: 55, baevsky: 1.2 }] },
    breathing: { rate: [measurement(15, 75)], upperTrace: [measurement(0.3)], lowerTrace: [measurement(0.2)] },
    eda: { trace: [measurement(0.1)] },
    face: { blinking: [{ detected: true, stable: true, timestamp }], talking: [{ detected: false, stable: true, timestamp }], expression: [{ stable: true, timestamp, scores: [{ type: 6, confidence: 88 }, { type: 4, confidence: 5 }] }] },
  };
}
