import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { geminiProposal, elevenSpeech, providerFailure } from '../src/integrations/providers';
import { createDirectorProbe, validateDirectorProbe } from './liveCheckValidation';
import type { DirectorRequest, DirectorProposal } from '../src/game/state';

for (const filename of ['.env', '.env.local']) if (existsSync(filename)) process.loadEnvFile(filename);
type Outcome = { status: 'passed' | 'blocked' | 'failed'; detail: string; latencyMs?: number; requestId?: string; providerRequestId?: string; selectedTactic?: string; evidenceEventIds?: string[]; observation?: DirectorRequest; validation?: string };
const results: Record<string, Outcome> = {};
const probe = createDirectorProbe(`smoke-${Date.now()}`);
const request = probe.request;

async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(abort.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new DOMException('Deadline exceeded', 'TimeoutError')); }, timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

try {
  const native = await import('@smartspectra/node-sdk');
  results.presage = { status: 'blocked', detail: `SDK ${native.SmartSpectraSDK.version} native import passed on ${process.platform}/${process.arch}. ${process.env.PRESAGE_API_KEY ? 'Key present; actual camera capture/calibration requires the explicit Electron camera setup flow.' : 'PRESAGE_API_KEY absent; live camera capture not tested.'}` };
} catch { results.presage = { status: 'failed', detail: 'Native SDK import failed; live capture not tested' }; }

if (process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    await bounded(signal => ai.models.get({ model: process.env.GEMINI_MODEL!, config: { abortSignal: signal, httpOptions: { timeout: 7000, retryOptions: { attempts: 1 } } } }), 7000);
    const result = await geminiProposal(request, process.env);
    const validation = result.source === 'gemini' ? validateDirectorProbe(probe.state, result.proposal, result.latencyMs) : 'PROVIDER_FAILED';
    const valid = validation === null;
    const proposal = valid ? result.proposal as DirectorProposal : null;
    results.gemini = { status: valid ? 'passed' : 'failed', detail: valid ? 'Configured model availability and real structured tactic request passed the game’s full current-state validator' : result.reason ?? `Returned proposal rejected: ${validation}`, latencyMs: result.latencyMs, requestId: request.requestId, ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}), validation: validation ?? 'ACCEPTED', observation: request, ...(proposal ? { selectedTactic: proposal.tactic, evidenceEventIds: proposal.evidenceEventIds } : {}) };
  } catch (error) { results.gemini = { status: 'failed', detail: providerFailure(error, 'Configured Gemini model availability or request failed'), requestId: request.requestId }; }
} else results.gemini = { status: 'blocked', detail: 'GEMINI_API_KEY and/or GEMINI_MODEL absent' };

if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID && process.env.ELEVENLABS_MODEL_ID) {
  try {
    const headers = { 'xi-api-key': process.env.ELEVENLABS_API_KEY };
    const voice = await bounded(signal => fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID!)}`, { headers, signal }), 7000);
    if (!voice.ok) throw { status: voice.status };
    void voice.body?.cancel();
    const modelList = await bounded(async signal => {
      const models = await fetch('https://api.elevenlabs.io/v1/models', { headers, signal });
      if (!models.ok) throw { status: models.status };
      return await models.json() as { model_id?: string }[];
    }, 7000);
    if (!Array.isArray(modelList) || !modelList.some(m => m.model_id === process.env.ELEVENLABS_MODEL_ID)) throw new Error('Configured voice/model unavailable');
    const result = await elevenSpeech({ requestId: `${request.requestId}-speech`, encounterId: 'smoke-operation-2', caption: 'The carrier is synchronized. Operation two is ready: sweep the left corridor before collecting the cartridge.', expiresAtMs: Date.now() + 20000 }, process.env);
    results.elevenlabs = { status: result.source === 'elevenlabs' && !!result.audioBase64 ? 'passed' : 'failed', detail: result.reason ?? 'Configured voice/model and one state-conditioned generated audio response verified; audible playback still requires UI test', latencyMs: result.latencyMs, requestId: `${request.requestId}-speech`, ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}) };
  } catch (error) { results.elevenlabs = { status: 'failed', detail: providerFailure(error, 'Configured ElevenLabs voice/model check or speech request failed'), requestId: `${request.requestId}-speech` }; }
} else results.elevenlabs = { status: 'blocked', detail: 'ElevenLabs key, voice ID and/or model ID absent' };

if (process.env.VITE_CONVEX_URL) {
  const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL);
  const ownerCapability = randomBytes(32).toString('hex');
  const judgeCapability = randomBytes(32).toString('hex');
  let sessionId: string | null = null;
  try {
    sessionId = await client.mutation(makeFunctionReference<'mutation'>('sessions:create'), { ownerCapability, judgeCapability, consent: true, seed: 0, mode: 'integration-smoke' });
    await client.query(makeFunctionReference<'query'>('sessions:get'), { sessionId, capability: judgeCapability });
    let denied = false;
    try { await client.query(makeFunctionReference<'query'>('sessions:get'), { sessionId, capability: ownerCapability }); } catch { denied = true; }
    if (!denied) throw new Error('Capability isolation failed');
    results.convex = { status: 'passed', detail: 'Existing deployment session create, judge read, invalid capability denial and delete tested. Reactive UI/reconnect requires separate browser check.' };
  } catch { results.convex = { status: 'failed', detail: 'Existing deployment unavailable, functions not provisioned, or capability isolation failed' }; }
  finally { if (sessionId) { try { await client.mutation(makeFunctionReference<'mutation'>('sessions:remove'), { sessionId, capability: ownerCapability }); } catch { results.convex = { status: 'failed', detail: 'Smoke session deletion failed; reset demo data before use' }; } } }
} else results.convex = { status: 'blocked', detail: 'VITE_CONVEX_URL absent; no deployment created' };

mkdirSync('docs', { recursive: true });
writeFileSync('docs/integration-checks.json', `${JSON.stringify({ checkedAt: new Date().toISOString(), platform: `${process.platform}/${process.arch}`, results }, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
