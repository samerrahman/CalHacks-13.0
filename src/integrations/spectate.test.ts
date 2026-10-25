import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../game/reducer';
import { emit } from '../game/state';
import type { SensorView } from '../sensing/types';
import { TraceBridge, sanitizedTrace, type TraceSnapshot } from './client';
import { localVitals, parseWatchAccess, remoteVitals, SpectateFeed, spectatorFear, spectatorVitals, type SpectateState } from './spectate';
import type { SensorSignals } from '../sensing/types';
import { LocalPhysics } from './physics';

const view = (patch: Partial<SensorView>): SensorView => ({ source: 'simulated', status: 'ready', trend: 'STEADY', quality: 'accepted', hint: 'SIMULATED', baselineBpm: 71.6, pulseBpm: 83.4, ageMs: 200, acceptedSeconds: 30, canContinueManual: true, sampleAtMs: 1234, captureSegment: 1, ...patch });
const nextMessage = (channel: BroadcastChannel) => new Promise<TraceSnapshot>(resolve => { channel.onmessage = e => resolve(e.data as TraceSnapshot); });

test('spectators get whole BPM, coarse labels and one fear number only, never for manual play', () => {
  assert.deepEqual(spectatorVitals(view({})), { source: 'simulated', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 83, baselineBpm: 72, fearPct: 47 });
  assert.equal(spectatorVitals(view({ source: 'manual', status: 'manual' })), null);
  assert.deepEqual(spectatorVitals(view({ source: 'presage', quality: 'rejected', pulseBpm: null, trend: 'ELEVATED' })), { source: 'presage', status: 'ready', quality: 'rejected', trend: 'UNKNOWN', pulseBpm: null, baselineBpm: 72, fearPct: null });
  const shared = spectatorVitals(view({ source: 'presage', diagnostics: undefined, breathingRpm: 21, restingBreathingRpm: 14, signals: signals({ fear: .41, edaRelative: 1.2 }) }))!;
  assert.deepEqual(Object.keys(shared).sort(), ['baselineBpm', 'fearPct', 'pulseBpm', 'quality', 'source', 'status', 'trend']);
  assert.equal(JSON.stringify(shared).includes('1234'), false, 'no measurement clock');
  assert.equal(/21|14|41|1\.2|breath|express|eda/i.test(JSON.stringify(shared)), false, 'none of the parts behind the fear number');
});

/** Presage-style signals where every estimate is ok; tests override the values they need. */
function signals(patch: Partial<SensorSignals>): SensorSignals {
  const ok = { status: 'ok', reason: '' } as const;
  return { breathingBpm: null, breathPhase: null, abdomenShare: null, hrv: null, blinksPerMinute: null, lastBlinkAgeMs: null, talking: null, expressions: null, fear: null, edaRelative: null,
    status: { pulse: ok, breathing: ok, chest: ok, abdomen: ok, hrv: ok, blinking: ok, talking: ok, expressions: ok, eda: ok, arterial: ok }, ...patch };
}

test('the fear number blends face, heart rate, breathing and skin response, led by the strongest', () => {
  const calm = view({ source: 'presage', pulseBpm: 72, baselineBpm: 72, breathingRpm: 14, restingBreathingRpm: 14, signals: signals({ fear: .03, edaRelative: 0 }) });
  assert.equal(spectatorFear(calm), 2, 'a calm player at baseline reads near zero');
  // Face .9 alone: .6 × .9 + .4 × (.4 × .9 + 0) / 1 = .684.
  assert.equal(spectatorFear({ ...calm, signals: signals({ fear: .9, edaRelative: 0 }) }), 68, 'a startled face reads as fear before the pulse catches up');
  // Heart +25, breathing +8, skin +3, face 1: every part full.
  assert.equal(spectatorFear(view({ source: 'presage', pulseBpm: 97, baselineBpm: 72, breathingRpm: 22, restingBreathingRpm: 14, signals: signals({ fear: 1, edaRelative: 3 }) })), 100);
  assert.equal(spectatorFear(view({ source: 'presage', pulseBpm: 81, baselineBpm: 72, trend: 'ELEVATED' })), 55, 'a sustained rise reads at least 55');
  assert.equal(spectatorFear(view({ source: 'presage', pulseBpm: 75, baselineBpm: 72, trend: 'ELEVATED' })), 12, 'no floor while the pulse itself is barely up (browser ELEVATED from a face spike)');
  const rejectedBreath = signals({ fear: .03, edaRelative: 0 }); rejectedBreath.status = { ...rejectedBreath.status, breathing: { status: 'rejected', reason: 'chest not visible' } };
  assert.equal(spectatorFear(view({ source: 'presage', pulseBpm: 72, baselineBpm: 72, breathingRpm: 22, restingBreathingRpm: 14, signals: rejectedBreath })), 2, 'a rejected breathing estimate stops counting at once');
  assert.equal(spectatorFear(view({ quality: 'rejected', pulseBpm: null, trend: 'UNKNOWN' })), null, 'nothing to go on');
  assert.equal(spectatorFear(view({ quality: 'unknown', pulseBpm: null, trend: 'ELEVATED' })), null, 'a held trend alone does not count without an accepted pulse');
  const warming = signals({ fear: .9, edaRelative: 3 }); warming.status = { ...warming.status, expressions: { status: 'warming', reason: '' }, eda: { status: 'stale', reason: '' } };
  assert.equal(spectatorFear(view({ pulseBpm: 72, baselineBpm: 72, signals: warming })), 0, 'estimates that are not ok are ignored');
  assert.equal(spectatorFear(view({ source: 'manual', status: 'manual' })), null);
});

test('remote vitals rows are revalidated before display', () => {
  assert.deepEqual(remoteVitals({ source: 'simulated', status: 'ready', quality: 'accepted', trend: 'ELEVATED', pulseBpm: 91, baselineBpm: 70 }), { source: 'simulated', status: 'ready', quality: 'accepted', trend: 'ELEVATED', pulseBpm: 91, baselineBpm: 70, fearPct: null });
  assert.equal(remoteVitals({ source: 'simulated', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 80, baselineBpm: 70 }, { source: 'simulated', fearPct: 64 })?.fearPct, 64);
  for (const fear of [{ source: 'presage', fearPct: 64 }, { source: 'simulated', fearPct: 101 }, { source: 'simulated', fearPct: 12.5 }, { source: 'simulated', fearPct: -1 }, { source: 'simulated' }])
    assert.equal(remoteVitals({ source: 'simulated', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 80, baselineBpm: 70 }, fear)?.fearPct, null, JSON.stringify(fear));
  assert.equal(remoteVitals(undefined, { source: 'simulated', fearPct: 64 }), null, 'no fear without the vitals row');
  const row = { source: 'simulated', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 80, baselineBpm: 70, sequence: 40 };
  assert.equal(remoteVitals(row, { source: 'simulated', fearPct: 64, sequence: 39 })?.fearPct, 64, 'the fear row may trail the vitals row by a reading or two');
  assert.equal(remoteVitals(row, { source: 'simulated', fearPct: 64, sequence: 30 })?.fearPct, null, 'a left-over fear row (player stopped sending it) is not current');
  assert.equal(localVitals({ source: 'presage', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 80, baselineBpm: 72 })?.fearPct, null, 'an older player build sends no fear number');
  assert.equal(localVitals({ source: 'presage', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 80, baselineBpm: 72, fearPct: 33 })?.fearPct, 33);
  assert.equal(localVitals({ source: 'presage', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 80, baselineBpm: 72, fearPct: '33' })?.fearPct, null, 'a fear value that is not a number is dropped');
  assert.equal(localVitals('nonsense'), null);
});

test('remote vitals rows without a source or pulse are rejected or downgraded', () => {
  assert.equal(remoteVitals({ source: 'manual', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 70 }), null);
  assert.equal(remoteVitals({ source: 'presage', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: undefined })?.quality, 'unknown');
  assert.equal(remoteVitals(undefined), null);
});

test('watch links must carry a well-formed channel', () => {
  assert.throws(() => parseWatchAccess('#watch=nonsense'));
  assert.throws(() => parseWatchAccess(`#watch=${btoa(JSON.stringify({ channel: 'other' }))}`));
  assert.equal(parseWatchAccess(`#watch=${encodeURIComponent(btoa(JSON.stringify({ channel: `hush-${'a'.repeat(64)}` })))}`).channel, `hush-${'a'.repeat(64)}`);
});

test('heart rate reaches the local link only while its separate consent is on', async () => {
  (globalThis as { location?: unknown }).location = { origin: 'http://127.0.0.1:5173', pathname: '/' };
  const bridge = new TraceBridge();
  assert.equal(bridge.setVitalsConsent(true), false, 'needs trace sharing first');
  await bridge.connect(true, 17, 'standard');
  const url = bridge.spectateUrl()!;
  assert.match(url, /^http:\/\/127\.0\.0\.1:5173\/#watch=/);
  const listener = new BroadcastChannel(parseWatchAccess(new URL(url).hash).channel);
  try {
    const state = createGame(17);
    let message = nextMessage(listener); bridge.publish(state, view({}));
    assert.equal((await message).vitals, null, 'trace sharing alone shares no heart rate');
    assert.equal(bridge.setVitalsConsent(true), true);
    message = nextMessage(listener); bridge.publish(state, view({}));
    assert.deepEqual((await message).vitals, spectatorVitals(view({})));
    message = nextMessage(listener); bridge.setVitalsConsent(false);
    assert.equal((await message).vitals, null, 'withdrawal is posted at once, without waiting for the next frame');
    assert.equal(bridge.sharingVitals, false);
    const trace = JSON.stringify(sanitizedTrace(state, view({})));
    assert.equal(/vitals|pulse|baseline/i.test(trace), false, 'the sanitized trace itself still carries no pulse');
  } finally { listener.close(); await bridge.dispose(); }
});

test('a same-browser spectator follows the trace, vitals and an offline physics replay', async () => {
  const channel = `hush-${'b'.repeat(64)}`;
  const feed = new SpectateFeed(`#watch=${encodeURIComponent(btoa(JSON.stringify({ channel })))}`);
  const player = new BroadcastChannel(channel);
  try {
    const states: SpectateState[] = [];
    const arrived = new Promise<void>(resolve => feed.subscribe(s => { states.push(s); if (s.trace) resolve(); }));
    const game = createGame(17);
    emit(game, 'SCARE', 'impact');
    player.postMessage({ ...sanitizedTrace(game, view({})), vitals: spectatorVitals(view({})) });
    await arrived;
    const latest = states.at(-1)!;
    assert.equal(latest.physics, 'local');
    assert.equal(latest.vitals?.source, 'simulated');
    assert.equal(latest.vitals?.pulseBpm, 83);
    const before = feed.props(1000), after = feed.props(1200);
    assert.ok(after.some((p, i) => Math.hypot(p.x - before[i]!.x, p.y - before[i]!.y, p.z - before[i]!.z) > 0.001), 'the door pound moves props');
  } finally { player.close(); feed.dispose(); }
});

test('local replay applies each event once and restarts with a new run', () => {
  const physics = new LocalPhysics();
  physics.ingest([{ seq: 5, time: 40, type: 'SCARE', detail: 'impact' }], 40.1);
  physics.advance(0);
  const moving = physics.advance(500);
  physics.ingest([{ seq: 5, time: 40, type: 'SCARE', detail: 'impact' }], 40.2);
  assert.deepEqual(physics.advance(500), moving, 'a resent event does not kick again');
  physics.ingest([{ seq: 1, time: 0, type: 'RUN_STARTED', detail: 'standard' }], 0.1);
  assert.ok(physics.advance(500).every(p => p.sleeping), 'a lower sequence means a new run with fresh props');
});

test('a spectator joining mid-run does not replay the backlog as one blast', () => {
  const physics = new LocalPhysics();
  physics.ingest([{ seq: 3, time: 20, type: 'SCARE', detail: 'impact' }, { seq: 9, time: 70, type: 'ATTACK_COMMITTED', detail: '' }], 120);
  physics.advance(0);
  assert.ok(physics.advance(200).every(p => p.sleeping));
});
