// End-to-end check of physics + spectate against a running SpacetimeDB. Usage:
// VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000 VITE_SPACETIMEDB_DB_NAME=hush-local npm run spacetime:e2e -- [out.json]
import { writeFileSync } from 'node:fs';
import { connectSpacetime, capabilityQuery, spacetimeConfig } from '../../src/integrations/spacetime';
import { PROPS } from '../src/physicsSim';

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: { check: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { results.push({ check: name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const summary = (time: number) => ({ time, stage: 1, status: 'playing', equipment: 'on', creatureNode: 'SHELTER_WALL', creaturePhase: 'approach', linePosition: 2, lineLength: 24, danger: 40, quietChargesRemaining: 3, tactic: 'WAIT', target: 'NONE', proposalSource: 'FALLBACK', sensorSource: 'simulated', sensorQuality: 'accepted', trend: 'STEADY', sensorAgeMs: 200 });

const id = hex(), owner = hex(), judge = hex();
const started = Date.now();
const player = await connectSpacetime();
const spectator = await connectSpacetime();
const stranger = await connectSpacetime();
type Prop = { slot: number; x: number; y: number; z: number; sleeping: boolean; tick: number };
const props = new Map<number, Prop>();
type VitalsRow = { sequence?: number; source?: string; pulseBpm?: number };
// Callbacks assign these; the casts stop TypeScript narrowing them to their initial null.
let vitals = null as VitalsRow | null, trace = null as unknown, vitalsUpdates = 0, strangerRows = 0;
// View updates arrive as separate insert + delete callbacks; read the settled cache instead.
const syncProps = () => { props.clear(); for (const r of spectator.db.physicsFeed.iter()) props.set(r.slot, r); };
const syncVitals = () => { const r = [...spectator.db.spectatorVitalsFeed.iter()][0] ?? null; if (r && r.sequence !== vitals?.sequence) vitalsUpdates++; vitals = r; };
const syncTrace = () => { trace = [...spectator.db.judgeTrace.iter()][0] ?? null; };
spectator.db.physicsFeed.onInsert(syncProps); spectator.db.physicsFeed.onDelete(syncProps);
spectator.db.spectatorVitalsFeed.onInsert(syncVitals); spectator.db.spectatorVitalsFeed.onDelete(syncVitals);
spectator.db.judgeTrace.onInsert(syncTrace); spectator.db.judgeTrace.onDelete(syncTrace);
for (const t of [stranger.db.physicsFeed, stranger.db.spectatorVitalsFeed, stranger.db.judgeTrace] as const) (t as { onInsert(cb: () => void): void }).onInsert(() => { strangerRows++; });

await player.reducers.createSession({ id, ownerCapability: owner, judgeCapability: judge, consent: true, seed: 17, mode: 'standard' });
await new Promise<void>((resolve, reject) => spectator.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error('spectator subscription failed'))).subscribe([capabilityQuery('judge_trace', id, judge), capabilityQuery('spectator_vitals_feed', id, judge), capabilityQuery('physics_feed', id, judge)]));
await new Promise<void>((resolve, reject) => stranger.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error('stranger subscription failed'))).subscribe([capabilityQuery('judge_trace', id, hex()), capabilityQuery('spectator_vitals_feed', id, hex()), capabilityQuery('physics_feed', id, hex())]));

// 1. Trace events create the world and a door pound kicks the props.
await player.reducers.appendTrace({ id, ownerCapability: owner, events: [{ id: 'e1', seq: 1, time: 0, type: 'RUN_STARTED', detail: 'standard' }], summary: summary(0.5) });
await wait(600);
check('first trace batch creates a resting 12-prop world visible to the spectator', props.size === PROPS.length && [...props.values()].every(p => p.sleeping), { props: props.size });
const spawn = new Map([...props].map(([k, v]) => [k, { ...v }]));
await player.reducers.appendTrace({ id, ownerCapability: owner, events: [{ id: 'e2', seq: 2, time: 30, type: 'PROXIMITY_ALARM', detail: '' }, { id: 'e3', seq: 3, time: 30, type: 'SCARE', detail: 'impact' }], summary: summary(30) });
await wait(400);
const moving = [...props.values()].filter(p => !p.sleeping).length, tickEarly = Math.max(...[...props.values()].map(p => p.tick));
check('SCARE impact wakes props and the server tick advances them', moving > 0 && tickEarly > 0, { moving, tick: tickEarly });
await wait(3600);
const settled = [...props.values()];
const displaced = settled.map(p => Math.hypot(p.x - spawn.get(p.slot)!.x, p.z - spawn.get(p.slot)!.z));
check('props settle back to sleep within 4 s, displaced by the pound', settled.every(p => p.sleeping) && Math.max(...displaced) > 0.05, { maxDisplacementM: +Math.max(...displaced).toFixed(3), tick: Math.max(...settled.map(p => p.tick)) });
const tickAfter = Math.max(...settled.map(p => p.tick));
await wait(800);
check('the scheduled tick stops once every prop sleeps', Math.max(...[...props.values()].map(p => p.tick)) === tickAfter);
// Resending an acknowledged batch must not kick again.
await player.reducers.appendTrace({ id, ownerCapability: owner, events: [{ id: 'e3', seq: 3, time: 30, type: 'SCARE', detail: 'impact' }], summary: summary(31) });
await wait(500);
check('a resent event batch does not re-apply its impulse', [...props.values()].every(p => p.sleeping));

// 2. Vitals: shared only after the separate consent, revalidated, revocable.
check('no vitals row exists before the player opts in', vitals === null && trace !== null);
await player.reducers.shareVitals({ id, ownerCapability: owner, sequence: 1, source: 'simulated', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 83, baselineBpm: 72 });
await wait(400);
check('opted-in vitals reach the spectator, labelled simulated, without a server clock', vitals?.source === 'simulated' && vitals.pulseBpm === 83 && !('updatedAtMs' in (vitals ?? {})), vitals);
let rejected = false;
try { await player.reducers.shareVitals({ id, ownerCapability: owner, sequence: 2, source: 'simulated', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: undefined, baselineBpm: 72 }); } catch { rejected = true; }
check('an accepted reading without a pulse is rejected', rejected);
rejected = false;
try { await player.reducers.shareVitals({ id, ownerCapability: hex(), sequence: 3, source: 'presage', status: 'ready', quality: 'accepted', trend: 'ELEVATED', pulseBpm: 99, baselineBpm: 72 }); } catch { rejected = true; }
check('a wrong owner capability cannot write vitals', rejected);
await wait(600);
await player.reducers.shareVitals({ id, ownerCapability: owner, sequence: 4, source: 'simulated', status: 'ready', quality: 'accepted', trend: 'ELEVATED', pulseBpm: 92, baselineBpm: 72 });
await wait(400);
check('a later reading replaces the row (latest value only)', vitals?.pulseBpm === 92, { updates: vitalsUpdates });
await player.reducers.stopVitals({ id, ownerCapability: owner });
await wait(400);
check('withdrawing consent deletes the row for the spectator', vitals === null);

// 3. Owner knock and capability isolation.
await player.reducers.physicsKnock({ id, ownerCapability: owner, slot: 1 });
await wait(300);
check('an owner knock moves exactly that prop', props.get(1)?.sleeping === false && [...props.values()].filter(p => !p.sleeping).length >= 1);
check('a spectator with the wrong capability receives no rows at all', strangerRows === 0);

// 4. Removing the session cascades.
await player.reducers.removeSession({ id, ownerCapability: owner });
await wait(600);
check('removing the session removes trace and props from the spectator', trace === null && props.size === 0, { props: props.size });

player.disconnect(); spectator.disconnect(); stranger.disconnect();
const out = { checkedAt: new Date().toISOString(), server: spacetimeConfig.uri, database: spacetimeConfig.database, durationMs: Date.now() - started, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
process.exit(out.failed ? 1 : 0);
