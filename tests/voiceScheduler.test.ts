import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceScheduler, type VoiceLine } from '../src/ui/voiceScheduler';

const instruction: VoiceLine = { id: 'faults', role: 'supervisor', text: 'Eight faults. Isolate the machines when you hear the proximity alarm.', stage: 1, priority: 3, expiresAt: 20 };
const creature: VoiceLine = { id: 'approach', role: 'creature', text: 'I can hear you working.', stage: 1, priority: 4, expiresAt: 12 };

test('faster creature response cannot replace the requested opening instruction', () => {
  const scheduler = new VoiceScheduler<string>();
  scheduler.enqueue(instruction); scheduler.enqueue(creature);
  scheduler.resolve(creature.id, 'creature audio');
  assert.equal(scheduler.next(1), null, 'wait for the reserved instruction, with no premature caption');
  scheduler.resolve(instruction.id, 'instruction audio');
  assert.equal(scheduler.next(2)?.id, instruction.id);
  assert.equal(scheduler.next(3), null, 'only engine completion may release the active line');
  scheduler.complete(instruction.id);
  assert.equal(scheduler.next(9)?.id, creature.id);
});

test('a short encounter taunt expires while a longer instruction finishes uninterrupted', () => {
  const scheduler = new VoiceScheduler<string>();
  scheduler.enqueue(instruction); scheduler.resolve(instruction.id, 'audio'); scheduler.next(0);
  scheduler.enqueue(creature); scheduler.resolve(creature.id, 'audio');
  assert.deepEqual(scheduler.prune(25), [creature.id]);
  assert.equal(scheduler.current?.id, instruction.id, 'latest-start deadlines do not truncate active speech');
  scheduler.complete(instruction.id); assert.equal(scheduler.next(25), null);
});

test('stage invalidation removes active and unresolved lines and rejects late provider completion', () => {
  const scheduler = new VoiceScheduler<string>();
  scheduler.enqueue(instruction); scheduler.resolve(instruction.id, 'audio'); scheduler.next(0);
  scheduler.enqueue(creature);
  assert.deepEqual(scheduler.prune(1, line => line.stage === 2), [creature.id, instruction.id]);
  assert.equal(scheduler.resolve(creature.id, 'late audio'), false);
  assert.equal(scheduler.current, null); assert.equal(scheduler.next(1), null);
});

test('pause cancellation prevents pending speech from reviving and old completion cannot clear a new line', () => {
  const scheduler = new VoiceScheduler<string>();
  scheduler.enqueue(instruction); scheduler.resolve(instruction.id, 'audio'); scheduler.next(0);
  scheduler.enqueue(creature); scheduler.cancel();
  assert.equal(scheduler.resolve(creature.id, 'late'), false);
  const resumed = { ...instruction, id: 'resumed instruction' };
  scheduler.enqueue(resumed); scheduler.resolve(resumed.id, 'new'); scheduler.next(1);
  assert.equal(scheduler.complete(instruction.id), false);
  assert.equal(scheduler.current?.id, resumed.id);
});

test('quiet can cancel radio instructions while retaining an eligible creature response', () => {
  const scheduler = new VoiceScheduler<string>();
  scheduler.enqueue(instruction); scheduler.resolve(instruction.id, 'audio'); scheduler.next(0);
  scheduler.enqueue(creature); scheduler.resolve(creature.id, 'audio');
  assert.deepEqual(scheduler.cancel(line => line.role !== 'creature'), [instruction.id]);
  assert.equal(scheduler.next(3)?.id, creature.id);
});

test('bounded scheduling deduplicates and reset permits fresh-run identities', () => {
  const scheduler = new VoiceScheduler<string>();
  assert.equal(scheduler.enqueue(instruction), true); assert.equal(scheduler.enqueue(instruction), false);
  for (let i = 0; i < 20; i++) scheduler.enqueue({ ...creature, id: `creature-${i}` });
  assert.equal(scheduler.length, 8);
  scheduler.reset(); assert.equal(scheduler.enqueue(instruction), true);
});
