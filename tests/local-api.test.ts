import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLocalApi, type LocalApiOptions } from '../src/integrations/devServer';
import { createDirectorProbe } from '../electron/liveCheckValidation';
import { authoredMonsterFallback, type MonsterRequest } from '../src/integrations/contracts';

type Result = { status: number; headers: Record<string,string>; body: any };
function invoke(api: ReturnType<typeof createLocalApi>, path: string, options: { method?: string; body?: unknown; raw?: string; headers?: Record<string,string|undefined>; peer?: string } = {}): Promise<Result> {
 return new Promise(resolve => {
  const raw = options.raw ?? (options.body === undefined ? '' : JSON.stringify(options.body));
  const request = Readable.from(raw ? [Buffer.from(raw)] : []) as unknown as IncomingMessage;
  request.url = '/api/hush/' + path; request.method = options.method ?? (options.body === undefined && options.raw === undefined ? 'GET' : 'POST');
  request.headers = { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin', 'x-hush-client': '1', 'content-type': 'application/json', ...options.headers };
  Object.defineProperty(request, 'socket', { value: { remoteAddress: options.peer ?? '127.0.0.1' } });
  const result: Result = { status: 0, headers: {}, body: null };
  const response = { writableEnded: false, writeHead(status: number, headers: Record<string,string>) { result.status = status; result.headers = headers; }, end(this: { writableEnded: boolean }, body: string) { this.writableEnded = true; result.body = JSON.parse(body); resolve(result); } } as unknown as ServerResponse;
  api(request, response, () => resolve(result));
 });
}
function fixture(offline = false) {
 let clock = 0, clockReads = 0; const calls: { kind: string; request: unknown; env: unknown }[] = [];
 const env = { GEMINI_API_KEY: 'unit-test-secret', GEMINI_MODEL: 'unit-test-model', ELEVENLABS_API_KEY: 'unit-test-voice-secret', ELEVENLABS_VOICE_ID: 'unit-test-voice', ELEVENLABS_MODEL_ID: 'unit-test-model' };
 const providers: LocalApiOptions['providers'] = {
  director: async (request, safeEnv) => { calls.push({ kind: 'director', request, env: safeEnv }); return { proposal: { requestId: request.requestId }, source: 'gemini', latencyMs: 1 }; },
  speech: async (request, safeEnv) => { calls.push({ kind: 'speech', request, env: safeEnv }); return { audioBase64: 'SUQz', mimeType: 'audio/mpeg', source: 'elevenlabs', latencyMs: 1 }; },
  monster: async (request, safeEnv) => { calls.push({ kind: 'monster', request, env: safeEnv }); return { ...authoredMonsterFallback(request, 'Test fixture'), caption: 'Your machinery calls me through the wall.', textSource: 'gemini' }; },
 };
 return { api: createLocalApi({ port: 5173, env, offline, allowedCaptions: ['Authored test caption.'], providers, now: () => { clockReads++; return clock; } }), calls, get clockReads() { return clockReads; }, advance(ms: number) { clock += ms; } };
}
const speech = (requestId = 'speech-1') => ({ requestId, caption: 'Authored test caption.', encounterId: 'fixture', expiresAtMs: Date.now() + 10000 });
const monster = (requestId = 'monster-1'): MonsterRequest => ({ requestId, context: createDirectorProbe('monster-context').request, fallbackId: 'AFTER_MISTAKE', expiresAtMs: Date.now() + 25000 });

test('local API exposes only configuration booleans and projects public provider requests through injected fake transports', async () => {
 const { api, calls } = fixture();
 const status = await invoke(api, 'status'); assert.equal(status.status, 200); assert.equal(status.body.desktop, false); assert.equal(status.body.presage, false); assert.equal(status.body.gemini, true);
 assert.equal(JSON.stringify(status).includes('unit-test'), false, 'status never exposes configured values');
 assert.equal(status.headers['Cache-Control'], 'no-store');
 const { request } = createDirectorProbe('local-probe');
 const result = await invoke(api, 'director', { body: { ...request, privateMemory: 'DO_NOT_LEAK', observations: { ...request.observations, pulseBpm: 'DO_NOT_LEAK' } } });
 assert.equal(result.status, 200); assert.equal(calls.length, 1); assert.equal(JSON.stringify(calls[0]!.request).includes('DO_NOT_LEAK'), false);
 const generated = await invoke(api, 'speech', { body: speech() }); assert.equal(generated.status, 200); assert.equal(calls.length, 2);
 assert.equal(JSON.stringify(generated.body).includes('secret'), false);
});

test('foreign origin, DNS-rebinding host, nonlocal peers, missing app header and wrong verbs cannot reach providers', async () => {
 const { api, calls } = fixture();
 for (const opts of [
  { headers: { origin: 'https://attacker.invalid' } },
  { headers: { host: 'attacker.invalid:5173', origin: 'http://attacker.invalid:5173' } },
  { peer: '192.168.0.8' },
  { headers: { 'x-hush-client': undefined } },
  { headers: { origin: undefined } },
  { headers: { 'sec-fetch-site': 'cross-site' } },
 ]) assert.equal((await invoke(api, 'speech', { body: speech(), ...opts })).status, 403);
 assert.equal((await invoke(api, 'speech', { method: 'GET' })).status, 405);
 assert.equal((await invoke(api, 'status', { method: 'POST', body: {} })).status, 405);
 assert.equal((await invoke(api, 'speech', { method: 'OPTIONS' })).status, 405);
 assert.equal(calls.length, 0);
});

test('body limits, malformed JSON, unapproved captions, expiry and private speech fields are rejected before generation', async () => {
 const { api, calls } = fixture();
 assert.equal((await invoke(api, 'speech', { raw: '{' })).status, 400);
 assert.equal((await invoke(api, 'speech', { raw: 'a'.repeat(32769) })).status, 413);
 assert.equal((await invoke(api, 'speech', { body: speech(), headers: { 'content-type': 'text/plain' } })).status, 415);
 assert.equal((await invoke(api, 'speech', { body: { ...speech(), caption: 'Unapproved arbitrary speech.' } })).status, 400);
 assert.equal((await invoke(api, 'speech', { body: { ...speech(), expiresAtMs: Date.now() - 1 } })).status, 400);
 assert.equal((await invoke(api, 'speech', { body: { ...speech(), pulseBpm: 87 } })).status, 400);
 assert.equal(calls.length, 0);
});

test('live duplicate and per-provider rate limits prevent a second account call', async () => {
 const { api, calls, advance } = fixture();
 assert.equal((await invoke(api, 'speech', { body: speech() })).status, 200);
 advance(2000); assert.equal((await invoke(api, 'speech', { body: speech() })).status, 409);
 assert.equal((await invoke(api, 'speech', { body: speech('speech-2') })).status, 200);
 assert.equal((await invoke(api, 'speech', { body: speech('speech-3') })).status, 429); assert.equal(calls.length, 2);
 const { request } = createDirectorProbe('first-director');
 assert.equal((await invoke(api, 'director', { body: request })).status, 200);
 advance(11999); assert.equal((await invoke(api, 'director', { body: { ...request, requestId: 'second-director' } })).status, 429);
 advance(1); assert.equal((await invoke(api, 'director', { body: { ...request, requestId: 'second-director' } })).status, 200);
});

test('offline parallel requests return deterministic fallbacks without providers, duplicate claims or rate counters', async () => {
 const disabled = fixture(true);
 assert.equal((await invoke(disabled.api, 'status')).body.elevenlabs, false);
 const { request } = createDirectorProbe('repeated-offline-director');
 const responses = await Promise.all(Array.from({ length: 8 }, () => [
  invoke(disabled.api, 'director', { body: request }),
  invoke(disabled.api, 'speech', { body: speech() }),
 ]).flat());
 assert.ok(responses.every(result => result.status === 200 && result.body.source === 'fallback' && result.body.latencyMs === 0));
 for (let i = 0; i < responses.length; i += 2) {
  assert.equal(responses[i]!.body.proposal, null);
  assert.equal(responses[i + 1]!.body.audioBase64, null);
  assert.deepEqual(responses[i]!.body, responses[0]!.body);
  assert.deepEqual(responses[i + 1]!.body, responses[1]!.body);
 }
 assert.equal(disabled.calls.length, 0, 'offline must not call even an injected adapter');
 assert.equal(disabled.clockReads, 0, 'offline returns before rate accounting');
 assert.equal((await invoke(disabled.api, 'speech', { body: { ...speech(), caption: 'Not authored.' } })).status, 400);
 assert.equal((await invoke(disabled.api, 'speech', { body: { ...speech(), expiresAtMs: 0 } })).status, 400);
 assert.equal((await invoke(disabled.api, 'director', { body: { ...request, allowedTactics: ['KILL'] } })).status, 400);
 assert.equal((await invoke(disabled.api, 'speech', { body: speech(), headers: { origin: 'https://foreign.invalid' } })).status, 403);
 assert.equal(disabled.calls.length, 0);
});

test('monster pipeline only accepts public context and known triggers, with an independent bounded rate', async () => {
 const { api, calls, advance } = fixture();
 const request = monster();
 for (const body of [ { ...request, caption: 'Caller text must never be voiced.' }, { ...request, fallbackId: 'ARBITRARY' }, { ...request, expiresAtMs: Date.now() - 1 }, { ...request, expiresAtMs: Date.now() + 60000 } ]) assert.equal((await invoke(api, 'monster', { body })).status, 400);
 assert.equal(calls.length, 0);
 const raw = { ...request, context: { ...request.context, privateAnswer: 'SECRET', observations: { ...request.context.observations, pulseBpm: 'SECRET' } } };
 const result = await invoke(api, 'monster', { body: raw });
 assert.equal(result.status, 200); assert.equal(result.body.textSource, 'gemini'); assert.equal(calls.length, 1);
 assert.equal(JSON.stringify(calls[0]!.request).includes('SECRET'), false);
 assert.equal((await invoke(api, 'monster', { body: monster('monster-2') })).status, 429);
 assert.equal((await invoke(api, 'speech', { body: speech() })).status, 200, 'authored supervisor route remains independent');
 advance(18000);
 assert.equal((await invoke(api, 'monster', { body: request })).status, 409);
 assert.equal((await invoke(api, 'monster', { body: monster('monster-2') })).status, 200);
});

test('offline monster dialogue cannot call providers or consume quota, and labels its authored fallback', async () => {
 const disabled = fixture(true);
 const results = await Promise.all(Array.from({ length: 12 }, () => invoke(disabled.api, 'monster', { body: monster() })));
 assert.ok(results.every(result => result.status === 200 && result.body.textSource === 'authored-fallback' && result.body.speech.source === 'fallback'));
 assert.equal(disabled.calls.length, 0); assert.equal(disabled.clockReads, 0);
 assert.equal((await invoke(disabled.api, 'monster', { body: { ...monster(), caption: 'Injected' } })).status, 400);
});
