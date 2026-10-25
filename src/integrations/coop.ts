import type { DbConnection } from '../module_bindings';
import type { GameState } from '../game/state';
import { coopManual, type CoopManual } from '../game/coop';
import { FRIEND_LIMITS, friendRowValid, friendSignalValid, manualRowValid, type FriendSignal, type ManualRow } from '../../spacetimedb/src/coopRules';
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
  if (manual.kind === 'memory') return { ...NONE, kind: 'memory', stage: manual.stage, panel: manual.entered, panels: manual.playing ? 1 : 0, values: manual.sequence };
  if (manual.kind === 'locate') return { ...NONE, kind: 'locate', stage: manual.stage, panel: manual.marks, panels: manual.required, values: manual.rings };
  if (manual.kind === 'calm') return { ...NONE, kind: 'calm', stage: manual.stage, panel: manual.inhale ? 1 : 0, size: manual.halfTenths, start: manual.elapsedTenths, panels: manual.required, end: manual.progress };
  if (manual.kind === 'door') return { ...NONE, kind: 'door', stage: 5, values: manual.key };
  return { ...NONE, kind: 'routing', stage: manual.stage, size: manual.size, start: manual.start, end: manual.end, values: manual.tiles };
}
/** Revalidates a row from the channel or the view. Anything unexpected reads as no manual page. */
export function manualFromRow(row: unknown): CoopManual | null {
  const r = row as ManualRow;
  if (!r || typeof r !== 'object' || !manualRowValid(r) || r.kind === 'none') return null;
  const values = Array.from(r.values);
  if (r.kind === 'faults') return { kind: 'faults', stage: r.stage, sounds: values };
  if (r.kind === 'wires') return { kind: 'wires', stage: r.stage, panel: r.panel, panels: r.panels, sockets: values };
  if (r.kind === 'memory') return { kind: 'memory', stage: r.stage, sequence: values, entered: r.panel, playing: r.panels === 1 };
  if (r.kind === 'locate') return { kind: 'locate', stage: r.stage, rings: values, marks: r.panel, required: r.panels };
  if (r.kind === 'calm') return { kind: 'calm', stage: r.stage, inhale: r.panel === 1, halfTenths: r.size, elapsedTenths: r.start, progress: r.end, required: r.panels };
  if (r.kind === 'door') return { kind: 'door', stage: 5, key: values };
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
  private friend: BroadcastChannel | null = null;
  private client: DbConnection | null = null;
  private access: { sessionId?: string; capability?: string } | null = null;
  private disposed = false;
  constructor(hash: string, connect: typeof connectSpacetime = connectSpacetime) {
    let access: ReturnType<typeof parseWatchAccess>;
    try { access = parseWatchAccess(hash); }
    catch { this.state.status = 'Invalid or missing spectate link'; return; }
    this.access = access;
    this.channel = new BroadcastChannel(`${access.channel}-coop`);
    this.friend = new BroadcastChannel(`${access.channel}-friend`);
    this.channel.onmessage = e => this.emit({ local: manualFromRow(e.data), localAt: performance.now() });
    this.state.status = 'Waiting for the player · same browser';
    if (access.host === spacetimeConfig.uri && access.database === spacetimeConfig.database && access.sessionId && access.capability && spacetimeConfig.database) {
      this.state.status = 'Connecting · SpacetimeDB';
      void this.connect(connect, access.sessionId, access.capability);
    }
  }
  subscribe(listener: (state: CoopFeedState) => void): () => void { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  dispose(): void { this.disposed = true; this.channel?.close(); this.channel = null; this.friend?.close(); this.friend = null; this.client?.disconnect(); this.client = null; this.listeners.clear(); }
  /** The friend's two remote controls. Goes through SpacetimeDB when this page is connected to the
   * player's session, otherwise (or if that write fails) on the same-browser link. The player's game
   * decides what actually happens. Resolves how it went out, or 'failed'. */
  async send(kind: FriendSignal): Promise<'remote' | 'local' | 'refused' | 'failed'> {
    if (this.disposed || !friendSignalValid(kind)) return 'failed';
    const access = this.access;
    if (this.client?.isActive && access?.sessionId && access.capability) {
      try { await this.client.reducers.friendSignal({ id: access.sessionId, judgeCapability: access.capability, kind }); return 'remote'; }
      catch (error) { if (/too frequent|no decoys/i.test(error instanceof Error ? error.message : String(error))) return 'refused'; }
    }
    if (!this.friend) return 'failed';
    this.friend.postMessage({ kind, id: Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('') });
    return 'local';
  }
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
        if ((row?.sequence ?? null) === sequenceSeen) {
          if (this.state.status.startsWith('Connecting')) this.emit({ status: 'Live · SpacetimeDB' });
          return;
        }
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

/** Player side of the friend's controls: the `${channel}-friend` same-browser link plus the owner-only
 * coop_remote_inbox view (running counts; only increases seen after subscribing count). Polled from the
 * UI clock like the manual publisher, never from the game step. `onSignal` dispatches into the reducer,
 * which applies its own cooldowns and charges. */
export class FriendSignalReceiver {
  private channel: BroadcastChannel | null = null;
  private channelName = '';
  private seenIds = new Set<string>();
  private subscribedTo = '';
  private handle: { unsubscribe(): void } | null = null;
  private connection: DbConnection | null = null;
  private seen: { warnCount: number; decoyCount: number } | null = null;
  private disposed = false;
  private readonly sync = () => this.drain();
  constructor(private readonly link: () => CoopLink | null, private readonly onSignal: (kind: FriendSignal) => void) {}
  poll(): void {
    const link = this.disposed ? null : this.link();
    if (!link) { this.close(); return; }
    if (link.channel !== this.channelName) {
      this.channel?.close(); this.channelName = link.channel; this.seenIds.clear();
      this.channel = new BroadcastChannel(`${link.channel}-friend`);
      this.channel.onmessage = e => this.local(e.data);
    }
    const { connection, sessionId, ownerCapability } = link, target = connection?.isActive && sessionId && ownerCapability ? `${sessionId}:${ownerCapability}` : '';
    if (target && target !== this.subscribedTo) this.watch(connection!, sessionId!, ownerCapability!, target);
  }
  close(): void {
    this.channel?.close(); this.channel = null; this.channelName = ''; this.seenIds.clear();
    this.unwatch();
  }
  dispose(): void { this.close(); this.disposed = true; }
  private local(data: unknown): void {
    const message = data as { kind?: unknown; id?: unknown };
    if (!message || typeof message !== 'object' || !friendSignalValid(message.kind) || typeof message.id !== 'string' || !/^[a-f0-9]{16}$/.test(message.id) || this.seenIds.has(message.id)) return;
    this.seenIds.add(message.id); if (this.seenIds.size > 200) this.seenIds.clear();
    this.onSignal(message.kind);
  }
  private watch(connection: DbConnection, id: string, owner: string, target: string): void {
    this.unwatch();
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(owner)) return;
    this.subscribedTo = target; this.connection = connection; this.seen = null;
    try {
      connection.db.coopRemoteInbox.onInsert(this.sync); connection.db.coopRemoteInbox.onDelete(this.sync);
      this.handle = connection.subscriptionBuilder()
        .onApplied(() => { if (this.subscribedTo === target) { this.seen = this.row() ?? { warnCount: 0, decoyCount: 0 }; } })
        .onError(() => { /* An older module without friend signals: the same-browser link still works. */ })
        .subscribe([`SELECT * FROM coop_remote_inbox('${id}', '${owner}')`]);
    } catch { /* bindings without the view */ }
  }
  private unwatch(): void {
    const connection = this.connection;
    if (connection) { try { connection.db.coopRemoteInbox.removeOnInsert(this.sync); connection.db.coopRemoteInbox.removeOnDelete(this.sync); } catch { /* gone */ } }
    try { this.handle?.unsubscribe(); } catch { /* ended */ }
    this.handle = null; this.connection = null; this.subscribedTo = ''; this.seen = null;
  }
  private row(): { warnCount: number; decoyCount: number } | null {
    const row = this.connection ? [...this.connection.db.coopRemoteInbox.iter()][0] : undefined;
    return row && friendRowValid(row) ? { warnCount: row.warnCount, decoyCount: row.decoyCount } : null;
  }
  /** View rows have no client key (an update is a delete plus an insert): re-read the settled cache. */
  private drain(): void {
    const seen = this.seen, row = this.row();
    if (!seen || !row) return;
    const warns = Math.min(3, Math.max(0, row.warnCount - seen.warnCount)), decoys = Math.min(FRIEND_LIMITS.maxDecoys, Math.max(0, row.decoyCount - seen.decoyCount));
    this.seen = { warnCount: Math.max(seen.warnCount, row.warnCount), decoyCount: Math.max(seen.decoyCount, row.decoyCount) };
    for (let i = 0; i < warns; i++) this.onSignal('warn');
    for (let i = 0; i < decoys; i++) this.onSignal('decoy');
  }
}
