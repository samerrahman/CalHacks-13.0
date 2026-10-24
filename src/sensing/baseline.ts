import { acceptedPulse, FRESHNESS_MS, type SensorSample } from './types';

/** Frozen once calibrated; an elevated reading never moves the goalposts. */
export class Baseline {
  value: number | null = null;
  acceptedMs = 0;
  private samples: number[] = [];
  private lastAcceptedAt: number | null = null;

  add(sample: SensorSample, nowMs: number, allowSimulated = false): void {
    if (this.value !== null) return;
    const pulse = acceptedPulse(sample, nowMs, allowSimulated);
    if (pulse === null) { this.lastAcceptedAt = null; return; }
    if (this.lastAcceptedAt !== null) {
      const elapsed = sample.receivedAtMs - this.lastAcceptedAt;
      if (elapsed <= 0) return;
      if (elapsed <= FRESHNESS_MS) this.acceptedMs += elapsed;
    }
    this.lastAcceptedAt = sample.receivedAtMs;
    this.samples.push(pulse);
    if (this.acceptedMs >= 30_000) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.value = sorted[Math.floor(sorted.length / 2)] ?? null;
    }
  }
  discardContinuity(): void { this.lastAcceptedAt = null; }
  reset(): void { this.value = null; this.acceptedMs = 0; this.samples = []; this.lastAcceptedAt = null; }
}
