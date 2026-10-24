import { config } from './config';
import { applyLure, contextualTaunt } from './creature';
import { emit, random, type CalmState, type GameState, type LocateState, type MemoryState, type PulseMaskState, type RoutingState, type Sector, type Stage, type WireState } from './state';

export function emptyWires(): WireState { return { targetOrder: [], connections: [] }; }
export function emptyRouting(): RoutingState { return { round: 0, rounds: 0, power: [], noise: [], on: [], required: 0, limit: 0 }; }
export function emptyPulse(): PulseMaskState { return { periodSeconds: 1, startedAt: 0, streak: 0, lastTap: null }; }
export function emptyLocate(): LocateState { return { marks: 0, required: 0, lastMarkAt: -1000 }; }
export function emptyCalm(): CalmState { return { progress: 0, required: 0, pacerStartedAt: 0, holding: false }; }
const mask = (bits: number, values: number[]) => values.reduce((sum, value, i) => bits & (1 << i) ? sum + value : sum, 0);
const ones = (bits: number) => bits.toString(2).replaceAll('0', '').length;
/** Every round has at least one quiet-enough combination, never the full set and never a single machine. */
function createRouting(state: GameState, round: number): RoutingState {
  const machines = [0, 1, 2, 3], subsets = Array.from({ length: 15 }, (_, i) => i + 1);
  for (let attempt = 0; attempt < 60; attempt++) {
    const top = config.tasks.routing.maximumRating, power = machines.map(() => 1 + Math.floor(random(state) * top)), noise = machines.map(() => 1 + Math.floor(random(state) * top));
    const candidates = subsets.filter(bits => ones(bits) >= 2 && ones(bits) <= 3), target = candidates[Math.floor(random(state) * candidates.length)];
    const required = mask(target, power), limit = mask(target, noise);
    const valid = subsets.filter(bits => mask(bits, power) >= required && mask(bits, noise) <= limit);
    // Exactly one right answer: the obvious high-power picks are always too loud.
    if (required >= 8 && valid.length === 1 && ones(valid[0]) >= 2) return { round, rounds: config.tasks.routing.rounds, power, noise, on: machines.map(() => false), required, limit };
  }
  return { round, rounds: config.tasks.routing.rounds, power: [5, 2, 4, 3], noise: [5, 1, 3, 4], on: [false, false, false, false], required: 7, limit: 4 };
}
export function routingTotals(routing: RoutingState): { power: number; noise: number } {
  return routing.on.reduce((sum, on, i) => on ? { power: sum.power + routing.power[i], noise: sum.noise + routing.noise[i] } : sum, { power: 0, noise: 0 });
}
/** Sectors match the CCTV coverage; boundary positions are visible on two feeds. */
export function sectorsAt(position: number): Sector[] {
  if (position < config.line.nearPosition) return ['NEAR'];
  return [...(position <= 14 ? ['A' as const] : []), ...(position >= 14 && position <= 22 ? ['B' as const] : []), ...(position >= 22 ? ['C' as const] : [])];
}
const SECTORS: Sector[] = ['NEAR', 'A', 'B', 'C'];
/** Coarse accepted trend only: raw pulse never enters game state. Manual or missing data is neutral. */
export function heartElevated(state: GameState): boolean { return state.sensor.source !== 'manual' && state.sensor.quality === 'accepted' && state.sensor.trend === 'ELEVATED'; }
function heartSteady(state: GameState): boolean { return state.sensor.source !== 'manual' && state.sensor.quality === 'accepted' && (state.sensor.trend === 'STEADY' || state.sensor.trend === 'RECOVERED'); }
export function pulseRequirement(state: GameState): { beats: number; tolerance: number } {
  const settings = config.tasks.pulse;
  return heartElevated(state) ? { beats: settings.elevatedBeats, tolerance: settings.elevatedTolerance } : { beats: settings.beats, tolerance: settings.tolerance };
}
/** Cables are patched one panel at a time; each panel shuffles only its own cables. */
export function wirePanel(wires: WireState): { index: number; count: number; start: number; size: number } {
  const size = config.tasks.wirePanelSize, count = Math.max(1, Math.ceil(wires.connections.length / size));
  const open = wires.connections.findIndex(to => to < 0), index = open < 0 ? count - 1 : Math.floor(open / size);
  return { index, count, start: index * size, size: Math.min(size, wires.connections.length - index * size) };
}
function createWires(state: GameState, total: number): WireState {
  const targetOrder: number[] = [];
  for (let start = 0; start < total; start += config.tasks.wirePanelSize) {
    const panel = Array.from({ length: Math.min(config.tasks.wirePanelSize, total - start) }, (_, i) => start + i);
    for (let i = panel.length - 1; i > 0; i--) {
      const j = Math.floor(random(state) * (i + 1));
      [panel[i], panel[j]] = [panel[j], panel[i]];
    }
    // A straight-through panel would reduce it to horizontal gestures.
    if (panel.length > 1 && panel.every((value, i) => value === start + i)) panel.push(panel.shift()!);
    targetOrder.push(...panel);
  }
  return { targetOrder, connections: targetOrder.map(() => -1) };
}

export function emptyMemory(): MemoryState {
  return { sequence: [], input: [], playbackIndex: 0, cue: null, playbackElapsed: 0, playing: false, tempo: 1, responseElapsed: 0, armed: false, needsReplay: false };
}
/** Memory grows one cue per matched round, from `first` up to `last` cues. Tutorial stays at four. */
export function memoryRounds(state: GameState): { first: number; last: number; round: number; rounds: number } {
  const settings = state.tasks.stage === 4 ? config.tasks.stage4 : config.tasks.stage2;
  const first = state.mode === 'tutorial' ? 4 : settings.firstInputs, last = state.mode === 'tutorial' ? 4 : settings.inputs;
  return { first, last, round: Math.max(1, state.tasks.memory.sequence.length - first + 1), rounds: last - first + 1 };
}
export function memoryLength(state: GameState): number { return memoryRounds(state).last; }
function cue(state: GameState): number { return 1 + Math.floor(random(state) * 4); }
function sequenceFor(state: GameState): number[] {
  return Array.from({ length: memoryRounds(state).first }, () => cue(state));
}
/** Every correct input is audible through the wall. Working draws the creature in. */
function workNoise(state: GameState): void {
  if (state.mode === 'tutorial') return;
  state.transients.push({ at: state.time, strength: config.tasks.workNoise.strength, duration: config.tasks.workNoise.decaySeconds });
  state.pressure = Math.min(config.danger.pressureMaximum, state.pressure + config.danger.workPressure);
}
function tempoFor(state: GameState): number {
  return !state.fixedMemoryTempo && state.sensor.source !== 'manual' && state.sensor.quality === 'accepted' && state.sensor.trend === 'ELEVATED' ? config.tasks.memory.maximumTempoMultiplier : 1;
}
export function replayMemory(state: GameState, keepInput = false): void {
  if ((state.tasks.stage !== 2 && state.tasks.stage !== 4) || state.tasks.step !== 'memory' || state.equipment !== 'on') return;
  const memory = state.tasks.memory;
  memory.playing = true; memory.playbackElapsed = 0; memory.playbackIndex = 0; memory.cue = memory.sequence[0];
  memory.tempo = tempoFor(state); memory.responseElapsed = 0; memory.armed = false; memory.needsReplay = false;
  if (!keepInput) memory.input = [];
  state.notice = `Watch ${memory.sequence.length} cues. Enter the sequence after playback. R replays for free.`;
  emit(state, 'MEMORY_REPLAY');
}
export function startStage(state: GameState, stage: Stage): void {
  state.tasks.stage = stage; state.tasks.stageStarted = state.time; state.version++;
  state.tasks.wires = emptyWires(); state.tasks.routing = emptyRouting(); state.tasks.pulse = emptyPulse(); state.tasks.locate = emptyLocate(); state.tasks.calm = emptyCalm();
  state.tasks.step = stage === 1 || stage === 3 ? 'faults' : stage === 2 || stage === 4 ? 'memory' : 'final';
  if (stage === 1 || stage === 3) {
    const settings = stage === 1 ? config.tasks.stage1 : config.tasks.stage3;
    state.tasks.faults = { active: [Math.floor(random(state) * 4)], completed: 0, required: settings.required, spawned: 1, spawnElapsed: 0, maximumActive: settings.maxActive };
    state.tasks.memory = emptyMemory();
    state.tasks.wires = createWires(state, settings.wires);
    state.notice = stage === 1 ? `Clear ${settings.required} faults, then patch ${settings.wires} cables. Working is loud; Q isolates when it comes.` : `${settings.required} overload faults, then ${settings.wires} more cables. Listen while you work.`;
  } else if (stage === 2 || stage === 4) {
    state.tasks.faults.active = [];
    state.tasks.memory = { ...emptyMemory(), sequence: sequenceFor(state) };
    replayMemory(state);
  } else if (stage === 5) {
    state.tasks.memory = emptyMemory(); state.tasks.faults.active = [];
    state.notice = 'All four research stages complete. Press T to broadcast the final containment signal.';
  }
}
function completeStage(state: GameState): void {
  const stage = state.tasks.stage;
  if (state.tasks.completedStages.includes(stage)) return;
  state.tasks.completedStages.push(stage);
  state.pressure = Math.max(0, state.pressure - config.danger.stageRelief);
  if (state.mode !== 'tutorial' && config.shutdown.stageRefill > 0 && state.shutdown.chargesRemaining < config.shutdown.charges) {
    state.shutdown.chargesRemaining = Math.min(config.shutdown.charges, state.shutdown.chargesRemaining + config.shutdown.stageRefill); emit(state, 'QUIET_RECHARGED');
  }
  state.transients.push({ at: state.time, strength: config.tasks.completionStrength, duration: config.tasks.completionDecaySeconds });
  emit(state, 'TASK_COMPLETE', String(stage));
}
function mistake(state: GameState, kind: 'FAULT' | 'MEMORY' | 'WIRE' | 'ROUTING' | 'LOCATE', notice?: string): void {
  // Reducer rate limit covers rapid repeated buttons, not only keyboard repeat.
  const last = [...state.events].reverse().find(event => event.type === 'WRONG_INPUT');
  if (!last || state.time - last.time >= .25) {
    state.transients.push({ at: state.time, strength: config.tasks.mistakeStrength, duration: config.tasks.mistakeDecaySeconds });
    emit(state, 'WRONG_INPUT', kind);
    state.pressure = Math.min(config.danger.pressureMaximum, state.pressure + config.danger.mistakePressure);
    contextualTaunt(state, 'AFTER_MISTAKE');
  }
  state.notice = notice ?? (kind === 'FAULT' ? 'That box was quiet. Press a box marked FAULT.' : kind === 'WIRE' ? 'Wrong terminal. The relay sparked. Match each cable symbol to its socket.' : `Sequence mismatch. Repeat all ${state.tasks.memory.sequence.length} inputs. R replays for free.`);
}
function readyToTransmit(state: GameState, event: string, notice: string): void {
  state.tasks.step = 'transmit'; state.tasks.memory.armed = true; state.notice = notice;
  emit(state, event); state.version++;
}
/** Quiet routing: toggling is silent thinking; engaging is loud, and a wrong engage is louder. */
export function toggleRoute(state: GameState, machine: number): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || state.tasks.step !== 'routing' || !Number.isInteger(machine) || machine < 0 || machine > 3) return;
  state.tasks.routing.on[machine] = !state.tasks.routing.on[machine];
  // No running totals: adding up power against noise is the puzzle.
  state.notice = `Machine ${machine + 1} ${state.tasks.routing.on[machine] ? 'on' : 'off'}. Press T to engage when the sums are right.`;
}
export function engageRoute(state: GameState): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || state.tasks.step !== 'routing') return;
  const routing = state.tasks.routing, totals = routingTotals(routing);
  if (totals.power < routing.required || totals.noise > routing.limit) {
    routing.on = routing.on.map(() => false);
    mistake(state, 'ROUTING', totals.power < routing.required ? `Underpowered: ${totals.power} of ${routing.required}. The relay coughed loudly.` : `Too loud: noise ${totals.noise} is over what it can hear (${routing.limit}). It heard that.`);
    return;
  }
  workNoise(state); emit(state, 'ROUTING_ENGAGED');
  if (routing.round + 1 < routing.rounds) { state.tasks.routing = createRouting(state, routing.round + 1); state.notice = 'Relay engaged. A second circuit needs quiet power.'; return; }
  completeStage(state); startStage(state, 2);
}
/** Locate: from the monitor, name the sector the creature occupies now or at the last detector reading. */
export function markSector(state: GameState, sector: Sector): void {
  if (state.equipment !== 'on' || state.station !== 'cameras' || state.tasks.step !== 'locate' || !SECTORS.includes(sector)) return;
  const locate = state.tasks.locate, wait = locate.lastMarkAt + config.tasks.locate.spacingSeconds - state.time;
  if (wait > 1e-8) { state.notice = `Marker recharging · ${Math.ceil(wait)}s`; return; }
  const observed = [...sectorsAt(state.creature.linePosition), ...(state.creature.sensorDistance === null ? [] : sectorsAt(state.creature.sensorDistance))];
  if (!observed.includes(sector)) { mistake(state, 'LOCATE', 'Wrong sector. The marker pinged empty ground, loudly. Check the feeds and the range reading.'); return; }
  locate.marks++; locate.lastMarkAt = state.time; workNoise(state); emit(state, 'SECTOR_MARKED');
  state.notice = `${locate.marks} / ${locate.required} positions marked. It keeps moving; check again.`;
  if (locate.marks >= locate.required) { completeStage(state); startStage(state, 4); }
}
/** Heartbeat mask: matched tap intervals build a streak. An accepted ELEVATED trend demands more. */
export function tapPulse(state: GameState): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || state.tasks.step !== 'pulse') return;
  const pulse = state.tasks.pulse, need = pulseRequirement(state);
  if (pulse.lastTap !== null) {
    const interval = state.time - pulse.lastTap;
    if (Math.abs(interval - pulse.periodSeconds) <= pulse.periodSeconds * need.tolerance) pulse.streak++;
    else { pulse.streak = 0; state.notice = interval < pulse.periodSeconds ? 'Too fast. Match the pulse on the screen.' : 'Too slow. Match the pulse on the screen.'; }
  }
  pulse.lastTap = state.time;
  if (pulse.streak >= need.beats) { readyToTransmit(state, 'PULSE_LOCKED', 'False heartbeat locked. Press T to transmit it.'); return; }
  if (pulse.streak > 0) state.notice = `${pulse.streak} / ${need.beats} beats in rhythm${heartElevated(state) ? ' · your pulse is bleeding into the mask' : ''}.`;
}
/** Display helpers shared by the HUD panels and the in-room terminal screen. */
const cycle = (value: number, period: number) => (value % period + period) % period;
export function pulseFlash(state: GameState): number {
  const pulse = state.tasks.pulse;
  return Math.max(0, 1 - cycle(state.time - pulse.startedAt, pulse.periodSeconds) / .35);
}
export function calmBreath(state: GameState): number {
  const seconds = config.tasks.calm.breathSeconds, phase = cycle(state.time - state.tasks.calm.pacerStartedAt, seconds) / seconds;
  return calmInhale(state) ? phase : 1 - phase;
}
export function calmMatched(state: GameState): boolean {
  return cycle(state.time - state.tasks.calm.pacerStartedAt, config.tasks.calm.breathSeconds) < config.tasks.calm.graceSeconds || state.tasks.calm.holding === calmInhale(state);
}
export function taskProgress(state: GameState): [number, number] | null {
  const t = state.tasks;
  return t.step === 'wires' ? [t.wires.connections.filter(to => to >= 0).length, t.wires.connections.length]
    : t.step === 'routing' ? [t.routing.round, t.routing.rounds]
      : t.step === 'locate' ? [t.locate.marks, t.locate.required]
        : t.step === 'pulse' ? [t.pulse.streak, pulseRequirement(state).beats]
          : t.step === 'calm' ? [Math.floor(t.calm.progress), t.calm.required] : null;
}
export function breathe(state: GameState, holding: boolean): void {
  if (state.tasks.step === 'calm') state.tasks.calm.holding = !!holding;
}
/** Calm pacer: inhale (hold) then exhale (release), each `breathSeconds`. */
export function calmInhale(state: GameState): boolean {
  const seconds = config.tasks.calm.breathSeconds;
  return ((state.time - state.tasks.calm.pacerStartedAt) % (seconds * 2) + seconds * 2) % (seconds * 2) < seconds;
}
/** Matching is validated here, including keyboard clicks and pointer drops. */
export function connectWire(state: GameState, from: number, to: number): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || ![1, 3].includes(state.tasks.stage)
    || state.tasks.step !== 'wires' || !Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < 0 || from >= state.tasks.wires.connections.length || to >= state.tasks.wires.targetOrder.length) return;
  const wires = state.tasks.wires;
  if (wires.connections[from] !== -1) return;
  if (wires.targetOrder[to] !== from) { mistake(state, 'WIRE'); return; }
  wires.connections[from] = to;
  emit(state, 'WIRE_CONNECTED'); workNoise(state);
  const complete = wires.connections.filter(value => value >= 0).length, panel = wirePanel(wires);
  state.notice = complete % config.tasks.wirePanelSize === 0 && complete < wires.connections.length ? `Panel ${complete / config.tasks.wirePanelSize} of ${panel.count} patched. Next panel live.` : `${complete} / ${wires.connections.length} cables connected.`;
  if (complete === wires.connections.length) {
    if (state.tasks.stage === 1) { state.tasks.step = 'routing'; state.tasks.routing = createRouting(state, 0); state.notice = 'Cables patched. Route power through machines quiet enough that it cannot hear them.'; }
    else { state.tasks.step = 'locate'; state.tasks.locate = { marks: 0, required: config.tasks.locate.marks, lastMarkAt: -1000 }; state.notice = `Cables patched. Use the security monitor to mark its position ${config.tasks.locate.marks} times.`; }
    state.version++;
  }
}
/** Number keys drive whichever step is live: faults, routing toggles, pulse taps, monitor marks or memory. */
export function taskInput(state: GameState, value: number): void {
  if (state.equipment !== 'on' || !Number.isInteger(value) || value < 1 || value > 4) return;
  const step = state.tasks.step;
  if (step === 'locate') { markSector(state, SECTORS[value - 1]); return; }
  if (state.station !== 'terminal') return;
  if (step === 'routing') { toggleRoute(state, value - 1); return; }
  if (step === 'pulse') { tapPulse(state); return; }
  const stage = state.tasks.stage;
  if (step === 'faults') {
    const faults = state.tasks.faults, index = value - 1;
    if (faults.completed >= faults.required) return;
    if (!faults.active.includes(index)) { mistake(state, 'FAULT'); return; }
    faults.active = faults.active.filter(fault => fault !== index); faults.completed++;
    emit(state, 'FAULT_CLEARED', String(stage)); workNoise(state);
    state.notice = `${faults.completed} / ${faults.required} faults resolved.`;
    if (faults.completed >= faults.required) { state.tasks.step = 'wires'; state.notice = 'Faults cleared. Drag each cable to its matching symbol to restore the relay.'; }
    return;
  }
  if (step !== 'memory' || (stage !== 2 && stage !== 4)) return;
  const memory = state.tasks.memory;
  if (memory.playing || memory.armed || memory.needsReplay) return;
  if (value !== memory.sequence[memory.input.length]) { memory.input = []; memory.responseElapsed = 0; mistake(state, 'MEMORY'); return; }
  memory.input.push(value); workNoise(state);
  if (memory.input.length === memory.sequence.length) {
    const rounds = memoryRounds(state);
    if (memory.sequence.length < rounds.last) {
      memory.sequence.push(cue(state)); replayMemory(state);
      state.notice = `Round ${rounds.round} matched. Watch ${memory.sequence.length} cues: one more than before.`;
      return;
    }
    emit(state, 'MEMORY_ARMED');
    if (state.mode === 'tutorial') { readyToTransmit(state, 'MEMORY_COMPLETE', 'Sequence matched. Press T to transmit the calibrated signal.'); return; }
    if (stage === 2) { state.tasks.step = 'pulse'; state.tasks.pulse = { periodSeconds: 60 / (config.tasks.pulse.minimumBpm + Math.floor(random(state) * (config.tasks.pulse.maximumBpm - config.tasks.pulse.minimumBpm + 1))), startedAt: state.time, streak: 0, lastTap: null }; state.notice = 'Sequence matched. Now tap 1 in rhythm with the false heartbeat to mask your own.'; }
    else { state.tasks.step = 'calm'; state.tasks.calm = { progress: 0, required: config.tasks.calm.seconds, pacerStartedAt: state.time, holding: false }; state.notice = 'Sequence matched. Hold B to breathe in, release to breathe out. Let it lose your trail.'; }
    state.version++;
  }
}
export function transmit(state: GameState): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || state.creature.warning) return;
  if (state.tasks.step === 'routing') { engageRoute(state); return; }
  const stage = state.tasks.stage;
  if ((stage === 2 || stage === 4) && state.tasks.memory.armed) {
    completeStage(state); applyLure(state, stage === 2 ? 'EMITTER_A' : 'EMITTER_B');
    startStage(state, stage === 2 ? 3 : 5);
  } else if (stage === 5 && !state.tasks.finalTransmitted && state.tasks.completedStages.length === 4) {
    state.tasks.finalTransmitted = true;
    applyLure(state, 'CONTAINMENT'); emit(state, 'FINAL_BROADCAST'); state.version++;
  }
}
export function tickTasks(state: GameState, dt: number): void {
  if (state.equipment !== 'on') return;
  const stage = state.tasks.stage, step = state.tasks.step;
  if (step === 'calm') {
    const settings = config.tasks.calm, calm = state.tasks.calm, matched = calmMatched(state);
    const rate = !matched ? -settings.drainPerSecond : heartElevated(state) ? settings.elevatedMultiplier : heartSteady(state) ? settings.steadyMultiplier : 1;
    calm.progress = Math.max(0, Math.min(calm.required, calm.progress + rate * dt));
    if (calm.progress >= calm.required - 1e-8) readyToTransmit(state, 'CALM_COMPLETE', 'It lost your trail. Press T to transmit.');
    return;
  }
  if (step === 'faults') {
    const faults = state.tasks.faults;
    const interval = stage === 1 ? config.tasks.stage1.spawnIntervalSeconds : config.tasks.stage3.spawnIntervalSeconds;
    faults.spawnElapsed += dt;
    if (faults.spawnElapsed >= interval - 1e-8 && faults.active.length < faults.maximumActive && faults.spawned < faults.required) {
      const available = [0, 1, 2, 3].filter(index => !faults.active.includes(index));
      faults.active.push(available[Math.floor(random(state) * available.length)]); faults.spawned++; faults.spawnElapsed = 0;
      emit(state, 'FAULT_STARTED');
    }
  } else if (step === 'memory' && (stage === 2 || stage === 4)) {
    const memory = state.tasks.memory;
    if (memory.playing) {
      memory.playbackElapsed += dt;
      const interval = (config.tasks.memory.cueOnSeconds + config.tasks.memory.cueGapSeconds) / memory.tempo;
      const index = Math.floor((memory.playbackElapsed + 1e-9) / interval);
      memory.playbackIndex = Math.min(index, memory.sequence.length);
      if (index >= memory.sequence.length) {
        memory.playing = false; memory.cue = null; memory.responseElapsed = 0;
        state.notice = `Enter all ${memory.sequence.length} cues in order. R replays for free.`;
        emit(state, 'MEMORY_READY');
      } else {
        const offset = memory.playbackElapsed - index * interval;
        memory.cue = offset < config.tasks.memory.cueOnSeconds / memory.tempo - 1e-9 ? memory.sequence[index] : null;
      }
    } else if (!memory.armed && !memory.needsReplay) {
      memory.responseElapsed += dt;
      if (memory.responseElapsed >= config.tasks.memory.responseWindowSeconds) {
        memory.needsReplay = true; memory.input = []; state.notice = 'Entry window elapsed. R replays for free; no noise penalty.';
        emit(state, 'MEMORY_EXPIRED');
      }
    }
  }
}
