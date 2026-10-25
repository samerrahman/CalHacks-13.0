import { applyImpulse, impulsesFromEvents, PROPS, spawnBodies, STEP_SECONDS, stepBodies, type Body, type PhysicsEvent } from '../../spacetimedb/src/physicsSim';

export type PropView = { slot: number; kind: string; radius: number; x: number; y: number; z: number; sleeping: boolean };

export function propViews(bodies: readonly Body[]): PropView[] {
  return bodies.map(b => ({ slot: b.slot, kind: PROPS[b.slot]?.kind ?? 'bolt', radius: PROPS[b.slot]?.radius ?? 0.02, x: b.x, y: b.y, z: b.z, sleeping: b.sleeping }));
}

/** Offline fallback for a spectator without SpacetimeDB: replays the server's fixed impulse map
 * from the same sanitized public events, on the spectator's own clock. Cosmetic only. */
export class LocalPhysics {
  private bodies = spawnBodies();
  private lastSeq = 0;
  private lastMs: number | null = null;
  private carryMs = 0;
  /** `nowGameSeconds` is the snapshot's game time; older events never push props. */
  ingest(events: readonly PhysicsEvent[], nowGameSeconds: number): void {
    const newest = events.reduce((max, e) => Math.max(max, e.seq), 0);
    if (newest < this.lastSeq) this.reset(); // a restarted run numbers its events from 1 again
    const fresh = events.filter(e => e.seq > this.lastSeq);
    if (!fresh.length) return;
    this.bodies = impulsesFromEvents(fresh, nowGameSeconds).reduce(applyImpulse, this.bodies);
    this.lastSeq = Math.max(this.lastSeq, newest);
  }
  advance(nowMs: number): PropView[] {
    const elapsed = this.lastMs === null ? 0 : Math.min(250, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;
    const stepMs = STEP_SECONDS * 1000, total = this.carryMs + elapsed, steps = Math.floor(total / stepMs);
    this.carryMs = total - steps * stepMs;
    if (steps) this.bodies = stepBodies(this.bodies, steps);
    return propViews(this.bodies);
  }
  reset(): void { this.bodies = spawnBodies(); this.lastSeq = 0; this.carryMs = 0; }
}
