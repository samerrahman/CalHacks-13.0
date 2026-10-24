import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeechQueue, type SpeechRequest } from './queue';

const line = (id: string, extra: Partial<SpeechRequest> = {}): SpeechRequest => ({ id, text: 'Silence the marked faulty unit.', expiresAt: 20, priority: 1, ...extra });

test('expired and repeated instructions never replay', () => {
  const queue = new SpeechQueue();
  assert.equal(queue.enqueue(line('expired', { expiresAt: 1 }), 2).accepted, false);
  queue.enqueue(line('first'), 2);
  assert.equal(queue.next(2)?.id, 'first');
  queue.finish('first');
  assert.equal(queue.enqueue(line('first'), 3).accepted, false);
  queue.enqueue(line('late', { expiresAt: 5 }), 3);
  assert.equal(queue.next(5), null);
});

test('critical calls interrupt active obsolete speech and replace queued lower priorities', () => {
  const queue = new SpeechQueue();
  queue.enqueue(line('tutorial'), 0); queue.next(0);
  queue.enqueue(line('help'), 0);
  assert.deepEqual(queue.enqueue(line('warning', { priority: 3 }), 1), { accepted: true, interrupted: true });
  assert.equal(queue.next(1)?.id, 'warning');
  queue.finish('warning');
  assert.equal(queue.next(2), null);
});

test('task or encounter invalidation cancels active and pending instructions', () => {
  const queue = new SpeechQueue();
  queue.enqueue(line('active', { stateVersion: 1 }), 0); queue.next(0);
  queue.enqueue(line('pending', { stateVersion: 1 }), 0);
  assert.equal(queue.prune(1, item => item.stateVersion === 2), true);
  assert.equal(queue.active, null);
  assert.equal(queue.length, 0);
});

test('reset removes an old shift but allows the same authored ID in a new one', () => {
  const queue = new SpeechQueue();
  queue.enqueue(line('opening'), 0); queue.next(0); queue.reset();
  assert.equal(queue.active, null);
  assert.equal(queue.enqueue(line('opening'), 0).accepted, true);
});
