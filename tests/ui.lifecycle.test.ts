import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncRun } from '../src/ui/asyncRun';
import { createGame, dispatch, step } from '../src/game/reducer';

test('a provider result received during pause applies exactly once after resume', () => {
  const run = new AsyncRun();
  let game = step(createGame(17, 'demo'), 12);
  const request = game.director.request!;
  game = dispatch(game, { type: 'pause', paused: true });
  const apply = () => { game = dispatch(game, { type: 'proposal', source: 'GEMINI', proposal: { requestId: request.requestId, stateVersion: request.stateVersion, tactic: 'WAIT', evidenceEventIds: [], reasonCode: 'NO_VALID_SIGNAL' } }); };
  assert.equal(run.enqueue(run.token, `director:${request.requestId}`, apply), true);
  assert.ok(game.director.request, 'Paused UI does not flush provider replies');
  game = dispatch(game, { type: 'pause', paused: false });
  run.flush();
  assert.equal(game.director.request, null);
  assert.equal(game.director.source, 'GEMINI');
  assert.equal(run.enqueue(run.token, `director:${request.requestId}`, apply), false);
  run.flush();
  assert.equal(game.events.filter(e => e.type === 'DIRECTOR_APPLIED').length, 1);
});

test('menu, restart and StrictMode cleanup invalidate queued and in-flight replies', async () => {
  const run = new AsyncRun();
  const old = run.token;
  let applied = 0;
  run.enqueue(old, 'speech:call-1', () => applied++);
  let deliver!: () => void;
  const late = new Promise<void>(resolve => { deliver = resolve; }).then(() => run.enqueue(old, 'director:request-1', () => applied++));
  run.invalidate();
  deliver();
  assert.equal(await late, false);
  run.flush();
  assert.equal(applied, 0);
  assert.equal(run.enqueue(run.token, 'speech:call-1', () => applied++), true, 'Same deterministic ID is usable in a fresh run');
  run.flush();
  assert.equal(applied, 1);
});

test('a run change while consuming replies cannot apply the remaining previous-run work', () => {
  const run = new AsyncRun();
  let stale = false;
  run.enqueue(run.token, 'restart', () => run.invalidate());
  run.enqueue(run.token, 'old-speech', () => { stale = true; });
  run.flush();
  assert.equal(stale, false);
});
