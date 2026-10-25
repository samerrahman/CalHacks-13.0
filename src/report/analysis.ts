import type { SensorMode } from '../sensing/types';
export type PulseSample = { capturedAtMs: number; gameMs: number; segment: number; bpm: number; source: SensorMode; accepted: boolean };
export type PulseEvent = { id: string; type: string; capturedAtMs: number; gameMs: number; segment: number };
export type PulseBin = { segment: number; capturedAtMs: number; gameMs: number; bpm: number; breakBefore?: boolean };
export type PulseIncrease = { eventId: string; deltaBpm: number; associatedEventIds: string[]; clustered: boolean };
export type PulseRecovery = { eventId: string; elapsedSeconds: number | null; observed: boolean };
export type BreathSample = { capturedAtMs: number; gameMs: number; segment: number; rpm: number; source: SensorMode; accepted: boolean };
export type BreathBin = { segment: number; capturedAtMs: number; gameMs: number; rpm: number; breakBefore?: boolean };
/** Breathing is optional within a recorded report: absent when no accepted breathing was captured. */
export type BreathingSummary = { timeline: BreathBin[]; restingRpm: number | null; lowestRpm: number; highestRpm: number };
export type PulseReport = { status: 'unrecorded' | 'recorded-live' | 'simulated'; baselineBpm: number | null; highestBpm: number | null; timeline: PulseBin[]; markers: PulseEvent[]; largestIncrease: PulseIncrease | null; recovery: PulseRecovery[]; note?: string; breathing?: BreathingSummary };
export type ReportInput = { recordingConsent: boolean; source: SensorMode; baselineBpm: number | null; samples?: PulseSample[]; events?: PulseEvent[]; breathingSamples?: BreathSample[]; restingBreathingRpm?: number | null };
/** Local-only explanatory statistics. No provider calls, persistence or diagnosis. */
const median = (values: number[]): number => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2 : 0;
};
const round = (n: number) => Math.round(n * 10) / 10;
const marked = new Set(['SCARE','BLACKOUT','MISTAKE','CLOSE_ENCOUNTER','BREACH_WARNING','LURE_SUCCESS','QUIET','POWER_RESTORED','RECOVERY']);
/** Breathing uses its own 30-second SDK window and updates less often, so lines break on a wider gap. */
const BREATH_GAP_MS = 8000;
const maxGap = (rows: PulseBin[]) => rows.slice(1).reduce((gap, row, i) => Math.max(gap, row.capturedAtMs - rows[i].capturedAtMs), 0);
/** Coverage includes interval edges; internal density cannot conceal an unobserved tail. */
const windowCovered = (rows: PulseBin[], startMs: number, endMs: number, maximumGapMs: number): boolean =>
  rows.length > 0 && rows[0].capturedAtMs - startMs <= maximumGapMs
  && endMs - rows.at(-1)!.capturedAtMs <= maximumGapMs && maxGap(rows) <= maximumGapMs;

export function acceptedBins(samples: PulseSample[], source: SensorMode) {
  const groups = new Map<string, PulseSample[]>();
  if (source !== 'presage' && source !== 'simulated') return [];
  for (const sample of samples) {
    if (!sample.accepted || sample.source !== source || !Number.isFinite(sample.bpm) || sample.bpm < 40 || sample.bpm > 110
      || !Number.isFinite(sample.capturedAtMs) || sample.capturedAtMs < 0 || !Number.isFinite(sample.gameMs) || sample.gameMs < 0
      || !Number.isInteger(sample.segment) || sample.segment < 0) continue;
    const key = `${sample.segment}:${Math.floor(sample.capturedAtMs / 1000)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sample);
  }
  return [...groups.values()].map(group => ({
    segment: group[0].segment,
    capturedAtMs: Math.floor(group[0].capturedAtMs / 1000) * 1000,
    gameMs: median(group.map(x => x.gameMs)),
    bpm: median(group.map(x => x.bpm)),
  })).sort((a, b) => a.segment - b.segment || a.capturedAtMs - b.capturedAtMs);
}

export function acceptedBreathBins(samples: BreathSample[], source: SensorMode): BreathBin[] {
  if (source !== 'presage' && source !== 'simulated') return [];
  const groups = new Map<string, BreathSample[]>();
  for (const sample of samples) {
    if (!sample.accepted || sample.source !== source || !Number.isFinite(sample.rpm) || sample.rpm < 5 || sample.rpm > 40
      || !Number.isFinite(sample.capturedAtMs) || sample.capturedAtMs < 0 || !Number.isFinite(sample.gameMs) || sample.gameMs < 0
      || !Number.isInteger(sample.segment) || sample.segment < 0) continue;
    const key = `${sample.segment}:${Math.floor(sample.capturedAtMs / 1000)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sample);
  }
  const bins = [...groups.values()].map(group => ({
    segment: group[0].segment, capturedAtMs: Math.floor(group[0].capturedAtMs / 1000) * 1000,
    gameMs: median(group.map(x => x.gameMs)), rpm: median(group.map(x => x.rpm)),
  })).sort((a, b) => a.segment - b.segment || a.capturedAtMs - b.capturedAtMs);
  return bins.map((b, i) => ({ ...b, breakBefore: i === 0 || bins[i - 1].segment !== b.segment || b.capturedAtMs - bins[i - 1].capturedAtMs > BREATH_GAP_MS }));
}
function breathingSummary(samples: BreathSample[], source: SensorMode, resting: number | null | undefined): BreathingSummary | null {
  const timeline = acceptedBreathBins(samples, source);
  if (!timeline.length) return null;
  const restingRpm = typeof resting === 'number' && Number.isFinite(resting) && resting >= 5 && resting <= 40 ? resting : null;
  return { timeline, restingRpm, lowestRpm: Math.min(...timeline.map(b => b.rpm)), highestRpm: Math.max(...timeline.map(b => b.rpm)) };
}

export function buildPulseReport({ recordingConsent, source, baselineBpm, samples = [], events = [], breathingSamples = [], restingBreathingRpm = null }: ReportInput): PulseReport {
  if (!recordingConsent || !['presage', 'simulated'].includes(source)) return { status: 'unrecorded', timeline: [], markers: [], baselineBpm: null, highestBpm: null, largestIncrease: null, recovery: [] };
  const bins = acceptedBins(samples, source);
  if (!bins.length) return { status: 'unrecorded', timeline: [], markers: [], baselineBpm: null, highestBpm: null, largestIncrease: null, recovery: [] };
  const baseline = baselineBpm !== null && Number.isFinite(baselineBpm) && baselineBpm >= 40 && baselineBpm <= 110 ? baselineBpm : null;
  const seenMarkers = new Set<string>();
  const safeEvents = events.filter(e => {
    if (typeof e.id !== 'string' || !e.id.length || e.id.length > 128 || seenMarkers.has(e.id) || !marked.has(e.type)
      || !Number.isInteger(e.segment) || e.segment < 0 || !Number.isFinite(e.capturedAtMs) || e.capturedAtMs < 0
      || !Number.isFinite(e.gameMs) || e.gameMs < 0) return false;
    seenMarkers.add(e.id);
    return true;
  }).map(e => ({ id: e.id, type: e.type, segment: e.segment, capturedAtMs: e.capturedAtMs, gameMs: e.gameMs }));
  const timeline = bins.map((b, i) => ({ ...b, breakBefore: i === 0 || bins[i - 1].segment !== b.segment || b.capturedAtMs - bins[i - 1].capturedAtMs > 5000 }));
  const comparisons: PulseIncrease[] = [];
  const recovery: PulseRecovery[] = [];
  for (const event of safeEvents) {
    const same = bins.filter(b => b.segment === event.segment);
    const before = same.filter(b => b.capturedAtMs >= event.capturedAtMs - 10000 && b.capturedAtMs < event.capturedAtMs);
    const after = same.filter(b => b.capturedAtMs >= event.capturedAtMs + 5000 && b.capturedAtMs <= event.capturedAtMs + 25000);
    if (before.length < 5 || after.length < 10 || !windowCovered(before, event.capturedAtMs - 10000, event.capturedAtMs, 5000)
      || !windowCovered(after, event.capturedAtMs + 5000, event.capturedAtMs + 25000, 5000)) continue;
    let peak: { bpm: number; capturedAtMs: number } | null = null;
    for (const start of after) {
      const window = after.filter(b => b.capturedAtMs >= start.capturedAtMs && b.capturedAtMs < start.capturedAtMs + 5000);
      if (window.length < 4 || !windowCovered(window, start.capturedAtMs, start.capturedAtMs + 5000, 2000)) continue;
      const value = median(window.map(b => b.bpm));
      if (!peak || value > peak.bpm) peak = { bpm: value, capturedAtMs: window.at(-1)!.capturedAtMs };
    }
    if (!peak) continue;
    const delta = peak.bpm - median(before.map(b => b.bpm));
    // Nearby marked events are a confounded cluster, never a causal attribution.
    const associated = safeEvents.filter(e => e.segment === event.segment && e.capturedAtMs >= event.capturedAtMs - 10000 && e.capturedAtMs <= event.capturedAtMs + 25000);
    if (delta > 0) comparisons.push({ eventId: event.id, deltaBpm: round(delta), associatedEventIds: associated.map(e => e.id), clustered: associated.length > 1 });
    // A steady trace already in this band has no observed excursion to return from.
    if (baseline === null || delta <= 0 || peak.bpm < baseline + 4) continue;
    let elapsedSeconds: number | null = null;
    for (const start of same.filter(b => b.capturedAtMs > peak.capturedAtMs && b.capturedAtMs <= event.capturedAtMs + 60000)) {
      const window = same.filter(b => b.capturedAtMs >= start.capturedAtMs && b.capturedAtMs <= start.capturedAtMs + 12000);
      if ((window.at(-1)?.capturedAtMs ?? Infinity) > event.capturedAtMs + 60000) continue;
      if (window.length >= 11 && window.at(-1)!.capturedAtMs - start.capturedAtMs >= 12000 && maxGap(window) <= 2000 && window.every(b => b.bpm < baseline + 4)) {
        elapsedSeconds = round((window.at(-1)!.capturedAtMs - event.capturedAtMs) / 1000); break;
      }
    }
    recovery.push({ eventId: event.id, elapsedSeconds, observed: elapsedSeconds !== null });
  }
  comparisons.sort((a, b) => b.deltaBpm - a.deltaBpm);
  const breathing = breathingSummary(breathingSamples, source, restingBreathingRpm);
  return { status: source === 'presage' ? 'recorded-live' : 'simulated', baselineBpm: baseline, highestBpm: Math.max(...bins.map(b => b.bpm)), timeline, markers: safeEvents,
    largestIncrease: comparisons[0] ?? null, recovery, note: 'Timing association only. Measurement delay, movement, lighting and other events may contribute.', ...(breathing ? { breathing } : {}) };
}
