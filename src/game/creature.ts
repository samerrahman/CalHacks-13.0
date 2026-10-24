import { clamp, config, currentSedation, EDGES, NODES } from './config';
import { emit, type GameState, type LureTarget, type NodeId, type Target, type Vec3, type TauntId } from './state';

export const distance = (a: Vec3, b: Vec3 = [0, 0, 0]) => Math.hypot(...a.map((v, i) => v - b[i]));
const neighbours = (node: NodeId): NodeId[] => EDGES.flatMap(([a, b]) => a === node ? [b] : b === node ? [a] : []);
/** Dijkstra on the authored physical graph. Returned route excludes the start. */
export function shortestRoute(start: NodeId, end: NodeId): NodeId[] {
  const pending = new Set(Object.keys(NODES) as NodeId[]);
  const costs = new Map<NodeId, number>([[start, 0]]);
  const paths = new Map<NodeId, NodeId[]>([[start, []]]);
  while (pending.size) {
    const node = [...pending].sort((a, b) => (costs.get(a) ?? Infinity) - (costs.get(b) ?? Infinity))[0];
    pending.delete(node);
    if (node === end) return paths.get(node) ?? [];
    for (const next of neighbours(node)) {
      const cost = (costs.get(node) ?? Infinity) + distance(NODES[node], NODES[next]);
      if (cost < (costs.get(next) ?? Infinity)) { costs.set(next, cost); paths.set(next, [...(paths.get(node) ?? []), next]); }
    }
  }
  return [];
}
const pathLength = (start: NodeId, route: NodeId[]): number => {
  let total = 0, previous = start;
  for (const node of route) { total += distance(NODES[previous], NODES[node]); previous = node; }
  return total;
};
/** Reroute through an endpoint of the current edge, preserving physical position. */
export function routeTo(state: GameState, target: NodeId): void {
  const c = state.creature;
  if (distance(c.position, NODES[c.node]) < 1e-7) { c.route = shortestRoute(c.node, target); return; }
  const endpoints = [...new Set([c.node, c.route[0]].filter((n): n is NodeId => Boolean(n)))];
  const choices = endpoints.map(node => {
    const onward = shortestRoute(node, target);
    return { route: [node, ...onward], cost: distance(c.position, NODES[node]) + pathLength(node, onward) };
  }).sort((a, b) => a.cost - b.cost);
  c.route = choices[0]?.route ?? [];
}
export function setPhase(state: GameState, phase: GameState['creature']['phase'], target: Target, seconds = 0): void {
  const c = state.creature;
  if (c.phase !== phase || c.target !== target) {
    c.phase = phase; c.target = target; c.phaseStarted = state.time; state.version++;
  }
  c.phaseUntil = state.time + seconds;
}
export function lureProtected(state: GameState): boolean {
  const lure = state.creature.lure;
  return Boolean(lure && (lure.target === 'CONTAINMENT' || state.time < lure.protectedUntil || lure.arrivedAt === null || state.time < lure.arrivedAt + config.lure.arrivalHoldSeconds));
}
export function applyLure(state: GameState, target: LureTarget): boolean {
  const c = state.creature;
  if (c.warning) return false;
  c.lure = { target, issuedAt: state.time, protectedUntil: Math.max(c.lure?.protectedUntil ?? 0, state.time + config.lure.minimumDiversionSeconds), arrivedAt: null };
  c.warning = null; c.approachStarted = null; c.containmentStarted = null;
  setPhase(state, 'lured', target);
  routeTo(state, target);
  emit(state, 'LURE_TRANSMITTED', target);
  contextualTaunt(state, 'LURE_FOLLOWED');
  state.notice = target === 'CONTAINMENT' ? 'Final signal locked. Track the route to containment.' : `${target === 'EMITTER_A' ? 'Emitter A' : 'Emitter B'} transmitting. Diversion is protected.`;
  state.version++;
  return true;
}
export function enterQuiet(state: GameState): void {
  if (state.equipment === 'quiet') return;
  state.equipment = 'quiet'; state.restoreHeld = false; state.restoreHold = 0;
  if (state.creature.warning) {
    // Power isolation still works electrically, but cannot undo a committed physical strike.
    state.quiet = null; state.transients = []; state.clues = { machinery: 0, transient: 0, physiology: 0 };
    state.notice = 'Isolation relay disengaged.';
    emit(state, 'QUIET_ENTERED'); state.version++; return;
  }
  state.quiet = { phase: 'listening', started: state.time, retreatStarted: null, movedAway: false };
  state.transients = []; state.clues = { machinery: 0, transient: 0, physiology: 0 };
  const c = state.creature;
  c.warning = null; c.approachStarted = null;
  c.recoveryUntil = Math.max(c.recoveryUntil, state.time + config.threat.minimumRecoverySeconds);
  if (!lureProtected(state)) { setPhase(state, 'listen', 'NONE', config.quiet.listeningSeconds); }
  emit(state, 'QUIET_ENTERED');
  contextualTaunt(state, 'MACHINES_QUIET');
  state.notice = 'Emergency QUIET. Research preserved. Listen for the restore window.';
  state.version++;
}
export function canRestore(state: GameState): boolean {
  return state.equipment === 'quiet' && state.quiet?.phase === 'ready';
}
export function restoreEquipment(state: GameState): void {
  if (state.equipment === 'on') return;
  if (state.creature.warning) { state.restoreHeld = false; state.restoreHold = 0; return; }
  const safe = canRestore(state);
  state.equipment = 'on'; state.quiet = null; state.restoreHeld = false; state.restoreHold = 0;
  state.blackout.startedAt = null;
  const c = state.creature;
  c.warning = null; c.approachStarted = null;
  if (safe) c.restoreProtectionUntil = state.time + config.quiet.restoreProtectionSeconds;
  c.recoveryUntil = Math.max(c.recoveryUntil, state.time + (safe ? 2 : 0));
  if (!lureProtected(state)) { setPhase(state, 'search', 'NONE'); c.route = []; }
  state.transients.push({ at: state.time, strength: config.quiet.startupSoundStrength, duration: config.quiet.startupSoundDecaySeconds });
  emit(state, 'RESTORED', safe ? 'CLEAR' : 'EARLY');
  state.notice = safe ? 'Power restored. Six seconds of protected restart. Listen for the proximity alarm.' : 'Early restart. The approach is active again. Isolate before it reaches the wall.';
  state.version++;
}
export function warningRemaining(state: GameState): number | null {
  return state.creature.warning ? Math.max(0, state.creature.warning.deadline - state.time) : null;
}
export function updateClues(state: GameState, dt: number): void {
  const c = state.creature;
  const machinery = state.equipment === 'quiet' ? 0 : Math.min(config.tasks.maxFaultNoise, state.tasks.faults.active.length * (state.equipment === 'blackout' ? config.tasks.blackoutResidualNoisePerActive : config.tasks.faultNoisePerActive));
  state.transients = state.transients.filter(s => state.time - s.at < s.duration);
  const transient = state.equipment === 'quiet' ? 0 : Math.min(1, state.transients.reduce((sum, s) => sum + s.strength * clamp(1 - (state.time - s.at) / s.duration), 0));
  const physiology = state.equipment !== 'quiet' && c.distance <= config.threat.nearPhysiologyRangeM && state.sensor.quality === 'accepted' && state.sensor.source !== 'manual' && state.sensor.trend === 'ELEVATED' ? config.threat.maximumPhysiologyClue : 0;
  state.clues = { machinery, transient, physiology };
  const audible = c.distance <= config.threat.audibleRangeM;
  if (audible && Math.max(machinery, transient) >= config.threat.audibleEvidenceMinimumStrength) {
    c.lastAudibleAt = state.time; c.lastAudibleStrength = Math.max(machinery, transient);
  }
  if (state.equipment === 'quiet') {
    if (state.quiet?.phase !== 'listening') c.confidence = clamp(c.confidence - config.threat.quietConfidenceDecayPerSecond * dt);
  } else {
    const gain = (audible ? machinery * config.threat.confidenceMachineryPerSecond + transient * config.threat.confidenceTransientPerSecond : 0) + physiology * config.threat.confidencePhysiologyPerSecond;
    c.confidence = clamp(c.confidence + (gain > 0 ? gain : -config.threat.ordinaryConfidenceDecayPerSecond) * dt);
  }
}
function move(state: GameState, dt: number, speed: number): void {
  const c = state.creature, oldDistance = c.distance;
  let remaining = speed * dt;
  while (remaining > 1e-9 && c.route.length) {
    const next = c.route[0], goal = NODES[next], length = distance(c.position, goal);
    if (length <= remaining + 1e-9) {
      c.position = [...goal]; c.node = next; c.route.shift(); remaining -= length;
    } else {
      c.position = c.position.map((value, i) => value + (goal[i] - value) * remaining / length) as Vec3;
      remaining = 0;
    }
  }
  c.distance = distance(c.position);
  c.lastMotion = c.distance < oldDistance - 1e-7 ? 'approaching' : c.distance > oldDistance + 1e-7 ? 'receding' : c.route.length ? 'circling' : 'stationary';
  if (state.quiet && c.lastMotion === 'receding') state.quiet.movedAway = true;
}
export function beginApproach(state: GameState): void {
  const c = state.creature;
  if (c.warning) return;
  if (c.approachStarted === null) { c.approachStarted = state.time; emit(state, 'APPROACH', 'SHELTER'); }
  setPhase(state, 'approach', 'SHELTER'); routeTo(state, 'SHELTER_WALL');
}
export function tickCreature(state: GameState, dt: number): void {
  const c = state.creature;
  if (c.warning) { c.lastMotion = 'stationary'; c.alarmLatched = true; finishCommittedAttack(state); return; }
  const protectedLure = lureProtected(state);
  if (protectedLure && c.lure) {
    if (c.phase !== 'lured' && c.phase !== 'containment') { setPhase(state, 'lured', c.lure.target); routeTo(state, c.lure.target); }
    move(state, dt, currentSedation(state).searchSpeedMps);
    if (!c.route.length && c.node === c.lure.target && c.lure.arrivedAt === null) {
      c.lure.arrivedAt = state.time;
      emit(state, 'LURE_ARRIVED', c.lure.target); state.version++;
      if (c.lure.target === 'CONTAINMENT') { c.containmentStarted = state.time; setPhase(state, 'containment', 'CONTAINMENT'); }
    }
    if (c.containmentStarted !== null && state.time - c.containmentStarted >= config.tasks.stage5.sealSeconds - 1e-8) {
      state.status = 'won'; state.tasks.stage = 6; c.route = []; state.restoreHeld = false;
      state.notice = 'Containment sealed. Research recovered. You made it through.';
      emit(state, 'WON'); state.version++;
    }
  } else {
    if (c.lure) { c.lure = null; c.approachStarted = null; setPhase(state, 'search', 'NONE'); emit(state, 'LURE_RELEASED'); state.version++; }
    if (state.equipment === 'quiet' && state.quiet) {
      const quiet = state.quiet;
      if (state.time - quiet.started >= config.quiet.listeningSeconds - 1e-8 && quiet.phase === 'listening') {
        quiet.phase = 'retreat'; quiet.retreatStarted = state.time;
        setPhase(state, 'retreat', 'NONE');
        if (c.distance < config.quiet.restoreClearDistanceM - 1e-7) routeTo(state, 'NEAR_PATH');
        else c.route = [];
        emit(state, 'QUIET_RETREAT'); state.version++;
      }
      if (quiet.phase !== 'listening') move(state, dt, config.quiet.retreatSpeedMps);
      else c.lastMotion = 'stationary';
    } else {
      // A local boundary rule keeps offline play moving while a provider is pending.
      // No provider result is required to investigate fresh, audible equipment.
      if ((c.phase === 'search' || c.phase === 'listen' && state.time >= c.phaseUntil || c.phase === 'retreat' && !c.route.length || c.phase === 'circle' && !c.route.length)
        && state.time >= c.recoveryUntil && state.time >= c.phaseUntil) {
        if (c.distance <= config.threat.audibleRangeM && state.time - c.lastAudibleAt <= config.threat.audibleEvidenceFreshSeconds) beginApproach(state);
        else { setPhase(state, 'search', 'NONE', 2); c.lastMotion = 'stationary'; }
      }
      if (c.phase === 'approach' || c.phase === 'circle' || c.phase === 'retreat') move(state, dt, currentSedation(state).searchSpeedMps);
      else c.lastMotion = 'stationary';
    }
  }
  // Quiet observation time still advances when a protected remote lure is moving.
  if (state.quiet) {
    const quiet = state.quiet;
    if (quiet.phase === 'listening' && state.time - quiet.started >= config.quiet.listeningSeconds - 1e-8) {
      quiet.phase = 'retreat'; quiet.retreatStarted = state.time; state.version++;
    }
    if (quiet.phase === 'retreat' && quiet.retreatStarted !== null && state.time - quiet.retreatStarted >= config.quiet.retreatMinimumSeconds - 1e-8 && c.distance >= config.quiet.restoreClearDistanceM - 1e-7) {
      quiet.phase = 'ready'; emit(state, 'RESTORE_WINDOW'); state.notice = 'Restore window. Hold F for one second when ready.'; state.version++;
    }
  }
  if (state.status !== 'playing') return;
  updateAlarm(state);
  commitIfEligible(state);
  finishCommittedAttack(state);
}
/** Exact physical alarm with hysteresis; isolation never falsifies proximity. */
export function proximityAlarm(state: GameState): { active: boolean; urgency: number } {
  const c = state.creature;
  const active = state.mode !== 'tutorial' && state.status === 'playing' && Boolean(c.warning || c.alarmLatched);
  return { active, urgency: active ? c.warning ? 1 : clamp((config.alarm.clearDistanceM - c.distance) / (config.alarm.clearDistanceM - config.threat.wallRangeM), .1, 1) : 0 };
}
export function triggerScare(state: GameState, kind: 'impact' | 'monitor' | 'breach'): void {
  if (state.mode === 'tutorial') return;
  if (kind !== 'breach' && (state.scareCount >= config.scares.maximumNonfatalPerRun || state.scare && state.time - state.scare.at < config.scares.minimumGapSeconds)) return;
  state.scare = { id: (state.scare?.id ?? 0) + 1, at: state.time, kind };
  if (kind !== 'breach') state.scareCount++;
  emit(state, 'SCARE', kind);
}
export function contextualTaunt(state: GameState, id: TauntId): boolean {
  if (state.mode === 'tutorial' || state.status !== 'playing' || state.creature.warning || state.creature.distance > 10
    || state.director.tauntCount >= 7 || state.time - state.director.lastTauntAt < 25) return false;
  const valid = id === 'AFTER_MISTAKE' && state.events.some(e => e.type === 'WRONG_INPUT' && state.time - e.time <= 30)
    || id === 'MACHINES_QUIET' && state.equipment === 'quiet'
    || id === 'HEARD_RHYTHM' && state.clues.physiology > 0
    || id === 'LURE_FOLLOWED' && lureProtected(state);
  if (!valid) return false;
  state.director.lastTauntAt = state.time; state.director.tauntCount++; state.director.tauntId = id;
  emit(state, 'TAUNT', id); return true;
}
function updateAlarm(state: GameState): void {
  const c = state.creature;
  if (state.mode === 'tutorial') { c.alarmLatched = false; return; }
  if (c.alarmLatched && c.distance >= config.alarm.clearDistanceM && !c.warning) c.alarmLatched = false;
  if (!c.alarmLatched && c.phase === 'approach' && c.distance <= config.alarm.enterDistanceM && c.lastMotion === 'approaching') {
    c.alarmLatched = true;
    emit(state, 'PROXIMITY_ALARM');
    triggerScare(state, state.station === 'cameras' ? 'monitor' : 'impact');
    contextualTaunt(state, 'HEARD_RHYTHM');
  }
}
/** Rechecked before player/model actions so a boundary input cannot erase commitment. */
export function commitIfEligible(state: GameState): void {
  const c = state.creature, band = currentSedation(state);
  c.warningStarts = c.warningStarts.filter(time => state.time - time < 60);
  if (c.warning || state.mode === 'tutorial' || state.status !== 'playing' || state.equipment === 'quiet' || lureProtected(state)
    || c.phase !== 'approach' || c.approachStarted === null || c.distance > config.threat.wallRangeM
    || state.time - c.approachStarted < band.minimumApproachSeconds
    || c.confidence < config.threat.warningConfidenceMinimum
    || state.time - c.lastAudibleAt > config.threat.audibleEvidenceFreshSeconds
    || c.lastAudibleStrength < config.threat.audibleEvidenceMinimumStrength
    || state.time < c.recoveryUntil || state.time < c.restoreProtectionUntil
    || c.warningStarts.length >= config.threat.maximumWarningsPerMinute) return;
  c.warning = { started: state.time, duration: band.warningSeconds, deadline: state.time + band.warningSeconds };
  c.warningStarts.push(state.time); c.alarmLatched = true;
  setPhase(state, 'breach', 'SHELTER'); c.route = []; c.lastMotion = 'stationary';
  emit(state, 'ATTACK_COMMITTED'); state.version++;
}
function finishCommittedAttack(state: GameState): void {
  const c = state.creature;
  if (!c.warning || state.time < c.warning.deadline - 1e-8 || state.status !== 'playing') return;
  state.status = 'lost'; state.restoreHeld = false;
  state.lossReason = 'The creature reached the wall before isolation. Once its strike committed, cutting power could not stop it.';
  state.notice = 'Isolate earlier, while the proximity alarm is approaching.';
  triggerScare(state, 'breach'); emit(state, 'LOST', 'BREACH'); state.version++;
}
export function updateCaption(state: GameState): void {
  const c = state.creature;
  if (state.status === 'won') state.caption = 'REMOTE SEAL CLOSED — CONTAINMENT COMPLETE';
  else if (state.status === 'lost') state.caption = 'SHELTER BREACHED';
  else if (c.warning) state.caption = 'METAL STRAINING — HEAVY IMPACTS';
  else if (state.quiet?.phase === 'ready') state.caption = state.quiet.movedAway ? 'FOOTSTEPS RECEDING — RESTORE WINDOW' : 'NO NEARBY MOVEMENT — RESTORE WINDOW';
  else if (proximityAlarm(state).active) state.caption = c.lastMotion === 'receding' ? 'PROXIMITY ALARM — MOVEMENT RECEDING' : c.lastMotion === 'approaching' ? 'PROXIMITY ALARM — MOVEMENT CLOSING IN' : 'PROXIMITY ALARM — MOVEMENT STILL CLOSE';
  else if (state.quiet?.phase === 'listening') state.caption = c.distance <= 8 ? 'CLOSE BREATHING — LISTENING OUTSIDE' : 'NO NEARBY MOVEMENT — OBSERVING';
  else if (c.phase === 'containment') state.caption = 'REMOTE CONTAINMENT SEAL CLOSING';
  else if (c.lastMotion === 'receding' && c.distance <= 32) state.caption = 'FOOTSTEPS RECEDING — AWAY FROM SHELTER';
  else if (c.lastMotion === 'approaching' && c.distance <= 32) state.caption = c.position[0] < -2 ? 'FOOTSTEPS APPROACHING — LEFT' : c.position[0] > 2 ? 'FOOTSTEPS APPROACHING — RIGHT' : 'FOOTSTEPS APPROACHING — FRONT';
  else if (c.distance <= 4.2) state.caption = 'CLOSE BREATHING — AT THE SHELTER WALL';
  else if (state.equipment === 'blackout') state.caption = 'POWER LOST — Q REMAINS AVAILABLE';
  else if (lureProtected(state)) state.caption = 'REMOTE SIGNAL ACTIVE — CREATURE FOLLOWING';
  else state.caption = 'NO NEARBY MOVEMENT';
}
/** CCTV edge visibility, never an independently randomized monster. */
export function cameraVisible(state: GameState, feed: 'A' | 'B' | 'C'): boolean {
  if (state.equipment !== 'on') return false;
  const edges: Record<typeof feed, [NodeId, NodeId]> = { A: ['JUNCTION', 'EMITTER_A'], B: ['JUNCTION', 'EMITTER_B'], C: ['EMITTER_B', 'CONTAINMENT'] };
  const [a, b] = edges[feed], p = state.creature.position;
  return Math.abs(distance(NODES[a], p) + distance(p, NODES[b]) - distance(NODES[a], NODES[b])) < 1e-4;
}
