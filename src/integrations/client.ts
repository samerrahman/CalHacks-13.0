import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { GameState, DirectorRequest, PublicEvent } from '../game/state';
import type { SensorView } from '../sensing/types';
import { publicDirectorRequest, publicEvent, publicMonsterRequest, authoredMonsterFallback, MONSTER_TOTAL_TIMEOUT_MS, TRACE_SCHEMA_VERSION, type MonsterRequest, type MonsterResult, type DirectorResult, type SpeechRequest, type SpeechResult, type IntegrationStatus } from './contracts';
import { DIRECTOR_TIMEOUT_MS } from '../game/directorValidation';
import { config } from '../game/config';

// The default beforeunload guard silently cancels closing an Electron window while a write is pending.
const convexOptions = { unsavedChangesWarning: false, logger: false };
let activeTrace: TraceBridge | null = null;
let integrationRun = 0;
let integrationPrefix = 'boot';
function localDevApi(): boolean { return !!import.meta.env?.DEV && typeof location !== 'undefined' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname); }
async function localRequest<T>(endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/lock-in/${endpoint}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', headers: { 'X-Lock-In-Client': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(endpoint === 'director' ? DIRECTOR_TIMEOUT_MS : endpoint === 'monster' ? MONSTER_TOTAL_TIMEOUT_MS + 500 : endpoint === 'speech' ? 7500 : 1500) });
  if (!response.ok) throw new Error(`Local provider HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
/** Call once at every new shift; provider idempotency must not confuse a replay
 * of the same deterministic seed with a reconnect of the current session. */
export function beginIntegrationRun(): void { integrationRun++; integrationPrefix = `${integrationRun}-${token().slice(0, 12)}`; }
export async function integrationStatus(): Promise<IntegrationStatus> {
  if (window.lockIn) return window.lockIn.status();
  if (localDevApi()) {
    try { return await localRequest<IntegrationStatus>('status'); }
    catch { return { desktop: false, presage: false, gemini: false, elevenlabs: false, convex: false, reasons: ['Local development provider bridge unavailable', 'Live Presage sensing requires Electron'] }; }
  }
  return { desktop: false, presage: false, gemini: !!activeTrace?.connected, elevenlabs: !!activeTrace?.connected, convex: !!activeTrace?.connected, reasons: ['Browser mode · live sensing requires Electron', 'Provider configuration is verified only by a successful request'] };
}
export async function requestDirector(request: DirectorRequest): Promise<DirectorResult> {
  const run = integrationRun;
  const local = localDevApi();
  try {
    const safe = publicDirectorRequest(request);
    const remote = { ...safe, requestId: `${integrationPrefix}:${safe.requestId.slice(-96)}` };
    const result = window.lockIn ? await window.lockIn.director(remote) : local ? await localRequest<DirectorResult>('director', remote) : activeTrace?.connected ? await activeTrace.action('director:propose', remote) as DirectorResult : null;
    if (result) {
      if (run !== integrationRun) return { proposal: null, source: 'fallback', latencyMs: result.latencyMs, reason: 'Response from previous shift discarded' };
      // Restore local identity only when the provider echoed the transported ID.
      const proposal = result.proposal as Record<string, unknown> | null;
      return { ...result, proposal: proposal?.requestId === remote.requestId ? { ...proposal, requestId: safe.requestId } : result.proposal };
    }
  } catch { /* The deterministic local director remains authoritative. */ }
  return { proposal: null, source: 'fallback', latencyMs: 0, reason: local ? 'Local director unavailable or timed out · seeded local director' : 'No live provider bridge · seeded local director' };
}
export async function requestSpeech(request: SpeechRequest): Promise<SpeechResult> {
  const run = integrationRun;
  const local = localDevApi();
  try {
    const remote = { ...request, requestId: `${integrationPrefix}:${request.requestId.slice(-96)}` };
    const result = window.lockIn ? await window.lockIn.speech(remote) : local ? await localRequest<SpeechResult>('speech', remote) : activeTrace?.connected ? await activeTrace.action('speech:generate', remote) as SpeechResult : null;
    if (result && run === integrationRun) return result;
  } catch { /* Captions plus radio beep are always usable. */ }
  return { audioBase64: null, mimeType: 'audio/mpeg', source: 'fallback', latencyMs: 0, reason: local ? 'Local voice unavailable or timed out · captions remain available' : 'No live voice bridge · captions and radio beep' };
}

export async function requestMonster(request: MonsterRequest): Promise<MonsterResult> {
  const run = integrationRun;
  try {
    const safe = publicMonsterRequest(request);
    const remote = { ...safe, requestId: `${integrationPrefix}:${safe.requestId.slice(-96)}` };
    const result = window.lockIn ? await window.lockIn.monster(remote) : localDevApi() ? await localRequest<MonsterResult>('monster', remote) : activeTrace?.connected ? await activeTrace.action('monster:generate', remote) as MonsterResult : null;
    if (result && result.requestId === remote.requestId && run === integrationRun && Date.now() < request.expiresAtMs) return { ...result, requestId: request.requestId };
    return authoredMonsterFallback(request, 'Stale or unavailable contextual dialogue');
  } catch { return authoredMonsterFallback(request, 'Contextual dialogue unavailable · authored fallback'); }
}

export type TraceSummary = { time: number; stage: number; status: string; equipment: string; creatureNode: string; creaturePhase: string; linePosition: number; lineLength: number; danger: number; quietChargesRemaining: number; tactic: string; target: string; proposalSource: string; sensorSource: string; sensorQuality: string; trend: string; sensorAgeMs: number | null };
export type TraceSnapshot = { seed: number; mode: string; summary: TraceSummary; events: PublicEvent[]; transport: 'local' | 'convex' };
export function sanitizedTrace(state: GameState, sensor: SensorView): TraceSnapshot {
  return { seed: state.seed, mode: state.mode, summary: { time: state.time, stage: state.tasks.stage, status: state.status, equipment: state.equipment, creatureNode: state.creature.node, creaturePhase: state.creature.phase, linePosition: state.creature.linePosition, lineLength: config.line.length, danger: Math.round(state.danger), quietChargesRemaining: state.shutdown.chargesRemaining, tactic: state.director.lastTactic, target: state.director.lastTarget, proposalSource: state.director.source, sensorSource: sensor.source, sensorQuality: sensor.quality, trend: state.trend, sensorAgeMs: sensor.ageMs === null ? null : Math.round(sensor.ageMs) }, events: state.events.slice(-100).map(publicEvent), transport: 'local' };
}
function token(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
type JudgeAccess = { channel: string; sessionId?: string; capability?: string; convexUrl?: string };
export class TraceBridge {
  connected = false;
  status = 'Trace sharing off';
  private client: ConvexClient | null = null;
  private channel: BroadcastChannel | null = null;
  private owner = token();
  private judge = token();
  private sessionId: string | null = null;
  private sequence = 0;
  private busy = false;
  private disposed = false;
  private lastWrite = -Infinity;
  private access: JudgeAccess | null = null;
  private connecting = false;
  private generation = 0;
  async connect(consent: boolean, seed: number, mode: string): Promise<void> {
    if (!consent || this.channel || this.disposed || this.connecting) return;
    const generation = ++this.generation;
    const channelName = `lock-in-${token()}`;
    this.channel = new BroadcastChannel(channelName);
    this.access = { channel: channelName };
    this.status = 'Local trace · same browser only';
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) return;
    this.connecting = true;
    try {
      if ((await window.lockIn?.status())?.offline) return;
      if (generation !== this.generation || this.disposed) return;
      this.client = new ConvexClient(url, convexOptions);
      const version = await this.client.query(makeFunctionReference<'query'>('sessions:version'), {});
      if (version?.schemaVersion !== TRACE_SCHEMA_VERSION) throw new Error('Deployment needs current LOCK IN functions');
      if (generation !== this.generation || this.disposed) return;
      this.sessionId = await this.client.mutation(makeFunctionReference<'mutation'>('sessions:create'), { ownerCapability: this.owner, judgeCapability: this.judge, consent: true, seed, mode });
      if (this.disposed || generation !== this.generation) { await this.deleteSession(); return; }
      this.connected = true; activeTrace = this;
      this.access = { channel: channelName, sessionId: this.sessionId!, capability: this.judge, convexUrl: url };
      this.status = 'Convex connected · consenting sanitized trace';
    } catch { this.status = this.sessionId ? 'Trace stopped · server deletion pending' : 'Convex LOCK IN functions unavailable · local trace only'; }
    finally { this.connecting = false; if ((this.disposed || generation !== this.generation) && !this.sessionId) await this.client?.close(); }
  }
  judgeUrl(): string | null { return this.access ? `${location.origin}${location.pathname}#judge=${encodeURIComponent(btoa(JSON.stringify(this.access)))}` : null; }
  async action(name: string, request: unknown): Promise<unknown> {
    if (!this.client || !this.sessionId || !this.connected) throw new Error('Convex unavailable');
    return this.client.action(makeFunctionReference<'action'>(name), { sessionId: this.sessionId, capability: this.owner, request });
  }
  publish(state: GameState, sensor: SensorView): void {
    if (!this.channel || this.disposed) return;
    const snapshot = sanitizedTrace(state, sensor);
    snapshot.transport = this.connected ? 'convex' : 'local';
    this.channel.postMessage(snapshot);
    if (!this.connected || !this.client || !this.sessionId || this.busy || performance.now() - this.lastWrite < 1000) return;
    this.busy = true; this.lastWrite = performance.now();
    const generation = this.generation;
    const events = snapshot.events.filter(e => e.seq > this.sequence);
    void this.client.mutation(makeFunctionReference<'mutation'>('events:append'), { sessionId: this.sessionId, capability: this.owner, events, summary: snapshot.summary }).then((sequence: number) => { if (generation === this.generation && this.connected) { this.sequence = sequence; this.status = 'Convex live trace'; } }).catch(() => { if (generation === this.generation && this.connected) this.status = 'Convex disconnected · retrying events without replay'; }).finally(() => { this.busy = false; });
  }
  async deleteSession(): Promise<void> {
    // Stop local publication immediately even if the remote deletion is offline.
    this.generation++; this.connected = false;
    this.channel?.close(); this.channel = null; this.access = null;
    if (activeTrace === this) activeTrace = null;
    if (this.client && this.sessionId) await this.client.mutation(makeFunctionReference<'mutation'>('sessions:remove'), { sessionId: this.sessionId, capability: this.owner });
    this.sessionId = null;
    this.status = 'Session deleted';
  }
  async dispose(): Promise<void> { this.disposed = true; this.generation++; this.channel?.close(); this.channel = null; if (activeTrace === this) activeTrace = null; if (!this.connecting) await this.client?.close(); this.connected = false; }
}

export function subscribeJudge(listener: (snapshot: TraceSnapshot) => void, reportStatus: (status: string) => void): () => void {
  let client: ConvexClient | null = null;
  let channel: BroadcastChannel | null = null;
  let unsubscribe: (() => void) | null = null;
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get('judge');
    const access = JSON.parse(atob(raw ?? '')) as JudgeAccess;
    if (!/^lock-in-[a-f0-9]{64}$/.test(access.channel)) throw new Error('Invalid trace access');
    channel = new BroadcastChannel(access.channel);
    channel.onmessage = e => listener(e.data as TraceSnapshot);
    reportStatus('Waiting for consenting local session');
    const configuredUrl = import.meta.env.VITE_CONVEX_URL;
    if (access.convexUrl && access.convexUrl === configuredUrl && access.sessionId && access.capability) {
      client = new ConvexClient(configuredUrl, convexOptions);
      unsubscribe = client.onUpdate(makeFunctionReference<'query'>('sessions:get'), { sessionId: access.sessionId, capability: access.capability }, result => { if (result.summary) listener({ ...result, transport: 'convex' } as TraceSnapshot); reportStatus('Convex live subscription'); }, () => reportStatus('Convex trace unavailable; access may have expired'));
    }
  } catch { reportStatus('Invalid or missing judge access'); }
  return () => { unsubscribe?.(); channel?.close(); void client?.close(); };
}
