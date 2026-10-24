import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { GameState, DirectorRequest, PublicEvent } from '../game/state';
import type { SensorView } from '../sensing/types';
import { publicDirectorRequest, publicEvent, type DirectorResult, type SpeechRequest, type SpeechResult, type IntegrationStatus } from './contracts';

let activeTrace: TraceBridge | null = null;
let integrationRun = 0;
let integrationPrefix = 'boot';
/** Call once at every new shift; provider idempotency must not confuse a replay
 * of the same deterministic seed with a reconnect of the current session. */
export function beginIntegrationRun(): void { integrationRun++; integrationPrefix = `${integrationRun}-${token().slice(0, 12)}`; }
export async function integrationStatus(): Promise<IntegrationStatus> {
  if (window.nightRelay) return window.nightRelay.status();
  return { desktop: false, presage: false, gemini: !!activeTrace?.connected, elevenlabs: !!activeTrace?.connected, convex: !!activeTrace?.connected, reasons: ['Browser mode · live sensing requires Electron', 'Provider configuration is verified only by a successful request'] };
}
export async function requestDirector(request: DirectorRequest): Promise<DirectorResult> {
  const run = integrationRun;
  try {
    const safe = publicDirectorRequest(request);
    const remote = { ...safe, requestId: `${integrationPrefix}:${safe.requestId.slice(-96)}` };
    const result = window.nightRelay ? await window.nightRelay.director(remote) : activeTrace?.connected ? await activeTrace.action('director:propose', remote) as DirectorResult : null;
    if (result) {
      if (run !== integrationRun) return { proposal: null, source: 'fallback', latencyMs: result.latencyMs, reason: 'Response from previous shift discarded' };
      // Restore local identity only when the provider echoed the transported ID.
      const proposal = result.proposal as Record<string, unknown> | null;
      return { ...result, proposal: proposal?.requestId === remote.requestId ? { ...proposal, requestId: safe.requestId } : result.proposal };
    }
  } catch { /* The deterministic local director remains authoritative. */ }
  return { proposal: null, source: 'fallback', latencyMs: 0, reason: 'No live provider bridge · seeded local director' };
}
export async function requestSpeech(request: SpeechRequest): Promise<SpeechResult> {
  const run = integrationRun;
  try {
    const remote = { ...request, requestId: `${integrationPrefix}:${request.requestId.slice(-96)}` };
    const result = window.nightRelay ? await window.nightRelay.speech(remote) : activeTrace?.connected ? await activeTrace.action('speech:generate', remote) as SpeechResult : null;
    if (result && run === integrationRun) return result;
  } catch { /* Captions plus radio beep are always usable. */ }
  return { audioBase64: null, mimeType: 'audio/mpeg', source: 'fallback', latencyMs: 0, reason: 'No live voice bridge · captions and radio beep' };
}

export type TraceSummary = { time: number; task: number; status: string; energy: number; tactic: string; proposalSource: string; sensorSource: string; sensorQuality: string; trend: string; sensorAgeMs: number | null };
export type TraceSnapshot = { seed: number; mode: string; summary: TraceSummary; events: PublicEvent[]; transport: 'local' | 'convex' };
export function sanitizedTrace(state: GameState, sensor: SensorView): TraceSnapshot {
  return { seed: state.seed, mode: state.mode, summary: { time: state.time, task: state.tasks.stage, status: state.status, energy: Math.round(state.energy), tactic: state.director.lastTactic, proposalSource: state.director.source, sensorSource: sensor.source, sensorQuality: sensor.quality, trend: state.trend, sensorAgeMs: sensor.ageMs === null ? null : Math.round(sensor.ageMs) }, events: state.events.slice(-100).map(publicEvent), transport: 'local' };
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
  async connect(consent: boolean, seed: number, mode: string): Promise<void> {
    if (!consent || this.channel || this.disposed) return;
    const channelName = `night-relay-${token()}`;
    this.channel = new BroadcastChannel(channelName);
    this.access = { channel: channelName };
    this.status = 'Local trace · same browser only';
    const url = import.meta.env.VITE_CONVEX_URL;
    if (!url) return;
    try {
      this.client = new ConvexClient(url);
      this.sessionId = await this.client.mutation(makeFunctionReference<'mutation'>('sessions:create'), { ownerCapability: this.owner, judgeCapability: this.judge, consent: true, seed, mode });
      if (this.disposed) { await this.deleteSession(); return; }
      this.connected = true; activeTrace = this;
      this.access = { channel: channelName, sessionId: this.sessionId!, capability: this.judge, convexUrl: url };
      this.status = 'Convex connected · consenting sanitized trace';
    } catch { this.status = 'Convex unavailable · local trace active'; }
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
    const events = snapshot.events.filter(e => e.seq > this.sequence);
    void this.client.mutation(makeFunctionReference<'mutation'>('events:append'), { sessionId: this.sessionId, capability: this.owner, events, summary: snapshot.summary }).then((sequence: number) => { this.sequence = sequence; this.status = 'Convex live trace'; }).catch(() => { this.status = 'Convex disconnected · retrying events without replay'; }).finally(() => { this.busy = false; });
  }
  async deleteSession(): Promise<void> {
    if (this.client && this.sessionId) await this.client.mutation(makeFunctionReference<'mutation'>('sessions:remove'), { sessionId: this.sessionId, capability: this.owner });
    this.sessionId = null; this.connected = false;
    this.channel?.close(); this.channel = null; this.access = null;
    if (activeTrace === this) activeTrace = null;
    this.status = 'Session deleted';
  }
  async dispose(): Promise<void> { this.disposed = true; this.channel?.close(); this.channel = null; if (activeTrace === this) activeTrace = null; await this.client?.close(); this.connected = false; }
}

export function subscribeJudge(listener: (snapshot: TraceSnapshot) => void, reportStatus: (status: string) => void): () => void {
  let client: ConvexClient | null = null;
  let channel: BroadcastChannel | null = null;
  let unsubscribe: (() => void) | null = null;
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get('judge');
    const access = JSON.parse(atob(raw ?? '')) as JudgeAccess;
    if (!/^night-relay-[a-f0-9]{64}$/.test(access.channel)) throw new Error('Invalid trace access');
    channel = new BroadcastChannel(access.channel);
    channel.onmessage = e => listener(e.data as TraceSnapshot);
    reportStatus('Waiting for consenting local session');
    const configuredUrl = import.meta.env.VITE_CONVEX_URL;
    if (access.convexUrl && access.convexUrl === configuredUrl && access.sessionId && access.capability) {
      client = new ConvexClient(configuredUrl);
      unsubscribe = client.onUpdate(makeFunctionReference<'query'>('sessions:get'), { sessionId: access.sessionId, capability: access.capability }, result => { if (result.summary) listener({ ...result, transport: 'convex' } as TraceSnapshot); reportStatus('Convex live subscription'); }, () => reportStatus('Convex trace unavailable; access may have expired'));
    }
  } catch { reportStatus('Invalid or missing judge access'); }
  return () => { unsubscribe?.(); channel?.close(); void client?.close(); };
}
