import test from 'node:test';
import assert from 'node:assert/strict';
import { Baseline } from '../src/sensing/baseline';
import { TrendTracker } from '../src/sensing/trend';
import { acceptedPulse, type SensorSample } from '../src/sensing/types';
import { normalizePresage } from '../src/sensing/presageSample';
import { publicDirectorRequest, publicEvent } from '../src/integrations/contracts';
import { geminiProposal, elevenSpeech, validSpeechRequest, safeProviderId, providerFailure } from '../src/integrations/providers';
import { hashCapability, authorize } from '../convex/auth';
import type { DirectorRequest } from '../src/game/state';
import { beginIntegrationRun, requestDirector } from '../src/integrations/client';
import { SensorController } from '../src/sensing/controller';
import { createDirectorProbe, validateDirectorProbe } from '../electron/liveCheckValidation';

const sample = (time: number, bpm = 72, quality: SensorSample['quality'] = 'accepted'): SensorSample => ({ source: 'presage', receivedAtMs: time, measuredAtMs: time, pulseBpm: bpm, breathingBpm: null, quality, qualityReasons: [], nativeConfidence: 95 });
test('sensor rejects missing, rejected, stale, future, out-of-range and unlabeled simulated data', () => {
  assert.equal(acceptedPulse(null, 10000), null);
  for (const s of [sample(0), sample(10000, 120), sample(10000, 35), sample(10000, 75, 'rejected'), sample(11000), { ...sample(10000), source: 'simulated' as const }, { ...sample(10000), measuredAtMs: 0 }]) assert.equal(acceptedPulse(s, 10000), null);
  assert.equal(acceptedPulse(sample(9999), 10000), 72);
});
test('native shape requires stable capture, full warmup, supported range, confidence and fresh epoch timestamp', () => {
  const wall = 1_800_000_000_000;
  const payload = { cardio: { pulseRate: [{ value: 75, stable: true, confidence: 93, timestamp: wall * 1000 }] } };
  const good = normalizePresage(payload, 20000, wall, 0, { code: 0, hint: '' });
  assert.equal(good.quality, 'accepted'); assert.equal(good.measuredAtMs, 20000); assert.equal(good.nativeConfidence, 93);
  assert.equal(normalizePresage(payload, 5000, wall, 0, { code: 0, hint: '' }).quality, 'rejected');
  assert.equal(normalizePresage(payload, 20000, wall, 0, { code: 1, hint: 'No face' }).quality, 'rejected');
  for (const change of [{ stable: false }, { confidence: 0 }, { confidence: 110 }, { value: 111 }, { timestamp: (wall - 10_000) * 1000 }, { timestamp: null }]) assert.equal(normalizePresage({ cardio: { pulseRate: [{ ...payload.cardio.pulseRate[0], ...change }] } }, 20000, wall, 0, { code: 0, hint: '' }).quality, 'rejected');
});
test('calibration counts usable time only and remains frozen during elevation', () => {
  const baseline = new Baseline();
  for (let t = 0; t <= 15_000; t += 1000) baseline.add(sample(t), t);
  assert.equal(baseline.value, null);
  baseline.add(sample(16000, 0, 'rejected'), 16000);
  baseline.add(sample(40000), 40000);
  assert.equal(baseline.acceptedMs, 15000);
  for (let t = 41000; t <= 55000; t += 1000) baseline.add(sample(t), t);
  assert.equal(baseline.value, 72);
  for (let t = 56000; t < 100000; t += 1000) baseline.add(sample(t, 100), t);
  assert.equal(baseline.value, 72);
});
test('trend requires twelve sustained seconds, rejects gaps and respects dwell without treating unavailable as steady', () => {
  const tracker = new TrendTracker();
  for (let t = 0; t <= 11000; t += 1000) tracker.add(sample(t, 84));
  assert.equal(tracker.classify(72, 11000), 'UNKNOWN');
  tracker.add(sample(12000, 84)); assert.equal(tracker.classify(72, 12000), 'ELEVATED');
  for (let t = 13000; t <= 26000; t += 1000) tracker.add(sample(t, 72));
  assert.equal(tracker.classify(72, 26000), 'ELEVATED');
  for (let t = 27000; t <= 33000; t += 1000) tracker.add(sample(t, 72));
  assert.equal(tracker.classify(72, 33000), 'RECOVERED');
  assert.equal(tracker.classify(72, 40000), 'UNKNOWN');
  tracker.discard(); assert.equal(tracker.classify(72, 41000), 'UNKNOWN');
});
test('disposing pending sensor start cannot create a timer; newer resume wins over an overlapping pause', async () => {
  const cancelled = new SensorController();
  await Promise.all([cancelled.start('simulated'), cancelled.dispose()]);
  assert.equal(cancelled.view().source, 'manual');
  await cancelled.start('simulated'); assert.equal(cancelled.view().source, 'manual');
  const controller = new SensorController();
  await controller.start('simulated');
  await Promise.all([controller.pause(), controller.resume()]);
  assert.equal(controller.view().source, 'simulated');
  assert.equal(controller.view().status, 'calibrating');
  await controller.dispose();
});
const request: DirectorRequest = { requestId: 'test-1', stateVersion: 2, allowedTactics: ['WAIT', 'RETREAT'], trend: 'UNKNOWN', events: [{ id: 'e1', seq: 1, time: 0, type: 'START', detail: 'private string must not be forwarded' }], evidenceEventIds: ['e1'], expiresAt: 20 };
test('director projection excludes hidden properties and arbitrary event detail', () => {
  const safe = publicDirectorRequest({ ...request, privateChallenge: { answer: 'DO_NOT_LEAK' }, rawVideo: 'DO_NOT_LEAK' } as DirectorRequest);
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('DO_NOT_LEAK'), false); assert.equal(serialized.includes('private string'), false);
  assert.throws(() => publicDirectorRequest({ ...request, allowedTactics: ['KILL'] } as unknown as DirectorRequest));
  const observed = publicDirectorRequest({ ...request, events: [{ id: 'e2', seq: 2, time: 2, type: 'DOOR', detail: 'left shutter open.' }, { id: 'e3', seq: 3, time: 3, type: 'CALL_VERIFIED', detail: 'Checked call-2; result MISMATCH.' }] });
  assert.equal(observed.events[0]!.detail, 'left shutter open.'); assert.equal(observed.events[1]!.detail, 'Verification result MISMATCH');
});
test('observable history projection is idempotent and rejects injected prose in every permitted detail', () => {
  const allowed = [
    ['DOOR', 'right shutter closed.'],
    ['CALL_VERIFIED', 'Checked call-2; result MATCH.'],
    ['APPROACH', 'Footsteps and silhouette in the left corridor. Minimum approach: 8 seconds.'],
    ['THRESHOLD', 'right threshold warning. At least 6 seconds remain to defend.'],
    ['SWEEP', 'left confirmed clear until 42.5 seconds; 8 energy spent.'],
    ['SENSOR_TREND', 'Quality-gated trend: ELEVATED.'],
    ['TASK_COMPLETE', 'Operation 1 completed. Current task 2.'],
    ['DIRECTOR_REJECTED', 'Proposal rejected: STALE_STATE.'],
    ['DIRECTOR_APPLIED', 'GEMINI selected RETREAT; evidence e1, e2.'],
  ];
  for (const [type, detail] of allowed) {
    const event = { id: 'e1', seq: 1, time: 1, type: type!, detail: detail! };
    const projected = publicEvent(event);
    assert.notEqual(projected.detail, '', type);
    assert.deepEqual(publicEvent(projected), projected, `${type}: browser/main/server projection retains observations`);
    assert.equal(publicEvent({ ...event, detail: `${detail} DO_NOT_LEAK_CHALLENGE` }).detail, '');
    assert.equal(publicEvent({ ...event, detail: `DO_NOT_LEAK_CHALLENGE ${detail}` }).detail, '');
  }
  assert.equal(publicEvent({ id: 'e1', seq: 1, time: 1, type: 'RADIO_CALL', detail: 'DO_NOT_LEAK_CHALLENGE' }).detail, '');
  assert.equal(publicEvent({ id: 'e1', seq: 1, time: 1, type: 'SENSOR_TREND', detail: 'Quality-gated trend: pulse=84.' }).detail, '');
});
test('live-check harness uses full game validation and records only safe provider metadata', () => {
  const { state, request: observation } = createDirectorProbe('smoke-fixture');
  assert.deepEqual(observation.allowedTactics, ['WAIT', 'RETREAT']);
  assert.ok(observation.events.some(e => e.type === 'DOOR' && e.detail === 'left shutter closed.'));
  assert.equal(JSON.stringify(observation).includes(state.privateChallenge.answer), false);
  const valid = { requestId: observation.requestId, stateVersion: observation.stateVersion, tactic: 'RETREAT', evidenceEventIds: [observation.evidenceEventIds[0]], reasonCode: 'RECOVERY_NEEDED' };
  assert.equal(validateDirectorProbe(state, valid, 1000), null);
  for (const malformed of [{ ...valid, reasonCode: 'invented' }, { ...valid, extra: 'not allowed' }, { ...valid, evidenceEventIds: ['e1', 'e2', 'e3', 'e4'] }]) assert.equal(validateDirectorProbe(state, malformed, 1000), 'BAD_SHAPE');
  assert.equal(validateDirectorProbe(state, { ...valid, tactic: 'PROBE_RIGHT' }, 1000), 'ILLEGAL_TACTIC');
  assert.equal(validateDirectorProbe(state, { ...valid, evidenceEventIds: ['unknown'] }, 1000), 'UNKNOWN_EVIDENCE');
  assert.equal(validateDirectorProbe(state, valid, (observation.expiresAt - state.time) * 1000 + 1), 'EXPIRED');
  assert.equal(safeProviderId('provider-response_123'), 'provider-response_123');
  assert.equal(safeProviderId('response\nDO_NOT_LEAK'), undefined);
  assert.equal(providerFailure({ status: 401, message: 'DO_NOT_LEAK', headers: { key: 'DO_NOT_LEAK' } }, 'Provider failed'), 'Provider failed: HTTP 401');
  assert.equal(providerFailure(new Error('DO_NOT_LEAK'), 'Provider failed'), 'Provider failed');
});
test('provider transport IDs differ across deterministic replays and obsolete replies are discarded', async () => {
  const sent: string[] = [];
  let resolvePending: ((value: { proposal: unknown; source: 'gemini'; latencyMs: number }) => void) | null = null;
  let delayed = false;
  (globalThis as unknown as { window: unknown }).window = { nightRelay: { director: async (r: DirectorRequest) => {
    sent.push(r.requestId);
    if (delayed) return new Promise(resolve => { resolvePending = resolve; });
    return { proposal: { requestId: r.requestId, stateVersion: 2, tactic: 'WAIT', evidenceEventIds: [], reasonCode: 'NO_VALID_SIGNAL' }, source: 'gemini', latencyMs: 10 };
  } } };
  beginIntegrationRun();
  assert.equal(((await requestDirector(request)).proposal as { requestId: string }).requestId, request.requestId);
  beginIntegrationRun(); await requestDirector(request);
  assert.notEqual(sent[0], sent[1]);
  delayed = true;
  const pending = requestDirector(request); beginIntegrationRun();
  (resolvePending as unknown as (value: unknown) => void)({ proposal: { requestId: sent[2] }, source: 'gemini', latencyMs: 10 });
  assert.equal((await pending).proposal, null);
});
test('missing provider credentials return honest fallbacks immediately with no HTTP', async () => {
  assert.deepEqual(await geminiProposal(request, {}), { proposal: null, source: 'fallback', latencyMs: 0, reason: 'Gemini key/model not configured' });
  const speech = await elevenSpeech({ requestId: 'r1', encounterId: 'e1', caption: 'Check the current order.', expiresAtMs: Date.now() + 10000 }, {});
  assert.equal(speech.source, 'fallback'); assert.equal(speech.audioBase64, null);
  assert.equal(validSpeechRequest({ requestId: 'r1', encounterId: 'e1', caption: 'expired', expiresAtMs: 100 }, 101), false);
});
test('speech reuses only exact caption/voice/model audio, labels cached results, rejects expiry, and evicts old entries', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; caption: string; model: string }[] = [];
  // Deliberately fake credentials and an intercepted transport: no real provider
  // access or paid generation occurs in this boundary test.
  const env = { ELEVENLABS_API_KEY: 'unit-test-key', ELEVENLABS_VOICE_ID: 'unit-test-voice', ELEVENLABS_MODEL_ID: 'unit-test-model' };
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { text: string; model_id: string };
    calls.push({ url: String(input), caption: body.text, model: body.model_id });
    return new Response(new Uint8Array([73, 68, 51, calls.length]), { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'request-id': 'mock-request-123' } });
  };
  const req = (caption = 'Cache fixture: check the work order.', requestId = 'cache-1') => ({ requestId, encounterId: 'unit-test-encounter', caption, expiresAtMs: Date.now() + 10000 });
  try {
    const first = await elevenSpeech(req(), env);
    assert.equal(first.source, 'elevenlabs'); assert.equal(calls.length, 1);
    assert.equal(first.providerRequestId, 'mock-request-123');
    const repeat = await elevenSpeech(req(undefined, 'cache-2'), env);
    assert.equal(repeat.source, 'cached'); assert.equal(repeat.audioBase64, first.audioBase64); assert.equal(calls.length, 1);
    const expired = await elevenSpeech({ ...req(), expiresAtMs: Date.now() - 1 }, env);
    assert.equal(expired.source, 'fallback'); assert.equal(expired.audioBase64, null); assert.equal(calls.length, 1);
    await elevenSpeech(req(), { ...env, ELEVENLABS_VOICE_ID: 'another-unit-test-voice' });
    await elevenSpeech(req(), { ...env, ELEVENLABS_MODEL_ID: 'another-unit-test-model' });
    await elevenSpeech(req('Cache fixture: check the work order!'), env);
    assert.equal(calls.length, 4, 'different voice, model or exact caption must generate separately');
    for (let i = 0; i < 33; i++) await elevenSpeech(req(`LRU fixture ${i}`), env);
    const before = calls.length;
    assert.equal((await elevenSpeech(req('LRU fixture 32'), env)).source, 'cached');
    assert.equal(calls.length, before);
    assert.equal((await elevenSpeech(req('LRU fixture 0'), env)).source, 'elevenlabs');
    assert.equal(calls.length, before + 1, 'oldest of 33 unique entries is evicted by the 32-entry bound');
  } finally { globalThis.fetch = originalFetch; }
});
test('capability hashes distinguish owner/judge and reject expired or nonconsenting trace access', async () => {
  const owner = 'a'.repeat(64), judge = 'b'.repeat(64);
  const record = { ownerHash: await hashCapability(owner), judgeHash: await hashCapability(judge), consent: true, expiresAt: Date.now() + 10000 };
  assert.notEqual(record.ownerHash, owner);
  const ctx = { db: { get: async () => record } } as unknown as Parameters<typeof authorize>[0];
  const id = 'session' as Parameters<typeof authorize>[1];
  await authorize(ctx, id, owner);
  await authorize(ctx, id, judge, true);
  await assert.rejects(authorize(ctx, id, judge));
  record.consent = false; await assert.rejects(authorize(ctx, id, judge, true));
  record.expiresAt = 0; await assert.rejects(authorize(ctx, id, owner));
});
