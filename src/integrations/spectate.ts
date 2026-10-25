import type { DbConnection } from '../module_bindings';
import type { SensorView, Trend } from '../sensing/types';
import type { PublicEvent } from '../game/state';
import type { TraceSnapshot, TraceSummary } from './client';
import { capabilityQuery, connectSpacetime, spacetimeConfig } from './spacetime';
import { LocalPhysics, type PropView } from './physics';

/** The only physiology a spectator receives, and only under the separate heart-rate consent:
 * the current accepted estimate in whole BPM, the frozen baseline and coarse labels. */
export type SpectatorVitals = { source: 'presage' | 'simulated'; status: SensorView['status']; quality: SensorView['quality']; trend: Trend; pulseBpm: number | null; baselineBpm: number | null };
/** Same threshold SpectateView uses to dim a reading as held. */
const HELD_AFTER_MS = 5000;
const wholeBpm = (value: number | null) => value === null || !Number.isFinite(value) ? null : Math.min(110, Math.max(40, Math.round(value)));

export function spectatorVitals(sensor: SensorView): SpectatorVitals | null {
  if (sensor.source === 'manual' || sensor.status === 'manual') return null;
  const pulseBpm = sensor.quality === 'accepted' ? wholeBpm(sensor.pulseBpm) : null;
  return { source: sensor.source, status: sensor.status, quality: pulseBpm === null ? (sensor.quality === 'rejected' ? 'rejected' : 'unknown') : 'accepted', trend: pulseBpm === null ? 'UNKNOWN' : sensor.trend, pulseBpm, baselineBpm: wholeBpm(sensor.baselineBpm) };
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
type RemoteVitals = { source: string; status: string; quality: string; trend: string; pulseBpm?: number; baselineBpm?: number };
type RemoteProp = { slot: number; kind: string; radius: number; x: number; y: number; z: number; sleeping: boolean };

export function parseWatchAccess(hash: string): Access {
  const access = JSON.parse(atob(new URLSearchParams(hash.slice(1)).get('watch') ?? '')) as Access;
  if (!access || !/^(hush|lock-in)-[a-f0-9]{64}$/.test(access.channel)) throw new Error('Invalid spectate link');
  return access;
}

/** Revalidates remote rows: anything unexpected is treated as not shared. */
export function remoteVitals(row: RemoteVitals | undefined): SpectatorVitals | null {
  if (!row || !['presage', 'simulated'].includes(row.source) || !['starting', 'calibrating', 'ready', 'unavailable', 'paused'].includes(row.status) || !['accepted', 'rejected', 'unknown'].includes(row.quality) || !['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'].includes(row.trend)) return null;
  const pulse = row.quality === 'accepted' ? wholeBpm(row.pulseBpm ?? null) : null;
  return { source: row.source as SpectatorVitals['source'], status: row.status as SpectatorVitals['status'], quality: pulse === null && row.quality === 'accepted' ? 'unknown' : row.quality as SpectatorVitals['quality'], trend: pulse === null ? 'UNKNOWN' : row.trend as Trend, pulseBpm: pulse, baselineBpm: wholeBpm(row.baselineBpm ?? null) };
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
    const vitals = snapshot.vitals ?? null;
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
      let traceKey: string | null = null, vitalsSequence: number | null = null, replaying = false;
      const stamp = () => performance.now() - (replaying ? HELD_AFTER_MS + 1 : 0);
      const syncTrace = () => {
        const row = [...connection.db.judgeTrace.iter()][0];
        if (!row) { if (traceKey !== null) { traceKey = null; this.emit({ trace: null, vitals: null, status: 'The player stopped sharing or the session expired' }); } return; }
        const key = `${row.summary.time}:${row.events.at(-1)?.seq ?? 0}`;
        if (key === traceKey) return;
        traceKey = key;
        this.emit({ physics: 'spacetime', trace: { seed: row.seed, mode: row.mode, summary: { ...row.summary, sensorAgeMs: row.summary.sensorAgeMs ?? null }, events: row.events, transport: 'spacetime' }, traceReceivedAt: stamp(), status: replaying ? 'Last known state · waiting for a live update' : 'Live · SpacetimeDB' });
      };
      const syncVitals = () => {
        const row = [...connection.db.spectatorVitalsFeed.iter()][0];
        if ((row?.sequence ?? null) === vitalsSequence) return;
        vitalsSequence = row?.sequence ?? null;
        const vitals = remoteVitals(row);
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
    } catch { this.emit({ status: 'SpacetimeDB unavailable · same-browser link only' }); }
  }
}
