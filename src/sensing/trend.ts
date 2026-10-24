import { acceptedPulse, FRESHNESS_MS, type SensorSample, type Trend } from './types';

export class TrendTracker {
  private samples: SensorSample[] = [];
  private stable: Trend = 'UNKNOWN';
  private changedAt = -Infinity;
  add(sample: SensorSample): void {
    if (this.samples.length && sample.receivedAtMs <= this.samples[this.samples.length - 1]!.receivedAtMs) return;
    this.samples.push(sample);
    this.samples = this.samples.filter(s => s.receivedAtMs >= sample.receivedAtMs - 15_000);
  }
  classify(baseline: number | null, nowMs: number, allowSimulated = false): Trend {
    if (baseline === null || !Number.isFinite(baseline)) return 'UNKNOWN';
    const recent = this.samples.filter(s => s.receivedAtMs >= nowMs - 12_500 && s.receivedAtMs <= nowMs);
    if (recent.length < 4 || recent.at(-1)!.receivedAtMs - recent[0]!.receivedAtMs < 12_000) return 'UNKNOWN';
    if (acceptedPulse(recent.at(-1)!, nowMs, allowSimulated) === null) return 'UNKNOWN';
    for (let i = 0; i < recent.length; i++) {
      if (acceptedPulse(recent[i]!, recent[i]!.receivedAtMs, allowSimulated) === null) return 'UNKNOWN';
      if (i && recent[i]!.receivedAtMs - recent[i - 1]!.receivedAtMs > FRESHNESS_MS) return 'UNKNOWN';
    }
    const elevated = recent.every(s => s.pulseBpm! - baseline >= 8);
    const recovered = recent.every(s => s.pulseBpm! - baseline < 4);
    const next: Trend = elevated ? 'ELEVATED' : recovered ? (this.stable === 'ELEVATED' ? 'RECOVERED' : 'STEADY') : this.stable;
    if (next !== this.stable && nowMs - this.changedAt >= 20_000) { this.stable = next; this.changedAt = nowMs; }
    return this.stable;
  }
  discard(): void { this.samples = []; }
  reset(): void { this.discard(); this.stable = 'UNKNOWN'; this.changedAt = -Infinity; }
}
