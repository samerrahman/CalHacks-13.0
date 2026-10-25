import type { DbConnection } from '../module_bindings';
import { capabilityQuery, connectSpacetime, spacetimeConfig } from '../integrations/spacetime';
import { parseWatchAccess } from '../integrations/spectate';
import { cleanName, predictionChoiceValid, predictionRowValid, type PredictionChoice, type PredictionRow } from '../../spacetimedb/src/predictRules';
export { standings, type Standing } from '../../spacetimedb/src/predictRules';

export type PredictionState = { rows: PredictionRow[]; mine: string | null; status: string };

/** Spectator predictions: the prediction_feed view (everyone holding the link) plus a same-browser
 * channel for local runs. Sends only the spectator's own call; never anything to the player. */
export class PredictionFeed {
  private state: PredictionState = { rows: [], mine: null, status: 'Connecting' };
  private listeners = new Set<(state: PredictionState) => void>();
  private channel: BroadcastChannel | null = null;
  private client: DbConnection | null = null;
  private access: { sessionId?: string; capability?: string } | null = null;
  private local = new Map<string, PredictionRow>();
  private remote: PredictionRow[] = [];
  private localVoter = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
  private disposed = false;
  constructor(hash: string, connect: typeof connectSpacetime = connectSpacetime) {
    let access: ReturnType<typeof parseWatchAccess>;
    try { access = parseWatchAccess(hash); } catch { this.state.status = 'Invalid spectate link'; return; }
    this.access = access;
    this.channel = new BroadcastChannel(`${access.channel}-predict`);
    this.channel.onmessage = e => { if (predictionRowValid(e.data)) { this.local.set(e.data.voter, e.data); this.emit(); } };
    this.state.status = 'Same browser only';
    if (access.host === spacetimeConfig.uri && access.database === spacetimeConfig.database && access.sessionId && access.capability && spacetimeConfig.database) void this.connect(connect, access.sessionId, access.capability);
  }
  subscribe(listener: (state: PredictionState) => void): () => void { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  /** Makes or changes this spectator's call at the run's current stage. */
  async predict(choice: PredictionChoice, rawName: string, stage: number): Promise<'remote' | 'local' | 'closed' | 'invalid' | 'failed'> {
    const name = cleanName(rawName);
    if (this.disposed || !predictionChoiceValid(choice) || !name) return 'invalid';
    if (stage > 2) return 'closed';
    const access = this.access;
    if (this.client?.isActive && access?.sessionId && access.capability) {
      try { await this.client.reducers.predictOutcome({ id: access.sessionId, judgeCapability: access.capability, choice, name }); return 'remote'; }
      catch (error) { if (/closed/i.test(error instanceof Error ? error.message : String(error))) return 'closed'; }
    }
    if (!this.channel) return 'failed';
    const row: PredictionRow = { voter: this.localVoter, name, choice, stage: Math.max(1, stage) };
    this.local.set(row.voter, row); this.channel.postMessage(row); this.state = { ...this.state, mine: this.localVoter }; this.emit();
    return 'local';
  }
  dispose(): void { this.disposed = true; this.channel?.close(); this.channel = null; this.client?.disconnect(); this.client = null; this.listeners.clear(); }
  private emit(): void {
    if (this.disposed) return;
    // Database rows win; same-browser rows fill in when this page has no database link.
    const rows = this.remote.length ? this.remote : [...this.local.values()];
    this.state = { ...this.state, rows };
    this.listeners.forEach(l => l(this.state));
  }
  private async connect(connect: typeof connectSpacetime, id: string, capability: string): Promise<void> {
    try {
      const connection = await connect(() => { this.state = { ...this.state, status: 'Reconnecting' }; this.emit(); });
      if (this.disposed) { connection.disconnect(); return; }
      this.client = connection;
      const mine = connection.identity?.toHexString().slice(-8) ?? null;
      const sync = () => { this.remote = [...connection.db.predictionFeed.iter()].map(r => ({ voter: r.voter, name: r.name, choice: r.choice, stage: r.stage })).filter(predictionRowValid); this.state = { ...this.state, mine, status: 'Live · SpacetimeDB' }; this.emit(); };
      connection.db.predictionFeed.onInsert(sync); connection.db.predictionFeed.onDelete(sync);
      connection.subscriptionBuilder().onApplied(sync)
        .onError(() => { this.state = { ...this.state, status: 'Predictions need the newer database module · same browser only' }; this.emit(); })
        .subscribe([capabilityQuery('prediction_feed', id, capability)]);
    } catch { this.state = { ...this.state, status: 'SpacetimeDB unavailable · same browser only' }; this.emit(); }
  }
}
