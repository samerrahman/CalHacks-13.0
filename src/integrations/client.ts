import { DbConnection } from '../module_bindings';
import { connectSpacetime, judgeQuery, spacetimeConfig } from './spacetime';
import type { GameState, DirectorRequest, PublicEvent } from '../game/state';
import type { SensorView } from '../sensing/types';
import { spectatorVitals, type SpectatorVitals } from './spectate';
import { publicDirectorRequest, publicEvent, publicMonsterRequest, authoredMonsterFallback, MONSTER_TOTAL_TIMEOUT_MS, type MonsterRequest, type MonsterResult, type DirectorResult, type SpeechRequest, type SpeechResult, type IntegrationStatus } from './contracts';
import { DIRECTOR_TIMEOUT_MS } from '../game/directorValidation';
import { config } from '../game/config';

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
    catch { return { desktop: false, presage: false, gemini: false, elevenlabs: false, spacetime: false, reasons: ['Local development provider bridge unavailable', 'Live Presage sensing requires Electron'] }; }
  }
  return { desktop: false, presage: false, gemini: false, elevenlabs: false, spacetime: !!activeTrace?.isRemoteLive, reasons: ['Browser mode · live sensing requires Electron', 'Provider configuration is verified only by a successful request'] };
}
export async function requestDirector(request: DirectorRequest): Promise<DirectorResult> {
  const run = integrationRun;
  const local = localDevApi();
  try {
    const safe = publicDirectorRequest(request);
    const remote = { ...safe, requestId: `${integrationPrefix}:${safe.requestId.slice(-96)}` };
    const result = window.lockIn ? await window.lockIn.director(remote) : local ? await localRequest<DirectorResult>('director', remote) : null;
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
    const result = window.lockIn ? await window.lockIn.speech(remote) : local ? await localRequest<SpeechResult>('speech', remote) : null;
    if (result && run === integrationRun) return result;
  } catch { /* Captions plus radio beep are always usable. */ }
  return { audioBase64: null, mimeType: 'audio/mpeg', source: 'fallback', latencyMs: 0, reason: local ? 'Local voice unavailable or timed out · captions remain available' : 'No live voice bridge · captions and radio beep' };
}

export async function requestMonster(request: MonsterRequest): Promise<MonsterResult> {
  const run = integrationRun;
  try {
    const safe = publicMonsterRequest(request);
    const remote = { ...safe, requestId: `${integrationPrefix}:${safe.requestId.slice(-96)}` };
    const result = window.lockIn ? await window.lockIn.monster(remote) : localDevApi() ? await localRequest<MonsterResult>('monster', remote) : null;
    if (result && result.requestId === remote.requestId && run === integrationRun && Date.now() < request.expiresAtMs) return { ...result, requestId: request.requestId };
    return authoredMonsterFallback(request, 'Stale or unavailable contextual dialogue');
  } catch { return authoredMonsterFallback(request, 'Contextual dialogue unavailable · authored fallback'); }
}

export type TraceSummary = { time: number; stage: number; status: string; equipment: string; creatureNode: string; creaturePhase: string; linePosition: number; lineLength: number; danger: number; quietChargesRemaining: number; tactic: string; target: string; proposalSource: string; sensorSource: string; sensorQuality: string; trend: string; sensorAgeMs: number | null };
/** `vitals` is present only while the player keeps the separate heart-rate consent on. */
export type TraceSnapshot = { seed: number; mode: string; summary: TraceSummary; events: PublicEvent[]; transport: 'local' | 'spacetime'; vitals?: SpectatorVitals | null };
export function sanitizedTrace(state: GameState, sensor: SensorView): TraceSnapshot {
  return { seed: state.seed, mode: state.mode, summary: { time: state.time, stage: state.tasks.stage, status: state.status, equipment: state.equipment, creatureNode: state.creature.node, creaturePhase: state.creature.phase, linePosition: state.creature.linePosition, lineLength: config.line.length, danger: Math.round(state.danger), quietChargesRemaining: state.shutdown.chargesRemaining, tactic: state.director.lastTactic, target: state.director.lastTarget, proposalSource: state.director.source, sensorSource: sensor.source, sensorQuality: sensor.quality, trend: state.trend, sensorAgeMs: sensor.ageMs === null ? null : Math.min(120_000, Math.round(sensor.ageMs)) }, events: state.events.slice(-100).map(publicEvent), transport: 'local' };
}
function token(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
type JudgeAccess = { channel: string; sessionId?: string; capability?: string; host?: string; database?: string };
export class TraceBridge {
  /** Owner access stays inside the player app; only the judge capability enters invite links. */
  cameraAccess(): import('./webrtc').CameraSignalAccess | null {
    return this.isRemoteLive && this.client && this.sessionId
      ? { connection: this.client, sessionId: this.sessionId, ownerCapability: this.owner } : null;
  }
  coopLink(): import('./coop').CoopLink | null {
    return this.access && !this.disposed ? {
      channel: this.access.channel, connection: this.remoteReady ? this.client : null,
      sessionId: this.sessionId, ownerCapability: this.owner,
    } : null;
  }
  connected = false;
  get isRemoteLive(): boolean { return this.connected && !!this.client?.isActive; }
  status = 'Trace sharing off';
  private client: DbConnection | null = null;
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
  private vitalsConsent = false;
  /** The server may hold our vitals row: set before a share is sent, cleared only by a stop that
   * no later share overtook. A pending withdrawal is retried until it succeeds. */
  private vitalsRemote = false;
  private withdrawPending = false;
  private stopBusy = false;
  private lastStopTry = -Infinity;
  private vitalsBusy = false;
  private vitalsSequence = 0;
  private lastVitalsWrite = -Infinity;
  private lastSnapshot: TraceSnapshot | null = null;
  async connect(consent: boolean, seed: number, mode: string): Promise<void> {
    if (!consent || this.channel || this.disposed || this.connecting) return;
    const generation = ++this.generation;
    const channelName = `lock-in-${token()}`;
    this.channel = new BroadcastChannel(channelName);
    this.access = { channel: channelName };
    this.status = 'Local trace · same browser only';
    if (!import.meta.env?.VITE_SPACETIMEDB_DB_NAME) return;
    this.connecting = true;
    try {
      if ((await window.lockIn?.status())?.offline) return;
      if (generation !== this.generation || this.disposed) return;
      this.client = await connectSpacetime(
        () => { if (!this.disposed) this.status = 'SpacetimeDB reconnecting · local trace continues'; },
        () => { if (!this.disposed && this.connected) { this.status = 'SpacetimeDB reconnected · live trace resumes'; this.retryWithdraw(); } },
      );
      if (generation !== this.generation || this.disposed) return;
      this.sessionId = token();
      await this.client.reducers.createSession({ id: this.sessionId, ownerCapability: this.owner, judgeCapability: this.judge, consent: true, seed, mode });
      if (this.disposed || generation !== this.generation) { await this.deleteSession(); return; }
      this.connected = true; activeTrace = this;
      this.access = { channel: channelName, sessionId: this.sessionId, capability: this.judge, host: spacetimeConfig.uri, database: spacetimeConfig.database };
      this.status = 'SpacetimeDB connected · consenting sanitized trace';
      globalThis.addEventListener?.('pagehide', this.onPageHide);
    } catch {
      this.status = 'SpacetimeDB unavailable · local trace only';
      if (this.client && this.sessionId) {
        try { await this.client.reducers.removeSession({ id: this.sessionId, ownerCapability: this.owner }); }
        catch { this.status = 'Local trace only · remote session expires within 24 hours'; }
      }
      this.client?.disconnect(); this.client = null; this.sessionId = null;
    }
    finally { this.connecting = false; if ((this.disposed || generation !== this.generation) && !this.sessionId) this.client?.disconnect(); }
  }
  judgeUrl(): string | null { return this.access ? `${location.origin}${location.pathname}#judge=${encodeURIComponent(btoa(JSON.stringify(this.access)))}` : null; }
  /** Read-only friend link: same capability as the second screen, friendlier page. */
  spectateUrl(): string | null { return this.access ? `${location.origin}${location.pathname}#watch=${encodeURIComponent(btoa(JSON.stringify(this.access)))}` : null; }
  /** The link to send a friend. A loopback dev server or the desktop app's hush:// page cannot be
   * opened on another machine, so a hosted web build's public origin (VITE_SPECTATE_ORIGIN) wins. */
  shareableSpectateUrl(): string | null {
    if (!this.access) return null;
    const hosted = String(import.meta.env?.VITE_SPECTATE_ORIGIN ?? '').replace(/\/+$/, '');
    const loopback = (host: string) => /^(localhost|127\..*|0\.0\.0\.0|\[::1\])$/.test(host) || host.endsWith('.localhost');
    let hostedOrigin: string | null = null;
    try { const url = new URL(hosted); if (/^https?:$/.test(url.protocol) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && !loopback(url.hostname)) hostedOrigin = url.origin; } catch { /* no hosted build configured */ }
    const base = hostedOrigin ? `${hostedOrigin}/` : /^https?:$/.test(location.protocol) && !loopback(location.hostname) ? `${location.origin}${location.pathname}` : null;
    return base && `${base}#watch=${encodeURIComponent(btoa(JSON.stringify(this.access)))}`;
  }
  /** True once the SpacetimeDB session exists; before that a link reaches only this browser. */
  get remoteReady(): boolean { return !!this.access?.sessionId; }
  get remoteConnecting(): boolean { return this.connecting; }
  get sharingVitals(): boolean { return this.vitalsConsent; }
  /** Separate, revocable consent for the live heart rate. It needs trace sharing; turning it
   * off withdraws vitals from the local link at once and deletes the remote row. */
  setVitalsConsent(consent: boolean): boolean {
    this.vitalsConsent = consent && !!this.channel && !this.disposed;
    if (this.vitalsConsent) this.withdrawPending = false; else this.withdrawVitals();
    return this.vitalsConsent;
  }
  private withdrawVitals(): void {
    if (this.channel && this.lastSnapshot?.vitals) { this.lastSnapshot = { ...this.lastSnapshot, vitals: null }; this.channel.postMessage(this.lastSnapshot); }
    if (this.vitalsRemote) this.withdrawPending = true;
    this.retryWithdraw();
  }
  /** Sends stopVitals until one lands after our last share: covers a revoke while a share is in
   * flight, during a reconnect, or after a failed stop. */
  private retryWithdraw(): void {
    if (!this.withdrawPending || this.vitalsConsent) { this.withdrawPending = this.withdrawPending && !this.vitalsConsent; return; }
    if (this.stopBusy || !this.client?.isActive || !this.sessionId || performance.now() - this.lastStopTry < 1000) return;
    this.stopBusy = true; this.lastStopTry = performance.now();
    const generation = this.generation, sharedThrough = this.vitalsSequence;
    void this.client.reducers.stopVitals({ id: this.sessionId, ownerCapability: this.owner })
      .then(() => { if (generation === this.generation && this.vitalsSequence === sharedThrough) { this.vitalsRemote = false; this.withdrawPending = false; } })
      .catch(() => { if (generation === this.generation) this.status = 'Heart rate withdrawn locally · remote deletion pending, retrying'; })
      .finally(() => { this.stopBusy = false; if (this.withdrawPending && !this.disposed) setTimeout(() => this.retryWithdraw(), 1100); });
  }
  publish(state: GameState, sensor: SensorView): void {
    if (!this.channel || this.disposed) return;
    const snapshot = sanitizedTrace(state, sensor);
    snapshot.transport = this.connected && !!this.client?.isActive ? 'spacetime' : 'local';
    snapshot.vitals = this.vitalsConsent ? spectatorVitals(sensor) : null;
    this.lastSnapshot = snapshot;
    this.channel.postMessage(snapshot);
    this.publishVitals(snapshot.vitals);
    if (!this.connected || !this.client?.isActive || !this.sessionId || this.busy || performance.now() - this.lastWrite < 1000) return;
    this.busy = true; this.lastWrite = performance.now();
    const generation = this.generation;
    const events = snapshot.events.filter(e => e.seq > this.sequence);
    void this.client.reducers.appendTrace({ id: this.sessionId, ownerCapability: this.owner, events, summary: { ...snapshot.summary, sensorAgeMs: snapshot.summary.sensorAgeMs ?? undefined } }).then(() => { if (generation === this.generation && this.connected) { this.sequence = events.at(-1)?.seq ?? this.sequence; this.status = 'SpacetimeDB live trace'; } }).catch(() => { if (generation === this.generation && this.connected) this.status = 'SpacetimeDB disconnected · retrying trace'; }).finally(() => { this.busy = false; });
  }
  private publishVitals(vitals: SpectatorVitals | null): void {
    this.retryWithdraw();
    // Without a reading (manual play) nothing is sent; the server sweeps a stale row within 15 s.
    if (!vitals || !this.vitalsConsent || !this.connected || !this.client?.isActive || !this.sessionId || this.vitalsBusy || performance.now() - this.lastVitalsWrite < 1000) return;
    this.vitalsBusy = true; this.lastVitalsWrite = performance.now(); this.vitalsRemote = true;
    const generation = this.generation;
    void this.client.reducers.shareVitals({ id: this.sessionId, ownerCapability: this.owner, sequence: ++this.vitalsSequence, source: vitals.source, status: vitals.status, quality: vitals.quality, trend: vitals.trend, pulseBpm: vitals.pulseBpm ?? undefined, baselineBpm: vitals.baselineBpm ?? undefined })
      .then(() => { if (generation === this.generation && !this.vitalsConsent) this.withdrawVitals(); })
      .catch(() => { /* The next reading retries; the local link is unaffected. */ })
      .finally(() => { this.vitalsBusy = false; });
  }
  async deleteSession(): Promise<void> {
    // Stop local publication immediately even if the remote deletion is offline.
    this.vitalsConsent = false; this.withdrawPending = false;
    if (this.channel && this.lastSnapshot?.vitals) this.channel.postMessage({ ...this.lastSnapshot, vitals: null });
    this.generation++; this.connected = false;
    this.channel?.close(); this.channel = null; this.access = null;
    if (activeTrace === this) activeTrace = null;
    globalThis.removeEventListener?.('pagehide', this.onPageHide);
    // Detach first: a restart disposes this bridge in the same click, and must not cancel the delete.
    const client = this.client, id = this.sessionId;
    this.client = null; this.sessionId = null;
    try { if (client && id) await client.reducers.removeSession({ id, ownerCapability: this.owner }); }
    finally { client?.disconnect(); }
    this.status = 'Session deleted';
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.vitalsConsent = false;
    if (this.channel && this.lastSnapshot?.vitals) this.channel.postMessage({ ...this.lastSnapshot, vitals: null });
    this.generation++; this.channel?.close(); this.channel = null; if (activeTrace === this) activeTrace = null;
    globalThis.removeEventListener?.('pagehide', this.onPageHide);
    const client = this.client; this.client = null; this.connected = false;
    if (!client) return;
    // Best effort: a closing game withdraws its heart rate now; the server sweep covers crashes.
    if (this.vitalsRemote && this.sessionId && client.isActive) {
      let closed = false; const close = () => { if (!closed) { closed = true; client.disconnect(); } };
      void client.reducers.stopVitals({ id: this.sessionId, ownerCapability: this.owner }).then(close, close); setTimeout(close, 1500);
    } else client.disconnect();
  }
  private onPageHide = (): void => { if (this.vitalsRemote && this.sessionId && this.client?.isActive) void this.client.reducers.stopVitals({ id: this.sessionId, ownerCapability: this.owner }).catch(() => {}); };
}

export function subscribeJudge(listener: (snapshot: TraceSnapshot) => void, reportStatus: (status: string) => void): () => void {
  let client: DbConnection | null = null;
  let channel: BroadcastChannel | null = null;
  let disposed = false;
  try {
    const raw = new URLSearchParams(location.hash.slice(1)).get('judge');
    const access = JSON.parse(atob(raw ?? '')) as JudgeAccess;
    if (!/^(hush|lock-in)-[a-f0-9]{64}$/.test(access.channel)) throw new Error('Invalid trace access');
    channel = new BroadcastChannel(access.channel);
    channel.onmessage = e => listener(e.data as TraceSnapshot);
    reportStatus('Waiting for consenting local session');
    if (access.host === spacetimeConfig.uri && access.database === spacetimeConfig.database && access.sessionId && access.capability && import.meta.env.VITE_SPACETIMEDB_DB_NAME) {
      void connectSpacetime(() => reportStatus('SpacetimeDB reconnecting')).then(connection => {
        if (disposed) { connection.disconnect(); return; }
        client = connection;
        const show = (row: { seed: number; mode: string; summary: Omit<TraceSummary, 'sensorAgeMs'> & { sensorAgeMs?: number }; events: PublicEvent[] }) => { listener({ seed: row.seed, mode: row.mode, summary: { ...row.summary, sensorAgeMs: row.summary.sensorAgeMs ?? null }, events: row.events, transport: 'spacetime' }); reportStatus('SpacetimeDB live subscription'); };
        connection.db.judgeTrace.onInsert((_ctx, row) => show(row));
        connection.db.judgeTrace.onUpdate((_ctx, _old, row) => show(row));
        // An update arrives as insert + delete (view rows have no client key); only an empty cache means deleted.
        connection.db.judgeTrace.onDelete(() => { if (![...connection.db.judgeTrace.iter()].length) reportStatus('Shared session deleted or unavailable'); });
        connection.subscriptionBuilder().onApplied(ctx => { for (const row of ctx.db.judgeTrace.iter()) show(row); }).onError(() => reportStatus('SpacetimeDB trace unavailable')).subscribe(judgeQuery(access.sessionId!, access.capability!));
      }).catch(() => reportStatus('SpacetimeDB unavailable · local trace only'));
    }
  } catch { reportStatus('Invalid or missing judge access'); }
  return () => { disposed = true; channel?.close(); client?.disconnect(); };
}
