// End-to-end check of the co-op manual against a running SpacetimeDB. Usage:
// VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000 VITE_SPACETIMEDB_DB_NAME=hush-local node --import tsx spacetimedb/tests/liveCoop.mts [out.json]
import { writeFileSync } from 'node:fs';
import { connectSpacetime, capabilityQuery, spacetimeConfig } from '../../src/integrations/spacetime';
import { CoopManualPublisher, manualFromRow, manualRow } from '../../src/integrations/coop';
import { coopManual } from '../../src/game/coop';
import { createGame } from '../../src/game/reducer';

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: { check: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { results.push({ check: name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const refused = async (call: () => Promise<unknown>) => { try { await call(); return false; } catch { return true; } };
const summary = { time: 1, stage: 1, status: 'playing', equipment: 'on', creatureNode: 'NEAR_PATH', creaturePhase: 'search', linePosition: 18, lineLength: 24, danger: 12, quietChargesRemaining: 3, tactic: 'WAIT', target: 'NONE', proposalSource: 'FALLBACK', sensorSource: 'manual', sensorQuality: 'unknown', trend: 'UNKNOWN', sensorAgeMs: undefined };

const id = hex(), owner = hex(), judge = hex(), soloId = hex(), soloOwner = hex();
const started = Date.now();
const player = await connectSpacetime(), friend = await connectSpacetime(), stranger = await connectSpacetime();
type Row = { sequence: number; kind: string; values: Uint8Array };
let page = null as Row | null, trace = null as { mode: string; events: { type: string; detail: string }[] } | null, strangerRows = 0;
const syncPage = () => { page = [...friend.db.coopManualFeed.iter()][0] ?? null; };
const syncTrace = () => { trace = [...friend.db.judgeTrace.iter()][0] ?? null; };
friend.db.coopManualFeed.onInsert(syncPage); friend.db.coopManualFeed.onDelete(syncPage);
friend.db.judgeTrace.onInsert(syncTrace); friend.db.judgeTrace.onDelete(syncTrace);
stranger.db.coopManualFeed.onInsert(() => { strangerRows++; });

await player.reducers.createSession({ id, ownerCapability: owner, judgeCapability: judge, consent: true, seed: 17, mode: 'coop' });
await player.reducers.createSession({ id: soloId, ownerCapability: soloOwner, judgeCapability: hex(), consent: true, seed: 17, mode: 'standard' });
check('a co-op session can be created', true);
await new Promise<void>((resolve, reject) => friend.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error('friend subscription failed'))).subscribe([capabilityQuery('coop_manual_feed', id, judge), capabilityQuery('judge_trace', id, judge)]));
await new Promise<void>((resolve, reject) => stranger.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error('stranger subscription failed'))).subscribe([capabilityQuery('coop_manual_feed', id, hex())]));
check('no manual row exists before the player publishes', page === null);

await player.reducers.appendTrace({ id, ownerCapability: owner, events: [{ id: 'e1', seq: 1, time: 0, type: 'RUN_STARTED', detail: 'coop' }], summary });
await wait(300);
check('the RUN_STARTED coop detail survives the server whitelist', trace?.mode === 'coop' && trace.events[0]?.detail === 'coop', trace?.events[0]);

// The real publisher, driven like the UI clock, with this connection.
const game = createGame(17, 'coop'), expected = coopManual(game);
const publisher = new CoopManualPublisher(() => ({ channel: `hush-${id}`, connection: player, sessionId: id, ownerCapability: owner }));
publisher.publish(game);
await wait(500);
check('the publisher writes the live page and the friend receives it', !!page && JSON.stringify(manualFromRow(page)) === JSON.stringify(expected), page && { kind: page.kind, values: [...page.values] });
check('the feed row carries no server clock or capability', !!page && !('updatedAtMs' in page) && !('ownerCapability' in page));
const first = page?.sequence ?? 0;

const base = { id, ownerCapability: owner, ...manualRow(expected), values: Uint8Array.from(manualRow(expected).values) };
check('a wrong owner capability cannot write the manual', await refused(() => player.reducers.publishManual({ ...base, ownerCapability: hex(), sequence: first + 10 })));
check('a standard session cannot hold a manual', await refused(() => player.reducers.publishManual({ ...base, id: soloId, ownerCapability: soloOwner, sequence: 1 })));
check('a malformed page is refused', await refused(() => player.reducers.publishManual({ ...base, sequence: first + 11, values: Uint8Array.from([0, 0, 1, 2]) })));
check('an oversize page is refused', await refused(() => player.reducers.publishManual({ ...base, kind: 'routing', stage: 1, size: 7, values: new Uint8Array(49), sequence: first + 12 })));
const wires = { ...base, kind: 'wires', panel: 0, panels: 1, values: Uint8Array.from([2, 0, 1, 5, 3, 4]), sequence: first + 20 };
await player.reducers.publishManual(wires);
check('a write within 250 ms of the last is refused, so the client retries', await refused(() => player.reducers.publishManual({ ...base, sequence: first + 21 })));
await wait(300);
check('a later page replaces the row (latest page only)', page?.kind === 'wires' && page.sequence === first + 20);
await player.reducers.publishManual({ ...base, sequence: first + 15 });
await wait(300);
check('a late (lower sequence) write is ignored', page?.kind === 'wires');
check('a friend with the wrong capability receives no rows', strangerRows === 0);

await player.reducers.removeSession({ id, ownerCapability: owner });
await wait(500);
check('removing the session deletes the manual for the friend', page === null && trace === null);
await player.reducers.removeSession({ id: soloId, ownerCapability: soloOwner });

publisher.dispose(); player.disconnect(); friend.disconnect(); stranger.disconnect();
const out = { checkedAt: new Date().toISOString(), server: spacetimeConfig.uri, database: spacetimeConfig.database, durationMs: Date.now() - started, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
process.exit(out.failed ? 1 : 0);
