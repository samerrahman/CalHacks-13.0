import test from 'node:test';
import assert from 'node:assert/strict';
import { Baseline } from '../src/sensing/baseline';
import { TrendTracker } from '../src/sensing/trend';
import { acceptedPulse, type SensorSample, type SensorView } from '../src/sensing/types';
import { normalizePresage } from '../src/sensing/presageSample';
import { publicDirectorRequest, publicEvent } from '../src/integrations/contracts';
import { geminiProposal, elevenSpeech, validSpeechRequest, safeProviderId, providerFailure } from '../src/integrations/providers';
import { hashCapability, authorize } from '../convex/auth';
import type { DirectorRequest } from '../src/game/state';
import { beginIntegrationRun, requestDirector, sanitizedTrace } from '../src/integrations/client';
import { SensorController } from '../src/sensing/controller';
import { createDirectorProbe, validateDirectorProbe } from '../electron/liveCheckValidation';

const sample = (time: number, bpm = 72, quality: SensorSample['quality'] = 'accepted'): SensorSample => ({ source: 'presage', receivedMonotonicMs: time, measuredMonotonicMs: time, pulseBpm: bpm, quality, qualityReasons: [], nativeConfidence: 95, validationCode: 0 });
test('sensor rejects missing, rejected, stale, future, out-of-range and unlabeled simulated data', () => {
  assert.equal(acceptedPulse(null, 10000), null);
  for (const s of [sample(0), sample(10000, 120), sample(10000, 35), sample(10000, 75, 'rejected'), sample(11000), { ...sample(10000), source: 'simulated' as const }, { ...sample(10000), measuredMonotonicMs: 0 }, { ...sample(10000), measuredMonotonicMs: null }, { ...sample(10000), measuredMonotonicMs: NaN }]) assert.equal(acceptedPulse(s, 10000), null);
  assert.equal(acceptedPulse(sample(9999), 10000), 72);
});
test('native shape requires stable capture, full warmup, supported range, confidence and fresh epoch timestamp', () => {
  const wall = 1_800_000_000_000;
  const payload = { cardio: { pulseRate: [{ value: 75, stable: true, confidence: 93, timestamp: wall * 1000 }] } };
  const good = normalizePresage(payload, 20000, wall, 0, { code: 0, hint: '' });
  assert.equal(good.quality, 'accepted'); assert.equal(good.measuredMonotonicMs, 20000); assert.equal(good.nativeConfidence, 93);
  assert.equal(normalizePresage(payload, 5000, wall, 0, { code: 0, hint: '' }).quality, 'rejected');
  assert.equal(normalizePresage(payload, 20000, wall, 0, { code: 1, hint: 'No face' }).quality, 'rejected');
  for (const change of [{ stable: false }, { confidence: 0 }, { confidence: 110 }, { confidence: NaN }, { value: 111 }, { timestamp: (wall - 10_000) * 1000 }, { timestamp: null }]) assert.equal(normalizePresage({ cardio: { pulseRate: [{ ...payload.cardio.pulseRate[0], ...change }] } }, 20000, wall, 0, { code: 0, hint: '' }).quality, 'rejected');
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
test('repeated measurement timestamps cannot inflate baseline duration despite new callbacks', () => {
  const baseline = new Baseline();
  for (let received = 0; received <= 5000; received += 100) baseline.add({ ...sample(received), measuredMonotonicMs: 0 }, received);
  assert.equal(baseline.acceptedMs, 0); assert.equal(baseline.value, null);
});
test('local recorder gets actual measurement time and a new capture segment on resume', async () => {
  const controller = new SensorController();
  const received: { at: number | null; segment: number }[] = [];
  controller.subscribeSamples((sample, segment) => received.push({ at: sample.measuredMonotonicMs, segment }));
  await controller.start('simulated');
  assert.equal(controller.view().sampleAtMs, received[0]!.at);
  await controller.pause(); assert.equal(controller.view().sampleAtMs, null);
  await controller.resume(); assert.ok(received[1]!.segment > received[0]!.segment);
  await controller.dispose(); assert.equal(controller.view().sampleAtMs, null);
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
// A deferred native stop exercises the real retirement queue without a camera,
// provider key, network call, or pretending these fixtures are live measurements.
function deferredNativeController() {
  const controller = new SensorController();
  let release!: () => void;
  const stopped = new Promise<void>(resolve => { release = resolve; });
  const calls = { stop: 0, destroy: 0, track: 0 };
  const internal = controller as unknown as {
    mode: 'presage'; status: 'ready'; sample: SensorSample; baseline: Baseline;
    trends: TrendTracker; sdk: unknown; stream: unknown; unavailable(hint: string): Promise<void>;
  };
  internal.mode = 'presage'; internal.status = 'ready'; internal.baseline.value = 72;
  for (let time = 18000; time <= 30000; time += 1000) internal.trends.add(sample(time, 84));
  internal.sample = sample(30000, 84);
  internal.sdk = { stop: async () => { calls.stop++; await stopped; }, destroy: () => { calls.destroy++; } };
  internal.stream = { getTracks: () => [{ stop: () => { calls.track++; } }] };
  return { controller, internal, calls, release };
}
test('every capture transition publishes UNKNOWN immediately while native teardown remains pending', async t => {
  t.mock.method(performance, 'now', () => 30000);
  const actions = ['restart', 'stop', 'pause', 'unavailable'] as const;
  for (const action of actions) {
    const { controller, internal, calls, release } = deferredNativeController();
    const views: SensorView[] = [];
    controller.subscribe(view => views.push(view));
    assert.equal(views.at(-1)?.trend, 'ELEVATED');
    assert.equal(views.at(-1)?.quality, 'accepted');
    const pending = action === 'restart' ? controller.start('simulated', true)
      : action === 'stop' ? controller.stop() : action === 'pause' ? controller.pause()
      : internal.unavailable('Native camera disconnected');
    let settled = false;
    void pending.then(() => { settled = true; });
    try {
      const neutral = views.at(-1)!;
      assert.equal(neutral.status, { restart: 'starting', stop: 'manual', pause: 'paused', unavailable: 'unavailable' }[action]);
      assert.equal(neutral.trend, 'UNKNOWN', action);
      assert.equal(neutral.quality, 'unknown', action);
      assert.equal(neutral.pulseBpm, null, action);
      assert.equal(neutral.sampleAtMs, null, action);
      assert.equal(neutral.baselineBpm, 72, 'A lifecycle transition does not alter the frozen baseline');
      assert.equal(calls.track, 1, 'Camera tracks stop synchronously');
      await Promise.resolve();
      assert.equal(calls.stop, 1);
      assert.equal(settled, false, 'The neutral publication precedes completion of native shutdown');
      release(); await pending;
      assert.equal(calls.destroy, 1);
      assert.equal(controller.view().baselineBpm, 72);
    } finally { release(); await pending; await controller.dispose(); }
  }
});
test('a newer start stays neutral during old native shutdown and wins when that shutdown completes', async t => {
  t.mock.method(performance, 'now', () => 30000);
  const { controller, calls, release } = deferredNativeController();
  const views: SensorView[] = [];
  controller.subscribe(view => views.push(view));
  const paused = controller.pause();
  const restarted = controller.start('simulated', true);
  try {
    assert.equal(views.at(-1)?.status, 'starting');
    assert.equal(views.at(-1)?.trend, 'UNKNOWN');
    assert.equal(views.at(-1)?.quality, 'unknown');
    release(); await Promise.all([paused, restarted]);
    const latest = views.at(-1)!;
    assert.equal(latest.source, 'simulated');
    assert.equal(latest.status, 'ready');
    assert.equal(latest.quality, 'accepted');
    assert.equal(latest.baselineBpm, 72);
    assert.equal(calls.stop, 1);
    assert.equal(calls.destroy, 1);
    assert.ok(latest.captureSegment > 0);
  } finally { release(); await Promise.all([paused, restarted]); await controller.dispose(); }
});

const { request } = createDirectorProbe('test-1');
test('director and trace projection exclude private memory, pulse reports and arbitrary details', () => {
  const safe = publicDirectorRequest({ ...request, sequence: ['DO_NOT_LEAK'], rawVideo: 'DO_NOT_LEAK', observations: { ...request.observations, pulseBpm: 'DO_NOT_LEAK', report: 'DO_NOT_LEAK' } } as DirectorRequest);
  assert.equal(JSON.stringify(safe).includes('DO_NOT_LEAK'), false);
  assert.throws(() => publicDirectorRequest({ ...request, allowedTactics: ['KILL'] } as unknown as DirectorRequest));
  assert.equal(safe.events.find(e => e.type === 'WRONG_INPUT')?.detail, 'FAULT');
  assert.deepEqual(publicDirectorRequest(safe), safe);
  const { state } = createDirectorProbe('trace-fixture');
  const sensor = new SensorController();
  const trace = sanitizedTrace(state, { ...sensor.view(), pulseBpm: 87, baselineBpm: 70, sampleAtMs: 1234 });
  for (const forbidden of ['pulseBpm', 'baselineBpm', 'sampleAtMs', 'sequence', 'memory', 'report']) assert.equal(JSON.stringify(trace).includes(forbidden), false, forbidden);
  assert.equal(trace.summary.stage, 1); assert.equal('energy' in trace.summary, false);
});
test('authored event projection preserves observable behavior and rejects injected detail', () => {
  const allowed = [['RUN_STARTED','demo'],['FAULT_CLEARED','1'],['TASK_COMPLETE','2'],['WRONG_INPUT','MEMORY'],['LURE_TRANSMITTED','EMITTER_A'],['APPROACH','SHELTER'],['BREACH_WARNING','6'],['RESTORED','CLEAR'],['SENSOR_TREND','source=presage quality=accepted trend=ELEVATED'],['DIRECTOR_APPLIED','GEMINI INVESTIGATE_SOUND SHELTER'],['DIRECTOR_REJECTED','ILLEGAL_PAIR'],['TAUNT','LURE_FOLLOWED']];
  for (const [type, detail] of allowed) {
    const event = { id: 'e1', seq: 1, time: 1, type: type!, detail: detail! };
    const projected = publicEvent(event);
    assert.equal(projected.detail, detail); assert.deepEqual(publicEvent(projected), projected);
    assert.equal(publicEvent({ ...event, detail: detail + ' DO_NOT_LEAK' }).detail, '');
    assert.equal(publicEvent({ ...event, detail: 'DO_NOT_LEAK ' + detail }).detail, '');
  }
  assert.equal(publicEvent({id:'e1',seq:1,time:1,type:'MEMORY_READY',detail:'1,3,2,4'}).detail,'');
  assert.equal(publicEvent({id:'e1',seq:1,time:1,type:'PRIVATE_PULSE_SECRET',detail:'87'}).type,'UNKNOWN');
});
test('live probe uses all new LOCK IN proposal guards and sanitized provider metadata', () => {
  const {state,request: observation}=createDirectorProbe('fixture');
  const valid={requestId:observation.requestId,stateVersion:observation.stateVersion,tactic:'WAIT',target:'NONE',tauntId:'NONE',evidenceEventIds:[],reasonCode:'NO_VALID_SIGNAL'};
  assert.equal(validateDirectorProbe(state,valid,1000),null);
  assert.equal(validateDirectorProbe(state,{...valid,extra:'secret'},1000),'BAD_SHAPE');
  assert.equal(validateDirectorProbe(state,{...valid,target:'CONTAINMENT'},1000),'ILLEGAL_PAIR');
  assert.equal(validateDirectorProbe(state,{...valid,evidenceEventIds:['unknown']},1000),'UNKNOWN_EVIDENCE');
  assert.equal(validateDirectorProbe(state,valid,observation.expiresAtGameMs-observation.issuedAtGameMs+1),'EXPIRED');
  assert.equal(safeProviderId('result-123'),'result-123');
  assert.equal(safeProviderId('result\nSECRET'),undefined);
  assert.equal(providerFailure({status:401,message:'SECRET',headers:{key:'SECRET'}},'Provider failed'),'Provider failed: HTTP 401');
  assert.equal(providerFailure(new Error('SECRET'),'Provider failed'),'Provider failed');
});
test('provider transport IDs differ across deterministic replays and obsolete replies are discarded', async () => {
  const sent: string[] = [];
  let resolvePending: ((value: { proposal: unknown; source: 'gemini'; latencyMs: number }) => void) | null = null;
  let delayed = false;
  (globalThis as unknown as { window: unknown }).window = { lockIn: { director: async (r: DirectorRequest) => {
    sent.push(r.requestId);
    if (delayed) return new Promise(resolve => { resolvePending = resolve; });
    return { proposal: { requestId: r.requestId, stateVersion: r.stateVersion, tactic: 'WAIT', target: 'NONE', tauntId: 'NONE', evidenceEventIds: [], reasonCode: 'NO_VALID_SIGNAL' }, source: 'gemini', latencyMs: 10 };
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
test('installed Gemini SDK sends LOCK IN schema and configured model settings through an intercepted transport', async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, any> | null = null;
  globalThis.fetch = async (input, init) => {
    body = JSON.parse(typeof init?.body === 'string' ? init.body : await (input as Request).text());
    const proposal = { requestId: request.requestId, stateVersion: request.stateVersion, tactic: 'WAIT', target: 'NONE', tauntId: 'NONE', evidenceEventIds: [], reasonCode: 'NO_VALID_SIGNAL' };
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(proposal) }] }, finishReason: 'STOP' }], responseId: 'mock-lock-in-response' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await geminiProposal(request, { GEMINI_API_KEY: 'unit-test-key', GEMINI_MODEL: 'gemini-3.8-flash' });
    assert.equal(result.source, 'gemini'); assert.equal(result.providerRequestId, 'mock-lock-in-response');
    assert.equal((body as unknown as Record<string, any>).generationConfig.thinkingConfig.thinkingLevel, 'LOW');
    assert.ok((body as unknown as Record<string, any>).generationConfig.responseJsonSchema.required.includes('target'));
    assert.ok((body as unknown as Record<string, any>).generationConfig.responseJsonSchema.required.includes('tauntId'));
    assert.equal('temperature' in (body as unknown as Record<string, any>).generationConfig, false);
  } finally { globalThis.fetch = originalFetch; }
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
