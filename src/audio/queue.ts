export interface SpeechRequest {
  id: string;
  encounterId?: string;
  text: string;
  expiresAt: number; // Latest start in local game seconds, never a provider timestamp.
  priority: number;
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  stateVersion?: number;
  source?: 'live' | 'cached';
  position?: [number, number, number];
  followCreature?: boolean;
  /** Caption-only fallback occupies the same slot for this reading duration. */
  captionDuration?: number;
}

/** No timing or provider side effects: eligibility is rechecked before playback. */
export class SpeechQueue {
  private pending: SpeechRequest[] = [];
  private seen = new Set<string>();
  active: SpeechRequest | null = null;
  private started = false;

  enqueue(request: SpeechRequest, now: number): { accepted: boolean; interrupted: boolean } {
    if (request.expiresAt <= now || this.seen.has(request.id) || !request.text.trim()) return { accepted: false, interrupted: false };
    this.seen.add(request.id);
    // A shift is bounded; cap retained IDs anyway for long-running preview sessions.
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    this.pending = this.pending.filter(item => item.expiresAt > now);
    this.pending.push(request);
    this.pending.sort((a, b) => b.priority - a.priority);
    this.pending = this.pending.slice(0, 8);
    return { accepted: this.pending.some(item => item.id === request.id), interrupted: false };
  }

  prune(now: number, isValid: (request: SpeechRequest) => boolean = () => true): boolean {
    this.pending = this.pending.filter(item => item.expiresAt > now && isValid(item));
    if (this.active && ((!this.started && this.active.expiresAt <= now) || !isValid(this.active))) {
      this.active = null; this.started = false; return true;
    }
    return false;
  }

  next(now: number): SpeechRequest | null {
    this.prune(now);
    if (this.active) return null;
    this.active = this.pending.shift() ?? null;
    this.started = false;
    return this.active;
  }

  markStarted(id: string): void { if (this.active?.id === id) this.started = true; }
  finish(id: string): void { if (this.active?.id === id) { this.active = null; this.started = false; } }
  cancel(id?: string): SpeechRequest[] {
    const removed = this.pending.filter(item => !id || item.id === id);
    this.pending = this.pending.filter(item => !!id && item.id !== id);
    if (this.active && (!id || this.active.id === id)) { removed.push(this.active); this.active = null; this.started = false; }
    return removed;
  }
  reset(): void { this.pending = []; this.seen.clear(); this.active = null; this.started = false; }
  get length(): number { return this.pending.length; }
}
