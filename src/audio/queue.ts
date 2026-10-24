export interface SpeechRequest {
  id: string;
  encounterId?: string;
  text: string;
  expiresAt: number; // Local game seconds, never a provider timestamp.
  priority: number;
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  stateVersion?: number;
}

/** No timing or provider side effects: eligibility is rechecked before playback. */
export class SpeechQueue {
  private pending: SpeechRequest[] = [];
  private seen = new Set<string>();
  active: SpeechRequest | null = null;

  enqueue(request: SpeechRequest, now: number): { accepted: boolean; interrupted: boolean } {
    if (request.expiresAt <= now || this.seen.has(request.id) || !request.text.trim()) return { accepted: false, interrupted: false };
    this.seen.add(request.id);
    // A shift is bounded; cap retained IDs anyway for long-running preview sessions.
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    const interrupted = this.active !== null && request.priority > this.active.priority;
    if (interrupted) this.active = null;
    this.pending = this.pending.filter(item => item.expiresAt > now && item.priority >= request.priority);
    this.pending.push(request);
    this.pending.sort((a, b) => b.priority - a.priority);
    this.pending = this.pending.slice(0, 8);
    return { accepted: true, interrupted };
  }

  prune(now: number, isValid: (request: SpeechRequest) => boolean = () => true): boolean {
    this.pending = this.pending.filter(item => item.expiresAt > now && isValid(item));
    if (this.active && (this.active.expiresAt <= now || !isValid(this.active))) {
      this.active = null; return true;
    }
    return false;
  }

  next(now: number): SpeechRequest | null {
    this.prune(now);
    if (this.active) return null;
    this.active = this.pending.shift() ?? null;
    return this.active;
  }

  finish(id: string): void { if (this.active?.id === id) this.active = null; }
  reset(): void { this.pending = []; this.seen.clear(); this.active = null; }
  get length(): number { return this.pending.length; }
}
