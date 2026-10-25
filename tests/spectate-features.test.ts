import test from 'node:test';
import assert from 'node:assert/strict';
import { newHighlights, trackHighlights, biggestRise, causeBefore } from '../src/spectate/highlights';
import { narrateEvent, narrateHighlight } from '../src/spectate/narrator';
import { recapData } from '../src/spectate/Recap';
import { heardPosition } from '../src/spectate/audio';
import { WhisperGate, WHISPER } from '../src/ui/whisper';
import { cleanName, predictionRowValid, standings } from '../spacetimedb/src/predictRules';
import type { TraceSnapshot } from '../src/integrations/client';
import type { PublicEvent } from '../src/game/state';

let seq = 0;
const event = (type: string, time: number, detail = ''): PublicEvent => ({ id: `e${++seq}`, seq, time, type, detail });
function trace(time: number, linePosition: number, events: PublicEvent[], status = 'playing'): TraceSnapshot {
  return { seed: 17, mode: 'standard', transport: 'local', events, summary: { time, stage: 2, status, equipment: 'on', creatureNode: 'NEAR_PATH', creaturePhase: 'approach', linePosition, lineLength: 24, danger: 40, quietChargesRemaining: 2, tactic: 'WAIT', target: 'NONE', proposalSource: 'FALLBACK', sensorSource: 'manual', sensorQuality: 'unknown', trend: 'UNKNOWN', sensorAgeMs: null } };
}

test('highlights: close calls, a visit to the wall, spikes and the escape, only from what was seen live', () => {
  seq = 0;
  const history = [event('RUN_STARTED', 0, 'standard'), event('QUIET_ENTERED', 5)];
  let t = trackHighlights(newHighlights(), trace(10, 1, history), 70);
  assert.equal(t.found.length, 0, 'joining mid-run never invents a past close call');
  const quiet = event('QUIET_ENTERED', 12);
  t = trackHighlights(t.next, trace(12, 1, [...history, quiet]), 72);
  assert.deepEqual(t.found.map(h => h.kind), ['close-call']);
  t = trackHighlights(t.next, trace(20, 11, [...history, quiet]), 74);
  assert.deepEqual(t.found.map(h => h.kind), ['left-wall'], 'it reached the wall and walked away again');
  const scare = event('SCARE', 24, 'impact');
  t = trackHighlights(t.next, trace(24, 9, [...history, quiet, scare]), 75);
  t = trackHighlights(t.next, trace(27, 9, [...history, quiet, scare]), 99);
  const spike = t.found.find(h => h.kind === 'spike');
  assert.ok(spike && /74 → 99 BPM after a hit on the door/.test(spike.text), spike?.text ?? 'no spike');
  const won = event('WON', 290);
  t = trackHighlights(t.next, trace(290, 24, [...history, quiet, scare, won], 'won'), null);
  assert.match(t.found.find(h => h.kind === 'escaped')!.text, /Escaped with 10 s to spare/);
  const restarted = trackHighlights(t.next, trace(1, 18, [event('RUN_STARTED', 0, 'standard')]), null);
  assert.equal(restarted.next.highlights.length, 0, 'a new run starts over');
  assert.deepEqual(biggestRise([{ time: 0, bpm: 70 }, { time: 3, bpm: 90 }, { time: 30, bpm: 60 }, { time: 31, bpm: 75 }]), { from: 70, to: 90, time: 3, rise: 20 });
  assert.equal(causeBefore([scare], 26), 'a hit on the door'); assert.equal(causeBefore([scare], 60), null);
});

test('narrator lines come from the public event and the shared whole-BPM pulse only', () => {
  const near = narrateEvent(event('PROXIMITY_ALARM', 40), { bpm: 104, metres: 5, locks: 2, equipment: 'on' })!;
  assert.equal(near.text, 'It is at the wall. Pulse 104. They can only hear it.');
  assert.equal(narrateEvent(event('PROXIMITY_ALARM', 40), { bpm: null, metres: 5, locks: 2, equipment: 'on' })!.text, 'It is at the wall. They can only hear it.');
  assert.equal(narrateEvent(event('TASK_COMPLETE', 50, '3'), { bpm: null, metres: 50, locks: 3, equipment: 'on' })!.text, 'Lock released. 1 to go.');
  assert.ok(narrateEvent(event('SCARE', 60, 'breach'), { bpm: null, metres: 0, locks: 1, equipment: 'on' })!.priority > near.priority);
  assert.equal(narrateEvent(event('MONSTER_STEP', 61, 'from=3 to=2 step=-1'), { bpm: null, metres: 0, locks: 1, equipment: 'on' }), null);
  assert.equal(narrateHighlight({ id: 's', kind: 'spike', time: 3, text: 'Heart rate 72 → 118 BPM after a hit on the door' })!.text, 'Their heart rate went from 72 to 118.');
});

test('predictions: clean names, one row shape, right calls score more the earlier they were made', () => {
  assert.equal(cleanName('  Night   Owl '), 'Night Owl'); assert.equal(cleanName('<script>'), null); assert.equal(cleanName(''), null); assert.equal(cleanName('a'.repeat(17)), null);
  assert.equal(predictionRowValid({ voter: 'abcd1234', name: 'Ana', choice: 'escape', stage: 1 }), true);
  assert.equal(predictionRowValid({ voter: 'abcd1234', name: 'Ana', choice: 'escape', stage: 3 }), false, 'calls close after stage 2');
  assert.equal(predictionRowValid({ voter: 'ABC', name: 'Ana', choice: 'win', stage: 1 }), false);
  const rows = [{ voter: '00000001', name: 'Late', choice: 'escape', stage: 2 }, { voter: '00000002', name: 'Early', choice: 'escape', stage: 1 }, { voter: '00000003', name: 'Doubter', choice: 'caught', stage: 1 }];
  assert.deepEqual(standings(rows, 'won').map(s => [s.name, s.points]), [['Early', 200], ['Late', 150], ['Doubter', 0]]);
  assert.deepEqual(standings(rows, 'lost').map(s => [s.name, s.points]), [['Doubter', 200], ['Early', 0], ['Late', 0]]);
});

test('whisper gate: loud only after a moment above the line, quiet again after a moment below it', () => {
  const gate = new WhisperGate();
  assert.equal(gate.update(0.9, 0), false); assert.equal(gate.update(0.9, WHISPER.loudAfterMs - 1), false); assert.equal(gate.update(0.9, WHISPER.loudAfterMs), true);
  assert.equal(gate.update(0.45, 400), true, 'between the lines it stays loud');
  assert.equal(gate.update(0.1, 500), true); assert.equal(gate.update(0.1, 500 + WHISPER.quietAfterMs), false);
  assert.equal(gate.update(0.9, 2000), false, 'a single loud frame is not enough'); assert.equal(gate.update(0.2, 2100), false);
});

test('the recap counts every event seen and names the biggest jump', () => {
  seq = 0;
  const events = [event('QUIET_ENTERED', 10), event('QUIET_ENTERED', 40), event('WRONG_INPUT', 50, 'WIRE'), event('SCARE', 60, 'impact'), event('FRIEND_WARNING', 61), event('DOOR_UNLOCKED', 200)];
  const data = recapData('won', 250, 5, 'coop', events, [{ id: 'c', kind: 'close-call', time: 40, text: 'Close call' }], [{ time: 58, bpm: 72 }, { time: 62, bpm: 110 }]);
  assert.deepEqual(data.stats.map(s => s.value), ['4 / 4', '2', '1', '1']);
  assert.deepEqual(data.rise, { from: 72, to: 110, time: 62, cause: 'your warning' });
  assert.deepEqual(data.friend.map(f => f.value), ['1', '0', 'Turned']); assert.deepEqual(data.moments, ['Close call']);
});

test('spectator sound places the creature where the game hears it: its line distance at its public bearing', () => {
  const near = heardPosition(1, 17, 30), far = heardPosition(20, 17, 30);
  assert.ok(Math.hypot(near[0], near[2]) < Math.hypot(far[0], far[2]));
  assert.notDeepEqual(heardPosition(10, 17, 0), heardPosition(10, 17, 120), 'it drifts around the shelter over time');
});
