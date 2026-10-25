import { createAudioEngine, type AudioEngine, type AudioPosition, type EffectName, type ScareKind } from '../audio/engine';
import type { TraceSnapshot } from '../integrations/client';
import type { SpectatorVitals } from '../integrations/spectate';
import { creatureBearing, huntWindow, projectCreature } from '../game/creature';
import { config } from '../game/config';
import type { GameState, PublicEvent } from '../game/state';

/** Where the creature is heard from on this page: the game's path projection of its line position,
 * swung to its public bearing (`creatureBearing` from the seed and run time), as the game does. */
export function heardPosition(linePosition: number, seed: number, seconds: number): AudioPosition {
  const probe = { creature: { linePosition } } as GameState;
  projectCreature(probe);
  const [x, , z] = probe.creature.position, radius = Math.hypot(x, z), bearing = creatureBearing(seed, seconds);
  return [Math.sin(bearing) * radius, 0, -Math.cos(bearing) * radius];
}

/** Room sounds the player hears for these public events (same mapping as the game's App). */
const EFFECTS: Partial<Record<string, EffectName>> = {
  WRONG_INPUT: 'machine_mistake', TASK_COMPLETE: 'relay_confirm', BLACKOUT_STARTED: 'blackout', RESTORED: 'power_restart',
  LURE_TRANSMITTED: 'lure_transmit', RECOVERY_REWARD: 'steps_receding', FRIEND_WARNING: 'radio_chime', FRIEND_DECOY: 'lure_transmit',
  DOOR_UNLOCKED: 'relay_confirm', QUIET_ENTERED: 'blackout', WON: 'containment_success',
};

/** A soft lub-dub at the player's shared heart rate, scheduled a little ahead on its own clock. */
class Heartbeat {
  private context: AudioContext;
  private out: GainNode;
  private next = 0;
  private timer: ReturnType<typeof setInterval>;
  bpm: number | null = null;
  elevated = false;
  constructor() {
    this.context = new AudioContext();
    const lowpass = this.context.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 160;
    this.out = this.context.createGain(); this.out.gain.value = 0.9; this.out.connect(lowpass).connect(this.context.destination);
    this.timer = setInterval(() => this.schedule(), 100);
  }
  resume(): Promise<void> { return this.context.resume(); }
  setLevel(level: number): void { this.out.gain.setTargetAtTime(level, this.context.currentTime, 0.1); }
  private thump(at: number, hz: number, gain: number): void {
    const osc = this.context.createOscillator(), env = this.context.createGain();
    osc.frequency.setValueAtTime(hz, at); osc.frequency.exponentialRampToValueAtTime(hz * 0.7, at + 0.14);
    env.gain.setValueAtTime(0.0001, at); env.gain.exponentialRampToValueAtTime(gain, at + 0.012); env.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(env).connect(this.out); osc.start(at); osc.stop(at + 0.18);
  }
  private schedule(): void {
    if (this.context.state !== 'running' || this.bpm === null) { this.next = 0; return; }
    const now = this.context.currentTime, period = 60 / Math.min(180, Math.max(40, this.bpm)), gain = this.elevated ? 0.9 : 0.6;
    if (this.next < now) this.next = now + 0.05;
    while (this.next < now + 0.3) { this.thump(this.next, 58, gain); this.thump(this.next + Math.min(0.3, period * 0.32), 48, gain * 0.65); this.next += period; }
  }
  dispose(): void { clearInterval(this.timer); void this.context.close().catch(() => undefined); }
}

export type SoundOptions = { heartbeat: boolean; volume: number };

/** Spectator sound: the game's own audio engine (footsteps louder and quicker as it closes in, a run
 * during a hunt, pounding at the wall, a barrage when an attack commits, scares, the power going off
 * and on), driven only by the public trace, plus the player's heartbeat when they share it. It starts
 * on a tap (browsers block audio until then) and sends nothing anywhere. */
export class SpectatorSound {
  private engine: AudioEngine | null = null;
  private heart: Heartbeat | null = null;
  private lastSeq = 0;
  private lastTime = 0;
  private primed = false;
  private lastPosition: number | null = null;
  private motion: { kind: 'approaching' | 'receding' | 'stationary'; at: number } = { kind: 'stationary', at: 0 };
  options: SoundOptions = { heartbeat: true, volume: 0.55 };
  get running(): boolean { return !!this.engine; }
  async start(): Promise<void> {
    if (this.engine) return;
    const engine = this.engine = createAudioEngine(), heart = this.heart = new Heartbeat();
    engine.setListenerPosition([0, 1.6, 0]); engine.setListenerYaw(0); engine.setVolume(this.options.volume);
    await Promise.all([engine.start(), heart.resume()]);
  }
  stop(): void { this.engine?.dispose(); this.engine = null; this.heart?.dispose(); this.heart = null; this.primed = false; this.lastPosition = null; }
  setOptions(patch: Partial<SoundOptions>): void { this.options = { ...this.options, ...patch }; this.engine?.setVolume(this.options.volume); this.heart?.setLevel(this.options.heartbeat ? this.options.volume * 1.6 : 0); }
  /** `seconds` is the run time carried forward from the last update. Call every animation frame. */
  update(trace: TraceSnapshot | null, vitals: SpectatorVitals | null, seconds: number, nowMs: number): void {
    const engine = this.engine;
    if (this.heart) { this.heart.bpm = this.options.heartbeat && vitals?.pulseBpm ? vitals.pulseBpm : null; this.heart.elevated = vitals?.trend === 'ELEVATED'; }
    if (!engine) return;
    engine.update(nowMs);
    const s = trace?.summary;
    if (!trace || !s) { engine.updateWorld({ time: this.lastTime, power: 'on', paused: true, faults: [], creature: { position: [0, 0, -30], distance: 24, phase: 'search', lastMotion: 'stationary' } }); return; }
    // A restarted run (time or sequence going backwards) starts the engine's schedules afresh.
    const newest = trace.events.reduce((max, e) => Math.max(max, e.seq), 0);
    if (this.primed && (newest < this.lastSeq || s.time < this.lastTime - 2)) { engine.reset(); this.primed = false; this.lastPosition = null; }
    const time = Math.max(s.time, Math.min(seconds, s.time + 2));
    if (this.lastPosition !== null && s.linePosition !== this.lastPosition) this.motion = { kind: s.linePosition < this.lastPosition ? 'approaching' : 'receding', at: time };
    else if (time - this.motion.at > 3) this.motion = { kind: 'stationary', at: this.motion.at };
    this.lastPosition = s.linePosition; this.lastTime = time;
    const heard = heardPosition(s.linePosition, trace.seed, time), power = (['on', 'quiet', 'blackout'] as const).find(p => p === s.equipment) ?? 'on';
    const hunting = s.status === 'playing' && power !== 'quiet' && !['lured', 'containment', 'breach'].includes(s.creaturePhase) && !!huntWindow({ mode: trace.mode, time, seed: trace.seed } as GameState);
    engine.updateWorld({
      time, power, paused: s.status !== 'playing' || trace.mode === 'tutorial', hunting, faults: [],
      creature: { position: heard, distance: s.linePosition / Math.max(1, s.lineLength) * config.line.length, phase: s.creaturePhase, lastMotion: this.motion.kind },
    });
    for (const e of trace.events) if (e.seq > this.lastSeq) { if (this.primed) this.event(e, heard); }
    this.lastSeq = Math.max(this.primed ? this.lastSeq : 0, newest); this.primed = true;
  }
  /** Only events that arrive while listening play; joining mid-run never replays old scares. */
  private event(e: PublicEvent, heard: AudioPosition): void {
    if (e.type === 'SCARE' && ['impact', 'monitor', 'breach'].includes(e.detail)) { this.engine?.playScare(e.detail as ScareKind, heard); return; }
    const effect = EFFECTS[e.type];
    if (effect) this.engine?.playEffect(effect, e.type === 'RECOVERY_REWARD' ? heard : undefined, e.type === 'WON' ? 0.5 : 0.32);
  }
  dispose(): void { this.stop(); }
}
