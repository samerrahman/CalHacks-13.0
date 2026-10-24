import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorProbe } from '../electron/liveCheckValidation';
import { generateMonster, validateMonsterText, DEFAULT_DIALOGUE_MODEL, type ProviderEnv } from '../src/integrations/providers';
import { publicMonsterRequest, monsterFallbackCaption, type MonsterRequest } from '../src/integrations/contracts';
import { beginIntegrationRun, requestMonster } from '../src/integrations/client';

const request = (id = 'monster-test'): MonsterRequest => ({ requestId: id, context: createDirectorProbe('public-context').request, fallbackId: 'AFTER_MISTAKE', expiresAtMs: Date.now() + 25000 });
const env: ProviderEnv = { GEMINI_API_KEY: 'FAKE-GEMINI-KEY', GEMINI_MODEL: 'unchanged-director-model', ELEVENLABS_API_KEY: 'FAKE-VOICE-KEY', ELEVENLABS_VOICE_ID: 'test-monster-voice', ELEVENLABS_MODEL_ID: 'test-monster-model' };
const generated = (req: MonsterRequest) => ({ requestId: req.requestId, caption: 'Your broken machinery tells me where you hide.', evidenceEventIds: [req.context.events.at(-1)!.id] });
function textResponse(value: unknown) {
 return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }], responseId: 'mock-monster-response' }), { status: 200, headers: { 'content-type': 'application/json' } });
}
test('real SDK transport generates contextual text then sends the exact caption to ElevenLabs with independent provenance', async () => {
 const oldFetch = globalThis.fetch; const calls: { url: string; body: any }[] = []; const req = request();
 const raw = { ...req, context: { ...req.context, privateMemory: 'PRIVATE-MEMORY', observations: { ...req.context.observations, pulseBpm: 'RAW-PULSE', cameraFrame: 'CAMERA' } } };
 globalThis.fetch = async (input, init) => {
  const url = String(input), body = JSON.parse(String(init?.body)); calls.push({ url, body });
  if (url.includes('generativelanguage')) return textResponse(generated(req));
  return new Response(new Uint8Array([73, 68, 51, 1]), { status: 200, headers: { 'content-type': 'audio/mpeg', 'request-id': 'mock-speech-response' } });
 };
 try {
  const result = await generateMonster(raw, env);
  assert.equal(result.textSource, 'gemini'); assert.equal(result.caption, generated(req).caption);
  assert.equal(result.speech.source, 'elevenlabs'); assert.equal(result.textProviderRequestId, 'mock-monster-response'); assert.equal(result.speech.providerRequestId, 'mock-speech-response');
  assert.equal(calls.length, 2); assert.ok(calls[0]!.url.includes(DEFAULT_DIALOGUE_MODEL)); assert.equal(calls[1]!.body.text, result.caption);
  assert.equal(JSON.stringify(calls[0]!.body).includes('PRIVATE-MEMORY'), false); assert.equal(JSON.stringify(calls[0]!.body).includes('RAW-PULSE'), false); assert.equal(JSON.stringify(calls[0]!.body).includes('CAMERA'), false);
  const contents = JSON.parse(calls[0]!.body.contents[0].parts[0].text);
  assert.deepEqual(contents.events, req.context.events); assert.equal(contents.trigger, 'AFTER_MISTAKE');
  assert.equal(calls[0]!.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(result.requestId, req.requestId); assert.ok(result.totalLatencyMs >= result.textLatencyMs);
 } finally { globalThis.fetch = oldFetch; }
});

test('generated caption validation rejects unsupported evidence, arbitrary fields, operative instructions, malformed or stock text', () => {
 const req = request(), valid = generated(req);
 assert.ok(validateMonsterText(valid, req));
 for (const invalid of [
  { ...valid, requestId: 'other-request' }, { ...valid, evidenceEventIds: ['private-event'] }, { ...valid, evidenceEventIds: [] }, { ...valid, evidenceEventIds: [valid.evidenceEventIds[0], valid.evidenceEventIds[0]] },
  { ...valid, tactic: 'ATTACK' }, { ...valid, caption: 'Press Q before the creature gets close.' }, { ...valid, caption: 'Your heart rate tells me your fear.' }, { ...valid, caption: 'I will arrive in 10 seconds.' },
  { ...valid, caption: 'First sentence. Second sentence.' }, { ...valid, caption: 'Line one\nline two.' }, { ...valid, caption: monsterFallbackCaption('FIRST_APPROACH') },
  { ...valid, caption: 'You step toward my shelter while the heavy alarms chatter in the cold iron.' },
  { ...valid, caption: 'You walk closer while the machinery rattles.' }, { ...valid, caption: 'You run through the shelter toward me.' }, { ...valid, caption: 'I am inside your shelter beside the terminal.' },
 ]) assert.equal(validateMonsterText(invalid, req), null);
});

test('failed generated-text validation voices only the authored fallback and never labels it Gemini', async () => {
 const oldFetch = globalThis.fetch; const req = request('invalid-generated'); let voiced = '';
 globalThis.fetch = async (input, init) => {
  if (String(input).includes('generativelanguage')) return textResponse({ ...generated(req), evidenceEventIds: ['fabricated'] });
  voiced = JSON.parse(String(init?.body)).text;
  return new Response(new Uint8Array([73, 68, 51, 2]), { headers: { 'content-type': 'audio/mpeg' } });
 };
 try {
  const result = await generateMonster(req, { ...env, ELEVENLABS_VOICE_ID: 'invalid-text-test-voice' });
  assert.equal(result.textSource, 'authored-fallback'); assert.equal(result.caption, monsterFallbackCaption(req.fallbackId)); assert.equal(voiced, result.caption);
  assert.equal(result.speech.source, 'elevenlabs'); assert.deepEqual(result.evidenceEventIds, []); assert.match(result.textReason!, /validation/);
 } finally { globalThis.fetch = oldFetch; }
});

test('valid Gemini text survives a voice outage with matching caption and an honest caption-only label', async () => {
 const oldFetch = globalThis.fetch; const req = request('voice-outage'); let calls = 0; let url = '';
 globalThis.fetch = async input => { calls++; url = String(input); return textResponse(generated(req)); };
 try {
  const result = await generateMonster(req, { GEMINI_API_KEY: 'FAKE', GEMINI_DIALOGUE_MODEL: 'explicit-dialogue-model' });
  assert.equal(result.textSource, 'gemini'); assert.equal(result.speech.source, 'fallback'); assert.equal(result.speech.audioBase64, null); assert.equal(calls, 1);
  assert.ok(url.includes('explicit-dialogue-model'));
 } finally { globalThis.fetch = oldFetch; }
});

test('caller deadline aborts pending generation and cannot start late speech', async () => {
 const oldFetch = globalThis.fetch; let calls = 0; let aborted = false;
 globalThis.fetch = async (_input, init) => {
  calls++;
  return new Promise((_resolve, reject) => {
   const fail = () => { aborted = true; reject(new DOMException('Fixture cancellation', 'AbortError')); };
   if (init?.signal?.aborted) fail(); else init?.signal?.addEventListener('abort', fail, { once: true });
  });
 };
 try {
  const started = performance.now(); const result = await generateMonster({ ...request('short-deadline'), expiresAtMs: Date.now() + 40 }, env);
  assert.equal(aborted, true); assert.equal(calls, 1); assert.equal(result.textSource, 'authored-fallback'); assert.equal(result.speech.audioBase64, null); assert.match(result.textReason!, /timeout/);
  assert.ok(performance.now() - started < 1000, 'caller expiry bounds provider work');
 } finally { globalThis.fetch = oldFetch; }
});

test('invalid outer shape, expired context and missing credentials cannot cause provider calls', async () => {
 const oldFetch = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Unexpected provider call'); };
 try {
  assert.throws(() => publicMonsterRequest({ ...request(), caption: 'Injected arbitrary prose' } as MonsterRequest));
  await assert.rejects(generateMonster({ ...request(), expiresAtMs: Date.now() - 1 }, env));
  await assert.rejects(generateMonster({ ...request(), fallbackId: 'HIDDEN' } as unknown as MonsterRequest, env));
  const result = await generateMonster(request(), {});
  assert.equal(result.textSource, 'authored-fallback'); assert.equal(result.speech.source, 'fallback'); assert.equal(calls, 0);
 } finally { globalThis.fetch = oldFetch; }
});

test('a delayed monster result from a previous run is discarded before caption or audio can escape', async () => {
 const oldWindow = globalThis.window; const req = request('old-run'); let release!: (value: any) => void; let transported!: MonsterRequest;
 Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { hush: { monster: async (value: MonsterRequest) => { transported = value; return new Promise(resolve => { release = resolve; }); } } } });
 try {
  beginIntegrationRun(); const pending = requestMonster(req); beginIntegrationRun();
  release({ requestId: transported.requestId, caption: 'This delayed model line must never play.', textSource: 'gemini', textLatencyMs: 1, evidenceEventIds: [], totalLatencyMs: 2, speech: { source: 'elevenlabs', audioBase64: 'UNWANTED', mimeType: 'audio/mpeg', latencyMs: 1 } });
  const result = await pending; assert.equal(result.textSource, 'authored-fallback'); assert.equal(result.speech.audioBase64, null);
 } finally { if (oldWindow === undefined) delete (globalThis as any).window; else globalThis.window = oldWindow; }
});
