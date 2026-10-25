/** Authored event time, not provider completion order, determines speech order. */
export interface VoiceLine {
  id: string;
  text: string;
  role: 'supervisor' | 'system' | 'creature';
  stage: number;
  /** Latest time a queued line may start, in local game seconds. */
  expiresAt: number;
  priority: number;
}
export type ScheduledVoice<T> = VoiceLine & { payload: T };

/** Pure scheduling only: the engine owns playback and its lifecycle events. */
export class VoiceScheduler<T> {
  private pending: { line: VoiceLine; ready: boolean; payload?: T }[] = [];
  private seen = new Set<string>();
  private active: ScheduledVoice<T> | null = null;

  enqueue(line: VoiceLine): boolean {
    if (this.seen.has(line.id) || !line.id || !line.text.trim() || !Number.isFinite(line.expiresAt) || !Number.isFinite(line.priority)) return false;
    this.seen.add(line.id);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    this.pending.push({ line: { ...line }, ready: false });
    // Instructions get the next slot; a taunt never interrupts a current line.
    // Stable sorting preserves event order when priorities are equal.
    this.pending.sort((a, b) => Number(a.line.role === 'creature') - Number(b.line.role === 'creature') || b.line.priority - a.line.priority);
    this.pending = this.pending.slice(0, 8);
    return this.pending.some(item => item.line.id === line.id);
  }

  resolve(id: string, payload: T): boolean {
    const item = this.pending.find(candidate => candidate.line.id === id);
    if (!item || item.ready) return false;
    item.payload = payload; item.ready = true; return true;
  }

  /** A started line may finish after its queue deadline, but never after invalidation. */
  prune(now: number, isValid: (line: VoiceLine) => boolean = () => true): string[] {
    const removed: string[] = [];
    this.pending = this.pending.filter(item => {
      const keep = item.line.expiresAt > now && isValid(item.line);
      if (!keep) removed.push(item.line.id);
      return keep;
    });
    if (this.active && !isValid(this.active)) { removed.push(this.active.id); this.active = null; }
    return removed;
  }

  next(now: number, isValid: (line: VoiceLine) => boolean = () => true): ScheduledVoice<T> | null {
    this.prune(now, isValid);
    if (this.active || !this.pending[0]?.ready) return null;
    const item = this.pending.shift()!;
    this.active = { ...item.line, payload: item.payload as T };
    return this.active;
  }

  complete(id: string): boolean {
    if (this.active?.id !== id) return false;
    this.active = null; return true;
  }

  cancel(predicate: (line: VoiceLine) => boolean = () => true): string[] {
    return this.prune(-Infinity, line => !predicate(line));
  }
  reset(): void { this.pending = []; this.active = null; this.seen.clear(); }
  has(id: string): boolean { return this.active?.id === id || this.pending.some(item => item.line.id === id); }
  get current(): ScheduledVoice<T> | null { return this.active; }
  get length(): number { return this.pending.length; }
}
