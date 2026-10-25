import test from 'node:test';
import assert from 'node:assert/strict';
import type { TraceSnapshot, TraceSummary } from './client';
import type { PublicEvent } from '../game/state';
import { camLighting, newTracker, trackFeed, type FeedTracker } from '../spectate/feedState';

const summary = (patch: Partial<TraceSummary> = {}): TraceSummary => ({ time: 30, stage: 2, status: 'playing', equipment: 'on', creatureNode: 'TREELINE', creaturePhase: 'approach', linePosition: 14, lineLength: 24, danger: 20, quietChargesRemaining: 3, tactic: 'WAIT', target: 'NONE', proposalSource: 'FALLBACK', sensorSource: 'manual', sensorQuality: 'unknown', trend: 'UNKNOWN', sensorAgeMs: null, ...patch });
let seq = 0;
const ev = (type: string, detail = ''): PublicEvent => ({ id: `E${++seq}`, seq, time: seq, type, detail });
const snap = (events: PublicEvent[], patch: Partial<TraceSummary> = {}, mode = 'standard'): TraceSnapshot => ({ seed: 7, mode, summary: summary(patch), events, transport: 'local' });
function run(trace: TraceSnapshot | null, prev: FeedTracker = newTracker()) { return trackFeed(prev, trace); }

test('nothing received is no signal; the first trace goes live without replaying old door hits', () => {
  assert.equal(run(null).next.signal, 'none');
  seq = 0;
  const history = [ev('RUN_STARTED', 'standard'), ev('SCARE', 'impact'), ev('PROXIMITY_ALARM')];
  const first = run(snap(history));
  assert.equal(first.next.signal, 'live');
  assert.deepEqual(first.cues, [], 'a late joiner sees the settled door');
  const hit = ev('SCARE', 'impact'), second = run(snap([...history, hit]), first.next);
  assert.deepEqual(second.cues, ['impact']);
  assert.deepEqual(run(snap([...history, hit]), second.next).cues, [], 'each event animates once');
});

test('a committed attack dents the door, and the breach cuts the feed for good', () => {
  seq = 0;
  const events = [ev('RUN_STARTED', 'standard')];
  let t = run(snap(events)).next;
  events.push(ev('ATTACK_COMMITTED'));
  const committed = run(snap(events, { linePosition: 0, creaturePhase: 'breach' }), t);
  assert.deepEqual(committed.cues, ['dent']); assert.equal(committed.next.dented, true); assert.equal(committed.next.signal, 'live');
  events.push(ev('SCARE', 'breach'));
  t = run(snap(events, { linePosition: 0 }), committed.next).next;
  assert.equal(t.signal, 'lost');
  t = run(snap(events, { status: 'lost', time: 31 }), t).next;
  assert.equal(run(null, t).next.signal, 'lost', 'stays cut when the player stops sharing');
  assert.equal(run(snap([ev('LOST', 'TIMEOUT')], { status: 'lost' })).next.signal, 'lost', 'a timeout loss also cuts');
});

test('a late joiner after the commit sees the dent without an animation cue', () => {
  seq = 0;
  const joined = run(snap([ev('RUN_STARTED', 'standard'), ev('ATTACK_COMMITTED')], { linePosition: 0 }));
  assert.equal(joined.next.dented, true); assert.deepEqual(joined.cues, []);
});

test('a restarted run re-arms the camera', () => {
  seq = 0;
  const lost = run(snap([ev('RUN_STARTED', 'standard'), ev('ATTACK_COMMITTED'), ev('SCARE', 'breach'), ev('LOST', 'BREACH')], { status: 'lost', time: 200 })).next;
  seq = 0;
  const restart = run(snap([ev('RUN_STARTED', 'standard')], { time: 1 }), lost), fresh = restart.next;
  assert.equal(restart.restarted, true); assert.equal(fresh.signal, 'live'); assert.equal(fresh.dented, false); assert.equal(fresh.lastSeq, 1);
});

test('the alarm latches near the wall and clears only once the creature is clear', () => {
  seq = 0;
  const events = [ev('RUN_STARTED', 'standard')];
  let t = run(snap(events, { linePosition: 8 })).next; assert.equal(t.alarm, false);
  t = run(snap(events, { linePosition: 7 }), t).next; assert.equal(t.alarm, true);
  t = run(snap(events, { linePosition: 9 }), t).next; assert.equal(t.alarm, true, 'hysteresis');
  t = run(snap(events, { linePosition: 10 }), t).next; assert.equal(t.alarm, false);
  assert.equal(run(snap(events, { linePosition: 3 }, 'tutorial')).next.alarm, false, 'no alarm in guided practice');
});

test('lighting follows the equipment state; the alarm is slow and steady under reduced motion', () => {
  const on = camLighting('on', false, 14, 3, false), quiet = camLighting('quiet', false, 14, 3, false), dark = camLighting('blackout', false, 14, 3, false);
  assert.equal(on.level, 1); assert.equal(on.screens, true); assert.equal(on.alarm, 0);
  assert.ok(quiet.level > 0 && quiet.level < .5); assert.equal(quiet.screens, false);
  assert.equal(dark.level, 0); assert.equal(dark.screens, false); assert.equal(dark.emergency, 1);
  assert.ok(dark.gain > quiet.gain && quiet.gain > on.gain, 'gain rises in the dark');
  const pulses = Array.from({ length: 40 }, (_, i) => camLighting('on', true, 2, i * .1, false).alarm);
  assert.ok(Math.max(...pulses) - Math.min(...pulses) > .1, 'the alarm breathes');
  for (let i = 1; i < pulses.length; i++) assert.ok(Math.abs(pulses[i]! - pulses[i - 1]!) < .12, 'no flashing');
  const still = Array.from({ length: 10 }, (_, i) => camLighting('on', true, 2, i * .7, true).alarm);
  assert.equal(new Set(still).size, 1, 'reduced motion holds the alarm steady');
});
