import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../game/reducer';
import { emit } from '../game/state';
import type { SensorView } from '../sensing/types';
import { TraceBridge, sanitizedTrace, type TraceSnapshot } from './client';
import { parseWatchAccess, remoteVitals, SpectateFeed, spectatorVitals, type SpectateState } from './spectate';
import { LocalPhysics } from './physics';

const view = (patch: Partial<SensorView>): SensorView => ({ source: 'simulated', status: 'ready', trend: 'STEADY', quality: 'accepted', hint: 'SIMULATED', baselineBpm: 71.6, pulseBpm: 83.4, ageMs: 200, acceptedSeconds: 30, canContinueManual: true, sampleAtMs: 1234, captureSegment: 1, ...patch });
const nextMessage = (channel: BroadcastChannel) => new Promise<TraceSnapshot>(resolve => { channel.onmessage = e => resolve(e.data as TraceSnapshot); });

test('spectators get whole BPM and coarse labels only, never for manual play', () => {
  assert.deepEqual(spectatorVitals(view({})), { source: 'simulated', status: 'ready', quality: 'accepted', trend: 'STEADY', pulseBpm: 83, baselineBpm: 72 });
  assert.equal(spectatorVitals(view({ source: 'manual', status: 'manual' })), null);
  assert.deepEqual(spectatorVitals(view({ source: 'presage', quality: 'rejected', pulseBpm: null, trend: 'ELEVATED' })), { source: 'presage', status: 'ready', quality: 'rejected', trend: 'UNKNOWN', pulseBpm: null, baselineBpm: 72 });
  const shared = spectatorVitals(view({ source: 'presage', diagnostics: undefined }))!;
  assert.deepEqual(Object.keys(shared).sort(), ['baselineBpm', 'pulseBpm', 'quality', 'source', 'status', 'trend']);
  assert.equal(JSON.stringify(shared).includes('1234'), false, 'no measurement clock');
});

test('remote vitals rows are revalidated before display', () => {
  assert.deepEqual(remoteVitals({ source: 'simulated', status: 'ready', quality: 'accepted', trend: 'ELEVATED', pulseBpm: 91, baselineBpm: 70 }), { source: 'simulated', status: 'ready', quality: 'accepted', trend: 'ELEVATED', pulseBpm: 91, baselineBpm: 70 });
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
  physics.ingest([{ seq: 5, type: 'SCARE', detail: 'impact' }]);
  physics.advance(0);
  const moving = physics.advance(500);
  physics.ingest([{ seq: 5, type: 'SCARE', detail: 'impact' }]);
  assert.deepEqual(physics.advance(500), moving, 'a resent event does not kick again');
  physics.ingest([{ seq: 1, type: 'RUN_STARTED', detail: 'standard' }]);
  assert.ok(physics.advance(500).every(p => p.sleeping), 'a lower sequence means a new run with fresh props');
});
