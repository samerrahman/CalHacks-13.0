// End-to-end check of the spectator's combined fear number and the readings under it against a running SpacetimeDB. Usage:
// VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000 VITE_SPACETIMEDB_DB_NAME=hush-local node --import tsx spacetimedb/tests/liveFear.mts [out.json]
import { writeFileSync } from 'node:fs';
import { connectSpacetime, capabilityQuery, spacetimeConfig } from '../../src/integrations/spacetime';

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: { check: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { results.push({ check: name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ?? ''); };
const rejects = async (call: () => Promise<unknown>) => { try { await call(); return false; } catch { return true; } };

const id = hex(), owner = hex(), judge = hex();
const started = Date.now();
const player = await connectSpacetime();
const spectator = await connectSpacetime();
const stranger = await connectSpacetime();
type FearRow = { sequence: number; source: string; fearPct?: number };
// Callbacks assign these; the casts stop TypeScript narrowing them to their initial null.
type SignalsRow = { sequence: number; source: string; breathingRpm?: number; emotion?: string; emotionPct?: number; blinksPerMinute?: number; hrvMs?: number };
let fear = null as FearRow | null, vitals = null as { sequence: number } | null, signals = null as SignalsRow | null, strangerRows = 0;
// View updates arrive as separate insert + delete callbacks; read the settled cache instead.
const syncFear = () => { fear = [...spectator.db.spectatorFearFeed.iter()][0] ?? null; };
const syncVitals = () => { vitals = [...spectator.db.spectatorVitalsFeed.iter()][0] ?? null; };
const syncSignals = () => { signals = [...spectator.db.spectatorSignalsFeed.iter()][0] ?? null; };
spectator.db.spectatorFearFeed.onInsert(syncFear); spectator.db.spectatorFearFeed.onDelete(syncFear);
spectator.db.spectatorVitalsFeed.onInsert(syncVitals); spectator.db.spectatorVitalsFeed.onDelete(syncVitals);
spectator.db.spectatorSignalsFeed.onInsert(syncSignals); spectator.db.spectatorSignalsFeed.onDelete(syncSignals);
stranger.db.spectatorFearFeed.onInsert(() => { strangerRows++; }); stranger.db.spectatorSignalsFeed.onInsert(() => { strangerRows++; });

await player.reducers.createSession({ id, ownerCapability: owner, judgeCapability: judge, consent: true, seed: 17, mode: 'coop' });
await new Promise<void>((resolve, reject) => spectator.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error('spectator subscription failed'))).subscribe([capabilityQuery('spectator_vitals_feed', id, judge), capabilityQuery('spectator_fear_feed', id, judge), capabilityQuery('spectator_signals_feed', id, judge)]));
await new Promise<void>((resolve, reject) => stranger.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error('stranger subscription failed'))).subscribe([capabilityQuery('spectator_fear_feed', id, hex()), capabilityQuery('spectator_signals_feed', id, hex())]));
const vitalsAt = (sequence: number, source = 'simulated') => player.reducers.shareVitals({ id, ownerCapability: owner, sequence, source, status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 80, baselineBpm: 72 });
const fearAt = (sequence: number, fearPct: number | undefined, source = 'simulated', ownerCapability = owner) => player.reducers.shareFear({ id, ownerCapability, sequence, source, fearPct });
const signalsAt = (sequence: number, extra: Partial<Omit<SignalsRow, 'sequence'>> = {}, ownerCapability = owner) => player.reducers.shareSignals({ id, ownerCapability, sequence, source: 'simulated', breathingRpm: 18, emotion: 'fear', emotionPct: 41, blinksPerMinute: 24, hrvMs: 36, ...extra });

// 1. Fear rides on the vitals consent: nothing shows before a vitals row exists.
await fearAt(1, 40);
await wait(400);
check('a fear write before any vitals row is dropped', fear === null && vitals === null);

// 2. Shared after the vitals row, revalidated, latest value only.
await vitalsAt(2); await fearAt(2, 64);
await wait(400);
check('the combined fear reaches the spectator, labelled simulated, without a server clock', fear?.fearPct === 64 && fear.source === 'simulated' && !('updatedAtMs' in (fear ?? {})), fear);
check('a fear above 100 is rejected', await rejects(() => fearAt(3, 101)));
check('a wrong owner capability cannot write fear', await rejects(() => fearAt(3, 10, 'simulated', hex())));
check('an unknown source is rejected', await rejects(() => fearAt(3, 10, 'manual')));
await wait(600);
await fearAt(3, 12, 'presage');
await wait(400);
check('a fear write whose source differs from the vitals row is dropped (simulated stays labelled)', fear?.fearPct === 64 && fear.source === 'simulated', fear);
await fearAt(4, 81);
await wait(400);
check('a later reading replaces the row', fear?.fearPct === 81 && fear.sequence === 4, fear);
await wait(600);
await fearAt(3, 5);
await wait(400);
check('an older sequence never overwrites a newer reading', fear?.fearPct === 81, fear);
await wait(600);
await fearAt(5, undefined);
await wait(400);
check('a reading with nothing to go on clears the number but keeps the row', fear !== null && fear.fearPct === undefined && fear.sequence === 5, fear);

// 2b. The readings under FEAR: same consent and revalidation.
await wait(600);
await signalsAt(6);
await wait(400);
check('the readings reach the spectator as whole numbers, without a server clock', signals?.breathingRpm === 18 && signals.emotion === 'fear' && signals.emotionPct === 41 && signals.blinksPerMinute === 24 && signals.hrvMs === 36 && !('updatedAtMs' in (signals ?? {})), signals);
check('an unknown expression is rejected', await rejects(() => signalsAt(7, { emotion: 'giddy' })));
check('an expression without its strength is rejected', await rejects(() => signalsAt(7, { emotionPct: undefined })));
check('an implausible breathing rate is rejected', await rejects(() => signalsAt(7, { breathingRpm: 90 })));
check('a wrong owner capability cannot write the readings', await rejects(() => signalsAt(7, {}, hex())));
await wait(600);
await signalsAt(7, { breathingRpm: undefined, emotion: undefined, emotionPct: undefined, blinksPerMinute: 20 });
await wait(400);
check('a later reading replaces the row, and unmeasured fields stay empty', signals?.sequence === 7 && signals.breathingRpm === undefined && signals.emotion === undefined && signals.blinksPerMinute === 20, signals);

// 3. Withdrawing the vitals consent deletes the fear and the readings, and a late write cannot bring them back.
await player.reducers.stopVitals({ id, ownerCapability: owner });
await wait(400);
check('withdrawing consent deletes the fear and readings rows for the spectator', fear === null && signals === null && vitals === null);
await signalsAt(8);
await wait(400);
check('a readings write landing after the withdrawal is dropped', signals === null);
await fearAt(6, 70);
await wait(400);
check('a fear write landing after the withdrawal is dropped', fear === null);

// 4. An abandoned share is swept with its vitals.
await vitalsAt(9); await fearAt(9, 33); await signalsAt(9);
await wait(500);
const sharedAgain = fear?.fearPct === 33 && signals !== null;
await wait(21_000);
check('abandoned fear and readings rows are swept with their vitals within 21 s', sharedAgain && fear === null && signals === null && vitals === null);

// 5. Capability isolation and session removal.
check('a spectator with the wrong capability receives no fear or readings rows', strangerRows === 0);
await vitalsAt(10); await fearAt(10, 50); await signalsAt(10);
await wait(400);
const beforeRemove = fear?.fearPct === 50 && signals !== null;
await player.reducers.removeSession({ id, ownerCapability: owner });
await wait(600);
check('removing the session removes the fear and readings rows', beforeRemove && fear === null && signals === null);

player.disconnect(); spectator.disconnect(); stranger.disconnect();
const out = { checkedAt: new Date().toISOString(), server: spacetimeConfig.uri, database: spacetimeConfig.database, durationMs: Date.now() - started, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
process.exit(out.failed ? 1 : 0);
