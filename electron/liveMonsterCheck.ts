/** Explicit, bounded live provider probe. Synthetic public game context;
 * this is separate from an actual in-game rendering/playback verification. */
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDirectorProbe } from './liveCheckValidation';
import { createGame, step } from '../src/game/reducer';
import { buildDirectorRequest } from '../src/game/directorValidation';
import { generateMonster, DEFAULT_DIALOGUE_MODEL } from '../src/integrations/providers';
import { monsterFallbackCaption, publicDirectorRequest, type MonsterRequest } from '../src/integrations/contracts';

for (const path of ['.env', '.env.local']) if (existsSync(path)) process.loadEnvFile(path);
const narrativeCheck = process.argv.includes('--narrative-check');
let context = createDirectorProbe('live-monster-context').request;
if (narrativeCheck) {
  let state = createGame(17, 'standard');
  for (let tick = 0; tick < 100 && !state.events.some(event => event.type === 'PROXIMITY_ALARM'); tick++) state = step(state, .1);
  context = publicDirectorRequest(buildDirectorRequest(state));
}
const request: MonsterRequest = { requestId: `live-monster-${Date.now()}`, context, fallbackId: narrativeCheck ? 'FIRST_APPROACH' : 'AFTER_MISTAKE', expiresAtMs: Date.now() + 25000 };
const originalFetch = globalThis.fetch;
let sentSpeechCaption: string | null = null;
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    try { sentSpeechCaption = JSON.parse(String(init?.body)).text; } catch { /* Do not retain headers, credentials, or other request fields. */ }
  }
  return originalFetch(input, init);
};
try {
  const result = await generateMonster(request, process.env);
  const audio = result.speech.audioBase64 ? Buffer.from(result.speech.audioBase64, 'base64') : null;
  let audioDecoded = false;
  let audioDurationSeconds: number | null = null;
  if (audio && process.platform === 'darwin') {
    const temp = mkdtempSync(join(tmpdir(), 'lock-in-dialogue-'));
    try {
      const path = join(temp, 'probe.mp3'); writeFileSync(path, audio, { mode: 0o600 });
      const info = execFileSync('/usr/bin/afinfo', [path], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
      const seconds = info.match(/estimated duration:\s*([0-9.]+)\s*sec/i)?.[1];
      audioDurationSeconds = seconds ? Number(seconds) : null;
      // afconvert actually decodes the file rather than only reading its header.
      execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', path, join(temp, 'decoded.wav')], { timeout: 3000, stdio: 'ignore' });
      audioDecoded = true;
    } catch { /* Decoder status remains explicitly false. */ }
    finally { rmSync(temp, { recursive: true, force: true }); }
  }
  const evidence = {
    checkedAt: new Date().toISOString(), testKind: 'live provider probe with synthetic sanitized LOCK IN context',
    promptRevision: 'stationary-player-outside-creature',
    model: process.env.GEMINI_DIALOGUE_MODEL || DEFAULT_DIALOGUE_MODEL,
    requestId: result.requestId, trigger: request.fallbackId, caption: result.caption,
    textSource: result.textSource, textLatencyMs: result.textLatencyMs, textReason: result.textReason ?? null, textProviderRequestId: result.textProviderRequestId ?? null,
    evidenceEventIds: result.evidenceEventIds, contextEventIds: context.events.map(event => event.id),
    distinctFromAuthoredFallback: result.caption !== monsterFallbackCaption(request.fallbackId),
    exactCaptionSentToSpeech: sentSpeechCaption === result.caption,
    speech: { source: result.speech.source, latencyMs: result.speech.latencyMs, reason: result.speech.reason ?? null, providerRequestId: result.speech.providerRequestId ?? null, mimeType: result.speech.mimeType, bytes: audio?.length ?? 0, audioDecoded, audioDurationSeconds },
    totalLatencyMs: result.totalLatencyMs,
    passed: result.textSource === 'gemini' && result.speech.source === 'elevenlabs' && sentSpeechCaption === result.caption && audioDecoded,
  };
  mkdirSync('docs/qa', { recursive: true }); writeFileSync(`docs/qa/${narrativeCheck ? 'generated-monster-narrative-check' : 'generated-monster-live-probe'}.json`, JSON.stringify(evidence, null, 2) + '\n');
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  if (!evidence.passed) process.exitCode = 1;
} catch {
  process.stderr.write('Live contextual dialogue probe failed before a valid result; no provider body or credentials logged.\n'); process.exitCode = 1;
} finally { globalThis.fetch = originalFetch; }
