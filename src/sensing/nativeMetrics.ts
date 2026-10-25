import { measurementTimestamp, normalizePresage, type NativeMeasurement, type NativeMetrics } from './presageSample';
import { FRESHNESS_MS, type SensorDiagnosticMetric, type SensorDiagnostics, type SensorSample } from './types';
import { METRIC_POLICY, validationBlocksMetric, type MetricKind } from './metricPolicy';

type Reading = { measurement: NativeMeasurement; received: number; measured: number | null; validationCode: number | null; invalidated: boolean; intervalMs: number | null };
const statuses: SensorDiagnostics['processingStatus'][] = ['uninitialized', 'idle', 'starting', 'running', 'stopping', 'error'];

/** Merges independent SDK streams. An empty metrics packet is not a rejected
 * pulse, and must not erase a valid pulse or interrupt calibration continuity. */
export class NativeMetricStream {
  processingStatus: SensorDiagnostics['processingStatus'] = 'uninitialized';
  validation = { code: null as number | null, hint: 'Waiting for capture validation' };
  firstFrameAt: number | null = null;
  metricsPackets = 0;
  pulseSamples = 0;
  breathingSamples = 0;
  framesSentThrough = 0;
  framesRejected = 0;
  lastMetricAt: number | null = null;
  failure: string | null = null;
  private pulse: Reading | null = null;
  private breathing: Reading | null = null;
  private frameTimes: number[] = [];
  private lastFrameAt: number | null = null;

  processing(code: number): void { this.processingStatus = statuses[code] ?? 'error'; }
  setValidation(code: number, hint: string): void {
    this.validation = { code, hint };
    if (this.pulse && validationBlocksMetric(code, 'pulse')) this.pulse.invalidated = true;
    if (this.breathing && validationBlocksMetric(code, 'breathing')) this.breathing.invalidated = true;
  }
  frame(sent: boolean, timestampUs: number, now: number): void {
    if (!sent) { this.framesRejected++; return; }
    this.framesSentThrough++;
    this.firstFrameAt ??= now;
    this.lastFrameAt = now;
    if (Number.isFinite(timestampUs) && timestampUs > (this.frameTimes.at(-1) ?? 0)) {
      this.frameTimes.push(timestampUs);
      this.frameTimes = this.frameTimes.filter(time => timestampUs - time <= 3_000_000).slice(-120);
    }
  }
  private latest(values: NativeMeasurement[] | null | undefined, previous: Reading | null, now: number, wall: number): Reading | null {
    if (!values?.length) return null;
    const latest = values.reduce((a, b) => (measurementTimestamp(b) ?? 0) >= (measurementTimestamp(a) ?? 0) ? b : a);
    const stamp = measurementTimestamp(latest), prior = previous && measurementTimestamp(previous.measurement);
    // Duplicate/older packets never refresh age or accumulate usable seconds.
    if (stamp !== null && prior !== null && prior !== undefined && stamp <= prior) return null;
    return { measurement: { ...latest }, received: now, measured: stamp === null ? null : now - (wall - stamp / 1000), validationCode: this.validation.code, invalidated: false, intervalMs: stamp !== null && prior !== null && prior !== undefined ? (stamp - prior) / 1000 : null };
  }
  ingest(metrics: NativeMetrics, now: number, wall: number): SensorSample | null {
    this.metricsPackets++; this.lastMetricAt = now;
    const pulse = this.latest(metrics.cardio?.pulseRate, this.pulse, now, wall);
    const breathing = this.latest(metrics.breathing?.rate, this.breathing, now, wall);
    if (breathing) { this.breathing = breathing; this.breathingSamples++; }
    if (!pulse) return null;
    this.pulse = pulse; this.pulseSamples++;
    return normalizePresage({ cardio: { pulseRate: [pulse.measurement] } }, now, wall, this.firstFrameAt ?? now, this.validation);
  }
  private metric(reading: Reading | null, now: number, kind: MetricKind, active: boolean): SensorDiagnosticMetric {
    const { warmupSeconds: seconds, range, confidence: threshold } = METRIC_POLICY[kind];
    const warm = this.firstFrameAt === null || now - this.firstFrameAt < seconds * 1000;
    const ageMs = reading?.measured !== null && reading?.measured !== undefined ? now - reading.measured : null;
    const measurement = reading?.measurement;
    const confidence = typeof measurement?.confidence === 'number' && Number.isFinite(measurement.confidence) ? measurement.confidence : null;
    const stable = typeof measurement?.stable === 'boolean' ? measurement.stable : null;
    const value = typeof measurement?.value === 'number' && Number.isFinite(measurement.value) ? measurement.value : null;
    const reasons: string[] = [];
    if (!active) reasons.push('Capture is off');
    if (this.processingStatus !== 'running') reasons.push(`Native processing: ${this.processingStatus}`);
    const validationBlocked = validationBlocksMetric(this.validation.code, kind);
    if (validationBlocked) reasons.push(this.validation.hint);
    if (warm) reasons.push(`Waiting for the ${seconds}-second analysis window`);
    if (!reading) reasons.push('No estimate received');
    else {
      if (!validationBlocked && (validationBlocksMetric(reading.validationCode, kind) || reading.invalidated)) reasons.push('Waiting for a fresh estimate after capture validation');
      if (!warm && (this.firstFrameAt === null || reading.received - this.firstFrameAt < seconds * 1000)) reasons.push('Waiting for a fresh estimate after warmup');
      if (value === null || value < range[0] || value > range[1]) reasons.push(`Outside supported range (${range[0]}–${range[1]})`);
      if (stable !== true) reasons.push('Capture is not stable');
      if (confidence === null || confidence < threshold || confidence > 100) reasons.push(`${kind === 'pulse' ? 'Pulse' : 'Breathing'} confidence below SDK threshold (${threshold}/100)`);
      if (ageMs === null || ageMs > FRESHNESS_MS || ageMs < -1000 || now - reading.received > FRESHNESS_MS) reasons.push('Missing or stale measurement timestamp');
    }
    const stale = !!reading && (ageMs === null || ageMs > FRESHNESS_MS || ageMs < -1000 || now - reading.received > FRESHNESS_MS);
    const eligible = reasons.length === 0;
    return { bpm: active && !warm && value !== null && value > 0 ? value : null, confidence, stable, ageMs, eligible, requiredConfidence: threshold,
      receivedAgeMs: reading ? Math.max(0, now - reading.received) : null, updateIntervalMs: reading?.intervalMs ?? null, sampleCount: kind === 'pulse' ? this.pulseSamples : this.breathingSamples,
      state: !active ? 'waiting' : warm ? 'warming-up' : !reading ? 'waiting' : stale ? 'stale' : eligible ? 'accepted' : 'rejected', reasons };
  }
  view(now: number, captureState: SensorDiagnostics['captureState']): SensorDiagnostics {
    const active = captureState === 'live';
    const pulse = this.metric(this.pulse, now, 'pulse', active);
    const breathing = this.metric(this.breathing, now, 'breathing', active);
    const remaining = (seconds: number) => this.firstFrameAt === null ? seconds : Math.max(0, Math.ceil(seconds - (now - this.firstFrameAt) / 1000));
    const frameSpan = this.frameTimes.length > 1 ? this.frameTimes.at(-1)! - this.frameTimes[0]! : 0;
    const lastFrameAge = this.lastFrameAt === null ? Infinity : now - this.lastFrameAt;
    return { captureState, processingStatus: this.processingStatus, validationCode: this.validation.code, validationHint: this.validation.hint,
      warmupRemainingSeconds: remaining(12), breathingWarmupRemainingSeconds: remaining(30), metricsPackets: this.metricsPackets,
      pulseSamples: this.pulseSamples, breathingSamples: this.breathingSamples, framesSentThrough: this.framesSentThrough, framesRejected: this.framesRejected,
      frameRate: active && frameSpan > 0 && lastFrameAge <= 3000 ? (this.frameTimes.length - 1) * 1_000_000 / frameSpan : null,
      lastFrameAgeMs: this.lastFrameAt === null ? null : Math.max(0, lastFrameAge),
      lastMetricAgeMs: this.lastMetricAt === null ? null : Math.max(0, now - this.lastMetricAt), pulse, breathing,
      blocker: this.failure ?? (pulse.eligible ? null : pulse.reasons[0] ?? 'Waiting for pulse estimate') };
  }
}
