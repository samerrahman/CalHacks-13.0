import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncRun } from '../src/ui/asyncRun';
import { createGame, dispatch } from '../src/game/reducer';
import { buildDirectorRequest } from '../src/game/directorValidation';

test('a provider result received during pause is consumed once and rejected after resume', () => {
  const run = new AsyncRun();
  let game = createGame(17);
  const request = buildDirectorRequest(game);
  game.director.request = request;
  game.director.requestSequence++;
  game = dispatch(game, { type: 'pause', paused: true });
  let attempts = 0;
  const apply = () => {
    attempts++;
    game = dispatch(game, { type: 'proposal', source: 'GEMINI', proposal: {
      requestId: request.requestId, stateVersion: request.stateVersion,
      tactic: 'WAIT', target: 'NONE', evidenceEventIds: [], reasonCode: 'NO_VALID_SIGNAL', tauntId: 'NONE',
    } });
  };
  assert.equal(run.enqueue(run.token, `director:${request.requestId}`, apply), true);
  assert.equal(game.director.request, null, 'Pausing invalidates semantic eligibility immediately');
  assert.equal(attempts, 0, 'Paused UI does not flush provider replies');
  game = dispatch(game, { type: 'pause', paused: false });
  run.flush();
  assert.equal(attempts, 1);
  assert.equal(game.director.source, 'FALLBACK');
  assert.equal(game.events.filter(e => e.type === 'DIRECTOR_APPLIED').length, 0);
  assert.equal(game.events.at(-1)?.detail, 'WRONG_REQUEST');
  assert.equal(run.enqueue(run.token, `director:${request.requestId}`, apply), false);
  run.flush();
  assert.equal(attempts, 1);
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
