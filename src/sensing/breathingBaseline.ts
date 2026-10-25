import { FRESHNESS_MS } from './types';
import { METRIC_POLICY } from './metricPolicy';

/** Personal resting breathing rate: the median of accepted, distinct breathing
 * estimates over a continuous span. Frozen once set, like the pulse baseline,
 * so a later fast-breathing stretch never moves it. Local only; the game sees
 * a rounded value and providers/traces never see it. */
export class BreathingBaseline {
  static readonly SPAN_MS = 15_000;
  value: number | null = null;
  private samples: number[] = [];
  private firstAt: number | null = null;
  private lastAt: number | null = null;

  add(rpm: number | null, measuredAtMs: number | null): void {
    if (this.value !== null) return;
    const [min, max] = METRIC_POLICY.breathing.range;
    if (rpm === null || measuredAtMs === null || !Number.isFinite(rpm) || !Number.isFinite(measuredAtMs) || rpm < min || rpm > max) { this.discardContinuity(); return; }
    if (this.lastAt !== null) {
      if (measuredAtMs <= this.lastAt) return;
      if (measuredAtMs - this.lastAt > FRESHNESS_MS) { this.samples = []; this.firstAt = null; }
    }
    this.firstAt ??= measuredAtMs;
    this.lastAt = measuredAtMs;
    this.samples.push(rpm);
    if (measuredAtMs - this.firstAt >= BreathingBaseline.SPAN_MS && this.samples.length >= 3) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.value = sorted[Math.floor(sorted.length / 2)] ?? null;
    }
  }
  discardContinuity(): void { this.samples = []; this.firstAt = null; this.lastAt = null; }
  reset(): void { this.value = null; this.discardContinuity(); }
}
