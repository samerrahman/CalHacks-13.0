import { retreat, sweep, tickCreature } from './creature';
import { applyDirectorProposal, tickEncounters } from './encounters';
import { emit, random, type GameAction, type GameState } from './state';
import { cancelHold, tickTasks } from './tasks';
import { authenticate, inspectCall, issueCall, makeOrder, rejectCall } from './verification';
import { MARA_DIALOGUE } from './dialogue';

export { buildDirectorRequest, applyDirectorProposal } from './encounters';
export type { GameAction, GameState } from './state';

function clone(state: GameState): GameState {
  return {
    ...state, doors: { ...state.doors }, tasks: { ...state.tasks, dials: [...state.tasks.dials], targets: [...state.tasks.targets], bars: [...state.tasks.bars], barTargets: [...state.tasks.barTargets] },
    creature: { ...state.creature, attacks: [...state.creature.attacks] }, safeUntil: { ...state.safeUntil },
    call: state.call ? { ...state.call, evidence: [...state.call.evidence] } : null,
    privateChallenge: { ...state.privateChallenge }, order: { ...state.order }, orderHistory: [...state.orderHistory], events: [...state.events],
    director: { ...state.director, usedRequestIds: [...state.director.usedRequestIds], lastEvidenceIds: [...state.director.lastEvidenceIds] },
  };
}

export function createGame(seed: number, mode: 'shift' | 'demo' = 'shift'): GameState {
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) : 17;
  const state: GameState = {
    seed: normalizedSeed, mode, time: 0, deadline: mode === 'demo' ? 120 : 300, status: 'playing', paused: false, version: 1,
    station: 'console', doors: { left: false, right: true }, energy: 100, blackoutRemaining: null,
    tasks: { stage: 1, dials: [0, 0, 0], targets: [2, 4, 6], sync: 0, cartridgeHold: 0, insertHold: 0, hasCartridge: false, inserted: false, bars: [0, 0], barTargets: [3, 7], upload: 0, uploadCheckpoint: 0, stageStarted: 0 },
    creature: { phase: 'dormant', side: null, phaseStarted: 0, recoveryUntil: 0, lastSide: null, dormantSince: -8, attacks: [] },
    safeUntil: { left: 0, right: 0 }, sweepReadyAt: 0, call: null,
    privateChallenge: { prompt: '', answer: '', previousAnswer: '', generation: 0 },
    order: { id: '', action: 'SYNC_CARRIER', instructions: '' }, orderHistory: [], events: [], eventSequence: 0,
    director: { nextAt: 12, request: null, requestStarted: 0, requestSequence: 0, usedRequestIds: [], lastTactic: 'WAIT', source: 'FALLBACK', lastOutcome: 'AUTHORED / OFFLINE', lastEvidenceIds: [], fallbackCount: 0 },
    trend: 'UNKNOWN', holding: false, notice: `Match the carrier targets. ${MARA_DIALOGUE.power}`,
    inspected: false, fakeDelivered: false, fakeRejected: 0, verifiedCalls: 0, rng: normalizedSeed >>> 0,
  };
  state.tasks.targets = Array.from({ length: 3 }, () => Math.floor(random(state) * 8) + 1);
  state.tasks.barTargets = Array.from({ length: 2 }, () => Math.floor(random(state) * 8) + 1);
  state.order = makeOrder(state);
  emit(state, 'SHIFT_STARTED', `${mode} shift started; deadline ${state.deadline} seconds. Sensing neutral until accepted trend.`);
  issueCall(state);
  return state;
}

export function dispatch(previous: GameState, action: GameAction): GameState {
  if (previous.status !== 'playing') return previous;
  const state = clone(previous);
  if (action.type === 'pause') {
    state.paused = action.paused ?? !state.paused;
    cancelHold(state);
    if (!state.paused) state.trend = 'UNKNOWN';
    emit(state, state.paused ? 'PAUSED' : 'RESUMED', state.paused ? 'Game clock stopped.' : 'Game resumed. Sensor freshness must be re-established.');
    return state;
  }
  if (state.paused && action.type !== 'trend') return previous;
  if (action.type === 'station') { cancelHold(state); state.station = action.station; }
  else if (action.type === 'door') {
    state.doors[action.side] = action.open ?? !state.doors[action.side];
    state.version++;
    emit(state, 'DOOR', `${action.side} shutter ${state.doors[action.side] ? 'open' : 'closed'}.`);
  } else if (action.type === 'dial') {
    if (state.tasks.stage === 1 && Number.isInteger(action.index) && action.index >= 0 && action.index < 3 && Number.isInteger(action.value) && action.value >= 0 && action.value <= 9) state.tasks.dials[action.index] = action.value;
  } else if (action.type === 'bar') {
    if (state.tasks.stage === 3 && Number.isInteger(action.index) && action.index >= 0 && action.index < 2 && Number.isInteger(action.value) && action.value >= 0 && action.value <= 9) state.tasks.bars[action.index] = action.value;
  } else if (action.type === 'interact') {
    if (!action.held) cancelHold(state);
    else {
      state.holding = true;
      if (state.tasks.stage === 2 && state.station === 'left' && state.time >= state.safeUntil.left) state.notice = 'Sweep LEFT first. Collection requires a confirmed clear window.';
      if (state.tasks.stage === 3 && state.time >= state.safeUntil.right) state.notice = 'Sweep RIGHT first. Upload requires a confirmed clear window.';
    }
  } else if (action.type === 'sweep') sweep(state, action.side);
  else if (action.type === 'authenticate') authenticate(state);
  else if (action.type === 'inspect') inspectCall(state);
  else if (action.type === 'reject') rejectCall(state);
  else if (action.type === 'proposal') applyDirectorProposal(state, action.proposal, action.source);
  else if (action.type === 'trend') {
    if (state.trend !== action.trend) {
      state.trend = action.trend;
      emit(state, 'SENSOR_TREND', `Quality-gated trend: ${action.trend}.`);
      if (action.trend === 'ELEVATED') {
        state.creature.recoveryUntil = Math.max(state.creature.recoveryUntil, state.time + 20);
        state.notice = `Mara: ${MARA_DIALOGUE.recover}`;
      }
    }
  }
  return state;
}

function tickPower(state: GameState, dt: number): void {
  const closed = Number(!state.doors.left) + Number(!state.doors.right);
  const rate = closed === 2 ? -0.75 : closed === 1 ? -0.2 : 0.35;
  const oldEnergy = state.energy;
  state.energy = Math.max(0, Math.min(100, state.energy + rate * dt));
  if (closed === 0 && state.blackoutRemaining !== null) {
    state.blackoutRemaining = null;
    state.notice = 'Both shutters open: power recovering. The station grants a quiet recovery window.';
    emit(state, 'POWER_RECOVERED', 'Both shutters opened. Outage countdown cancelled.');
  } else if (state.energy === 0) {
    if (state.blackoutRemaining === null) {
      const zeroDuringStep = rate < 0 ? Math.max(0, dt - oldEnergy / -rate) : dt;
      state.blackoutRemaining = 8 - zeroDuringStep;
      if (state.creature.phase === 'approach' || state.creature.phase === 'threshold') retreat(state, 'Station outage grace suspends physical pressure.');
      state.notice = 'POWER DEPLETED — open BOTH shutters within eight seconds to restore the station.';
      emit(state, 'POWER_WARNING', 'Power depleted. Eight-second outage grace; open both shutters.');
    } else state.blackoutRemaining = Math.max(0, state.blackoutRemaining - dt);
    if (state.blackoutRemaining <= 1e-8) {
      state.blackoutRemaining = 0; state.status = 'lost'; state.holding = false;
      state.lossReason = 'Station outage. Both shutters needed to open during the eight-second power warning.';
      emit(state, 'SHIFT_LOST', 'Station outage after eight-second recovery warning.');
    }
  }
}

export function step(previous: GameState, dtSeconds: number): GameState {
  if (previous.paused || previous.status !== 'playing' || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return previous;
  const state = clone(previous);
  let remaining = Math.min(dtSeconds, 3600);
  while (remaining > 1e-9 && state.status === 'playing') {
    const dt = Math.min(0.05, remaining);
    state.time = Math.round((state.time + dt) * 1e9) / 1e9; remaining -= dt;
    tickPower(state, dt);
    if (state.status !== 'playing') break;
    tickCreature(state);
    if (state.status !== 'playing') break;
    tickTasks(state, dt);
    if (state.status !== 'playing') break;
    tickEncounters(state);
    if (state.time >= state.deadline - 1e-8) {
      state.time = state.deadline; state.status = 'lost'; state.holding = false;
      state.lossReason = 'Shift deadline reached before all three operations were complete.';
      emit(state, 'SHIFT_LOST', 'Shift deadline reached without all three task completions.');
    }
  }
  return state;
}
