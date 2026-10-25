import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../game/reducer';
import type { SensorView } from '../sensing/types';
import { TraceBridge } from './client';

const view: SensorView = { source: 'simulated', status: 'ready', trend: 'STEADY', quality: 'accepted', hint: 'SIMULATED', baselineBpm: 72, pulseBpm: 83, ageMs: 100, acceptedSeconds: 30, canContinueManual: true, sampleAtMs: 1, captureSegment: 1 };
const tick = () => new Promise(r => setTimeout(r, 0));
type Call = { name: string; resolve: () => void; reject: (e: Error) => void };

/** A TraceBridge wired to a fake live SpacetimeDB connection whose reducer calls we settle by hand. */
function connectedBridge() {
  const calls: Call[] = [];
  const reducer = (name: string) => () => new Promise<void>((resolve, reject) => { calls.push({ name, resolve, reject }); });
  const client = { isActive: true, disconnected: 0, disconnect() { this.disconnected++; }, reducers: { shareVitals: reducer('share'), stopVitals: reducer('stop'), appendTrace: reducer('append'), removeSession: reducer('remove') } };
  const bridge = new TraceBridge();
  const raw = bridge as unknown as Record<string, unknown>;
  raw.channel = new BroadcastChannel(`hush-${'c'.repeat(64)}`);
  raw.access = { channel: `hush-${'c'.repeat(64)}`, sessionId: 'd'.repeat(64) };
  raw.client = client; raw.sessionId = 'd'.repeat(64); raw.connected = true;
  return { bridge, client, calls, names: () => calls.map(c => c.name), state: () => ({ remote: raw.vitalsRemote, pending: raw.withdrawPending }) };
}

test('friend links never advertise loopback addresses as reachable on another device', async () => {
  const { bridge } = connectedBridge(), previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    for (const address of ['http://localhost:5187/', 'http://127.0.0.2:5187/', 'http://[::1]:5187/', 'http://game.localhost:5187/', 'hush://app/']) {
      Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(address) });
      assert.equal(bridge.shareableSpectateUrl(), null);
    }
    Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://hush.example/game/') });
    const link = new URL(bridge.shareableSpectateUrl()!);
    assert.equal(link.origin, 'https://hush.example'); assert.equal(link.pathname, '/game/');
    const access = JSON.parse(atob(decodeURIComponent(link.hash.slice('#watch='.length))));
    assert.equal('ownerCapability' in access, false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous); else Reflect.deleteProperty(globalThis, 'location');
    await bridge.dispose();
  }
});

test('revoking while the first share is in flight still deletes the remote row', async () => {
  const { bridge, calls, names, state } = connectedBridge();
  try {
    bridge.setVitalsConsent(true);
    bridge.publish(createGame(17), view);
    assert.deepEqual(names().filter(n => n !== 'append'), ['share']);
    bridge.setVitalsConsent(false);
    assert.deepEqual(names().filter(n => n !== 'append'), ['share', 'stop'], 'the stop is sent behind the share, so the server applies it last');
    calls.find(c => c.name === 'share')!.resolve(); calls.find(c => c.name === 'stop')!.resolve(); await tick();
    assert.deepEqual(state(), { remote: false, pending: false });
  } finally { await bridge.dispose(); }
});

test('a revoke during a reconnect is retried once the connection is back', async () => {
  const { bridge, client, calls, names, state } = connectedBridge();
  try {
    bridge.setVitalsConsent(true);
    bridge.publish(createGame(17), view);
    calls[0]!.resolve(); await tick();
    client.isActive = false;
    bridge.setVitalsConsent(false);
    assert.equal(names().includes('stop'), false);
    assert.equal(state().pending, true);
    client.isActive = true;
    (bridge as unknown as { lastStopTry: number }).lastStopTry = -Infinity;
    bridge.publish(createGame(17), view);
    assert.ok(names().includes('stop'), 'publish retries the withdrawal even with consent off');
    calls.find(c => c.name === 'stop')!.resolve(); await tick();
    assert.deepEqual(state(), { remote: false, pending: false });
  } finally { await bridge.dispose(); }
});

test('a failed stop keeps the withdrawal pending and says so', async () => {
  const { bridge, calls, state } = connectedBridge();
  try {
    bridge.setVitalsConsent(true);
    bridge.publish(createGame(17), view);
    calls[0]!.resolve(); await tick();
    bridge.setVitalsConsent(false);
    calls.find(c => c.name === 'stop')!.reject(new Error('offline')); await tick();
    assert.equal(state().pending, true);
    assert.match(bridge.status, /remote deletion pending/);
  } finally { await bridge.dispose(); }
});

test('restart: disposing in the same click does not cancel the session delete', async () => {
  const { bridge, client, calls } = connectedBridge();
  const deletion = bridge.deleteSession();
  await bridge.dispose();
  assert.equal(client.disconnected, 0, 'the delete still owns the connection');
  calls.find(c => c.name === 'remove')!.resolve();
  await deletion;
  assert.equal(client.disconnected, 1);
  assert.equal(bridge.status, 'Session deleted');
});
