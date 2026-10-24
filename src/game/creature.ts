import { clamp, config, FIXED_DT, NODES } from './config';
import { emit, type GameState, type LureTarget, type NodeId, type Target, type Vec3, type TauntId } from './state';

export const distance = (a: Vec3, b: Vec3 = [0, 0, 0]) => Math.hypot(...a.map((v, i) => v - b[i]));
const checkpoints: [number, NodeId][] = [[0, 'SHELTER_WALL'], [7, 'NEAR_PATH'], [14, 'JUNCTION'], [22, 'EMITTER_B'], [24, 'CONTAINMENT']];
/** The integer is authoritative. Vec3/node are deterministic display projections only. */
export function projectCreature(state: GameState): void {
  const c = state.creature;
  c.linePosition = Math.round(clamp(c.linePosition, 0, config.line.length));
  c.distance = c.linePosition;
  const p = c.linePosition / config.line.length * 24;
  const upper = checkpoints.findIndex(([at]) => at >= p);
  const [end, endNode] = checkpoints[Math.max(0, upper)];
  const [start, startNode] = checkpoints[Math.max(0, upper - 1)];
  const fraction = end === start ? 0 : (p - start) / (end - start);
  c.position = NODES[startNode].map((v, i) => v + (NODES[endNode][i] - v) * fraction) as Vec3;
  c.node = fraction >= 1 ? endNode : startNode;
  c.route = fraction > 0 && fraction < 1 ? [endNode] : [];
}
/** Compatibility utility: no route call can move the local integer authority. */
export function shortestRoute(start: NodeId, end: NodeId): NodeId[] { return start === end ? [] : [end]; }
export function routeTo(state: GameState, _target: NodeId): void { projectCreature(state); }
export function setPhase(state: GameState, phase: GameState['creature']['phase'], target: Target, seconds = 0): void {
  const c = state.creature;
  if (c.phase !== phase || c.target !== target) { c.phase = phase; c.target = target; c.phaseStarted = state.time; }
  c.phaseUntil = state.time + seconds;
}
export function lureProtected(state: GameState): boolean {
  const lure = state.creature.lure;
  return !!lure && (lure.target === 'CONTAINMENT' || state.time < lure.protectedUntil);
}
export function applyLure(state: GameState, target: LureTarget): boolean {
  const c = state.creature;
  if (c.warning) return false;
  c.lure = { target, issuedAt: state.time, protectedUntil: state.time + config.lineLure.durationSeconds, arrivedAt: null };
  c.containmentStarted = null;
  setPhase(state, 'lured', target); emit(state, 'LURE_TRANSMITTED', target); contextualTaunt(state, 'LURE_FOLLOWED');
  state.notice = target === 'CONTAINMENT' ? 'Final signal active. Lead the creature to the far end.' : 'Remote signal active. Its next steps favor the far end.';
  state.version++; return true;
}
export function enterQuiet(state: GameState): void {
  if (state.equipment === 'quiet') return;
  if (state.mode !== 'tutorial' && state.shutdown.chargesRemaining <= 0) { state.notice = 'No isolation charges remain.'; emit(state, 'QUIET_EXHAUSTED'); return; }
  if (state.mode !== 'tutorial' && state.time < state.shutdown.cooldownUntil) { state.notice = 'Isolation relay cooling down.'; emit(state, 'QUIET_COOLDOWN'); return; }
  if (state.mode !== 'tutorial') { state.shutdown.chargesRemaining--; state.shutdown.used++; }
  state.shutdown.activeUntil = state.time + config.shutdown.durationSeconds;
  state.equipment = 'quiet'; state.restoreHeld = false; state.restoreHold = 0;
  state.quiet = { phase: 'listening', started: state.time, retreatStarted: null, movedAway: false };
  state.transients = []; state.clues = { machinery: 0, transient: 0, physiology: 0 };
  const c = state.creature;
  // Isolation changes future step probabilities, never the position or step clock.
  if (!c.warning) setPhase(state, 'retreat', 'NONE');
  state.notice = c.warning ? 'Isolation relay disengaged.' : `Isolation active for ${config.shutdown.durationSeconds} seconds. Research paused; charges are limited.`;
  emit(state, 'QUIET_ENTERED'); contextualTaunt(state, 'MACHINES_QUIET'); state.version++;
}
export function canRestore(state: GameState): boolean {
  return state.equipment === 'blackout' || state.equipment === 'quiet' && state.quiet?.phase === 'ready';
}
export function restoreEquipment(state: GameState): void {
  if (state.equipment === 'on' || !canRestore(state)) return;
  const wasIsolated = state.equipment === 'quiet';
  state.equipment = 'on'; state.quiet = null; state.restoreHeld = false; state.restoreHold = 0; state.blackout.startedAt = null;
  state.shutdown.activeUntil = 0;
  if (wasIsolated) state.shutdown.cooldownUntil = state.time + (state.mode === 'tutorial' ? 0 : config.shutdown.cooldownSeconds);
  if (!state.creature.warning && !lureProtected(state)) setPhase(state, 'search', 'NONE');
  state.transients.push({ at: state.time, strength: config.quiet.startupSoundStrength, duration: config.quiet.startupSoundDecaySeconds });
  emit(state, 'RESTORED', 'CLEAR'); state.notice = wasIsolated ? 'Power restored. Isolation relay is cooling down.' : 'Power restored. Research can continue.'; state.version++;
}
export function warningRemaining(state: GameState): number | null { return state.creature.warning ? Math.max(0, state.creature.warning.deadline - state.time) : null; }
/** A research task is live (not tutorial, not the final broadcast): the terminal and relays are running. */
export function equipmentRunning(state: GameState): boolean {
  return state.mode !== 'tutorial' && state.status === 'playing' && state.time >= config.line.graceSeconds && state.tasks.step !== 'final';
}
/** One seeded hunt per period at a seeded offset, derived from the run seed: no extra state, fully deterministic. */
export function huntWindow(state: GameState): { start: number; end: number } | null {
  const h = config.hunt;
  if (state.mode === 'tutorial' || state.time < h.firstSeconds) return null;
  const k = Math.floor((state.time - h.firstSeconds) / h.periodSeconds);
  const jitter = (Math.imul((state.seed ^ 0x5bd1e995) + k * 0x9e3779b1, 2654435761) >>> 0) / 4294967296;
  const start = h.firstSeconds + k * h.periodSeconds + jitter * (h.periodSeconds - h.durationSeconds);
  return state.time >= start && state.time < start + h.durationSeconds ? { start, end: start + h.durationSeconds } : null;
}
export function huntActive(state: GameState): boolean {
  return !!huntWindow(state) && state.equipment !== 'quiet' && !lureProtected(state) && !state.creature.warning;
}
export function updateClues(state: GameState, _dt: number): void {
  const c = state.creature;
  const faultNoise = Math.min(config.tasks.maxFaultNoise, state.tasks.faults.active.length * (state.equipment === 'blackout' ? config.tasks.blackoutResidualNoisePerActive : config.tasks.faultNoisePerActive));
  // Running research equipment is never silent: only turning it off (Q) or a blackout quiets the room.
  const machinery = state.equipment === 'quiet' ? 0 : state.equipment === 'on' && equipmentRunning(state) ? Math.max(faultNoise, config.tasks.equipmentNoise) : faultNoise;
  state.transients = state.transients.filter(s => state.time - s.at < s.duration);
  const transient = state.equipment === 'quiet' ? 0 : Math.min(1, state.transients.reduce((sum, s) => sum + s.strength * clamp(1 - (state.time - s.at) / s.duration), 0));
  const physiology = state.sensor.source !== 'manual' && state.sensor.quality === 'accepted' && state.sensor.trend === 'ELEVATED' ? config.threat.maximumPhysiologyClue : 0;
  state.clues = { machinery, transient, physiology };
  if (Math.max(machinery, transient) >= config.threat.audibleEvidenceMinimumStrength) { c.lastAudibleAt = state.time; c.lastAudibleStrength = Math.max(machinery, transient); }
  c.confidence = clamp(state.danger / 100);
}
/** Named exposure contributions. The HUD explains the same numbers the movement odds use. */
export function dangerParts(state: GameState): { base: number; time: number; noise: number; pulse: number; isolation: number } {
  const pulse = state.sensor.source !== 'manual' && state.sensor.quality === 'accepted' && state.sensor.trend === 'ELEVATED' ? config.danger.physiologyMaximum : 0;
  return { base: config.danger.base, time: config.danger.timeMaximum * clamp(state.time / config.line.deadlineSeconds), noise: state.pressure, pulse, isolation: state.shutdown.used * config.danger.shutdownAdaptation };
}
/** Tasks own mistake/success pressure; this combines it with bounded contextual factors. */
export function updateDanger(state: GameState, dt: number): void {
  // Work noise: inputs and mistakes add it (tasks.ts), unresolved faults keep adding it,
  // and it cools whenever the room is quiet, fastest while isolated.
  const cooling = config.danger.pressureDecayPerSecond * (state.equipment === 'quiet' ? config.danger.quietCoolingMultiplier : 1);
  const machinery = state.equipment === 'on' && state.mode !== 'tutorial' ? state.clues.machinery * config.danger.machineryPressurePerSecond : 0;
  state.pressure = clamp(state.pressure + (machinery - cooling) * dt, 0, config.danger.pressureMaximum);
  const part = dangerParts(state);
  state.danger = state.mode === 'tutorial' ? 0 : clamp(part.base + part.time + part.noise + part.pulse + part.isolation, 0, 100);
}
export function updateDistanceSensor(state: GameState): void {
  const c = state.creature;
  if (state.equipment !== 'on') { c.sensorDistance = null; return; }
  if (c.sensorDistance === null || state.time - c.sensorSampleAt >= config.line.sensorSeconds - 1e-8) { c.sensorDistance = c.linePosition; c.sensorSampleAt = state.time; }
}
export function movementProbabilities(state: GameState): { step: number; probability: number }[] {
  const c = state.creature;
  const settings = config.lineBias;
  let bias = settings.base - state.danger / 100 * settings.dangerScale + Math.sign(c.lastStep) * settings.momentum;
  // It hunts by sound: after a stretch of silence it loses the trail and drifts away.
  if (state.time - c.lastAudibleAt > settings.lostTrailSeconds) bias += settings.lostTrailBias;
  // Seeded hunts: now and then it charges regardless of how careful you have been.
  if (huntActive(state)) bias = config.hunt.bias;
  if (state.time < c.biasUntil) bias += clamp(c.tacticBias, -settings.providerMaximum, settings.providerMaximum);
  if (state.equipment === 'quiet') bias = config.shutdown.retreatBias - state.danger / 100 * settings.quietDangerScale;
  if (lureProtected(state)) bias = c.lure?.target === 'CONTAINMENT' ? settings.finalLure : config.lineLure.bias - state.danger / 100 * settings.lureDangerScale;
  bias = clamp(bias, settings.minimum, settings.maximum);
  const weights = config.lineWeights.map((base, i) => base * (i < 3 ? 1 - bias : i > 3 ? 1 + bias : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((weight, i) => ({ step: i - 3, probability: weight / sum }));
}
function moveBy(state: GameState, amount: number): void {
  const c = state.creature, previous = c.linePosition;
  c.linePosition = Math.round(clamp(previous + clamp(amount, -config.line.maximumStep, config.line.maximumStep), 0, config.line.length));
  c.lastStep = c.linePosition - previous;
  c.lastMotion = c.lastStep < 0 ? 'approaching' : c.lastStep > 0 ? 'receding' : 'stationary';
  if (state.quiet && c.lastStep > 0) state.quiet.movedAway = true;
  projectCreature(state);
  emit(state, 'MONSTER_STEP', `from=${previous} to=${c.linePosition} step=${c.lastStep}`);
  updateAlarm(state);
}
export function beginApproach(state: GameState): void {
  if (state.creature.warning) return;
  state.creature.tacticBias = -config.lineBias.providerMaximum; state.creature.biasUntil = state.time + config.lineBias.providerDurationSeconds;
}
export function tickCreature(state: GameState, _dt: number): void {
  const c = state.creature;
  const hunt = huntWindow(state);
  if (hunt && state.time - hunt.start < FIXED_DT - 1e-9 && !c.warning && !lureProtected(state)) { emit(state, 'HUNT_STARTED'); state.version++; }
  if (state.quiet) {
    if (state.time - state.quiet.started >= config.shutdown.listeningSeconds && state.quiet.phase === 'listening') { state.quiet.phase = 'retreat'; state.quiet.retreatStarted = state.time; emit(state, 'QUIET_RETREAT'); }
    const readyAt = state.mode === 'tutorial' ? config.shutdown.durationSeconds : config.shutdown.manualRestoreAfterSeconds;
    if (state.time - state.quiet.started >= readyAt - 1e-8 && state.quiet.phase !== 'ready') { state.quiet.phase = 'ready'; emit(state, 'RESTORE_WINDOW'); }
    if (state.mode !== 'tutorial' && state.time >= state.shutdown.activeUntil - 1e-8) restoreEquipment(state);
  }
  if (c.warning) { c.lastMotion = 'stationary'; finishCommittedAttack(state); return; }
  if (state.mode === 'tutorial') return;
  if (c.lure && !lureProtected(state)) { c.lure = null; emit(state, 'LURE_RELEASED'); }
  if (state.time >= c.nextMoveAt - 1e-8 && c.containmentStarted === null) {
    c.nextMoveAt += config.line.stepSeconds;
    c.movementRng = (Math.imul(c.movementRng, 1664525) + 1013904223) >>> 0;
    let sample = c.movementRng / 4294967296;
    let chosen = 3;
    for (const candidate of movementProbabilities(state)) { sample -= candidate.probability; if (sample <= 0) { chosen = candidate.step; break; } }
    moveBy(state, chosen);
    if (c.lure) setPhase(state, 'lured', c.lure.target);
    else setPhase(state, c.lastStep < 0 ? 'approach' : c.lastStep > 0 ? 'retreat' : 'listen', c.lastStep < 0 ? 'SHELTER' : 'NONE');
  }
  if (c.lure && c.linePosition >= config.lineLure[c.lure.target] && c.lure.arrivedAt === null) {
    c.lure.arrivedAt = state.time; emit(state, 'LURE_ARRIVED', c.lure.target);
    if (c.lure.target === 'CONTAINMENT') { c.containmentStarted = state.time; setPhase(state, 'containment', 'CONTAINMENT'); }
  }
  if (c.containmentStarted !== null && state.time - c.containmentStarted >= config.tasks.stage5.sealSeconds - 1e-8) {
    state.status = 'won'; state.tasks.stage = 6; state.restoreHeld = false; state.notice = 'Containment sealed. Research recovered.'; emit(state, 'WON'); state.version++; return;
  }
  commitIfEligible(state); finishCommittedAttack(state);
}
export function proximityAlarm(state: GameState): { active: boolean; urgency: number } {
  const c = state.creature;
  const active = state.mode !== 'tutorial' && state.status === 'playing' && (c.warning !== null || c.alarmLatched);
  return { active, urgency: active ? c.warning ? 1 : clamp((config.line.clearPosition - c.linePosition) / (config.line.clearPosition - config.line.commitPosition), .1, 1) : 0 };
}
export function triggerScare(state: GameState, kind: 'impact' | 'monitor' | 'breach'): void {
  if (state.mode === 'tutorial' || state.time < config.line.graceSeconds) return;
  if (kind !== 'breach' && (state.scareCount >= config.scares.maximumNonfatalPerRun || state.scare && state.time - state.scare.at < config.scares.minimumGapSeconds)) return;
  state.scare = { id: (state.scare?.id ?? 0) + 1, at: state.time, kind };
  if (kind !== 'breach') state.scareCount++;
  emit(state, 'SCARE', kind);
}
export function contextualTaunt(state: GameState, id: TauntId): boolean {
  if (state.mode === 'tutorial' || state.time < config.line.graceSeconds || state.status !== 'playing' || state.creature.warning || state.creature.linePosition > 10 || state.director.tauntCount >= 7 || state.time - state.director.lastTauntAt < 25) return false;
  const valid = id === 'AFTER_MISTAKE' && state.events.some(e => ['WRONG_INPUT', 'WIRE_MISTAKE'].includes(e.type) && state.time - e.time <= 30)
    || id === 'MACHINES_QUIET' && state.equipment === 'quiet' || id === 'HEARD_RHYTHM' && state.clues.physiology > 0 || id === 'LURE_FOLLOWED' && lureProtected(state);
  if (!valid) return false;
  state.director.lastTauntAt = state.time; state.director.tauntCount++; state.director.tauntId = id; emit(state, 'TAUNT', id); return true;
}
function updateAlarm(state: GameState): void {
  const c = state.creature;
  if (c.linePosition >= config.line.clearPosition && !c.warning) { c.alarmLatched = false; c.nearSince = null; }
  if (!c.alarmLatched && c.linePosition <= config.line.nearPosition && state.mode !== 'tutorial') {
    c.alarmLatched = true; c.nearSince = state.time;
    emit(state, 'PROXIMITY_ALARM'); triggerScare(state, state.station === 'cameras' ? 'monitor' : 'impact'); contextualTaunt(state, 'HEARD_RHYTHM');
  }
}
export function commitIfEligible(state: GameState): void {
  const c = state.creature;
  if (c.warning || state.mode === 'tutorial' || state.status !== 'playing' || state.time < config.line.graceSeconds || c.linePosition > config.line.commitPosition
    || c.nearSince === null || state.time - c.nearSince < config.line.minimumWarningSeconds - 1e-8
    || state.time - c.lastAudibleAt > config.line.soundEvidenceSeconds || c.lastAudibleStrength < config.threat.audibleEvidenceMinimumStrength) return;
  c.warning = { started: state.time, duration: config.line.committedSeconds, deadline: state.time + config.line.committedSeconds };
  c.warningStarts.push(state.time); c.alarmLatched = true; setPhase(state, 'breach', 'SHELTER'); c.lastMotion = 'stationary';
  emit(state, 'ATTACK_COMMITTED'); state.version++;
}
function finishCommittedAttack(state: GameState): void {
  if (!state.creature.warning || state.time < state.creature.warning.deadline - 1e-8 || state.status !== 'playing') return;
  state.status = 'lost'; state.restoreHeld = false; state.lossReason = 'The creature reached the shelter. Isolation must be used before its final strike.';
  state.notice = 'Watch its distance and manage your isolation cells.'; triggerScare(state, 'breach'); emit(state, 'LOST', 'BREACH'); state.version++;
}
export function updateCaption(state: GameState): void {
  const c = state.creature;
  if (state.status === 'won') state.caption = 'REMOTE SEAL CLOSED — CONTAINMENT COMPLETE';
  else if (state.status === 'lost') state.caption = state.lossReason?.includes('protocol window') ? 'PROTOCOL WINDOW CLOSED' : 'SHELTER BREACHED';
  else if (c.warning) state.caption = 'METAL STRAINING — HEAVY IMPACTS';
  else if (state.quiet?.phase === 'ready') state.caption = 'ISOLATION ENDING — RESTORE WINDOW';
  else if (proximityAlarm(state).active) state.caption = c.lastMotion === 'receding' ? 'PROXIMITY ALARM — MOVEMENT RECEDING' : c.lastMotion === 'approaching' ? 'PROXIMITY ALARM — MOVEMENT CLOSING IN' : 'PROXIMITY ALARM — MOVEMENT STILL CLOSE';
  else if (state.equipment === 'quiet') state.caption = 'EQUIPMENT ISOLATED — LISTEN FOR MOVEMENT';
  else if (c.phase === 'containment') state.caption = 'REMOTE CONTAINMENT SEAL CLOSING';
  else if (c.lastMotion === 'receding') state.caption = 'FOOTSTEPS RECEDING — AWAY FROM SHELTER';
  else if (huntActive(state)) state.caption = 'RUNNING FOOTSTEPS — IT IS CHARGING';
  else if (c.lastMotion === 'approaching') state.caption = c.position[0] < -2 ? 'FOOTSTEPS APPROACHING — LEFT' : c.position[0] > 2 ? 'FOOTSTEPS APPROACHING — RIGHT' : 'FOOTSTEPS APPROACHING — FRONT';
  else if (state.equipment === 'blackout') state.caption = 'POWER LOST — HOLD F TO RESTORE';
  else if (lureProtected(state)) state.caption = 'REMOTE SIGNAL ACTIVE — CREATURE FOLLOWING';
  else state.caption = 'NO NEARBY MOVEMENT';
}
export function cameraVisible(state: GameState, feed: 'A' | 'B' | 'C'): boolean {
  if (state.equipment !== 'on') return false;
  const p = state.creature.linePosition;
  return feed === 'A' ? p >= 7 && p <= 14 : feed === 'B' ? p >= 14 && p <= 22 : p >= 22 && p <= config.line.length;
}
