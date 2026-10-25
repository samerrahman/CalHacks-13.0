import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../game/reducer';
import { coopManual, type CoopManual } from '../game/coop';
import { beginStep, startStage } from '../game/tasks';
import type { DbConnection } from '../module_bindings';
import { manualRowValid, type ManualRow } from '../../spacetimedb/src/coopRules';
import { CoopManualFeed, CoopManualPublisher, currentManual, manualFromRow, manualRow, type CoopFeedState, type CoopLink } from './coop';

const NONE: ManualRow = { kind: 'none', stage: 0, panel: 0, panels: 0, size: 0, start: 0, end: 0, values: [] };
const pages: CoopManual[] = [
  { kind: 'faults', stage: 3, sounds: [1, 3, 0, 2] },
  { kind: 'wires', stage: 1, panel: 0, panels: 1, sockets: [4, 0, 5, 1, 3, 2] },
  { kind: 'routing', stage: 1, size: 4, start: 2, end: 0, tiles: [0, 10, 12, 0, 3, 9, 5, 0, 10, 10, 6, 0, 0, 0, 0, 0] },
  { kind: 'memory', stage: 4, sequence: [3, 1, 4, 4, 2], entered: 2, playing: false },
  { kind: 'locate', stage: 3, rings: [1, 2], marks: 1, required: 3 },
  { kind: 'calm', stage: 4, inhale: false, halfTenths: 42, elapsedTenths: 17, progress: 6, required: 12 },
];
const channelName = `hush-${'c'.repeat(64)}`;
const watch = `#watch=${encodeURIComponent(btoa(JSON.stringify({ channel: channelName })))}`;
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('manual rows round-trip, and malformed rows read as no page', () => {
  for (const page of pages) { assert.ok(manualRowValid(manualRow(page))); assert.deepEqual(manualFromRow(manualRow(page)), page); }
  assert.deepEqual(manualRow(null), NONE); assert.equal(manualFromRow(NONE), null);
  assert.deepEqual(manualFromRow({ ...manualRow(pages[0]!), values: Uint8Array.from([1, 3, 0, 2]) }), pages[0], 'a SpacetimeDB byte array reads the same');
  const bad: unknown[] = [
    null, 'faults', { ...NONE, kind: 'answer' }, { ...NONE, stage: 1 },
    { ...manualRow(pages[0]!), values: [0, 0, 1, 2] }, { ...manualRow(pages[0]!), stage: 2 }, { ...manualRow(pages[0]!), panel: 1 },
    { ...manualRow(pages[1]!), panel: 1 }, { ...manualRow(pages[1]!), values: [0, 1, 2, 3, 4, 5, 6] },
    { ...manualRow(pages[2]!), values: [16, ...Array(15).fill(0)] }, { ...manualRow(pages[2]!), stage: 3 }, { ...manualRow(pages[2]!), values: Array(37).fill(0) }, { ...manualRow(pages[2]!), start: 4 },
    { ...manualRow(pages[3]!), values: [3, 5] }, { ...manualRow(pages[3]!), stage: 3 }, { ...manualRow(pages[3]!), panel: 6 }, { ...manualRow(pages[3]!), size: 1 },
    { ...manualRow(pages[4]!), values: [2, 1] }, { ...manualRow(pages[4]!), values: [4] }, { ...manualRow(pages[4]!), panel: 3 }, { ...manualRow(pages[4]!), stage: 1 },
    { ...manualRow(pages[5]!), start: 43 }, { ...manualRow(pages[5]!), end: 13 }, { ...manualRow(pages[5]!), values: [1] }, { ...manualRow(pages[5]!), panel: 2 }, { ...manualRow(pages[5]!), stage: 2 },
  ];
  for (const row of bad) { assert.equal(manualFromRow(row), null, JSON.stringify(row)); if (row && typeof row === 'object') assert.equal(manualRowValid(row as ManualRow), false); }
});

test('the publisher posts the live page on the -coop channel, writes on change at most once a second, and withdraws on close', async () => {
  const calls: Record<string, unknown>[] = [];
  const connection = { isActive: true, reducers: { publishManual: async (args: Record<string, unknown>) => { calls.push(args); } } } as unknown as DbConnection;
  let link: CoopLink | null = { channel: channelName, connection, sessionId: 'a'.repeat(64), ownerCapability: 'b'.repeat(64) };
  const publisher = new CoopManualPublisher(() => link), heard: unknown[] = [];
  const listener = new BroadcastChannel(`${channelName}-coop`); listener.onmessage = e => heard.push(e.data);
  try {
    publisher.publish(createGame(17), 0); await tick();
    assert.equal(heard.length, 0); assert.equal(calls.length, 0, 'a standard run publishes nothing');
    // The live page is the breathing pacer (every other answer is in the friend's book).
    const game = createGame(17, 'coop'); startStage(game, 4); beginStep(game, 'calm'); const page = coopManual(game)!;
    publisher.publish(game, 0); await tick();
    assert.deepEqual(manualFromRow(heard.at(-1)), page); assert.equal(calls.length, 1);
    assert.equal(calls[0]!.ownerCapability, 'b'.repeat(64)); assert.ok(calls[0]!.values instanceof Uint8Array);
    publisher.publish(game, 400); await tick();
    assert.equal(heard.length, 1); assert.equal(calls.length, 1, 'an unchanged page is neither reposted nor rewritten within a second');
    const changed = structuredClone(game); changed.time += 1.3;
    publisher.publish(changed, 600); await tick();
    assert.notDeepEqual(manualFromRow(heard.at(-1)), page, 'the local link changes at once');
    assert.equal(calls.length, 1, 'the database waits for the one-second gap');
    publisher.publish(changed, 1100); await tick();
    assert.equal(calls.length, 2); assert.equal(calls[1]!.kind, 'calm'); assert.ok((calls[1]!.sequence as number) > (calls[0]!.sequence as number));
    publisher.publish(changed, 2200); await tick();
    assert.equal(heard.length, 3, 'reposted once a second for late joiners'); assert.equal(calls.length, 2, 'but not rewritten');
    link = null; publisher.publish(changed, 3000); await tick();
    assert.deepEqual(heard.at(-1), NONE, 'sharing off withdraws the page from the local link');
  } finally { listener.close(); publisher.dispose(); }
});

test('a same-browser spectator reads the page from the -coop channel; local wins only while fresh', async () => {
  const feed = new CoopManualFeed(watch), player = new BroadcastChannel(`${channelName}-coop`);
  try {
    const states: CoopFeedState[] = [];
    const arrived = new Promise<void>(resolve => feed.subscribe(s => { states.push(s); if (s.local) resolve(); }));
    player.postMessage(manualRow(pages[1]!));
    await arrived;
    const latest = states.at(-1)!;
    assert.deepEqual(currentManual(latest, latest.localAt!), pages[1]);
    assert.deepEqual(currentManual({ ...latest, remote: pages[0] }, latest.localAt! + 10_000), pages[0], 'a stale local link yields to the database row');
    assert.equal(currentManual({ ...latest, remote: undefined }, latest.localAt! + 10_000), null);
    player.postMessage({ ...manualRow(pages[1]!), values: [0, 0, 0, 0, 0, 0] }); await tick();
    assert.equal(states.at(-1)!.local, null, 'an invalid message is no page, never a partial one');
  } finally { player.close(); feed.dispose(); }
  const invalid = new CoopManualFeed('#watch=nonsense'), seen: CoopFeedState[] = [];
  invalid.subscribe(s => seen.push(s)); assert.match(seen[0]!.status, /Invalid/); invalid.dispose();
});
