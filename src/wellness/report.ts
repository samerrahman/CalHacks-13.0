import { METRICS, type ExpressionValue, type HrvValues, type Metric, type SignalObservation, type SignalSource, type SignalValue } from './signals';

// Window lengths come from the SmartSpectra model cards. Confidence cutoffs are
// conservative display gates; they are not clinical thresholds.
const WARMUP_MS: Record<Metric, number> = {
  pulse: 12_000, breathingRate: 30_000, chestWave: 30_000, abdomenWave: 30_000,
  hrv: 60_000, blink: 0, talking: 0, expression: 0, edaProxy: 35_000, arterialWave: 12_000,
};
const MIN_CONFIDENCE: Partial<Record<Metric, number>> = { pulse: 80, breathingRate: 45, hrv: 50, arterialWave: 40 };
const MAX_GAP_MS = 5000;

type MetricState = {
  validMs: number;
  samples: number;
  lastAtMs: number | null;
  latest: SignalValue;
  sum: number;
  min: number;
  max: number;
  events: number;
  eventActive: boolean;
};

export type MetricSummary = {
  available: boolean;
  validSeconds: number;
  samples: number;
  latest: SignalValue;
  mean: number | null;
  min: number | null;
  max: number | null;
  events: number;
};
export type ReportSnapshot = {
  source: SignalSource | 'none';
  pulseBaselineBpm: number | null;
  metrics: Record<Metric, MetricSummary>;
};

function emptyState(): MetricState {
  return { validMs: 0, samples: 0, lastAtMs: null, latest: null, sum: 0, min: Infinity, max: -Infinity, events: 0, eventActive: false };
}
function isHrv(value: SignalValue): value is HrvValues {
  return typeof value === 'object' && value !== null && 'rmssd' in value
    && Number.isFinite(value.rmssd) && value.rmssd > 0
    && Number.isFinite(value.meanNn) && value.meanNn > 0
    && Number.isFinite(value.sdnn) && value.sdnn >= 0
    && Number.isFinite(value.baevsky) && value.baevsky >= 0;
}
function isExpression(value: SignalValue): value is ExpressionValue {
  return typeof value === 'object' && value !== null && 'label' in value
    && typeof value.label === 'string' && Number.isFinite(value.score) && value.score >= 60 && value.score <= 100;
}
function validValue(metric: Metric, value: SignalValue): boolean {
  if (metric === 'pulse') return typeof value === 'number' && Number.isFinite(value) && value >= 40 && value <= 110;
  if (metric === 'breathingRate') return typeof value === 'number' && Number.isFinite(value) && value >= 5 && value <= 40;
  if (metric === 'hrv') return isHrv(value);
  if (metric === 'blink' || metric === 'talking') return typeof value === 'boolean';
  if (metric === 'expression') return isExpression(value);
  return value === true; // Only a valid waveform/proxy marker crosses the adapter.
}

export class WellnessSession {
  private startedAtMs: number | null = null;
  private states = Object.fromEntries(METRICS.map(metric => [metric, emptyState()])) as Record<Metric, MetricState>;
  private sources = new Set<SignalSource>();
  private pulseBaselineBpm: number | null = null;

  reset(startedAtMs: number): void {
    this.startedAtMs = startedAtMs;
    this.states = Object.fromEntries(METRICS.map(metric => [metric, emptyState()])) as Record<Metric, MetricState>;
    this.sources.clear();
    this.pulseBaselineBpm = null;
  }

  finish(): void { this.startedAtMs = null; }

  add(observation: SignalObservation): boolean {
    const started = this.startedAtMs;
    if (started === null) return false;
    this.sources.add(observation.source);
    const state = this.states[observation.metric];
    const age = observation.receivedAtMs - (observation.measuredAtMs ?? NaN);
    const threshold = MIN_CONFIDENCE[observation.metric];
    const confidenceOk = threshold === undefined || (observation.source === 'simulated' && observation.confidence === null)
      || (observation.confidence !== null && Number.isFinite(observation.confidence) && observation.confidence >= threshold && observation.confidence <= 100);
    const parent = observation.metric === 'hrv' || observation.metric === 'arterialWave' ? this.states.pulse
      : observation.metric === 'chestWave' || observation.metric === 'abdomenWave' ? this.states.breathingRate : null;
    const parentAge = parent?.lastAtMs === null || !parent ? null : observation.receivedAtMs - parent.lastAtMs;
    const parentOk = !parent || (parentAge !== null && parentAge >= 0 && parentAge <= MAX_GAP_MS);
    if (!observation.validationOk || !observation.stable || !confidenceOk || !parentOk
      || observation.captureElapsedMs < WARMUP_MS[observation.metric]
      || observation.receivedAtMs - started < WARMUP_MS[observation.metric]
      || !Number.isFinite(age) || age < -1000 || age > MAX_GAP_MS
      || observation.measuredAtMs! < started || observation.measuredAtMs! <= (state.lastAtMs ?? -Infinity)
      || !validValue(observation.metric, observation.value)) {
      if (observation.metric === 'blink' || observation.metric === 'talking') state.eventActive = false;
      return false;
    }
    if (state.lastAtMs !== null) {
      const delta = observation.measuredAtMs! - state.lastAtMs;
      if (delta <= MAX_GAP_MS) state.validMs += delta;
    }
    state.lastAtMs = observation.measuredAtMs;
    state.samples++;
    state.latest = observation.value;
    if (typeof observation.value === 'number') {
      state.sum += observation.value;
      state.min = Math.min(state.min, observation.value);
      state.max = Math.max(state.max, observation.value);
      if (observation.metric === 'pulse' && this.pulseBaselineBpm === null && state.validMs >= 30_000) {
        this.pulseBaselineBpm = state.sum / state.samples;
      }
    }
    if (observation.metric === 'blink' || observation.metric === 'talking') {
      if (observation.value === true && !state.eventActive) state.events++;
      state.eventActive = observation.value === true;
    }
    return true;
  }

  snapshot(): ReportSnapshot {
    const metrics = Object.fromEntries(METRICS.map(metric => {
      const state = this.states[metric];
      const available = state.samples > 0 && (metric !== 'pulse' || this.pulseBaselineBpm !== null);
      return [metric, {
        available, validSeconds: Math.round(state.validMs / 1000), samples: state.samples,
        latest: available ? state.latest : null,
        mean: available && (metric === 'pulse' || metric === 'breathingRate') ? state.sum / state.samples : null,
        min: available && Number.isFinite(state.min) ? state.min : null,
        max: available && Number.isFinite(state.max) ? state.max : null,
        events: state.events,
      }];
    })) as Record<Metric, MetricSummary>;
    return { source: this.sources.has('simulated') ? 'simulated' : this.sources.has('presage') ? 'presage' : 'none', pulseBaselineBpm: this.pulseBaselineBpm, metrics };
  }
}
