import type { DbConnection } from '../module_bindings';
import type { SensorView, Trend } from '../sensing/types';
import type { PublicEvent } from '../game/state';
import type { TraceSnapshot, TraceSummary } from './client';
import { capabilityQuery, connectSpacetime, spacetimeConfig } from './spacetime';
import { LocalPhysics, type PropView } from './physics';

/** The only physiology a spectator receives, and only under the separate vitals consent: the
 * current accepted estimate in whole BPM, the frozen baseline, coarse labels and one combined
 * fear percentage worked out on the player's device (`spectatorFear`). */
export type SpectatorVitals = { source: 'presage' | 'simulated'; status: SensorView['status']; quality: SensorView['quality']; trend: Trend; pulseBpm: number | null; baselineBpm: number | null; fearPct: number | null };
/** Same threshold SpectateView uses to dim a reading as held. */
const HELD_AFTER_MS = 5000;
const wholeBpm = (value: number | null) => value === null || !Number.isFinite(value) ? null : Math.min(110, Math.max(40, Math.round(value)));

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
const unit = (value: number) => Math.max(0, Math.min(1, value));
/** How much each camera estimate counts toward FEAR when present. */
export const FEAR_WEIGHTS = { face: .4, heart: .3, breathing: .2, skin: .1 } as const;

/** One fear percentage (0–100) from the player's own camera estimates, worked out on this device
 * so none of its parts leave it: Presage's fear expression score; heart rate above the frozen
 * baseline (+25 BPM is full); breathing above the resting rate (+8 breaths/min is full); and the
 * skin-response proxy above the first minute (+3 spreads is full). Each counts only while its
 * estimate is accepted and fresh (breathing also while its signal status is ok). The blend leans on
 * the strongest sign (a startled face reads as fear even while the pulse catches up), and a pulse
 * at least 8 BPM over baseline while the trend reads ELEVATED reads at least 55. (The browser camera
 * path can mark ELEVATED from a face or breathing spike alone, so the floor also needs the pulse.)
 * Null with nothing to go on. A game estimate, not a medical reading. */
export function spectatorFear(sensor: SensorView): number | null {
  if (sensor.source === 'manual' || sensor.status === 'manual') return null;
  const s = sensor.signals, parts: [number, number][] = [];
  if (s?.status.expressions.status === 'ok' && finite(s.fear)) parts.push([FEAR_WEIGHTS.face, unit(s.fear)]);
  if (sensor.quality === 'accepted' && finite(sensor.pulseBpm) && finite(sensor.baselineBpm)) parts.push([FEAR_WEIGHTS.heart, unit((sensor.pulseBpm - sensor.baselineBpm) / 25)]);
  // breathingRpm stays fresh for 5 s after its measurement, even once a rejection or validation block arrives.
  if (finite(sensor.breathingRpm) && finite(sensor.restingBreathingRpm) && (!s || s.status.breathing.status === 'ok')) parts.push([FEAR_WEIGHTS.breathing, unit((sensor.breathingRpm - sensor.restingBreathingRpm) / 8)]);
  if (s?.status.eda.status === 'ok' && finite(s.edaRelative)) parts.push([FEAR_WEIGHTS.skin, unit(s.edaRelative / 3)]);
  const elevated = sensor.quality === 'accepted' && sensor.trend === 'ELEVATED' && finite(sensor.pulseBpm) && finite(sensor.baselineBpm) && sensor.pulseBpm - sensor.baselineBpm >= 8 ? .55 : 0;
  if (!parts.length) return elevated ? Math.round(elevated * 100) : null;
  const peak = Math.max(...parts.map(([, v]) => v)), mean = parts.reduce((sum, [w, v]) => sum + w * v, 0) / parts.reduce((sum, [w]) => sum + w, 0);
  return Math.round(Math.max(elevated, .6 * peak + .4 * mean) * 100);
}

export function spectatorVitals(sensor: SensorView): SpectatorVitals | null {
  if (sensor.source === 'manual' || sensor.status === 'manual') return null;
  const pulseBpm = sensor.quality === 'accepted' ? wholeBpm(sensor.pulseBpm) : null;
  return { source: sensor.source, status: sensor.status, quality: pulseBpm === null ? (sensor.quality === 'rejected' ? 'rejected' : 'unknown') : 'accepted', trend: pulseBpm === null ? 'UNKNOWN' : sensor.trend, pulseBpm, baselineBpm: wholeBpm(sensor.baselineBpm), fearPct: spectatorFear(sensor) };
}

export type SpectateState = {
  status: string;
  trace: TraceSnapshot | null;
  vitals: SpectatorVitals | null;
  /** Local performance.now() when the latest vitals arrived; never a remote clock. */
  vitalsReceivedAt: number | null;
  traceReceivedAt: number | null;
  physics: 'spacetime' | 'local';
};
type Access = { channel: string; sessionId?: string; capability?: string; host?: string; database?: string };
type RemoteVitals = { source: string; status: string; quality: string; trend: string; pulseBpm?: number; baselineBpm?: number; sequence?: number };
type RemoteFear = { source: string; fearPct?: number; sequence?: number };
/** The player writes the fear row right after the vitals row with the same sequence. A fear row more
 * than this many readings away is left over (the player stopped sending it), not current. */
const FEAR_SEQUENCE_WINDOW = 3;
type RemoteProp = { slot: number; kind: string; radius: number; x: number; y: number; z: number; sleeping: boolean };

export function parseWatchAccess(hash: string): Access {
  const access = JSON.parse(atob(new URLSearchParams(hash.slice(1)).get('watch') ?? '')) as Access;
  if (!access || !/^(hush|lock-in)-[a-f0-9]{64}$/.test(access.channel)) throw new Error('Invalid spectate link');
  return access;
}

/** Revalidates remote rows: anything unexpected is treated as not shared. The fear row counts only
 * with a valid vitals row of the same source and a nearby sequence; a module without the fear table
 * leaves it null. */
export function remoteVitals(row: RemoteVitals | undefined, fear?: RemoteFear): SpectatorVitals | null {
  if (!row || !['presage', 'simulated'].includes(row.source) || !['starting', 'calibrating', 'ready', 'unavailable', 'paused'].includes(row.status) || !['accepted', 'rejected', 'unknown'].includes(row.quality) || !['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'].includes(row.trend)) return null;
  const pulse = row.quality === 'accepted' ? wholeBpm(row.pulseBpm ?? null) : null;
  const current = row.sequence === undefined || fear?.sequence === undefined || Math.abs(row.sequence - fear.sequence) <= FEAR_SEQUENCE_WINDOW;
  const fearPct = current && fear?.source === row.source && Number.isInteger(fear.fearPct) && fear.fearPct! >= 0 && fear.fearPct! <= 100 ? fear.fearPct! : null;
  return { source: row.source as SpectatorVitals['source'], status: row.status as SpectatorVitals['status'], quality: pulse === null && row.quality === 'accepted' ? 'unknown' : row.quality as SpectatorVitals['quality'], trend: pulse === null ? 'UNKNOWN' : row.trend as Trend, pulseBpm: pulse, baselineBpm: wholeBpm(row.baselineBpm ?? null), fearPct };
}
/** A local-link snapshot's vitals, revalidated like a remote row (an older player build sends no fear). */
export function localVitals(vitals: unknown): SpectatorVitals | null {
  if (!vitals || typeof vitals !== 'object') return null;
  const v = vitals as Partial<SpectatorVitals>, number = (value: unknown) => typeof value === 'number' ? value : undefined;
  return remoteVitals({ source: String(v.source), status: String(v.status), quality: String(v.quality), trend: String(v.trend), pulseBpm: number(v.pulseBpm), baselineBpm: number(v.baselineBpm) }, { source: String(v.source), fearPct: number(v.fearPct) });
}

/** Read-only spectator feed. It never sends anything to the player or the database. */
export class SpectateFeed {
  private state: SpectateState = { status: 'Connecting', trace: null, vitals: null, vitalsReceivedAt: null, traceReceivedAt: null, physics: 'local' };
  private listeners = new Set<(state: SpectateState) => void>();
  private channel: BroadcastChannel | null = null;
  private client: DbConnection | null = null;
  private disposed = false;
  private local = new LocalPhysics();
  private remoteProps = new Map<number, { target: RemoteProp; shown: RemoteProp }>();
  private lastPropsMs: number | null = null;
  constructor(hash: string) {
    let access: Access;
    try { access = parseWatchAccess(hash); }
    catch { this.state.status = 'Invalid or missing spectate link'; return; }
    this.channel = new BroadcastChannel(access.channel);
    this.channel.onmessage = e => this.localSnapshot(e.data as TraceSnapshot);
    this.state.status = 'Waiting for the player · same browser';
    if (access.host === spacetimeConfig.uri && access.database === spacetimeConfig.database && access.sessionId && access.capability && spacetimeConfig.database) {
      this.state.status = 'Connecting · SpacetimeDB';
      void this.connect(access.sessionId, access.capability);
    }
  }
  subscribe(listener: (state: SpectateState) => void): () => void { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  /** Prop positions for this animation frame: smoothed server rows, or the local replay. */
  props(nowMs: number): PropView[] {
    if (this.state.physics === 'local') return this.local.advance(nowMs);
    const k = this.lastPropsMs === null ? 1 : 1 - Math.exp(-Math.min(250, nowMs - this.lastPropsMs) / 60);
    this.lastPropsMs = nowMs;
    return [...this.remoteProps.values()].sort((a, b) => a.target.slot - b.target.slot).map(p => {
      for (const axis of ['x', 'y', 'z'] as const) p.shown[axis] += (p.target[axis] - p.shown[axis]) * k;
      return { ...p.shown, sleeping: p.target.sleeping };
    });
  }
  dispose(): void { this.disposed = true; this.channel?.close(); this.channel = null; this.client?.disconnect(); this.client = null; this.listeners.clear(); }

  private emit(patch: Partial<SpectateState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(l => l(this.state));
  }
  private localSnapshot(snapshot: TraceSnapshot): void {
    if (this.state.physics === 'spacetime' || !snapshot?.summary || !Array.isArray(snapshot.events)) return;
    const now = performance.now();
    this.local.ingest(snapshot.events, snapshot.summary.time);
    const vitals = localVitals(snapshot.vitals);
    this.emit({ trace: snapshot, traceReceivedAt: now, vitals, vitalsReceivedAt: vitals ? now : null, status: 'Live · same-browser local link' });
  }
  private async connect(id: string, capability: string): Promise<void> {
    try {
      const connection = await connectSpacetime(() => this.emit({ status: 'SpacetimeDB reconnecting · showing last known state' }));
      if (this.disposed) { connection.disconnect(); return; }
      this.client = connection;
      // View rows carry no client-side primary key, so one update arrives as a separate insert and
      // delete in server order. The cache is final when callbacks run, so always resync from it.
      // Rows already present when the subscription applies may belong to a player who left hours
      // ago, so they count as held (SpectateView dims after 5 s) until a genuinely new update.
      let traceKey: string | null = null, vitalsKey: string | null = null, replaying = false;
      const stamp = () => performance.now() - (replaying ? HELD_AFTER_MS + 1 : 0);
      const syncTrace = () => {
        const row = [...connection.db.judgeTrace.iter()][0];
        if (!row) { if (traceKey !== null) { traceKey = null; this.emit({ trace: null, vitals: null, status: 'The player stopped sharing or the session expired' }); } return; }
        const key = `${row.summary.time}:${row.events.at(-1)?.seq ?? 0}`;
        if (key === traceKey) return;
        traceKey = key;
        this.emit({ physics: 'spacetime', trace: { seed: row.seed, mode: row.mode, summary: { ...row.summary, sensorAgeMs: row.summary.sensorAgeMs ?? null }, events: row.events, transport: 'spacetime' }, traceReceivedAt: stamp(), status: replaying ? 'Last known state · waiting for a live update' : 'Live · SpacetimeDB' });
      };
      // The fear row arrives on its own subscription (so a module without it cannot break this feed)
      // and is merged into the vitals here; either one changing counts as a fresh reading.
      const syncVitals = () => {
        const row = [...connection.db.spectatorVitalsFeed.iter()][0], fear = [...connection.db.spectatorFearFeed.iter()][0];
        const key = row ? `${row.sequence}:${fear?.sequence ?? '-'}:${fear?.fearPct ?? '-'}` : null;
        if (key === vitalsKey) return;
        vitalsKey = key;
        const vitals = remoteVitals(row, fear);
        this.emit({ vitals, vitalsReceivedAt: vitals ? stamp() : null });
      };
      const syncProps = () => {
        const next = new Map<number, { target: RemoteProp; shown: RemoteProp }>();
        for (const row of connection.db.physicsFeed.iter()) next.set(row.slot, { target: { ...row }, shown: this.remoteProps.get(row.slot)?.shown ?? { ...row } });
        this.remoteProps = next;
        if (next.size && this.state.physics !== 'spacetime') this.emit({ physics: 'spacetime' });
      };
      connection.db.judgeTrace.onInsert(syncTrace); connection.db.judgeTrace.onDelete(syncTrace);
      connection.db.spectatorVitalsFeed.onInsert(syncVitals); connection.db.spectatorVitalsFeed.onDelete(syncVitals);
      connection.db.spectatorFearFeed.onInsert(syncVitals); connection.db.spectatorFearFeed.onDelete(syncVitals);
      connection.db.physicsFeed.onInsert(syncProps); connection.db.physicsFeed.onDelete(syncProps);
      connection.subscriptionBuilder()
        .onApplied(() => {
          // Also runs again after an automatic reconnect, where unchanged rows fire no callbacks.
          replaying = true; syncTrace(); syncVitals(); syncProps(); replaying = false;
          if (this.state.status.startsWith('SpacetimeDB reconnecting')) this.emit({ status: 'Reconnected · waiting for the next update' });
          else if (this.state.status.startsWith('Connecting')) this.emit({ status: 'Waiting for the player · SpacetimeDB' });
        })
        .onError(() => this.emit({ status: 'SpacetimeDB feed unavailable · same-browser link only' }))
        .subscribe([capabilityQuery('judge_trace', id, capability), capabilityQuery('spectator_vitals_feed', id, capability), capabilityQuery('physics_feed', id, capability)]);
      // A database published before the fear table rejects this query alone; FEAR then falls back
      // to the heart-rate estimate on the spectator's page.
      connection.subscriptionBuilder().onApplied(() => { replaying = true; syncVitals(); replaying = false; }).onError(() => { /* no fear feed on this module */ })
        .subscribe([capabilityQuery('spectator_fear_feed', id, capability)]);
    } catch { this.emit({ status: 'SpacetimeDB unavailable · same-browser link only' }); }
  }
}
