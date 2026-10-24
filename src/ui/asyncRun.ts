/** Buffers asynchronous provider replies until an active game can consume them.
 * Advancing a run invalidates both queued work and callbacks still in flight. */
export class AsyncRun {
  private epoch = 0;
  private pending = new Map<string, () => void>();
  private consumed = new Set<string>();
  get token(): number { return this.epoch; }
  invalidate(): void { this.epoch++; this.pending.clear(); this.consumed.clear(); }
  enqueue(token: number, key: string, apply: () => void): boolean {
    if (token !== this.epoch || this.pending.has(key) || this.consumed.has(key)) return false;
    this.pending.set(key, apply);
    return true;
  }
  flush(): void {
    const token = this.epoch;
    for (const [key, apply] of this.pending) {
      if (token !== this.epoch) break;
      this.pending.delete(key);
      this.consumed.add(key);
      apply();
    }
  }
}
