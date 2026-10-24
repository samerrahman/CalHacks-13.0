/** Local-only explanatory statistics. No provider calls, persistence or diagnosis. */
const median = values => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2 : null;
};
const round = n => Math.round(n * 10) / 10;
const marked = new Set(['SCARE','BLACKOUT','MISTAKE','CLOSE_ENCOUNTER','BREACH_WARNING','LURE_SUCCESS','QUIET','POWER_RESTORED']);
const maxGap = rows => rows.slice(1).reduce((gap, row, i) => Math.max(gap, row.capturedAtMs - rows[i].capturedAtMs), 0);

export function acceptedBins(samples, source) {
  const groups = new Map();
  for (const sample of samples) {
    if (!sample.accepted || sample.source !== source || !Number.isFinite(sample.bpm) || sample.bpm < 40 || sample.bpm > 110
      || !Number.isFinite(sample.capturedAtMs) || sample.capturedAtMs < 0 || !Number.isFinite(sample.gameMs) || sample.gameMs < 0
      || !Number.isInteger(sample.segment) || sample.segment < 0) continue;
    const key = `${sample.segment}:${Math.floor(sample.capturedAtMs / 1000)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sample);
  }
  return [...groups.values()].map(group => ({
    segment: group[0].segment,
    capturedAtMs: Math.floor(group[0].capturedAtMs / 1000) * 1000,
    gameMs: median(group.map(x => x.gameMs)),
    bpm: median(group.map(x => x.bpm)),
  })).sort((a, b) => a.segment - b.segment || a.capturedAtMs - b.capturedAtMs);
}

export function buildPulseReport({ recordingConsent, source, baselineBpm, samples = [], events = [] }) {
  if (!recordingConsent || !['presage', 'simulated'].includes(source)) return { status: 'unrecorded', timeline: [], markers: [], baselineBpm: null, highestBpm: null, largestIncrease: null, recovery: [] };
  const bins = acceptedBins(samples, source);
  if (!bins.length) return { status: 'unrecorded', timeline: [], markers: [], baselineBpm: null, highestBpm: null, largestIncrease: null, recovery: [] };
  const baseline = Number.isFinite(baselineBpm) && baselineBpm >= 40 && baselineBpm <= 110 ? baselineBpm : null;
  const safeEvents = events.filter(e => typeof e.id === 'string' && marked.has(e.type) && Number.isInteger(e.segment)
    && Number.isFinite(e.capturedAtMs) && Number.isFinite(e.gameMs)).map(e => ({ id: e.id, type: e.type, segment: e.segment, capturedAtMs: e.capturedAtMs, gameMs: e.gameMs }));
  const timeline = bins.map((b, i) => ({ ...b, breakBefore: i === 0 || bins[i - 1].segment !== b.segment || b.capturedAtMs - bins[i - 1].capturedAtMs > 5000 }));
  const comparisons = [];
  const recovery = [];
  for (const event of safeEvents) {
    const same = bins.filter(b => b.segment === event.segment);
    const before = same.filter(b => b.capturedAtMs >= event.capturedAtMs - 10000 && b.capturedAtMs < event.capturedAtMs);
    const after = same.filter(b => b.capturedAtMs >= event.capturedAtMs + 5000 && b.capturedAtMs <= event.capturedAtMs + 25000);
    if (before.length < 5 || after.length < 10 || maxGap(before) > 5000 || maxGap(after) > 5000) continue;
    let peak = null;
    for (const start of after) {
      const window = after.filter(b => b.capturedAtMs >= start.capturedAtMs && b.capturedAtMs < start.capturedAtMs + 5000);
      if (window.length < 4 || maxGap(window) > 2000) continue;
      const value = median(window.map(b => b.bpm));
      if (!peak || value > peak.bpm) peak = { bpm: value, capturedAtMs: window.at(-1).capturedAtMs };
    }
    if (!peak) continue;
    const delta = peak.bpm - median(before.map(b => b.bpm));
    // Nearby marked events are a confounded cluster, never a causal attribution.
    const associated = safeEvents.filter(e => e.segment === event.segment && e.capturedAtMs >= event.capturedAtMs - 10000 && e.capturedAtMs <= event.capturedAtMs + 25000);
    if (delta > 0) comparisons.push({ eventId: event.id, deltaBpm: round(delta), associatedEventIds: associated.map(e => e.id), clustered: associated.length > 1 });
    if (baseline === null) continue;
    let elapsedSeconds = null;
    for (const start of same.filter(b => b.capturedAtMs > peak.capturedAtMs && b.capturedAtMs <= event.capturedAtMs + 60000)) {
      const window = same.filter(b => b.capturedAtMs >= start.capturedAtMs && b.capturedAtMs <= start.capturedAtMs + 12000);
      if (window.at(-1)?.capturedAtMs > event.capturedAtMs + 60000) continue;
      if (window.length >= 11 && window.at(-1).capturedAtMs - start.capturedAtMs >= 12000 && maxGap(window) <= 2000 && window.every(b => b.bpm < baseline + 4)) {
        elapsedSeconds = round((window.at(-1).capturedAtMs - event.capturedAtMs) / 1000); break;
      }
    }
    recovery.push({ eventId: event.id, elapsedSeconds, observed: elapsedSeconds !== null });
  }
  comparisons.sort((a, b) => b.deltaBpm - a.deltaBpm);
  return { status: source === 'presage' ? 'recorded-live' : 'simulated', baselineBpm: baseline, highestBpm: Math.max(...bins.map(b => b.bpm)), timeline, markers: safeEvents,
    largestIncrease: comparisons[0] ?? null, recovery, note: 'Timing association only. Measurement delay, movement, lighting and other events may contribute.' };
}
