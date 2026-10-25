import { FRESHNESS_MS, type ExpressionName, type SensorDiagnosticMetric, type SensorDiagnostics, type SensorSignals, type SignalName, type SignalState } from './types';
import { measurementTimestamp, type NativeDetection, type NativeExpression, type NativeHrv, type NativeMeasurement, type NativeMetrics, type NativeStamp } from './presageSample';
import { METRIC_POLICY, NOT_PROVIDED_GRACE_MS, SIGNAL_POLICY, validationBlocksMetric } from './metricPolicy';

export type WavePoint = { t: number; v: number; ok: boolean };
export type WaveName = 'chest' | 'abdomen' | 'arterial' | 'eda';
/** Local display buffers. Monotonic `t` in ms; `ok` means stable, above the
 * SDK floor and not received under a blocking validation code. */
export type SensorWaveforms = { simulated: boolean; nowMs: number } & Record<WaveName, WavePoint[]>;
export type SignalContext = { captureState: SensorDiagnostics['captureState']; processing: SensorDiagnostics['processingStatus']; firstFrameAt: number | null; validation: { code: number | null; hint: string } };
type TrackName = Exclude<SignalName, 'pulse' | 'breathing'>;
type Track = { count: number; lastStamp: number | null; received: number | null; measured: number | null; reason: string | null; invalidated: boolean };
export type PhaseState = { phase: 'in' | 'out' | null; high: number | null; low: number | null };

export const WAVE_WINDOW_MS = 20_000;
export const NOT_PROVIDED = 'Not provided by this key or session';
const WAVE_CAPACITY = 900, BLINK_REFRACTORY_MS = 400, PHASE_WINDOW_MS = 12_000, SHARE_WINDOW_MS = 15_000, EDA_RECENT_MS = 10_000;
const CHEST_FRESH_MS = 3000;
export const EXPRESSION_NAMES: Record<number, ExpressionName> = { 1: 'angry', 2: 'contempt', 3: 'disgust', 4: 'fear', 5: 'happy', 6: 'neutral', 7: 'sad', 8: 'surprise' };
const round = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(4));
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const ok: SignalState = { status: 'ok', reason: '' };

/** Fixed-capacity ring; the oldest entry is overwritten. */
export class Ring<T> {
  private items: T[] = [];
  private head = 0;
  constructor(readonly capacity: number) {}
  get size(): number { return this.items.length; }
  push(item: T): void { if (this.items.length < this.capacity) this.items.push(item); else { this.items[this.head] = item; this.head = (this.head + 1) % this.capacity; } }
  last(): T | undefined { return this.items.length ? this.items[(this.head + this.items.length - 1) % this.items.length] : undefined; }
  forEach(fn: (item: T) => void): void { for (let i = 0; i < this.items.length; i++) fn(this.items[(this.head + i) % this.items.length]!); }
  toArray(): T[] { const out: T[] = []; this.forEach(item => out.push(item)); return out; }
}

/** Turning-point hysteresis: the phase flips only after the trace retreats 20%
 * of its recent peak-to-peak range from the running extreme. A rising chest
 * trace is taken as inhale; SDK 3.4 docs state no sign convention. */
export function stepBreathPhase(state: PhaseState, value: number, amplitude: number): PhaseState {
  if (!(amplitude > 1e-9) || !Number.isFinite(value)) return { phase: null, high: null, low: null };
  const h = 0.2 * amplitude;
  if (state.phase === 'in') { const high = Math.max(state.high ?? value, value); return value < high - h ? { phase: 'out', high: null, low: value } : { phase: 'in', high, low: null }; }
  if (state.phase === 'out') { const low = Math.min(state.low ?? value, value); return value > low + h ? { phase: 'in', high: value, low: null } : { phase: 'out', high: null, low }; }
  const high = Math.max(state.high ?? value, value), low = Math.min(state.low ?? value, value);
  return value > low + h ? { phase: 'in', high: value, low: null } : value < high - h ? { phase: 'out', high: null, low: value } : { phase: null, high, low };
}
/** Stable scores only, 0..1. UNSPECIFIED and out-of-range entries are dropped. */
export function expressionScores(scores: NativeExpression['scores']): Partial<Record<ExpressionName, number>> | null {
  const result: Partial<Record<ExpressionName, number>> = {};
  for (const score of scores ?? []) {
    const name = EXPRESSION_NAMES[score.type ?? 0], confidence = score.confidence;
    if (name && typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100) result[name] = Math.round(confidence) / 100;
  }
  return Object.keys(result).length ? result : null;
}
/** FEAR boosted by a quarter of SURPRISE (startle). A game estimate, not a diagnosis. */
export function fearScore(expressions: Partial<Record<ExpressionName, number>> | null): number | null {
  if (expressions?.fear === undefined) return null;
  return round(clamp(expressions.fear + 0.25 * (expressions.surprise ?? 0), 0, 1), 0.01);
}
/** SDK 3.4 states no HRV unit; its model card states accuracy in ms. Mean NN
 * identifies seconds (0.3–2) versus ms (300–2000); missing mean NN assumes ms. */
export function hrvScale(meanNn: number | null | undefined): number | null {
  if (typeof meanNn !== 'number' || !Number.isFinite(meanNn) || meanNn === 0) return 1;
  return meanNn >= 300 && meanNn <= 2000 ? 1 : meanNn >= 0.3 && meanNn <= 2 ? 1000 : null;
}
function quantile(sorted: number[], q: number): number { return sorted[Math.round((sorted.length - 1) * q)]!; }
function gate(ctx: SignalContext, warmupSeconds: number, now: number, count: number): SignalState | null {
  if (ctx.captureState === 'off') return { status: 'unavailable', reason: 'Capture is off' };
  if (ctx.processing === 'error') return { status: 'unavailable', reason: 'Native processing error' };
  if (ctx.captureState !== 'live' || ctx.processing !== 'running') return { status: 'warming', reason: ctx.captureState !== 'live' ? 'Waiting for the camera' : `Native processing: ${ctx.processing}`, secondsLeft: warmupSeconds };
  if (ctx.firstFrameAt === null) return { status: 'warming', reason: 'Waiting for the first forwarded frame', secondsLeft: warmupSeconds };
  const elapsed = now - ctx.firstFrameAt, secondsLeft = Math.max(0, Math.ceil(warmupSeconds - elapsed / 1000));
  if (!count) return elapsed >= warmupSeconds * 1000 + NOT_PROVIDED_GRACE_MS ? { status: 'unavailable', reason: NOT_PROVIDED } : { status: 'warming', reason: secondsLeft ? `Waiting for the ${warmupSeconds}-second analysis window` : 'Waiting for the first estimate', secondsLeft };
  return secondsLeft ? { status: 'warming', reason: `Waiting for the ${warmupSeconds}-second analysis window`, secondsLeft } : null;
}

/** Every non-pulse Presage signal. Like NativeMetricStream: only new SDK
 * timestamps count, NoData is not rejection, blocking validation withholds
 * current values until a fresh estimate, and >freshness gaps are stale. */
export class SignalTracker {
  private tracks: Record<TrackName, Track> = { chest: this.track(), abdomen: this.track(), arterial: this.track(), hrv: this.track(), blinking: this.track(), talking: this.track(), expressions: this.track(), eda: this.track() };
  private waves: Record<WaveName, Ring<WavePoint>> = { chest: new Ring(WAVE_CAPACITY), abdomen: new Ring(WAVE_CAPACITY), arterial: new Ring(WAVE_CAPACITY), eda: new Ring(WAVE_CAPACITY) };
  private validation: SignalContext['validation'] = { code: null, hint: '' };
  private phase: PhaseState = { phase: null, high: null, low: null };
  private hrv: SensorSignals['hrv'] = null;
  private talking: boolean | null = null;
  private expressions: SensorSignals['expressions'] = null;
  private blinks = new Ring<number>(240);
  private blink = { observedSince: null as number | null, lastStableAt: null as number | null, detected: false, lastDetectedAt: null as number | null };
  private eda = { acceptedMs: 0, lastOkAt: null as number | null, n: 0, sum: 0, sumSq: 0, mean: null as number | null, spread: null as number | null };
  private track(): Track { return { count: 0, lastStamp: null, received: null, measured: null, reason: null, invalidated: false }; }
  private blocked(chest: boolean, validation = this.validation): string | null { return validationBlocksMetric(validation.code, chest ? 'breathing' : 'pulse') ? validation.hint || 'Capture quality has not been validated' : null; }

  setValidation(code: number, hint: string): void {
    this.validation = { code, hint };
    for (const name of Object.keys(this.tracks) as TrackName[]) if (this.blocked(SIGNAL_POLICY[name].chest)) this.tracks[name].invalidated = true;
    if (this.blocked(true)) this.phase = { phase: null, high: null, low: null };
    if (this.blocked(false)) { this.blink.observedSince = null; this.blink.lastStableAt = null; this.eda.lastOkAt = null; }
  }
  private fresh<T extends { timestamp?: NativeStamp }>(name: TrackName, values: T[] | null | undefined): { item: T; stamp: number }[] {
    const prior = this.tracks[name].lastStamp;
    return (values ?? []).map(item => ({ item, stamp: measurementTimestamp(item) })).filter((entry): entry is { item: T; stamp: number } => entry.stamp !== null && (prior === null || entry.stamp > prior)).sort((a, b) => a.stamp - b.stamp);
  }
  private commit(name: TrackName, stamp: number, now: number, wall: number, reason: string | null): number | null {
    const track = this.tracks[name];
    if (track.lastStamp !== null && stamp <= track.lastStamp) return null;
    // Received under blocking validation: rejected until a later fresh estimate.
    const invalidated = this.blocked(SIGNAL_POLICY[name].chest) !== null;
    Object.assign(track, { count: track.count + 1, lastStamp: stamp, received: now, measured: now - (wall - stamp / 1000), reason: invalidated ? null : reason, invalidated });
    return track.measured;
  }
  ingest(metrics: NativeMetrics, now: number, wall: number, validation: SignalContext['validation']): void {
    this.validation = validation;
    this.wave('chest', metrics.breathing?.upperTrace, now, wall, null, point => this.onChest(point));
    this.wave('abdomen', metrics.breathing?.lowerTrace, now, wall, null);
    this.wave('arterial', metrics.cardio?.arterialPressureTrace, now, wall, SIGNAL_POLICY.arterial.confidence);
    this.wave('eda', metrics.eda?.trace, now, wall, null, point => this.onEda(point));
    this.ingestHrv(metrics.cardio?.hrv, now, wall);
    this.ingestBlinks(metrics.face?.blinking, now, wall);
    this.ingestDetections(metrics.face?.talking, now, wall);
    this.ingestExpressions(metrics.face?.expression, now, wall);
  }
  private wave(name: WaveName, values: NativeMeasurement[] | null | undefined, now: number, wall: number, threshold: number | null, after?: (point: WavePoint) => void): void {
    for (const { item, stamp } of this.fresh(name, values)) {
      if (typeof item.value !== 'number' || !Number.isFinite(item.value)) continue;
      const confidence = item.confidence;
      const reason = this.blocked(SIGNAL_POLICY[name].chest) ?? (item.stable !== true ? 'Capture is not stable' : threshold !== null && !(typeof confidence === 'number' && confidence >= threshold && confidence <= 100) ? `Confidence below SDK threshold (${threshold}/100)` : null);
      const t = this.commit(name, stamp, now, wall, reason);
      if (t === null) continue;
      const point = { t, v: item.value, ok: reason === null };
      this.waves[name].push(point); after?.(point);
    }
  }
  private onChest(point: WavePoint): void {
    if (!point.ok) { this.phase = { phase: null, high: null, low: null }; return; }
    let lo = Infinity, hi = -Infinity, first = Infinity;
    this.waves.chest.forEach(p => { if (p.ok && p.t >= point.t - PHASE_WINDOW_MS && p.t <= point.t) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); first = Math.min(first, p.t); } });
    this.phase = point.t - first >= 3000 ? stepBreathPhase(this.phase, point.v, hi - lo) : { phase: null, high: null, low: null };
  }
  private onEda(point: WavePoint): void {
    const e = this.eda;
    if (!point.ok) { e.lastOkAt = null; return; }
    if (e.mean !== null) return;
    if (e.lastOkAt !== null && point.t - e.lastOkAt > 0 && point.t - e.lastOkAt <= FRESHNESS_MS) e.acceptedMs += point.t - e.lastOkAt;
    e.lastOkAt = point.t; e.n++; e.sum += point.v; e.sumSq += point.v ** 2;
    if (e.acceptedMs >= SIGNAL_POLICY.eda.baselineSeconds * 1000) { e.mean = e.sum / e.n; e.spread = Math.max(Math.sqrt(Math.max(0, e.sumSq / e.n - e.mean ** 2)), Math.abs(e.mean) * 0.01, 1e-9); }
  }
  private ingestHrv(values: NativeHrv[] | null | undefined, now: number, wall: number): void {
    const floor = SIGNAL_POLICY.hrv.confidence;
    for (const { item, stamp } of this.fresh('hrv', values)) {
      const scale = hrvScale(item.meanNn), rmssd = (item.rmssd ?? NaN) * (scale ?? NaN), sdnn = (item.sdnn ?? NaN) * (scale ?? NaN), confidence = item.confidence;
      const reason = this.blocked(false) ?? (item.stable !== true ? 'Capture is not stable' : !(typeof confidence === 'number' && confidence >= floor && confidence <= 100) ? `HRV confidence below SDK threshold (${floor}/100)` : scale === null ? 'HRV interval units not recognized' : !(rmssd >= 1 && rmssd <= 300 && sdnn >= 1 && sdnn <= 300) ? 'Outside supported HRV range (1–300 ms)' : null);
      if (this.commit('hrv', stamp, now, wall, reason) !== null) this.hrv = reason === null ? { rmssdMs: Math.round(rmssd), sdnnMs: Math.round(sdnn) } : null;
    }
  }
  /** Counts a blink on a stable detected=true entry after a not-detected entry
   * or after 400 ms without detection, so per-frame and event-only streams
   * both count once per blink. Unstable or blocked entries end the window. */
  private ingestBlinks(values: NativeDetection[] | null | undefined, now: number, wall: number): void {
    const b = this.blink;
    for (const { item, stamp } of this.fresh('blinking', values)) {
      const reason = this.blocked(false) ?? (item.stable !== true || typeof item.detected !== 'boolean' ? 'Blink detection is not stable' : null);
      const t = this.commit('blinking', stamp, now, wall, reason);
      if (t === null) continue;
      if (reason) { b.observedSince = null; b.lastStableAt = null; b.detected = false; continue; }
      if (b.lastStableAt === null || t - b.lastStableAt > FRESHNESS_MS) { b.observedSince = t; b.detected = false; }
      if (item.detected && (!b.detected || b.lastDetectedAt === null || t - b.lastDetectedAt > BLINK_REFRACTORY_MS)) this.blinks.push(t);
      if (item.detected) b.lastDetectedAt = t;
      b.detected = item.detected === true; b.lastStableAt = t;
    }
  }
  private ingestDetections(values: NativeDetection[] | null | undefined, now: number, wall: number): void {
    for (const { item, stamp } of this.fresh('talking', values)) {
      const reason = this.blocked(false) ?? (item.stable !== true || typeof item.detected !== 'boolean' ? 'Talking detection is not stable' : null);
      if (this.commit('talking', stamp, now, wall, reason) !== null) this.talking = reason === null ? item.detected === true : null;
    }
  }
  private ingestExpressions(values: NativeExpression[] | null | undefined, now: number, wall: number): void {
    for (const { item, stamp } of this.fresh('expressions', values)) {
      const scores = expressionScores(item.scores);
      const reason = this.blocked(false) ?? (item.stable !== true ? 'Expression estimate is not stable' : scores === null ? 'No expression scores' : null);
      if (this.commit('expressions', stamp, now, wall, reason) !== null) this.expressions = reason === null ? scores : null;
    }
  }
  private state(name: TrackName, ctx: SignalContext, now: number): SignalState {
    const policy = SIGNAL_POLICY[name], track = this.tracks[name];
    const fresh = name === 'chest' ? CHEST_FRESH_MS : name === 'hrv' ? SIGNAL_POLICY.hrv.freshMs : FRESHNESS_MS;
    const pending = gate(ctx, policy.warmupSeconds, now, track.count);
    if (pending) return pending;
    if (track.received! - ctx.firstFrameAt! < policy.warmupSeconds * 1000) return { status: 'warming', reason: 'Waiting for a fresh estimate after warm-up', secondsLeft: 0 };
    const age = now - track.measured!;
    if (age > fresh || age < -1000 || now - track.received! > fresh) return { status: 'stale', reason: 'Missing or stale measurement timestamp' };
    const blocked = this.blocked(policy.chest, ctx.validation);
    if (blocked) return { status: 'rejected', reason: blocked };
    if (track.invalidated) return { status: 'rejected', reason: 'Waiting for a fresh estimate after capture validation' };
    return track.reason ? { status: 'rejected', reason: track.reason } : ok;
  }
  private fromDiagnostic(metric: SensorDiagnosticMetric, warmupSeconds: number, ctx: SignalContext, now: number): SignalState {
    const pending = gate(ctx, warmupSeconds, now, metric.sampleCount ?? 0);
    if (pending) return pending;
    if (metric.state === 'accepted') return ok;
    if (metric.state === 'stale') return { status: 'stale', reason: 'Missing or stale measurement timestamp' };
    if (metric.state === 'rejected') return { status: 'rejected', reason: metric.reasons[0] ?? 'Estimate rejected' };
    return { status: 'warming', reason: metric.reasons[0] ?? 'Waiting for the first estimate', secondsLeft: 0 };
  }
  private recentOk(name: WaveName, now: number, windowMs: number): WavePoint[] { const out: WavePoint[] = []; this.waves[name].forEach(p => { if (p.ok && p.t >= now - windowMs && p.t <= now + 1000) out.push(p); }); return out; }
  private amplitude(name: WaveName, now: number): number | null {
    const points = this.recentOk(name, now, SHARE_WINDOW_MS);
    if (points.length < 8 || points.at(-1)!.t - points[0]!.t < 8000) return null;
    const values = points.map(p => p.v).sort((a, b) => a - b);
    return quantile(values, 0.9) - quantile(values, 0.1);
  }
  view(now: number, ctx: SignalContext, diagnostics: Pick<SensorDiagnostics, 'pulse' | 'breathing'>): SensorSignals {
    const status = { pulse: this.fromDiagnostic(diagnostics.pulse, METRIC_POLICY.pulse.warmupSeconds, ctx, now), breathing: this.fromDiagnostic(diagnostics.breathing, METRIC_POLICY.breathing.warmupSeconds, ctx, now) } as Record<SignalName, SignalState>;
    for (const name of Object.keys(this.tracks) as TrackName[]) status[name] = this.state(name, ctx, now);
    const isOk = (name: SignalName) => status[name].status === 'ok';
    const breathingBpm = isOk('breathing') && diagnostics.breathing.bpm !== null ? Math.round(diagnostics.breathing.bpm) : null;
    let abdomenShare: number | null = null;
    if (isOk('abdomen')) {
      const chest = isOk('chest') ? this.amplitude('chest', now) : null, abdomen = this.amplitude('abdomen', now);
      if (chest !== null && abdomen !== null && chest + abdomen > 1e-9) abdomenShare = round(abdomen / (chest + abdomen), 0.05);
      else status.abdomen = { status: 'warming', reason: 'Collecting 8 seconds of chest and abdomen movement', secondsLeft: 0 };
    }
    if (isOk('chest') && this.phase.phase === null) status.chest = { status: 'warming', reason: 'Waiting for a full breath', secondsLeft: 0 };
    let blinksPerMinute: number | null = null, lastBlinkAgeMs: number | null = null;
    if (isOk('blinking')) {
      const since = this.blink.observedSince, span = since === null ? 0 : Math.min(60_000, now - since), need = SIGNAL_POLICY.blinking.observeSeconds * 1000;
      if (since === null || span < need) status.blinking = { status: 'warming', reason: `Watching blinks for ${SIGNAL_POLICY.blinking.observeSeconds} seconds`, secondsLeft: Math.ceil((need - span) / 1000) };
      else {
        let count = 0; this.blinks.forEach(t => { if (t >= now - span && t >= since) count++; });
        blinksPerMinute = Math.round(count * 60_000 / span);
        const last = this.blinks.last();
        lastBlinkAgeMs = last !== undefined && last >= since ? round(Math.max(0, now - last), 100) : null;
      }
    }
    let edaRelative: number | null = null;
    if (isOk('eda')) {
      const e = this.eda, recent = this.recentOk('eda', now, EDA_RECENT_MS);
      if (e.mean === null || e.spread === null) status.eda = { status: 'warming', reason: 'Collecting your first accepted minute', secondsLeft: Math.ceil((SIGNAL_POLICY.eda.baselineSeconds * 1000 - e.acceptedMs) / 1000) };
      else if (recent.length) edaRelative = round(clamp((recent.reduce((sum, p) => sum + p.v, 0) / recent.length - e.mean) / e.spread, -3, 3), 0.1);
    }
    const expressions = isOk('expressions') ? this.expressions : null;
    return { breathingBpm, breathPhase: isOk('chest') ? this.phase.phase : null, abdomenShare, hrv: isOk('hrv') ? this.hrv : null, blinksPerMinute, lastBlinkAgeMs,
      talking: isOk('talking') ? this.talking : null, expressions: expressions ? { ...expressions } : null, fear: fearScore(expressions), edaRelative, status };
  }
  waveforms(now: number): SensorWaveforms {
    const recent = (name: WaveName) => this.waves[name].toArray().filter(p => p.t >= now - WAVE_WINDOW_MS);
    return { simulated: false, nowMs: now, chest: recent('chest'), abdomen: recent('abdomen'), arterial: recent('arterial'), eda: recent('eda') };
  }
}
