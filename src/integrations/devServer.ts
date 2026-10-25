// Trusted Node-only development middleware. Never import this into the renderer.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { geminiProposal, elevenSpeech, generateMonster, validSpeechRequest, type ProviderEnv } from './providers';
import { publicDirectorRequest, publicMonsterRequest, authoredMonsterFallback, MONSTER_MIN_INTERVAL_MS, type MonsterRequest, type MonsterResult, type SpeechRequest, type DirectorResult, type SpeechResult } from './contracts';
import type { DirectorRequest } from '../game/state';
import dialogue from '../game/dialogue.json';

const BASE = '/api/lock-in/';
const MAX_BODY = 32768;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
class RequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }
type Providers = { director(request: DirectorRequest, env: ProviderEnv): Promise<DirectorResult>; speech(request: SpeechRequest, env: ProviderEnv): Promise<SpeechResult>; monster(request: MonsterRequest, env: ProviderEnv): Promise<MonsterResult> };
export type LocalApiOptions = { port: number; env: ProviderEnv; offline?: boolean; allowedCaptions: readonly string[]; providers?: Providers; now?: () => number };
function send(response: ServerResponse, status: number, value: unknown): void {
 if (response.writableEnded) return;
 response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
 response.end(JSON.stringify(value));
}
async function readJson(request: IncomingMessage): Promise<unknown> {
 const length = Number(request.headers['content-length']);
 if (Number.isFinite(length) && length > MAX_BODY) { request.resume(); throw new RequestError(413, 'Request body exceeds limit'); }
 return new Promise((resolve, reject) => {
  const chunks: Buffer[] = []; let size = 0, complete = false;
  const finish = (error?: Error, result?: unknown) => {
   if (complete) return; complete = true; clearTimeout(timer);
   request.removeListener('data', data); request.removeListener('end', end); request.removeListener('error', failed); request.removeListener('aborted', aborted);
   if (error) { request.resume(); reject(error); } else resolve(result);
  };
  const data = (chunk: Buffer | string) => { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.byteLength; if (size > MAX_BODY) { finish(new RequestError(413, 'Request body exceeds limit')); return; } chunks.push(bytes); };
  const end = () => { try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new RequestError(400, 'Invalid JSON')); } };
  const failed = () => finish(new RequestError(400, 'Request interrupted'));
  const aborted = () => finish(new RequestError(400, 'Request interrupted'));
  const timer = setTimeout(() => finish(new RequestError(408, 'Request body timed out')), 2000);
  request.on('data', data); request.on('end', end); request.on('error', failed); request.on('aborted', aborted);
 });
}
/** Exact host/origin, loopback peer, JSON and custom-header checks prevent a
 * foreign website or network client from spending this local account's quota. */
export function createLocalApi(options: LocalApiOptions) {
 const providers = options.providers ?? { director: geminiProposal, speech: elevenSpeech, monster: generateMonster };
 const now = options.now ?? (() => performance.now());
 const captions = new Set(options.allowedCaptions);
 const ids = { director: new Set<string>(), speech: new Set<string>(), monster: new Set<string>() };
 const last = { director: -Infinity, speech: -Infinity, monster: -Infinity };
 const hosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`, `[::1]:${options.port}`]);
 const env: ProviderEnv = options.offline ? {} : { ...options.env };
 return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
  const url = request.url;
  if (!url?.startsWith(BASE)) { next(); return; }
  void (async () => {
   const host = request.headers.host;
   if (!LOOPBACK.has(request.socket.remoteAddress ?? '') || typeof host !== 'string' || !hosts.has(host)) throw new RequestError(403, 'Loopback host required');
   if (request.headers['x-lock-in-client'] !== '1') throw new RequestError(403, 'Local app header required');
   const origin = request.headers.origin;
   if (origin !== undefined && origin !== `http://${host}`) throw new RequestError(403, 'Same origin required');
   const site = request.headers['sec-fetch-site'];
   if (site !== undefined && site !== 'same-origin') throw new RequestError(403, 'Same origin required');
   const route = url.slice(BASE.length);
   if (route === 'status') {
    if (request.method !== 'GET') throw new RequestError(405, 'GET required');
    send(response, 200, { desktop: false, presage: false, offline: !!options.offline, gemini: !!(env.GEMINI_API_KEY && env.GEMINI_MODEL), elevenlabs: !!(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID && env.ELEVENLABS_MODEL_ID), spacetime: false, reasons: ['Local development provider bridge', 'Live Presage sensing requires Electron'] });
    return;
   }
   if (route !== 'director' && route !== 'speech' && route !== 'monster') throw new RequestError(404, 'Unknown local endpoint');
   if (request.method !== 'POST') throw new RequestError(405, 'POST required');
   if (origin !== `http://${host}`) throw new RequestError(403, 'Same origin required');
   if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new RequestError(415, 'JSON required');
   const raw = await readJson(request);
   let payload: DirectorRequest | SpeechRequest | MonsterRequest;
   try {
    if (route === 'director') payload = publicDirectorRequest(raw as DirectorRequest);
    else if (route === 'monster') payload = publicMonsterRequest(raw as MonsterRequest);
    else {
     if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'caption,encounterId,expiresAtMs,requestId' || !validSpeechRequest(raw as SpeechRequest)) throw new Error('Invalid speech');
     const speech = raw as SpeechRequest;
     if (!captions.has(speech.caption)) throw new Error('Speech must match an authored caption');
     payload = { requestId: speech.requestId, encounterId: speech.encounterId, caption: speech.caption, expiresAtMs: speech.expiresAtMs };
    }
   } catch { throw new RequestError(400, 'Invalid public provider request'); }
   // Offline QA has no provider work to deduplicate or rate-limit. Keep the
   // same trust/payload checks, then return without invoking an adapter or
   // consuming counters shared by parallel browser runs and rapid restarts.
   if (options.offline) {
    const result: DirectorResult | SpeechResult | MonsterResult = route === 'monster' ? authoredMonsterFallback(payload as MonsterRequest, 'Offline mode · authored monster dialogue') : route === 'director'
     ? { proposal: null, source: 'fallback', latencyMs: 0, reason: 'Offline mode · seeded local director' }
     : { audioBase64: null, mimeType: 'audio/mpeg', source: 'fallback', latencyMs: 0, reason: 'Offline mode · captions and original effects' };
    send(response, 200, result); return;
   }
   if (ids[route].has(payload.requestId)) throw new RequestError(409, 'Duplicate request');
   const admittedAt = now();
   if (admittedAt - last[route] < (route === 'director' ? 12000 : route === 'monster' ? MONSTER_MIN_INTERVAL_MS : 1500)) throw new RequestError(429, 'Local provider rate limit');
   ids[route].add(payload.requestId); last[route] = admittedAt;
   if (ids[route].size > 512) ids[route].delete(ids[route].values().next().value!);
   const result = route === 'director' ? await providers.director(payload as DirectorRequest, env) : route === 'monster' ? await providers.monster(payload as MonsterRequest, env) : await providers.speech(payload as SpeechRequest, env);
   send(response, 200, result);
  })().catch(error => send(response, error instanceof RequestError ? error.status : 502, { error: error instanceof RequestError ? error.message : 'Local provider unavailable' }));
 };
}

export function localProviderApi(): Plugin {
 return { name: 'hush-local-provider-api', apply: 'serve', configureServer(server) {
  if (server.config.server.host !== '127.0.0.1') throw new Error('HUSH local providers require server.host=127.0.0.1');
  const loaded = { ...loadEnv(server.config.mode, server.config.root, ''), ...process.env };
  const env: ProviderEnv = { GEMINI_API_KEY: loaded.GEMINI_API_KEY, GEMINI_MODEL: loaded.GEMINI_MODEL, GEMINI_DIALOGUE_MODEL: loaded.GEMINI_DIALOGUE_MODEL, ELEVENLABS_API_KEY: loaded.ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID: loaded.ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID: loaded.ELEVENLABS_MODEL_ID };
  server.middlewares.use(createLocalApi({ port: server.config.server.port ?? 5173, env, offline: loaded.LOCK_IN_OFFLINE === '1' || loaded.HUSH_OFFLINE === '1', allowedCaptions: dialogue.lines.map(line => line.text) }));
 } };
}
