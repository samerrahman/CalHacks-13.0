import type { TraceSnapshot } from '../integrations/client';
import type { PublicEvent } from '../game/state';

export type PlayerStation = 'terminal' | 'cameras' | 'equipment';
/** `shared`: sent by the player over the same-browser link. `inferred`: worked out on this device
 * from the public events alone (always the case over SpacetimeDB). */
export type PlayerActivity = { station: PlayerStation; working: boolean; source: 'shared' | 'inferred' };
/** Where the spectator draws the researcher this frame. `stride` is the walk cycle in [0, 1). */
export type PlayerView = PlayerActivity & { x: number; z: number; heading: number; walking: boolean; stride: number };

/** Inputs only a player at the terminal makes, and the lever's. Game-driven events (a fault
 * starting, sequence playback) say nothing about where the player is. */
const TERMINAL_INPUT = new Set(['FAULT_CLEARED', 'WRONG_INPUT', 'WIRE_CONNECTED', 'MEMORY_REPLAY', 'MEMORY_ARMED', 'TASK_COMPLETE', 'LURE_TRANSMITTED', 'FINAL_BROADCAST']);
const LEVER_INPUT = new Set(['QUIET_ENTERED', 'RESTORED']);
/** Game seconds an inferred terminal input keeps the researcher working, and the lever pull. */
export const WORK_SECONDS = 6, LEVER_SECONDS = 4;

const STATIONS: ReadonlySet<string> = new Set<PlayerStation>(['terminal', 'cameras', 'equipment']);
const latest = (events: readonly PublicEvent[], types: Set<string>) => events.reduce<PublicEvent | undefined>((found, e) => types.has(e.type) && (!found || e.seq > found.seq) ? e : found, undefined);

/** Station and working state from public events: at the lever while the equipment is off or just
 * after pulling it, otherwise at the terminal, working shortly after each input there. */
export function inferActivity(trace: TraceSnapshot): PlayerActivity {
  const s = trace.summary, playing = s.status === 'playing', terminal = latest(trace.events, TERMINAL_INPUT), lever = latest(trace.events, LEVER_INPUT);
  const since = (e: PublicEvent | undefined) => e ? s.time - e.time : Infinity;
  const leverLast = !!lever && (!terminal || lever.seq > terminal.seq);
  if (s.equipment !== 'on' || leverLast && since(lever) < LEVER_SECONDS) return { station: 'equipment', working: playing && leverLast && since(lever) < LEVER_SECONDS, source: 'inferred' };
  return { station: 'terminal', working: playing && since(terminal) < WORK_SECONDS, source: 'inferred' };
}

/** The player's own station and open task panel when the same-browser link carries them,
 * revalidated (anything unexpected falls back to inference); otherwise inferred from events. */
export function playerActivity(trace: TraceSnapshot): PlayerActivity {
  const shared: unknown = trace.player;
  if (shared && typeof shared === 'object' && 'station' in shared && 'working' in shared && typeof shared.station === 'string' && STATIONS.has(shared.station) && typeof shared.working === 'boolean')
    return { station: shared.station as PlayerStation, working: shared.working && trace.summary.status === 'playing', source: 'shared' };
  return inferActivity(trace);
}

type Spot = { x: number; z: number; heading: number };
/** Floor spots in the render scene's metres (room.ts PLACEMENT): in front of the terminal and the
 * security monitor on the desk, and beside the emergency lever on the back wall so the reaching
 * arm (local +x) meets it. `heading` faces the equipment; 0 looks toward +z. */
export const SPOTS: Record<PlayerStation, Spot> = {
  terminal: { x: -.62, z: -1.06, heading: Math.PI },
  cameras: { x: .72, z: -1.06, heading: Math.PI },
  equipment: { x: -.98, z: 1.78, heading: 0 },
};
/** Routes step back from the equipment, cross the open floor and step in, clear of the desk. */
export const STEP_BACK = .36, WALK_SPEED = 1.05, STRIDE_METRES = 1.1;
const TURN_RATE = 7;
type Waypoint = { x: number; z: number; backward?: boolean };
const backOf = (spot: Spot): Waypoint => ({ x: spot.x - Math.sin(spot.heading) * STEP_BACK, z: spot.z - Math.cos(spot.heading) * STEP_BACK });
const turn = (from: number, to: number, k: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k;

/** Moves the spectator's researcher between stations on this device's clock. Display only: it
 * reads the same trace as the rest of the page and never reaches the player. */
export class PlayerWalker {
  private x = 0;
  private z = 0;
  private heading = 0;
  private stride = 0;
  private route: Waypoint[] = [];
  private goal: PlayerStation | null = null;
  private lastSeq = 0;
  private lastMs: number | null = null;
  private last: PlayerView | null = null;
  /** Call every animation frame; repeated calls for the same `nowMs` return the same view. A late
   * joiner, a restarted run and reduced motion place the researcher without walking. */
  at(trace: TraceSnapshot | null, nowMs: number, reducedMotion = false): PlayerView | null {
    if (!trace?.summary || !Array.isArray(trace.events)) return null;
    if (this.last && nowMs === this.lastMs) return this.last;
    const activity = playerActivity(trace), spot = SPOTS[activity.station], newest = trace.events.reduce((max, e) => Math.max(max, e.seq), 0);
    if (newest < this.lastSeq) this.goal = null;
    this.lastSeq = newest;
    const dt = this.lastMs === null ? 0 : Math.min(.25, Math.max(0, (nowMs - this.lastMs) / 1000)); this.lastMs = nowMs;
    if (this.goal === null || reducedMotion) { this.x = spot.x; this.z = spot.z; this.heading = spot.heading; this.route = []; }
    else if (activity.station !== this.goal) this.route = this.plan(this.goal, activity.station);
    this.goal = activity.station;
    let budget = WALK_SPEED * dt, moved = 0;
    while (budget > 1e-9 && this.route.length) {
      const next = this.route[0]!, dx = next.x - this.x, dz = next.z - this.z, d = Math.hypot(dx, dz);
      if (d <= budget) { this.x = next.x; this.z = next.z; budget -= d; moved += d; this.route.shift(); }
      else { this.x += dx / d * budget; this.z += dz / d * budget; moved += budget; budget = 0; }
    }
    const next = this.route[0], walking = !!next;
    const want = next ? Math.atan2(next.x - this.x, next.z - this.z) + (next.backward ? Math.PI : 0) : spot.heading;
    this.heading = turn(this.heading, want, 1 - Math.exp(-TURN_RATE * dt));
    this.stride = (this.stride + moved / STRIDE_METRES) % 1;
    return this.last = { ...activity, working: activity.working && !walking, x: this.x, z: this.z, heading: this.heading, walking, stride: this.stride };
  }
  private plan(from: PlayerStation, to: PlayerStation): Waypoint[] {
    const a = SPOTS[from], b = SPOTS[to], docked = Math.hypot(this.x - a.x, this.z - a.z) < .05;
    return [...(docked ? [{ ...backOf(a), backward: true }] : []), backOf(b), { x: b.x, z: b.z }];
  }
}
