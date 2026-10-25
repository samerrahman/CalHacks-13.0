import { monotonePath } from '../ui/pulseChart';
import type { PublicEvent } from '../game/state';
import type { PulseSample } from './highlights';

const W = 320, H = 92, PAD = 6, WINDOW_S = 120;
const MARK: Record<string, string> = { SCARE: '#c9553a', ATTACK_COMMITTED: '#c9553a', RECOVERY_REWARD: '#8fbf8f', PROXIMITY_ALARM: '#d99450' };

/** The shared heart rate as a scrolling line over the last two minutes, with scares and recoveries
 * marked. Only the whole-BPM values this page received; nothing is kept after the page closes. */
export default function PulseTrace({ samples, baseline, events, now }: { samples: readonly PulseSample[]; baseline: number | null; events: readonly PublicEvent[]; now: number }) {
  const start = Math.max(0, now - WINDOW_S), shown = samples.filter(p => p.time >= start - 2);
  if (shown.length < 2) return <p className="small muted spectate-trace-empty">The line starts once a few heart-rate readings arrive.</p>;
  const values = [...shown.map(p => p.bpm), ...(baseline === null ? [] : [baseline])];
  const lo = Math.floor((Math.min(...values) - 4) / 5) * 5, hi = Math.max(lo + 10, Math.ceil((Math.max(...values) + 4) / 5) * 5);
  const x = (t: number) => PAD + (t - start) / Math.max(1, now - start) * (W - 2 * PAD), y = (v: number) => H - PAD - (v - lo) / (hi - lo) * (H - 2 * PAD);
  const path = monotonePath(shown.map(p => ({ x: Math.max(PAD, x(p.time)), y: y(p.bpm) })));
  const last = shown.at(-1)!, marks = events.filter(e => MARK[e.type] && e.time >= start && e.time <= now);
  return <svg className="spectate-trace" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Heart rate over the last ${Math.round(now - start)} seconds, now ${last.bpm} BPM${baseline === null ? '' : ` against a baseline of ${baseline}`}.`}>
    {[lo, hi].map(v => <text key={v} x={W - 2} y={y(v) + (v === hi ? 9 : -3)} textAnchor="end">{v}</text>)}
    {baseline !== null && <line x1={PAD} x2={W - PAD} y1={y(baseline)} y2={y(baseline)} className="baseline"/>}
    {marks.map(e => <line key={e.id} x1={x(e.time)} x2={x(e.time)} y1={PAD} y2={H - PAD} stroke={MARK[e.type]} className="mark"/>)}
    <path d={`${path} L${x(last.time).toFixed(1)},${H - PAD} L${Math.max(PAD, x(shown[0]!.time)).toFixed(1)},${H - PAD} Z`} className="fill"/>
    <path d={path} className="line"/>
    <circle cx={x(last.time)} cy={y(last.bpm)} r="3"/>
  </svg>;
}
