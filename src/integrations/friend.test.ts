import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../game/config';
import { dispatch } from '../game/reducer';
import type { DbConnection } from '../module_bindings';
import { DOOR_KEY_LENGTH, FRIEND_LIMITS, friendRowValid, friendSignalValid, manualRowValid, type ManualRow } from '../../spacetimedb/src/coopRules';
import { CoopManualFeed, FriendSignalReceiver, manualFromRow, manualRow, type CoopLink } from './coop';
import { challengeSolved, newChallenge } from '../spectate/challenge';
import { tileOpenings } from '../game/tasks';

const channelName = `hush-${'d'.repeat(64)}`;
const watch = `#watch=${encodeURIComponent(btoa(JSON.stringify({ channel: channelName })))}`;
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('shared limits match the game config', () => {
  assert.equal(DOOR_KEY_LENGTH, config.coop.doorKeyLength);
  assert.equal(FRIEND_LIMITS.maxDecoys, config.coop.decoy.charges);
  assert.ok(FRIEND_LIMITS.warnGapMs <= config.coop.warnCooldownSeconds * 1000 && FRIEND_LIMITS.decoyGapMs <= config.coop.decoy.cooldownSeconds * 1000, 'server limits never refuse what the game would accept');
});

test('door manual page round-trips; malformed door rows read as no page', () => {
  const page = { kind: 'door' as const, stage: 5 as const, key: [3, 1, 4, 2] };
  assert.ok(manualRowValid(manualRow(page))); assert.deepEqual(manualFromRow(manualRow(page)), page);
  assert.deepEqual(manualFromRow({ ...manualRow(page), values: Uint8Array.from([3, 1, 4, 2]) }), page);
  const row = manualRow(page);
  for (const bad of [{ ...row, stage: 4 }, { ...row, values: [3, 1, 4] }, { ...row, values: [0, 1, 2, 3] }, { ...row, values: [5, 1, 2, 3] }, { ...row, size: 2 }] as ManualRow[]) {
    assert.equal(manualRowValid(bad), false, JSON.stringify(bad)); assert.equal(manualFromRow(bad), null);
  }
});

test('friend signal and inbox row shapes', () => {
  assert.ok(friendSignalValid('warn') && friendSignalValid('decoy'));
  for (const bad of ['', 'WARN', 'attack', 3, null]) assert.equal(friendSignalValid(bad), false);
  assert.ok(friendRowValid({ warnCount: 2, decoyCount: 1 }));
  for (const bad of [null, {}, { warnCount: -1, decoyCount: 0 }, { warnCount: 1, decoyCount: 9 }, { warnCount: 1.5, decoyCount: 0 }]) assert.equal(friendRowValid(bad), false);
});

test('same-browser link: the spectator page sends, the player receives once per message, nothing outside a link', async () => {
  const link: CoopLink = { channel: channelName, connection: null, sessionId: null, ownerCapability: null };
  let current: CoopLink | null = link;
  const heard: string[] = [], receiver = new FriendSignalReceiver(() => current, kind => heard.push(kind));
  const feed = new CoopManualFeed(watch);
  const rogue = new BroadcastChannel(`${channelName}-friend`);
  try {
    receiver.poll(); await tick();
    assert.equal(await feed.send('warn'), 'local'); await tick();
    assert.deepEqual(heard, ['warn']);
    assert.equal(await feed.send('decoy'), 'local'); await tick();
    assert.deepEqual(heard, ['warn', 'decoy']);
    rogue.postMessage({ kind: 'attack', id: 'a'.repeat(16) }); rogue.postMessage({ kind: 'warn' }); rogue.postMessage({ kind: 'warn', id: 'zz' });
    const id = 'e'.repeat(16); rogue.postMessage({ kind: 'warn', id }); rogue.postMessage({ kind: 'warn', id }); await tick();
    assert.deepEqual(heard, ['warn', 'decoy', 'warn'], 'malformed messages ignored; a repeated id counts once');
    current = null; receiver.poll(); await feed.send('warn'); await tick();
    assert.equal(heard.length, 3, 'no link (sharing stopped): nothing reaches the game');
  } finally { rogue.close(); feed.dispose(); receiver.dispose(); }
});

test('SpacetimeDB inbox: only increases after subscribing reach the game, capped per update', () => {
  let rows: { warnCount: number; decoyCount: number }[] = [{ warnCount: 4, decoyCount: 1 }];
  const inserts: (() => void)[] = [];
  let applied: (() => void) | null = null, query = '';
  const connection = {
    isActive: true,
    db: { coopRemoteInbox: { iter: () => rows, onInsert: (cb: () => void) => inserts.push(cb), onDelete: () => {}, removeOnInsert: () => {}, removeOnDelete: () => {} } },
    subscriptionBuilder: () => { const b = { onApplied: (cb: () => void) => { applied = cb; return b; }, onError: () => b, subscribe: (q: string[]) => { query = q[0]!; return { unsubscribe() {} }; } }; return b; },
  } as unknown as DbConnection;
  const heard: string[] = [];
  const receiver = new FriendSignalReceiver(() => ({ channel: channelName, connection, sessionId: 'a'.repeat(64), ownerCapability: 'b'.repeat(64) }), kind => heard.push(kind));
  try {
    receiver.poll();
    assert.match(query, /coop_remote_inbox\('a{64}', 'b{64}'\)/);
    inserts.forEach(cb => cb()); assert.deepEqual(heard, [], 'nothing before the subscription settles');
    applied!(); inserts.forEach(cb => cb()); assert.deepEqual(heard, [], 'signals sent before the player subscribed are not replayed');
    rows = [{ warnCount: 5, decoyCount: 2 }]; inserts.forEach(cb => cb());
    assert.deepEqual(heard, ['warn', 'decoy']);
    rows = [{ warnCount: 50, decoyCount: 2 }]; inserts.forEach(cb => cb());
    assert.equal(heard.filter(k => k === 'warn').length, 4, 'a burst is capped at three');
    rows = [{ warnCount: 50, decoyCount: 99 }]; inserts.forEach(cb => cb());
    assert.equal(heard.filter(k => k === 'decoy').length, 1, 'malformed rows are ignored');
  } finally { receiver.dispose(); }
});

test('decoy challenges are the player\'s own puzzles: a conduit, then a memory sequence', () => {
  let conduit = newChallenge(17, 0);
  assert.equal(conduit.kind, 'conduit'); assert.equal(conduit.state.tasks.step, 'routing'); assert.equal(challengeSolved(conduit), false);
  const r = conduit.state.tasks.routing;
  r.answer.forEach((want, tile) => { if (want >= 0) while (tileOpenings(r.kinds[tile]!, conduit.state.tasks.routing.turns[tile]!) !== tileOpenings(r.kinds[tile]!, want)) conduit = { ...conduit, state: dispatch(conduit.state, { type: 'rotate', tile }) }; });
  conduit = { ...conduit, state: dispatch(conduit.state, { type: 'engage' }) };
  assert.equal(challengeSolved(conduit), true);
  let memory = newChallenge(17, 1);
  assert.equal(memory.kind, 'memory'); assert.equal(challengeSolved(memory), false);
  memory.state.tasks.memory.playing = false;
  for (const value of [...memory.state.tasks.memory.sequence]) memory = { ...memory, state: dispatch(memory.state, { type: 'input', value }) };
  assert.equal(challengeSolved(memory), true);
  assert.notDeepEqual(newChallenge(17, 2).state.tasks.routing.kinds, newChallenge(17, 0).state.tasks.routing.kinds, 'each decoy gets a fresh puzzle');
});
