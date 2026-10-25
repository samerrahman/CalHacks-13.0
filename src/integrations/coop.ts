import type { DbConnection } from '../module_bindings';
import type { GameState } from '../game/state';
import { coopManual, type CoopManual } from '../game/coop';
import { manualRowValid, type ManualRow } from '../../spacetimedb/src/coopRules';
import { capabilityQuery, connectSpacetime, spacetimeConfig } from './spacetime';
import { parseWatchAccess } from './spectate';

/** What the publisher needs from the live TraceBridge; null while trace sharing is off. */
export type CoopLink = { channel: string; connection: DbConnection | null; sessionId: string | null; ownerCapability: string | null };
const NONE: ManualRow = { kind: 'none', stage: 0, panel: 0, panels: 0, size: 0, start: 0, end: 0, values: [] };
const WRITE_GAP_MS = 1000, REPOST_MS = 1000, LOCAL_FRESH_MS = 2500;
let sequence = 0; // module-wide, so the server's per-session sequence only ever grows

export function manualRow(manual: CoopManual | null): ManualRow {
  if (!manual) return NONE;
  if (manual.kind === 'faults') return { ...NONE, kind: 'faults', stage: manual.stage, values: manual.sounds };
  if (manual.kind === 'wires') return { ...NONE, kind: 'wires', stage: manual.stage, panel: manual.panel, panels: manual.panels, values: manual.sockets };
  return { ...NONE, kind: 'routing', stage: manual.stage, size: manual.size, start: manual.start, end: manual.end, values: manual.tiles };
}
/** Revalidates a row from the channel or the view. Anything unexpected reads as no manual page. */
export function manualFromRow(row: unknown): CoopManual | null {
  const r = row as ManualRow;
  if (!r || typeof r !== 'object' || !manualRowValid(r) || r.kind === 'none') return null;
  const values = Array.from(r.values);
  if (r.kind === 'faults') return { kind: 'faults', stage: r.stage, sounds: values };
  if (r.kind === 'wires') return { kind: 'wires', stage: r.stage, panel: r.panel, panels: r.panels, sockets: values };
  return { kind: 'routing', stage: r.stage, size: r.size, start: r.start, end: r.end, tiles: values };
}

/** Player side. Called from the UI clock (never the game step): posts the live page to `${channel}-coop`
 * on change and once a second for late joiners, and writes publishManual on change, at most once a second. */
export class CoopManualPublisher {
  private channel: BroadcastChannel | null = null;
  private channelName = '';
  private posted = '';
  private postedAt = -Infinity;
  private written = '';
  private lastWrite = -Infinity;
  private busy = false;
  private disposed = false;
  constructor(private readonly link: () => CoopLink | null) {}
  publish(state: GameState, now = performance.now()): void {
    const link = this.disposed || state.mode !== 'coop' ? null : this.link();
    if (!link) { this.close(); return; }
    if (link.channel !== this.channelName) { this.close(); this.channelName = link.channel; this.channel = new BroadcastChannel(`${link.channel}-coop`); }
    const row = manualRow(coopManual(state)), key = JSON.stringify(row);
    if (key !== this.posted || now - this.postedAt >= REPOST_MS) { this.channel!.postMessage(row); this.posted = key; this.postedAt = now; }
    const { connection, sessionId, ownerCapability } = link, target = `${sessionId}:${key}`;
    if (!connection?.isActive || !sessionId || !ownerCapability || this.busy || target === this.written || now - this.lastWrite < WRITE_GAP_MS) return;
    this.busy = true; this.lastWrite = now;
    void connection.reducers.publishManual({ id: sessionId, ownerCapability, sequence: ++sequence, ...row, values: Uint8Array.from(row.values) })
      .then(() => { this.written = target; })
      .catch(() => { /* Unsent: retried after the gap. The local channel is unaffected. */ })
      .finally(() => { this.busy = false; });
  }
  /** Withdraws the page from the local link at once; the remote row goes with the session (removeSession). */
  close(): void {
    if (this.channel) { this.channel.postMessage(NONE); this.channel.close(); }
    this.channel = null; this.channelName = ''; this.posted = ''; this.postedAt = -Infinity;
  }
  dispose(): void { this.close(); this.disposed = true; }
}

export type CoopFeedState = {
  /** undefined: nothing heard yet on that path; null: no page right now. */
  local: CoopManual | null | undefined; localAt: number | null;
  remote: CoopManual | null | undefined;
  status: string;
};
/** Same-browser messages win while fresh (they lead the database by up to a second); otherwise the view row. */
export function currentManual(state: CoopFeedState, now: number): CoopManual | null {
  if (state.local !== undefined && state.localAt !== null && now - state.localAt <= LOCAL_FRESH_MS) return state.local;
  return state.remote ?? null;
}

/** Spectator side, read-only: the `${channel}-coop` link plus the capability-checked coop_manual_feed view. */
export class CoopManualFeed {
  private state: CoopFeedState = { local: undefined, localAt: null, remote: undefined, status: 'Connecting' };
  private listeners = new Set<(state: CoopFeedState) => void>();
  private channel: BroadcastChannel | null = null;
  private client: DbConnection | null = null;
  private disposed = false;
  constructor(hash: string, connect: typeof connectSpacetime = connectSpacetime) {
    let access: ReturnType<typeof parseWatchAccess>;
    try { access = parseWatchAccess(hash); }
    catch { this.state.status = 'Invalid or missing spectate link'; return; }
    this.channel = new BroadcastChannel(`${access.channel}-coop`);
    this.channel.onmessage = e => this.emit({ local: manualFromRow(e.data), localAt: performance.now() });
    this.state.status = 'Waiting for the player · same browser';
    if (access.host === spacetimeConfig.uri && access.database === spacetimeConfig.database && access.sessionId && access.capability && import.meta.env?.VITE_SPACETIMEDB_DB_NAME) void this.connect(connect, access.sessionId, access.capability);
  }
  subscribe(listener: (state: CoopFeedState) => void): () => void { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  dispose(): void { this.disposed = true; this.channel?.close(); this.channel = null; this.client?.disconnect(); this.client = null; this.listeners.clear(); }
  private emit(patch: Partial<CoopFeedState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(l => l(this.state));
  }
  private async connect(connect: typeof connectSpacetime, id: string, capability: string): Promise<void> {
    try {
      const connection = await connect(() => this.emit({ status: 'SpacetimeDB reconnecting · showing the last page' }));
      if (this.disposed) { connection.disconnect(); return; }
      this.client = connection;
      // View rows have no client primary key: an update is an insert plus a delete. Resync from the settled cache.
      let sequenceSeen: number | null = null;
      const sync = () => {
        const row = [...connection.db.coopManualFeed.iter()][0];
        if ((row?.sequence ?? null) === sequenceSeen) return;
        sequenceSeen = row?.sequence ?? null;
        this.emit({ remote: row ? manualFromRow(row) : undefined, status: 'Live · SpacetimeDB' });
      };
      connection.db.coopManualFeed.onInsert(sync); connection.db.coopManualFeed.onDelete(sync);
      connection.subscriptionBuilder().onApplied(sync)
        .onError(() => this.emit({ status: 'SpacetimeDB manual unavailable · same-browser link only' }))
        .subscribe([capabilityQuery('coop_manual_feed', id, capability)]);
    } catch { this.emit({ status: 'SpacetimeDB unavailable · same-browser link only' }); }
  }
}
