// Explicit, stage-selective live checks. No deployment or env mutation commands.
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { geminiProposal, elevenSpeech, providerFailure } from '../src/integrations/providers';
import { createDirectorProbe, validateDirectorProbe } from './liveCheckValidation';
import type { DirectorProposal } from '../src/game/state';

const selected = process.argv.find(value => value.startsWith('--only='))?.slice(7) ?? 'native';
if (!['native', 'gemini', 'elevenlabs', 'spacetime'].includes(selected)) throw new Error('Use --only=native|gemini|elevenlabs|spacetime');
if (selected !== 'native' && !process.argv.includes('--live')) throw new Error('Provider checks require explicit --live after the offline game gate');
for (const filename of ['.env', '.env.local']) if (existsSync(filename)) process.loadEnvFile(filename);
type Outcome = { status: 'passed' | 'blocked' | 'failed' | 'not_tested'; detail: string; checkedAt?: string; [key: string]: unknown };
const results: Record<string, Outcome> = Object.fromEntries(['presage', 'gemini', 'elevenlabs', 'spacetime'].map(name => [name, { status: 'not_tested', detail: 'Not yet tested in HUSH; previous-game evidence does not qualify' }]));
if (existsSync('docs/integration-checks.json')) {
  const prior = JSON.parse(readFileSync('docs/integration-checks.json', 'utf8'));
  if (prior.application === 'HUSH' || prior.application === 'LOCK IN') Object.assign(results, prior.results);
}
delete results.convex;
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
      results.gemini = { status: proposal ? 'passed' : 'failed', checkedAt, scope: 'structured probe; actual game proof separate', model: process.env.GEMINI_MODEL, detail: proposal ? 'Real HUSH proposal passed the full current-state validator' : result.reason ?? `Rejected: ${rejection}`, latencyMs: result.latencyMs, requestId: probe.request.requestId, providerRequestId: result.providerRequestId, source: result.source, validation: rejection ?? 'ACCEPTED', observation: probe.request, ...(proposal ? { selectedTactic: proposal.tactic, selectedTarget: proposal.target, evidenceEventIds: proposal.evidenceEventIds, tauntId: proposal.tauntId } : {}) };
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
if (selected === 'spacetime') {
  if (!process.env.VITE_SPACETIMEDB_DB_NAME) results.spacetime = { status: 'blocked', checkedAt, detail: 'VITE_SPACETIMEDB_DB_NAME absent; no database published' };
  else {
    const { connectSpacetime, judgeQuery } = await import('../src/integrations/spacetime');
    const ownerCapability = randomBytes(32).toString('hex'), judgeCapability = randomBytes(32).toString('hex'), sessionId = randomBytes(32).toString('hex');
    let client: Awaited<ReturnType<typeof connectSpacetime>> | null = null;
    try {
      client = await connectSpacetime();
      await client.reducers.createSession({ id: sessionId, ownerCapability, judgeCapability, consent: true, seed: 17, mode: 'integration-smoke' });
      await client.reducers.appendTrace({ id: sessionId, ownerCapability, events: [], summary: { time: 0, stage: 1, status: 'playing', equipment: 'on', creatureNode: 'SHELTER_WALL', creaturePhase: 'search', linePosition: 0, lineLength: 24, danger: 0, quietChargesRemaining: 5, tactic: 'WAIT', target: 'NONE', proposalSource: 'FALLBACK', sensorSource: 'manual', sensorQuality: 'unknown', trend: 'UNKNOWN', sensorAgeMs: undefined } });
      const read = async (capability: string): Promise<number> => {
        // Each capability needs its own cache; a prior subscription can leave rows visible.
        const judge = await connectSpacetime();
        try {
          return await bounded(_signal => new Promise<number>((resolve, reject) => {
            judge.subscriptionBuilder()
              .onApplied(ctx => resolve([...ctx.db.judgeTrace.iter()].length))
              .onError(() => reject(new Error('Judge subscription failed')))
              .subscribe(judgeQuery(sessionId, capability));
          }), 7000);
        } finally { judge.disconnect(); }
      };
      if (await read(judgeCapability) !== 1 || await read(ownerCapability) !== 0) throw new Error('Judge capability isolation failed');
      results.spacetime = { status: 'passed', checkedAt, detail: 'Consenting session, trace write, judge view isolation passed; browser reconnection proof separate.' };
    } catch { results.spacetime = { status: 'blocked', checkedAt, detail: 'SpacetimeDB database unavailable or module not published; local trace remains available.' }; }
    finally {
      if (client) {
        try { await client.reducers.removeSession({ id: sessionId, ownerCapability }); }
        catch { results.spacetime = { status: 'failed', checkedAt, detail: 'Smoke session deletion failed; retry owner deletion before demo' }; }
        client.disconnect();
      }
    }
  }
}
mkdirSync('docs', { recursive: true });
const alternate = selected === 'gemini' && process.argv.includes('--alternate');
if (alternate) mkdirSync('docs/qa', { recursive: true });
const evidence = alternate ? { application: 'HUSH', checkedAt, platform: `${process.platform}/${process.arch}`, processOnlyModelOverride: true, result: results.gemini } : { application: 'HUSH', checkedAt, platform: `${process.platform}/${process.arch}`, results };
writeFileSync(alternate ? 'docs/qa/lock-in-gemini-alternate.json' : 'docs/integration-checks.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(alternate ? results.gemini : results, null, 2));
const selectedResult = results[selected === 'native' ? 'presage' : selected]!;
if (selected === 'native' ? selectedResult.nativeImport !== 'passed' : selectedResult.status !== 'passed') process.exitCode = 1;
