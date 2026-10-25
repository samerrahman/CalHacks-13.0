import { config } from './config';
import { applyLure, contextualTaunt } from './creature';
import { doorNeedsKey, enterDoorKey } from './coop';
import { emit, random, type CalmState, type GameState, type LocateState, type MemoryState, type PulseMaskState, type RoutingState, type Sector, type Stage, type WireState } from './state';

export function emptyWires(): WireState { return { targetOrder: [], connections: [] }; }
export function emptyRouting(): RoutingState { return { round: 0, rounds: 0, size: 0, kinds: [], turns: [], answer: [], start: 0, end: 0 }; }
export function emptyPulse(): PulseMaskState { return { periodSeconds: 1, startedAt: 0, streak: 0, lastTap: null }; }
export function emptyLocate(): LocateState { return { marks: 0, required: 0, lastMarkAt: -1000 }; }
export function emptyCalm(): CalmState { return { progress: 0, required: 0, pacerStartedAt: 0, holding: false, halfSeconds: config.tasks.calm.breathSeconds, phaseStartedAt: 0, inhale: true, personal: false }; }
/** Conduit tiles. Openings are bits N=1, E=2, S=4, W=8 at zero turns; each turn rotates clockwise. */
const KIND_OPENINGS = [0, 5, 3, 7];
const STEPS: [number, number, number, number][] = [[-1, 0, 1, 4], [0, 1, 2, 8], [1, 0, 4, 1], [0, -1, 8, 2]]; // row, col, own bit, neighbour bit
export function tileOpenings(kind: number, turns: number): number {
  let bits = KIND_OPENINGS[kind] ?? 0;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) bits = ((bits << 1) | (bits >> 3)) & 15;
  return bits;
}
/** Tiles reachable from the left inlet through matching openings. */
export function energizedTiles(routing: RoutingState): Set<number> {
  const { size, kinds, turns, start } = routing, seen = new Set<number>(), first = start * size;
  if (!size || !(tileOpenings(kinds[first]!, turns[first]!) & 8)) return seen;
  const queue = [first]; seen.add(first);
  while (queue.length) {
    const cell = queue.shift()!, row = Math.floor(cell / size), col = cell % size, open = tileOpenings(kinds[cell]!, turns[cell]!);
    for (const [dr, dc, own, theirs] of STEPS) {
      const r = row + dr, c = col + dc, next = r * size + c;
      if (r < 0 || c < 0 || r >= size || c >= size || seen.has(next) || !(open & own) || !(tileOpenings(kinds[next]!, turns[next]!) & theirs)) continue;
      seen.add(next); queue.push(next);
    }
  }
  return seen;
}
export function conduitConnected(routing: RoutingState): boolean {
  const outlet = routing.end * routing.size + routing.size - 1;
  return energizedTiles(routing).has(outlet) && !!(tileOpenings(routing.kinds[outlet]!, routing.turns[outlet]!) & 2);
}
/** A random self-avoiding path from the inlet to the outlet guarantees a solution; other tiles are decoys. */
function createRouting(state: GameState, round: number): RoutingState {
  const size = config.tasks.routing.size, start = Math.floor(random(state) * size), end = Math.floor(random(state) * size);
  // Column by column: move up or down to a random row, then step right. Linear time, never backtracks.
  const path: number[] = [];
  for (let col = 0, row = start; col < size; col++) {
    const target = col === size - 1 ? end : Math.floor(random(state) * size);
    path.push(row * size + col);
    while (row !== target) { row += Math.sign(target - row); path.push(row * size + col); }
  }
  const kinds = Array.from({ length: size * size }, () => random(state) < .25 ? 0 : 1 + Math.floor(random(state) * 3)), answer = kinds.map(() => -1);
  path.forEach((cell, i) => {
    const direction = (from: number, to: number) => STEPS.findIndex(([dr, dc]) => Math.floor(from / size) + dr === Math.floor(to / size) && from % size + dc === to % size);
    const entry = i === 0 ? 8 : STEPS[direction(cell, path[i - 1]!)]![2], exit = i === path.length - 1 ? 2 : STEPS[direction(cell, path[i + 1]!)]![2], need = entry | exit;
    const kind = need === 5 || need === 10 ? (random(state) < .25 ? 3 : 1) : (random(state) < .25 ? 3 : 2);
    kinds[cell] = kind; answer[cell] = [0, 1, 2, 3].find(t => (tileOpenings(kind, t) & need) === need)!;
  });
  const turns = kinds.map(() => Math.floor(random(state) * 4)), routing: RoutingState = { round, rounds: config.tasks.routing.rounds, size, kinds, turns, answer, start, end };
  if (conduitConnected(routing)) routing.turns[path[0]!] = (routing.turns[path[0]!]! + 1) % 4;
  return routing;
}
/** Fault-sound key: each stage shuffles which machine makes which sound. Derived from the seed, no extra state. */
export const FAULT_SOUNDS = ['LOW THUMPING', 'HIGH WHINE', 'FAST TICKING', 'ELECTRIC BUZZING'] as const;
export function faultSounds(state: Pick<GameState, 'seed' | 'tasks'>): number[] {
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) { const j = (Math.imul((state.seed ^ 0x51ed27) + state.tasks.stage * 0x9e3779b1 + i * 0x85ebca6b, 2654435761) >>> 0) % (i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  return order;
}
/** The rack key window (it also holds back new faults). Same timing in every mode. */
function rackKey(state: GameState): number | null {
  if (state.tasks.step !== 'faults' || state.equipment !== 'on') return null;
  const index = Math.floor((state.time - state.tasks.faults.listenFrom) / config.tasks.listen.secondsPerMachine);
  return index >= 0 && index < 4 ? index : null;
}
/** Which machine the rack key is playing to the player, or null. In co-op it never plays: the friend's manual holds the key. */
export function listeningTo(state: GameState): number | null { return state.mode === 'coop' ? null : rackKey(state); }
export function listenToRack(state: GameState): void {
  if (state.tasks.step !== 'faults' || state.equipment !== 'on' || state.station !== 'terminal' || rackKey(state) !== null) return;
  if (state.mode === 'coop') { state.notice = 'No rack key in co-op. Describe the sound to your friend; their manual says which machine makes it.'; return; }
  state.tasks.faults.listenFrom = state.time; emit(state, 'RACK_KEY');
  state.notice = 'Each machine plays its fault sound in turn. Remember which number makes which sound.';
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
/** The player's own frozen resting pulse, clamped to a tappable range; null without opted-in sensing. */
export function personalPulseBpm(state: GameState): number | null {
  const bpm = state.personal.restingBpm, { minimumBpm, maximumBpm } = config.tasks.pulse;
  return state.sensor.source !== 'manual' && bpm !== null && Number.isFinite(bpm) ? Math.min(maximumBpm, Math.max(minimumBpm, Math.round(bpm))) : null;
}
/** Starting pacer phase from the player's resting breathing rate (one inhale or exhale is half a breath). */
export function personalBreathSeconds(state: GameState): number | null {
  const rpm = state.personal.restingBreathsPerMinute, settings = config.tasks.calm;
  return state.sensor.source !== 'manual' && rpm !== null && Number.isFinite(rpm) && rpm > 0 ? Math.min(settings.breathSeconds, Math.max(settings.personalMinimumBreathSeconds, 30 / rpm)) : null;
}
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
  // Work tops out at the work cap but never lowers noise that mistakes pushed above it.
  state.pressure = Math.max(state.pressure, Math.min(config.danger.pressureMaximum, state.pressure + config.danger.workPressure));
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
  state.notice = state.mode === 'coop' ? `Your friend sees the ${memory.sequence.length}-digit sequence; you only get static. Enter it as they read it out, after playback.` : `Watch ${memory.sequence.length} cues. Enter the sequence after playback. R replays for free.`;
  emit(state, 'MEMORY_REPLAY');
}
export function startStage(state: GameState, stage: Stage): void {
  state.tasks.stage = stage; state.tasks.stageStarted = state.time; state.version++;
  state.tasks.wires = emptyWires(); state.tasks.routing = emptyRouting(); state.tasks.pulse = emptyPulse(); state.tasks.locate = emptyLocate(); state.tasks.calm = emptyCalm();
  state.tasks.step = stage === 1 || stage === 3 ? 'faults' : stage === 2 || stage === 4 ? 'memory' : 'final';
  if (stage === 1 || stage === 3) {
    const settings = stage === 1 ? config.tasks.stage1 : config.tasks.stage3;
    state.tasks.faults = { active: [], completed: 0, required: settings.required, spawned: 0, spawnElapsed: settings.spawnIntervalSeconds, maximumActive: settings.maxActive, listenFrom: state.time };
    state.tasks.memory = emptyMemory();
    state.tasks.wires = createWires(state, settings.wires);
    state.notice = state.mode === 'coop' ? `${stage === 1 ? 'Your friend has the manual' : 'The rack sounds have changed; so has the manual'}. Describe each fault sound; they tell you the machine. Fix ${settings.required} faults${stage === 3 ? ' (two can fail at once)' : ''}, then patch ${settings.wires} cables.`
      : stage === 1 ? `Listen to the rack: each machine plays its fault sound. Then fix ${settings.required} faults by ear and patch ${settings.wires} cables.` : `The rack sounds have changed. Learn them again, then fix ${settings.required} faults by ear; two can fail at once.`;
  } else if (stage === 2 || stage === 4) {
    state.tasks.faults.active = [];
    state.tasks.memory = { ...emptyMemory(), sequence: sequenceFor(state) };
    replayMemory(state);
  } else if (stage === 5) {
    state.tasks.memory = emptyMemory(); state.tasks.faults.active = [];
    state.coop.doorInput = [];
    state.notice = state.mode === 'coop' && !state.coop.doorUnlocked
      ? 'All four basement locks are released. The door motor needs a second key, and your friend has it. Enter their four digits with 1–4, then press T.'
      : 'All four basement locks are released. Press T to send the last decoy heartbeat; the door motor starts once it holds. The motor is loud.';
  }
  // Each research stage releases one of the basement door's four locks.
  if (stage >= 2 && stage <= 4 && state.mode !== 'tutorial') state.notice = `Basement lock ${stage - 1} of 4 released. ${state.notice}`;
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
export function mistake(state: GameState, kind: 'FAULT' | 'MEMORY' | 'WIRE' | 'ROUTING' | 'LOCATE' | 'DOOR', notice?: string): void {
  // Reducer rate limit covers rapid repeated buttons, not only keyboard repeat.
  const last = [...state.events].reverse().find(event => event.type === 'WRONG_INPUT');
  if (!last || state.time - last.time >= .25) {
    state.transients.push({ at: state.time, strength: config.tasks.mistakeStrength, duration: config.tasks.mistakeDecaySeconds });
    emit(state, 'WRONG_INPUT', kind);
    state.pressure = Math.min(config.danger.mistakeMaximum, state.pressure + config.danger.mistakePressure);
    contextualTaunt(state, 'AFTER_MISTAKE');
  }
  state.notice = notice ?? (kind === 'FAULT' ? 'That box was quiet. Press a box marked FAULT.' : kind === 'WIRE' ? `Wrong terminal. The relay sparked. ${state.mode === 'coop' ? 'Ask your friend which socket code that cable takes.' : 'Match each cable symbol to its socket.'}` : `Sequence mismatch. Repeat all ${state.tasks.memory.sequence.length} inputs. R replays for free.`);
}
function readyToTransmit(state: GameState, event: string, notice: string): void {
  state.tasks.step = 'transmit'; state.tasks.memory.armed = true; state.notice = notice;
  emit(state, event); state.version++;
}
/** Conduit: rotating a tile is quiet; engaging is loud, and engaging a broken conduit is louder. */
export function rotateTile(state: GameState, tile: number): void {
  const routing = state.tasks.routing;
  if (state.equipment !== 'on' || state.station !== 'terminal' || state.tasks.step !== 'routing' || !Number.isInteger(tile) || tile < 0 || tile >= routing.kinds.length) return;
  routing.turns[tile] = (routing.turns[tile]! + 1) % 4;
}
export function engageRoute(state: GameState): void {
  if (state.equipment !== 'on' || state.station !== 'terminal' || state.tasks.step !== 'routing') return;
  const routing = state.tasks.routing;
  if (!conduitConnected(routing)) { mistake(state, 'ROUTING', 'The conduit is broken. The surge arced loudly. Connect the inlet to the outlet first.'); return; }
  workNoise(state); emit(state, 'ROUTING_ENGAGED');
  if (routing.round + 1 < routing.rounds) { state.tasks.routing = createRouting(state, routing.round + 1); state.notice = 'Relay engaged. Another conduit is broken.'; return; }
  completeStage(state); startStage(state, 2);
}
/** Locate: from the monitor, name the sector the creature occupies now or at the last detector reading. */
export function markSector(state: GameState, sector: Sector): void {
  if (state.equipment !== 'on' || state.station !== 'cameras' || state.tasks.step !== 'locate' || !SECTORS.includes(sector)) return;
  const locate = state.tasks.locate, wait = locate.lastMarkAt + config.tasks.locate.spacingSeconds - state.time;
  if (wait > 1e-8) { state.notice = `Marker recharging · ${Math.ceil(wait)}s`; return; }
  const observed = [...sectorsAt(state.creature.linePosition), ...(state.creature.sensorDistance === null ? [] : sectorsAt(state.creature.sensorDistance))];
  if (!observed.includes(sector)) { mistake(state, 'LOCATE', state.mode === 'coop' ? 'Wrong ring. The marker pinged empty ground, loudly. Ask your friend again; it keeps moving.' : 'Wrong sector. The marker pinged empty ground, loudly. Check the feeds and the range reading.'); return; }
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
  const calm = state.tasks.calm, phase = cycle(state.time - calm.phaseStartedAt, calm.halfSeconds) / calm.halfSeconds;
  return calmInhale(state) ? phase : 1 - phase;
}
export function calmMatched(state: GameState): boolean {
  return cycle(state.time - state.tasks.calm.phaseStartedAt, state.tasks.calm.halfSeconds) < config.tasks.calm.graceSeconds || state.tasks.calm.holding === calmInhale(state);
}
/** Advance whole pacer phases. A personal pacer lengthens each full breath until the standard pace. */
function advanceCalmPacer(state: GameState): void {
  const calm = state.tasks.calm, settings = config.tasks.calm;
  for (let guard = 0; guard < 1000 && state.time - calm.phaseStartedAt >= calm.halfSeconds - 1e-9; guard++) {
    calm.phaseStartedAt += calm.halfSeconds; calm.inhale = !calm.inhale;
    if (calm.inhale && calm.personal) calm.halfSeconds = Math.min(settings.breathSeconds, calm.halfSeconds + settings.slowStepSeconds);
  }
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
/** Calm pacer: inhale (hold) then exhale (release), each phase `halfSeconds`. Times outside the
 * current phase (a reaction delay, or a phase not yet advanced) belong to the neighbouring phase. */
export function calmInhale(state: GameState): boolean {
  const calm = state.tasks.calm, elapsed = state.time - calm.phaseStartedAt;
  return elapsed >= 0 && elapsed < calm.halfSeconds ? calm.inhale : !calm.inhale;
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
    if (state.tasks.stage === 1) { state.tasks.step = 'routing'; state.tasks.routing = createRouting(state, 0); state.notice = `Cables patched. Rotate the conduit tiles to join the inlet to the relay outlet, then press T.${state.mode === 'coop' ? ' The board shows no power; your friend has the solved route.' : ''}`; }
    else { state.tasks.step = 'locate'; state.tasks.locate = { marks: 0, required: config.tasks.locate.marks, lastMarkAt: -1000 }; state.notice = state.mode === 'coop' ? `Cables patched. Your radar is dark; your friend can see it. Ask which ring, then mark it ${config.tasks.locate.marks} times.` : `Cables patched. Use the radar to mark its position ${config.tasks.locate.marks} times.`; }
    state.version++;
  }
}
/** Number keys drive whichever step is live: faults, routing toggles, pulse taps, monitor marks or memory. */
export function taskInput(state: GameState, value: number): void {
  if (state.equipment !== 'on' || !Number.isInteger(value) || value < 1 || value > 4) return;
  const step = state.tasks.step;
  if (step === 'locate') { markSector(state, SECTORS[value - 1]); return; }
  if (state.station !== 'terminal') return;
  if (step === 'routing') return;
  if (step === 'pulse') { tapPulse(state); return; }
  const stage = state.tasks.stage;
  if (step === 'faults') {
    const faults = state.tasks.faults, index = value - 1;
    if (faults.completed >= faults.required) return;
    if (!faults.active.includes(index)) { mistake(state, 'FAULT', 'Wrong machine. It clanged loudly. Listen for which sound is playing.'); return; }
    faults.active = faults.active.filter(fault => fault !== index); faults.completed++;
    emit(state, 'FAULT_CLEARED', String(stage)); workNoise(state);
    state.notice = `${faults.completed} / ${faults.required} faults resolved.`;
    if (faults.completed >= faults.required) { state.tasks.step = 'wires'; state.notice = state.mode === 'coop' ? 'Faults cleared. Read each cable symbol to your friend; the manual gives its socket code.' : 'Faults cleared. Drag each cable to its matching symbol to restore the relay.'; }
    return;
  }
  if (step === 'final') { enterDoorKey(state, value); return; }
  if (step !== 'memory' || (stage !== 2 && stage !== 4)) return;
  const memory = state.tasks.memory;
  if (memory.playing || memory.armed || memory.needsReplay) return;
  if (value !== memory.sequence[memory.input.length]) { memory.input = []; memory.responseElapsed = 0; mistake(state, 'MEMORY'); return; }
  memory.input.push(value); workNoise(state);
  if (memory.input.length === memory.sequence.length) {
    const rounds = memoryRounds(state);
    if (memory.sequence.length < rounds.last) {
      memory.sequence.push(cue(state)); replayMemory(state);
      state.notice = state.mode === 'coop' ? `Round ${rounds.round} matched. Your friend has ${memory.sequence.length} digits now: one more than before.` : `Round ${rounds.round} matched. Watch ${memory.sequence.length} cues: one more than before.`;
      return;
    }
    emit(state, 'MEMORY_ARMED');
    if (state.mode === 'tutorial') { readyToTransmit(state, 'MEMORY_COMPLETE', 'Sequence matched. Press T to transmit the calibrated signal.'); return; }
    if (stage === 2) {
      // The seeded draw always happens so personal sensing never shifts the run's random stream.
      const seeded = config.tasks.pulse.minimumBpm + Math.floor(random(state) * (config.tasks.pulse.maximumBpm - config.tasks.pulse.minimumBpm + 1)), own = personalPulseBpm(state);
      state.tasks.step = 'pulse'; state.tasks.pulse = { periodSeconds: 60 / (own ?? seeded), startedAt: state.time, streak: 0, lastTap: null, personal: own !== null };
      state.notice = own !== null ? 'Sequence matched. The false heartbeat is tuned to your own resting rhythm. Tap 1 with it to mask yourself.' : 'Sequence matched. Now tap 1 in rhythm with the false heartbeat to mask your own.';
    } else {
      const own = personalBreathSeconds(state);
      state.tasks.step = 'calm'; state.tasks.calm = { progress: 0, required: config.tasks.calm.seconds, pacerStartedAt: state.time, holding: false, halfSeconds: own ?? config.tasks.calm.breathSeconds, phaseStartedAt: state.time, inhale: true, personal: own !== null };
      state.notice = state.mode === 'coop' ? 'Sequence matched. Only your friend sees the breathing pacer: hold B when they say in, let go when they say out.' : own !== null ? 'Sequence matched. The pacer starts at your own breathing pace and slows with every breath. Hold B to breathe in, release to breathe out.' : 'Sequence matched. Hold B to breathe in, release to breathe out. Let it lose your trail.';
    }
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
    if (doorNeedsKey(state)) { state.notice = 'The door motor needs your friend’s key first. Ask them to read it, then enter it with 1–4.'; return; }
    state.tasks.finalTransmitted = true;
    applyLure(state, 'CONTAINMENT'); emit(state, 'FINAL_BROADCAST'); state.version++;
  }
}
export function tickTasks(state: GameState, dt: number): void {
  if (state.equipment !== 'on') return;
  const stage = state.tasks.stage, step = state.tasks.step;
  if (step === 'calm') {
    advanceCalmPacer(state);
    const settings = config.tasks.calm, calm = state.tasks.calm, matched = calmMatched(state);
    const rate = !matched ? -settings.drainPerSecond : heartElevated(state) ? settings.elevatedMultiplier : heartSteady(state) ? settings.steadyMultiplier : 1;
    calm.progress = Math.max(0, Math.min(calm.required, calm.progress + rate * dt));
    if (calm.progress >= calm.required - 1e-8) readyToTransmit(state, 'CALM_COMPLETE', 'It lost your trail. Press T to transmit.');
    return;
  }
  if (step === 'faults') {
    const faults = state.tasks.faults;
    const interval = stage === 1 ? config.tasks.stage1.spawnIntervalSeconds : config.tasks.stage3.spawnIntervalSeconds;
    if (rackKey(state) !== null) return; // no new faults while the rack plays its key (a silent briefing gap in co-op)
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
