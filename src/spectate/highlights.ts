import { config } from '../game/config';
import type { TraceSnapshot } from '../integrations/client';
import type { PublicEvent } from '../game/state';

/** Moments worth calling out on the spectate page, the narrator and the end-of-run recap. Derived only
 * from the public trace and the shared whole-BPM heart rate this page received; nothing is stored or
 * sent anywhere. Close calls need the creature's position at the time, so only what this page saw live
 * counts: joining mid-run never invents a past close call. */
export type HighlightKind = 'close-call' | 'left-wall' | 'steadied' | 'decoy-save' | 'spike' | 'escaped' | 'caught';
export type Highlight = { id: string; kind: HighlightKind; time: number; text: string };
export type PulseSample = { time: number; bpm: number };
export type HighlightTracker = {
  primed: boolean; lastSeq: number; lastTime: number;
  /** Closest the creature got (line units) since it last came within the near position, or null. */
  visitMin: number | null;
  pulse: PulseSample[];
  /** Run time of the last heart-rate spike called out (one per 20 s). */
  spikeAt: number;
  highlights: Highlight[];
};
export const newHighlights = (): HighlightTracker => ({ primed: false, lastSeq: 0, lastTime: 0, visitMin: null, pulse: [], spikeAt: -Infinity, highlights: [] });

const AT_WALL = 2, SPIKE_BPM = 18, SPIKE_WINDOW = 8, PULSE_KEEP = 600;
const seconds = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** The biggest rise within `window` seconds anywhere in the samples: from, to and when it peaked. */
export function biggestRise(samples: readonly PulseSample[], window = SPIKE_WINDOW): { from: number; to: number; time: number; rise: number } | null {
  let best: { from: number; to: number; time: number; rise: number } | null = null;
  for (let i = 0, low = 0; i < samples.length; i++) {
    while (samples[i]!.time - samples[low]!.time > window) low++;
    let min = samples[low]!;
    for (let j = low; j < i; j++) if (samples[j]!.bpm < min.bpm) min = samples[j]!;
    const rise = samples[i]!.bpm - min.bpm;
    if (rise > 0 && (!best || rise > best.rise)) best = { from: min.bpm, to: samples[i]!.bpm, time: samples[i]!.time, rise };
  }
  return best;
}
/** The most recent public event of interest at or before `time` (within `within` seconds), as a short cause. */
export function causeBefore(events: readonly PublicEvent[], time: number, within = 8): string | null {
  const CAUSES: Record<string, string> = { SCARE: 'a hit on the door', ATTACK_COMMITTED: 'an attack', PROXIMITY_ALARM: 'it reaching the wall', WRONG_INPUT: 'a loud mistake', BLACKOUT_STARTED: 'a blackout', QUIET_ENTERED: 'going quiet', RESTORED: 'the power coming back', FRIEND_WARNING: 'your warning', VOICE_HEARD: 'it hearing them talk' };
  const e = [...events].reverse().find(x => CAUSES[x.type] && x.time <= time + 0.5 && time - x.time <= within);
  return e ? CAUSES[e.type]! : null;
}

/** Folds one update (trace plus the current whole-BPM pulse, if shared) into the tracker. */
export function trackHighlights(prev: HighlightTracker, trace: TraceSnapshot | null, bpm: number | null): { next: HighlightTracker; found: Highlight[] } {
  if (!trace?.summary || !Array.isArray(trace.events)) return { next: prev, found: [] };
  const s = trace.summary, events = trace.events, newest = events.reduce((max, e) => Math.max(max, e.seq), 0);
  // A restarted run (sequence or time going backwards) starts over.
  const base = prev.primed && (newest < prev.lastSeq || s.time < prev.lastTime - 2) ? newHighlights() : prev;
  const next: HighlightTracker = { ...base, pulse: base.pulse, highlights: base.highlights, lastTime: s.time };
  const found: Highlight[] = [], add = (kind: HighlightKind, time: number, text: string) => {
    const id = `${kind}:${Math.round(time * 10)}`;
    if (next.highlights.some(h => h.id === id) || found.some(h => h.id === id)) return;
    found.push({ id, kind, time, text });
  };
  if (base.primed) {
    for (const e of events) if (e.seq > base.lastSeq) {
      if (e.type === 'QUIET_ENTERED' && s.linePosition <= AT_WALL) add('close-call', e.time, `Close call · went quiet with it at the wall (${seconds(e.time)})`);
      if (e.type === 'RECOVERY_REWARD') add('steadied', e.time, `They steadied and it lost their trail (${seconds(e.time)})`);
      if (e.type === 'FRIEND_DECOY' && s.linePosition <= config.line.nearPosition) add('decoy-save', e.time, `Your decoy pulled it off the wall (${seconds(e.time)})`);
      if (e.type === 'WON') { const left = Math.max(0, Math.round(config.line.deadlineSeconds - e.time)); add('escaped', e.time, left <= 45 ? `Escaped with ${left} s to spare` : `Escaped at ${seconds(e.time)}`); }
      if (e.type === 'LOST') add('caught', e.time, `It got them at ${seconds(e.time)}`);
    }
    // A visit to the wall that ends with it walking away again.
    if (s.status === 'playing' && s.linePosition <= config.line.nearPosition) next.visitMin = Math.min(next.visitMin ?? Infinity, s.linePosition);
    else if (next.visitMin !== null && s.linePosition >= config.line.clearPosition) {
      if (next.visitMin <= AT_WALL && s.status === 'playing') add('left-wall', s.time, `It reached the wall and left again (${seconds(s.time)})`);
      next.visitMin = null;
    }
  }
  if (bpm !== null && Number.isFinite(bpm) && s.status === 'playing') {
    const last = next.pulse.at(-1);
    if (!last || s.time - last.time >= 0.5 || last.bpm !== bpm) next.pulse = [...next.pulse.filter(p => p.time <= s.time), { time: s.time, bpm }].slice(-PULSE_KEEP);
    const recent = next.pulse.filter(p => s.time - p.time <= SPIKE_WINDOW), low = recent.reduce((min, p) => Math.min(min, p.bpm), Infinity);
    if (base.primed && bpm - low >= SPIKE_BPM && s.time - next.spikeAt >= 20) { next.spikeAt = s.time; add('spike', s.time, `Heart rate ${low} → ${bpm} BPM${causeBefore(events, s.time) ? ` after ${causeBefore(events, s.time)}` : ''}`); }
  }
  next.highlights = [...next.highlights, ...found].slice(-30);
  next.lastSeq = Math.max(base.lastSeq, newest); next.primed = true;
  return { next, found };
}
