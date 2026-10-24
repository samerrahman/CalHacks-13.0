// Explicit, stage-selective live checks. No deployment or env mutation commands.
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { geminiProposal, elevenSpeech, providerFailure } from '../src/integrations/providers';
import { createDirectorProbe, validateDirectorProbe } from './liveCheckValidation';
import type { DirectorProposal } from '../src/game/state';
import { TRACE_SCHEMA_VERSION } from '../src/integrations/contracts';

const selected = process.argv.find(value => value.startsWith('--only='))?.slice(7) ?? 'native';
if (!['native', 'gemini', 'elevenlabs', 'convex'].includes(selected)) throw new Error('Use --only=native|gemini|elevenlabs|convex');
if (selected !== 'native' && !process.argv.includes('--live')) throw new Error('Provider checks require explicit --live after the offline game gate');
for (const filename of ['.env', '.env.local']) if (existsSync(filename)) process.loadEnvFile(filename);
type Outcome = { status: 'passed' | 'blocked' | 'failed' | 'not_tested'; detail: string; checkedAt?: string; [key: string]: unknown };
const results: Record<string, Outcome> = Object.fromEntries(['presage', 'gemini', 'elevenlabs', 'convex'].map(name => [name, { status: 'not_tested', detail: 'Not yet tested in LOCK IN; previous-game evidence does not qualify' }]));
if (existsSync('docs/integration-checks.json')) {
  const prior = JSON.parse(readFileSync('docs/integration-checks.json', 'utf8'));
  if (prior.application === 'LOCK IN') Object.assign(results, prior.results);
}
const checkedAt = new Date().toISOString();
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(abort.signal), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { abort.abort(); reject(new DOMException('Deadline exceeded', 'TimeoutError')); }, timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
if (selected === 'native') {
  try {
    const native = await import('@smartspectra/node-sdk');
    results.presage = { status: 'blocked', checkedAt, nativeImport: 'passed', sdkVersion: native.SmartSpectraSDK.version, detail: `Native import passed on ${process.platform}/${process.arch}; camera capture/calibration still requires explicit Electron setup. Key ${process.env.PRESAGE_API_KEY ? 'present' : 'absent'}.` };
  } catch { results.presage = { status: 'failed', checkedAt, detail: 'Native import failed; camera not tested' }; }
}
if (selected === 'gemini') {
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) results.gemini = { status: 'blocked', checkedAt, detail: 'Gemini key/model absent' };
  else {
    const probe = createDirectorProbe(`lock-in-smoke-${Date.now()}`);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      await bounded(signal => ai.models.get({ model: process.env.GEMINI_MODEL!, config: { abortSignal: signal, httpOptions: { timeout: 10_000, retryOptions: { attempts: 1 } } } }), 10_000);
      const result = await geminiProposal(probe.request, process.env);
      const rejection = result.proposal ? validateDirectorProbe(probe.state, result.proposal, result.latencyMs) : 'PROVIDER_FAILED';
      const proposal = rejection === null ? result.proposal as DirectorProposal : null;
      results.gemini = { status: proposal ? 'passed' : 'failed', checkedAt, scope: 'structured probe; actual game proof separate', model: process.env.GEMINI_MODEL, detail: proposal ? 'Real LOCK IN proposal passed the full current-state validator' : result.reason ?? `Rejected: ${rejection}`, latencyMs: result.latencyMs, requestId: probe.request.requestId, providerRequestId: result.providerRequestId, source: result.source, validation: rejection ?? 'ACCEPTED', observation: probe.request, ...(proposal ? { selectedTactic: proposal.tactic, selectedTarget: proposal.target, evidenceEventIds: proposal.evidenceEventIds, tauntId: proposal.tauntId } : {}) };
    } catch (error) { results.gemini = { status: 'failed', checkedAt, detail: providerFailure(error, 'Gemini availability/request failed') }; }
  }
}
if (selected === 'elevenlabs') {
  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID || !process.env.ELEVENLABS_MODEL_ID) results.elevenlabs = { status: 'blocked', checkedAt, detail: 'ElevenLabs key/voice/model absent' };
  else try {
    const headers = { 'xi-api-key': process.env.ELEVENLABS_API_KEY };
    const voice = await bounded(signal => fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID!)}`, { headers, signal }), 7000);
    if (!voice.ok) throw { status: voice.status }; await voice.body?.cancel();
    const models = await bounded(async signal => { const result = await fetch('https://api.elevenlabs.io/v1/models', { headers, signal }); if (!result.ok) throw { status: result.status }; return await result.json() as { model_id?: string }[]; }, 7000);
    if (!Array.isArray(models) || !models.some(model => model.model_id === process.env.ELEVENLABS_MODEL_ID)) throw new Error('Configured model unavailable');
    const requestId = `lock-in-speech-${Date.now()}`;
    const caption = 'Machines quiet. It may still investigate the last sound. Prepare emitter A.';
    const result = await elevenSpeech({ requestId, encounterId: 'stage-1-complete', caption, expiresAtMs: Date.now() + 20000 }, process.env);
    results.elevenlabs = { status: result.source === 'elevenlabs' && result.audioBase64 ? 'passed' : 'failed', checkedAt, detail: result.reason ?? 'Configured voice/model and real authored speech generated; audible UI playback still separate', source: result.source, latencyMs: result.latencyMs, requestId, providerRequestId: result.providerRequestId, caption, audioBytes: result.audioBase64 ? Buffer.from(result.audioBase64, 'base64').byteLength : 0 };
  } catch (error) { results.elevenlabs = { status: 'failed', checkedAt, detail: providerFailure(error, 'ElevenLabs voice/model/generation failed') }; }
}
if (selected === 'convex') {
  if (!process.env.VITE_CONVEX_URL) results.convex = { status: 'blocked', checkedAt, detail: 'VITE_CONVEX_URL absent; no deployment created' };
  else {
    const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL, { logger: false, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) });
    const ownerCapability = randomBytes(32).toString('hex'), judgeCapability = randomBytes(32).toString('hex');
    let sessionId: string | null = null;
    try {
      const version = await client.query(makeFunctionReference<'query'>('sessions:version'), {});
      if (version?.schemaVersion !== TRACE_SCHEMA_VERSION) throw new Error('Existing deployment needs current LOCK IN provisioning');
      sessionId = await client.mutation(makeFunctionReference<'mutation'>('sessions:create'), { ownerCapability, judgeCapability, consent: true, seed: 17, mode: 'integration-smoke' });
      await client.query(makeFunctionReference<'query'>('sessions:get'), { sessionId, capability: judgeCapability });
      let denied = false;
      try { await client.query(makeFunctionReference<'query'>('sessions:get'), { sessionId, capability: ownerCapability }); } catch { denied = true; }
      if (!denied) throw new Error('Capability isolation failed');
      results.convex = { status: 'passed', checkedAt, detail: 'Existing LOCK IN deployment version, consenting session, judge read and capability isolation passed. Reactive/reconnect UI proof separate.' };
    } catch (error) {
      // Inspect only to classify; never emit the remote error body or URL.
      const missingFunctions = error instanceof Error && /Could not find public function|Could not find function|No function found|needs (?:current )?LOCK IN provisioning/.test(error.message);
      results.convex = { status: 'blocked', checkedAt, category: missingFunctions ? 'FUNCTIONS_NOT_PROVISIONED' : 'DEPLOYMENT_UNAVAILABLE', detail: missingFunctions ? 'Existing deployment lacks compatible LOCK IN functions. Human provisioning required; no dev/env/deploy CLI commands were run.' : 'Existing deployment unavailable or incompatible. No dev/env/deploy CLI commands were run; local trace remains available.' };
    }
    finally { if (sessionId) try { await client.mutation(makeFunctionReference<'mutation'>('sessions:remove'), { sessionId, capability: ownerCapability }); } catch { results.convex = { status: 'failed', checkedAt, detail: 'Smoke session deletion failed; retry owner deletion before demo' }; } }
  }
}
mkdirSync('docs', { recursive: true });
const alternate = selected === 'gemini' && process.argv.includes('--alternate');
if (alternate) mkdirSync('docs/qa', { recursive: true });
const evidence = alternate ? { application: 'LOCK IN', checkedAt, platform: `${process.platform}/${process.arch}`, processOnlyModelOverride: true, result: results.gemini } : { application: 'LOCK IN', checkedAt, platform: `${process.platform}/${process.arch}`, results };
writeFileSync(alternate ? 'docs/qa/lock-in-gemini-alternate.json' : 'docs/integration-checks.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(alternate ? results.gemini : results, null, 2));
const selectedResult = results[selected === 'native' ? 'presage' : selected]!;
if (selected === 'native' ? selectedResult.nativeImport !== 'passed' : selectedResult.status !== 'passed') process.exitCode = 1;
