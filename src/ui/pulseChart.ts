/** Display geometry for the run report's chart. Presage readings arrive in bursts with gaps, so the
 * chart draws one continuous line over the whole run: measured bins as they are, gaps bridged,
 * the line starting at the resting baseline (or the first reading) and holding the last reading to
 * the end. Display only: the report's numbers and comparisons still come from measured bins. */
export type ChartPoint = { t: number; v: number; measured: boolean };

/** Gaps longer than this between readings are drawn as bridged rather than measured. */
export const BRIDGE_MS = 3000;

export function continuousLine(rows: { gameMs: number; value: number }[], endMs: number, lead: number | null): ChartPoint[] {
  const sorted = rows.filter(r => Number.isFinite(r.gameMs) && Number.isFinite(r.value)).sort((a, b) => a.gameMs - b.gameMs);
  if (!sorted.length) return [];
  const measured = sorted.map(r => ({ t: r.gameMs, v: r.value, measured: true }));
  const first = measured[0], last = measured.at(-1)!, out: ChartPoint[] = [];
  if (first.t > 0) out.push({ t: 0, v: lead ?? first.v, measured: false });
  out.push(...measured);
  if (last.t < endMs) out.push({ t: endMs, v: last.v, measured: false });
  return out;
}

/** Whether the segment from point i to i + 1 joins two readings close enough to count as measured. */
export function measuredSegment(points: ChartPoint[], i: number): boolean {
  const a = points[i], b = points[i + 1];
  return !!a && !!b && a.measured && b.measured && b.t - a.t <= BRIDGE_MS;
}

/** Smooth cubic segments through screen points that never overshoot them (monotone cubic in x).
 * Entry i runs from point i to point i + 1, so a path can be drawn whole or in pieces that line up. */
export function curveSegments(points: { x: number; y: number }[]): string[] {
  if (points.length < 2) return [];
  const n = points.length, slopes: number[] = [], tangents: number[] = [];
  for (let i = 0; i < n - 1; i++) { const dx = points[i + 1].x - points[i].x; slopes.push(dx > 0 ? (points[i + 1].y - points[i].y) / dx : 0); }
  tangents.push(slopes[0]);
  for (let i = 1; i < n - 1; i++) tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  tangents.push(slopes[n - 2]);
  for (let i = 0; i < n - 1; i++) { // Fritsch–Carlson: clamp tangents so each segment stays monotone
    if (slopes[i] === 0) { tangents[i] = tangents[i + 1] = 0; continue; }
    const a = tangents[i] / slopes[i], b = tangents[i + 1] / slopes[i], h = Math.hypot(a, b);
    if (h > 3) { tangents[i] = 3 * a / h * slopes[i]; tangents[i + 1] = 3 * b / h * slopes[i]; }
  }
  return points.slice(0, -1).map((p, i) => {
    const q = points[i + 1], third = (q.x - p.x) / 3;
    return `C${(p.x + third).toFixed(1)},${(p.y + tangents[i] * third).toFixed(1)} ${(q.x - third).toFixed(1)},${(q.y - tangents[i + 1] * third).toFixed(1)} ${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  });
}
const move = (p: { x: number; y: number }) => `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
/** The whole curve as one path. */
export function monotonePath(points: { x: number; y: number }[]): string {
  return points.length ? [move(points[0]), ...curveSegments(points)].join(' ') : '';
}
/** Only the segments `keep(i)` selects, as one path of separate pieces on the same curve. */
export function partialPath(points: { x: number; y: number }[], keep: (i: number) => boolean): string {
  const segments = curveSegments(points), out: string[] = [];
  segments.forEach((segment, i) => { if (!keep(i)) return; if (i === 0 || !keep(i - 1)) out.push(move(points[i])); out.push(segment); });
  return out.join(' ');
}

/** A tidy value range and gridline steps around the data. */
export function valueAxis(values: number[], pad: number, step: number): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(...values) - pad, hi = Math.max(...values) + pad;
  const min = Math.floor(lo / step) * step, max = Math.max(min + step, Math.ceil(hi / step) * step);
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(v);
  return { min, max, ticks };
}

/** Time ticks (ms) at a readable interval for a run of `endMs`, with m:ss labels. */
export function timeTicks(endMs: number): { t: number; label: string }[] {
  const step = endMs <= 60_000 ? 10_000 : endMs <= 180_000 ? 30_000 : 60_000, ticks: { t: number; label: string }[] = [];
  for (let t = 0; t <= endMs + 1; t += step) ticks.push({ t, label: `${Math.floor(t / 60_000)}:${String(Math.round(t / 1000) % 60).padStart(2, '0')}` });
  return ticks;
}
