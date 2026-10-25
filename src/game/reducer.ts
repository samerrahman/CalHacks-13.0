import { config, currentSedation, finite, FIXED_DT, NODES } from './config';
import { cameraVisible, canRestore, commitIfEligible, enterQuiet, proximityAlarm, triggerScare, lureProtected, projectCreature, restoreEquipment, tickCreature, updateCaption, updateClues, updateDanger, updateDistanceSensor, warningRemaining } from './creature';
import { receiveProposal, tickDirector } from './directorValidation';
import { doorKeyFor, friendSignal, playerVoice } from './coop';
import { breathe, connectWire, emptyCalm, emptyLocate, emptyMemory, emptyPulse, emptyRouting, emptyWires, engageRoute, listenToRack, markSector, replayMemory, rotateTile, startStage, tapPulse, taskInput, tickTasks, transmit } from './tasks';
import { emit, random, type GameAction, type GameState, type SensorState } from './state';

export { config, currentSedation, cameraVisible, canRestore, lureProtected, warningRemaining, proximityAlarm };
export function createGame(seed = 17, mode: GameState['mode'] = 'standard'): GameState {
  const safeSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 17;
  const state: GameState = {
    seed: safeSeed, mode, time: 0, status: 'playing', paused: false, version: 0,
    station: 'terminal', cameraFeed: 'A', equipment: 'on',
    danger: config.danger.base, pressure: 0, shutdown: { chargesRemaining: config.shutdown.charges, used: 0, activeUntil: 0, cooldownUntil: 0 },
    tasks: { stage: 1, stageStarted: 0, completedStages: [], faults: { active: [], completed: 0, required: 5, spawned: 0, spawnElapsed: 0, maximumActive: 1, listenFrom: -1000 }, memory: emptyMemory(), wires: emptyWires(), step: 'faults', routing: emptyRouting(), pulse: emptyPulse(), locate: emptyLocate(), calm: emptyCalm(), finalTransmitted: false },
    creature: {
      linePosition: config.line.start, nextMoveAt: config.line.graceSeconds + config.line.stepSeconds, lastStep: 0, tacticBias: 0, biasUntil: 0, nearSince: null, movementRng: (safeSeed ^ 0x9e3779b9) >>> 0, sensorDistance: config.line.start, sensorSampleAt: 0,
      position: [...NODES.NEAR_PATH], node: 'NEAR_PATH', route: [], target: 'NONE', phase: 'search', distance: 12,
      confidence: .25, approachStarted: null, phaseStarted: 0, phaseUntil: 0, recoveryUntil: 0, restoreProtectionUntil: 0,
      lastAudibleAt: -1000, lastAudibleStrength: 0, warning: null, alarmLatched: false, warningStarts: [], lure: null, containmentStarted: null, lastMotion: 'stationary',
    },
    quiet: null, scare: null, scareCount: 0, restoreHeld: false, restoreHold: 0,
    blackout: { count: 0, lastAt: -1000, nextAt: config.blackout.firstEligibleAtSeconds, startedAt: null },
    clues: { machinery: 0, transient: 0, physiology: 0 }, transients: [],
    sensor: { source: 'manual', quality: 'unknown', trend: 'UNKNOWN' }, personal: { restingBpm: null, restingBreathsPerMinute: null }, recovery: { until: 0, rewardedStages: [] }, coop: { warnedAt: -1000, warnings: 0, decoysUsed: 0, lastDecoyAt: -1000, decoyUntil: 0, doorKey: doorKeyFor(safeSeed), doorInput: [], doorUnlocked: false }, voice: { loud: false, since: 0, heardAt: -1000 }, trend: 'UNKNOWN', fixedMemoryTempo: false,
    events: [], eventSequence: 0,
    director: { nextAt: 12, request: null, requestStarted: 0, requestSequence: 0, usedRequestIds: [], lastTactic: 'WAIT', lastTarget: 'NONE', source: 'FALLBACK', lastOutcome: 'LOCAL · ready', lastEvidenceIds: [], fallbackCount: 0, tauntId: 'NONE', lastTauntAt: -1000, tauntCount: 0 },
    notice: '', caption: 'NO NEARBY MOVEMENT', rng: safeSeed, accumulator: 0,
  };
  startStage(state, 1);
  state.blackout.nextAt += Math.floor(random(state) * 10);
  emit(state, 'RUN_STARTED', mode);
  projectCreature(state); updateDanger(state, 0);
  updateClues(state, 0);
  return state;
}
function tickBlackout(state: GameState): void {
  if (state.mode === 'tutorial' || state.equipment !== 'on' || state.blackout.count >= config.blackout.maximumPerRun || state.time < state.blackout.nextAt
    || !config.blackout.eligibleResearchStages.includes(state.tasks.stage) || state.creature.warning || lureProtected(state) || state.quiet || state.tasks.finalTransmitted) return;
  state.equipment = 'blackout'; state.blackout.count++; state.blackout.lastAt = state.time; state.blackout.startedAt = state.time;
  state.blackout.nextAt = state.time + config.blackout.minimumCooldownSeconds + Math.floor(random(state) * 15);
  state.restoreHeld = false; state.restoreHold = 0;
  state.notice = 'Power lost. Research is preserved. Hold F to restore without spending isolation.';
  emit(state, 'BLACKOUT_STARTED'); triggerScare(state, 'monitor'); state.version++;
}
function tick(state: GameState): void {
  state.time += FIXED_DT;
  if (state.restoreHeld && canRestore(state)) {
    state.restoreHold += FIXED_DT;
    if (state.restoreHold >= config.quiet.restoreHoldSeconds - 1e-8) restoreEquipment(state);
  }
  tickTasks(state, FIXED_DT);
  updateDanger(state, FIXED_DT);
  updateClues(state, FIXED_DT);
  tickCreature(state, FIXED_DT);
  if (state.status === 'playing') { tickBlackout(state); tickDirector(state); }
  if (state.mode !== 'tutorial' && state.status === 'playing' && state.time >= config.line.deadlineSeconds - 1e-8) {
    state.status = 'lost'; state.restoreHeld = false; state.lossReason = `The ${Math.round(config.line.deadlineSeconds / 60)}-minute protocol window expired.`; state.notice = 'Release all four basement locks and open the door before the deadline.';
    // Running out of time is still a breach: the app plays the breach scream for every loss, so the face must show too.
    triggerScare(state, 'breach'); emit(state, 'TIMEOUT'); emit(state, 'LOST', 'TIMEOUT'); state.version++;
  }
  updateDistanceSensor(state);
  updateCaption(state);
}
/** Pure deterministic fixed-step simulation. Nothing here awaits a live provider. */
export function step(previous: GameState, dtSeconds: number): GameState {
  if (previous.paused || previous.status !== 'playing' || !finite(dtSeconds) || dtSeconds <= 0) return previous;
  const state = structuredClone(previous);
  state.accumulator += Math.min(dtSeconds, 3600);
  while (state.accumulator >= FIXED_DT - 1e-9 && state.status === 'playing') {
    state.accumulator -= FIXED_DT;
    if (state.accumulator < 0) state.accumulator = 0;
    tick(state);
  }
  return state;
}
/** Calming down is rewarded, once per research stage: it loses your trail for a few seconds.
 * Only an accepted ELEVATED → RECOVERED transition counts; manual play has no equivalent by design. */
function rewardRecovery(state: GameState): void {
  if (state.mode === 'tutorial' || state.status !== 'playing' || state.paused || state.tasks.finalTransmitted) return;
  const stage = state.tasks.stage;
  if (state.recovery.rewardedStages.includes(stage)) return;
  state.recovery.rewardedStages.push(stage);
  state.recovery.until = state.time + config.recovery.durationSeconds;
  state.notice = 'Your pulse settled. It lost your trail for a moment.';
  emit(state, 'RECOVERY_REWARD', String(stage));
}
/** Accepts only rounded values inside the sensing ranges; anything else is neutral. */
function personalChange(state: GameState, restingBpm: unknown, restingBreathsPerMinute: unknown): void {
  const bpm = typeof restingBpm === 'number' && Number.isFinite(restingBpm) && restingBpm >= 40 && restingBpm <= 110 ? Math.round(restingBpm) : null;
  const rpm = typeof restingBreathsPerMinute === 'number' && Number.isFinite(restingBreathsPerMinute) && restingBreathsPerMinute >= 5 && restingBreathsPerMinute <= 40 ? Math.round(restingBreathsPerMinute) : null;
  state.personal = { restingBpm: bpm, restingBreathsPerMinute: rpm };
}
function sensorChange(state: GameState, sensor: SensorState): void {
  const source = ['presage', 'simulated', 'manual'].includes(sensor.source) ? sensor.source : 'manual';
  const quality = ['accepted', 'rejected', 'unknown'].includes(sensor.quality) ? sensor.quality : 'unknown';
  const trend = source !== 'manual' && quality === 'accepted' && ['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'].includes(sensor.trend) ? sensor.trend : 'UNKNOWN';
  if (state.sensor.source === source && state.sensor.quality === quality && state.sensor.trend === trend) return;
  // Brief capture gaps read as UNKNOWN; compare with the last known trend so a glitch can't hide a recovery.
  const lastKnown = [...state.events].reverse().find(event => event.type === 'SENSOR_TREND' && !event.detail.endsWith('trend=UNKNOWN'));
  const calmedDown = trend === 'RECOVERED' && (state.sensor.trend === 'ELEVATED' || state.sensor.trend === 'UNKNOWN' && !!lastKnown?.detail.endsWith('trend=ELEVATED'));
  state.sensor = { source, quality, trend }; state.trend = trend;
  emit(state, 'SENSOR_TREND', `source=${source} quality=${quality} trend=${trend}`);
  if (calmedDown) rewardRecovery(state);
  // It changes model eligibility (near physiology reason), but never a live puzzle's tempo.
  state.version++;
  updateClues(state, 0); updateDanger(state, 0);
}
export function dispatch(previous: GameState, action: GameAction): GameState {
  const state = structuredClone(previous);
  if (action.type === 'sensor') { sensorChange(state, action); return state; }
  if (action.type === 'trend') { sensorChange(state, { ...state.sensor, trend: action.trend }); return state; }
  if (action.type === 'personal') { personalChange(state, action.restingBpm, action.restingBreathsPerMinute); return state; }
  if (action.type === 'accessibility') { state.fixedMemoryTempo = action.fixedMemoryTempo; return state; }
  if (action.type === 'pause') {
    if (state.status !== 'playing') return previous;
    const paused = action.paused ?? !state.paused;
    if (state.paused === paused) return previous;
    state.paused = paused; state.restoreHeld = false; state.restoreHold = 0;
    state.director.request = null; state.director.nextAt = state.time + 1; state.version++;
    emit(state, paused ? 'PAUSED' : 'RESUMED'); return state;
  }
  if (state.paused || state.status !== 'playing') return previous;
  updateClues(state, 0);
  commitIfEligible(state);
  switch (action.type) {
    case 'station':
      if (['terminal', 'cameras', 'equipment'].includes(action.station)) { state.station = action.station; state.restoreHeld = false; state.restoreHold = 0; }
      break;
    case 'camera': if (['A', 'B', 'C'].includes(action.feed)) state.cameraFeed = action.feed; break;
    case 'input': taskInput(state, action.value); break;
    case 'wire': connectWire(state, action.from, action.to); break;
    case 'rotate': rotateTile(state, action.tile); break;
    case 'listen': listenToRack(state); break;
    case 'engage': engageRoute(state); break;
    case 'mark': markSector(state, action.sector); break;
    case 'tap': tapPulse(state); break;
    case 'breathe': breathe(state, action.holding); break;
    case 'friend': friendSignal(state, action.signal); break;
    case 'voice': playerVoice(state, action.loud); break;
    case 'practice-memory': if (state.mode === 'tutorial') startStage(state, 2); break;
    case 'replay': if (state.station === 'terminal') replayMemory(state); break;
    case 'transmit': transmit(state); break;
    case 'quiet': enterQuiet(state); break;
    case 'restore':
      state.restoreHeld = action.held && canRestore(state);
      if (!state.restoreHeld) state.restoreHold = 0;
      break;
    case 'proposal': receiveProposal(state, action.proposal, action.source); break;
  }
  updateClues(state, 0); updateDanger(state, 0); updateDistanceSensor(state); updateCaption(state);
  return state;
}
