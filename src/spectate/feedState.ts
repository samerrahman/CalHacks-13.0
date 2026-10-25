import type { TraceSnapshot } from '../integrations/client';
import type { PublicEvent } from '../game/state';
import { config } from '../game/config';
import { alarmIntensity } from '../render/presentation';

/** `none`: nothing received yet. `lost`: the breach (or a loss) cut the feed for the rest of the run. */
export type Signal = 'none' | 'live' | 'lost';
export type DoorCue = 'impact' | 'dent';
export type FeedTracker = { lastSeq: number; time: number; signal: Signal; alarm: boolean; dented: boolean; primed: boolean };
export const newTracker = (): FeedTracker => ({ lastSeq: 0, time: 0, signal: 'none', alarm: false, dented: false, primed: false });

const breach = (e: PublicEvent) => e.type === 'SCARE' && e.detail === 'breach';

/** Folds one public trace into the shelter camera's state. Only events newer than the last
 * seen sequence animate the door; a spectator joining mid-run sees settled poses, not replays.
 * A restarted run (sequence or time going backwards) re-arms the feed. */
export function trackFeed(prev: FeedTracker, trace: TraceSnapshot | null): { next: FeedTracker; cues: DoorCue[]; restarted: boolean } {
  if (!trace?.summary || !Array.isArray(trace.events)) return { next: { ...prev, signal: prev.signal === 'lost' ? 'lost' : 'none' }, cues: [], restarted: false };
  const s = trace.summary, events = trace.events, newest = events.reduce((max, e) => Math.max(max, e.seq), 0);
  const base = prev.primed && (newest < prev.lastSeq || s.time < prev.time - 1) ? newTracker() : prev;
  const cues: DoorCue[] = [];
  if (base.primed) for (const e of events) if (e.seq > base.lastSeq) {
    if (e.type === 'SCARE' && e.detail === 'impact') cues.push('impact');
    else if (e.type === 'ATTACK_COMMITTED') cues.push('dent');
  }
  // Same latch as the game's alarm: on at the near position, off again only once clear.
  const alarm = s.status === 'playing' && trace.mode !== 'tutorial' && (base.alarm ? s.linePosition < config.line.clearPosition : s.linePosition <= config.line.nearPosition);
  const lost = base.signal === 'lost' || s.status === 'lost' || events.some(breach);
  return { next: { lastSeq: Math.max(base.lastSeq, newest), time: s.time, signal: lost ? 'lost' : 'live', alarm, dented: base.dented || events.some(e => e.type === 'ATTACK_COMMITTED'), primed: true }, cues, restarted: base !== prev };
}

export type CamLighting = { level: number; screens: boolean; emergency: number; alarm: number; gain: number; noise: number };
/** Room light from the public equipment state. on: lamp and screens lit; quiet: dim and screens
 * dark; blackout: emergency light only. The camera's gain (and its grain) rises in the dark. */
export function camLighting(equipment: string | undefined, alarm: boolean, linePosition: number, seconds: number, reducedMotion: boolean): CamLighting {
  const on = equipment === 'on' || equipment === undefined, quiet = equipment === 'quiet';
  const urgency = Math.max(0, Math.min(1, 1 - linePosition / config.line.nearPosition));
  return { level: on ? 1 : quiet ? .22 : 0, screens: on, emergency: on ? .55 : quiet ? .8 : 1.4, alarm: alarmIntensity(seconds, { active: alarm, urgency }, reducedMotion), gain: on ? 1 : quiet ? 1.4 : 1.9, noise: on ? .06 : quiet ? .1 : .16 };
}
