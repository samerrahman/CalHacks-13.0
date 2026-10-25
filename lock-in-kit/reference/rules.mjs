// Pure reference utilities, not a finished game or application scaffold.
// Node >=22; no packages, rendering, provider calls, credentials or persistent data.
import config from '../design/config.json' with { type: 'json' };
import proposalSchema from './director.schema.json' with { type: 'json' };
export { config };
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const validTime = value => { if (!finite(value) || value < 0) throw new Error('Invalid finite nonnegative time'); };

export function sedationAt(gameMs) {
  if (!finite(gameMs) || gameMs < 0) throw new Error('Invalid game time');
  return [...config.sedation].reverse().find(band => gameMs >= band.fromSeconds * 1000);
}

export function acceptedPulse(sample, nowMs, allowSimulated = false) {
  // This consumes the verified native adapter's quality decision; confidence is
  // intentionally not reinterpreted as a universal scale in this neutral utility.
  if (!sample || sample.quality !== 'accepted' || !(sample.source === 'presage' || allowSimulated && sample.source === 'simulated')) return null;
  const age = nowMs - sample.receivedMonotonicMs;
  if (!finite(age) || age < 0 || age > config.sensor.freshnessMs) return null;
  if (sample.measuredMonotonicMs !== null && (!finite(sample.measuredMonotonicMs) || nowMs - sample.measuredMonotonicMs > config.sensor.freshnessMs || sample.measuredMonotonicMs > nowMs + 1000)) return null;
  const pulse = sample.pulseBpm;
  return finite(pulse) && pulse >= config.sensor.pulseRangeBpm[0] && pulse <= config.sensor.pulseRangeBpm[1] ? pulse : null;
}

export function baselineFrom(samples, captureStartedMs, allowSimulated = false) {
  // Conservative reference: require a continuous usable 30-second span after warmup.
  // Production may accumulate disjoint accepted spans, but must not count gaps.
  const usable = samples.filter(s => s.receivedMonotonicMs >= captureStartedMs + config.sensor.warmupSeconds * 1000).sort((a, b) => a.receivedMonotonicMs - b.receivedMonotonicMs);
  let run = [];
  for (const sample of usable) {
    if (acceptedPulse(sample, sample.receivedMonotonicMs, allowSimulated) === null) { run = []; continue; }
    if (run.length && (sample.receivedMonotonicMs <= run.at(-1).receivedMonotonicMs || sample.receivedMonotonicMs - run.at(-1).receivedMonotonicMs > config.sensor.maximumAcceptedGapMs)) run = [];
    run.push(sample);
    if (run.at(-1).receivedMonotonicMs - run[0].receivedMonotonicMs >= config.sensor.baselineAcceptedSeconds * 1000) {
      const values = run.map(s => s.pulseBpm).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    }
  }
  return null;
}

export function pulseTrend(samples, baselineBpm, nowMs, previous = { trend: 'UNKNOWN', changedAtMs: -Infinity }, allowSimulated = false) {
  if (!finite(baselineBpm)) return { trend: 'UNKNOWN', changedAtMs: nowMs };
  const ordered = samples.filter(s => s.receivedMonotonicMs <= nowMs).sort((a, b) => a.receivedMonotonicMs - b.receivedMonotonicMs);
  const anchor = ordered.findLastIndex(s => s.receivedMonotonicMs <= nowMs - config.sensor.trendWindowSeconds * 1000);
  const recent = anchor < 0 ? [] : ordered.slice(anchor);
  if (recent.length < 4 || nowMs - recent[0].receivedMonotonicMs < 12000 || acceptedPulse(recent.at(-1), nowMs, allowSimulated) === null) return { trend: 'UNKNOWN', changedAtMs: nowMs };
  for (let i = 0; i < recent.length; i++) {
    if (acceptedPulse(recent[i], recent[i].receivedMonotonicMs, allowSimulated) === null || i && recent[i].receivedMonotonicMs - recent[i - 1].receivedMonotonicMs > config.sensor.maximumAcceptedGapMs) return { trend: 'UNKNOWN', changedAtMs: nowMs };
  }
  const deltas = recent.map(s => s.pulseBpm - baselineBpm);
  const elevated = deltas.every(d => d >= config.sensor.elevatedDeltaBpm);
  const recovered = deltas.every(d => d < config.sensor.recoveredDeltaBpm);
  let next = elevated ? 'ELEVATED' : recovered && previous.trend === 'ELEVATED' ? 'RECOVERED' : recovered ? 'STEADY' : previous.trend === 'ELEVATED' ? 'ELEVATED' : 'STEADY';
  if (previous.trend !== 'UNKNOWN' && nowMs - previous.changedAtMs < config.sensor.minimumStateDwellSeconds * 1000) next = previous.trend;
  return { trend: next, changedAtMs: next === previous.trend ? previous.changedAtMs : nowMs };
}

export function physiologyClue({ trend, quality, distanceM, quiet = false }) {
  return !quiet && quality === 'accepted' && trend === 'ELEVATED' && finite(distanceM) && distanceM >= 0 && distanceM <= config.threat.nearPhysiologyRangeM ? config.threat.maximumPhysiologyClue : 0;
}

export function machineryNoise(activeFaults, { quiet = false, blackout = false } = {}) {
  if (!Number.isInteger(activeFaults) || activeFaults < 0 || activeFaults > 2) throw new Error('At most two authored faults may be active');
  if (quiet) return 0;
  return Math.min(config.tasks.maxFaultNoise, activeFaults * (blackout ? config.tasks.blackoutResidualNoisePerActive : config.tasks.faultNoisePerActive));
}

export function confidenceAfter(confidence, clues = {}, dtSeconds, { quiet = false, listening = false } = {}) {
  if (!finite(confidence) || !finite(dtSeconds) || dtSeconds < 0) throw new Error('Invalid confidence integration');
  if (quiet) return listening ? clamp(confidence) : clamp(confidence - config.threat.quietConfidenceDecayPerSecond * dtSeconds);
  const machinery = finite(clues.machinery) ? clamp(clues.machinery) : 0, transient = finite(clues.transient) ? clamp(clues.transient) : 0, physiology = finite(clues.physiology) ? clamp(clues.physiology, 0, config.threat.maximumPhysiologyClue) : 0;
  const rate = machinery * config.threat.confidenceMachineryPerSecond + transient * config.threat.confidenceTransientPerSecond + physiology * config.threat.confidencePhysiologyPerSecond;
  return clamp(confidence + (rate || -config.threat.ordinaryConfidenceDecayPerSecond) * dtSeconds);
}

export function distanceToShelter(position) {
  if (!Array.isArray(position) || position.length !== 3 || position.some(n => !finite(n))) throw new Error('Invalid physical position');
  return Math.hypot(position[0], position[2]);
}

export function createRoute(path) {
  if (!Array.isArray(path) || path.length < 1 || path.some(node => !Object.hasOwn(config.graph.nodes, node))) throw new Error('Unknown graph node');
  for (let i = 1; i < path.length; i++) if (!config.graph.edges.some(([a, b]) => a === path[i - 1] && b === path[i] || b === path[i - 1] && a === path[i])) throw new Error('Nonadjacent route: teleport forbidden');
  return { path: [...path], segment: 0, offsetM: 0, position: [...config.graph.nodes[path[0]]], arrived: path.length === 1 };
}

export function advanceRoute(route, dtSeconds, speedMps) {
  if (!finite(dtSeconds) || dtSeconds < 0 || !finite(speedMps) || speedMps < 0 || speedMps > 1.5) throw new Error('Invalid bounded movement');
  const result = { ...route, path: [...route.path], position: [...route.position] };
  let remaining = dtSeconds * speedMps;
  while (!result.arrived && remaining > 0) {
    const a = config.graph.nodes[result.path[result.segment]], b = config.graph.nodes[result.path[result.segment + 1]];
    const length = Math.hypot(...a.map((n, i) => b[i] - n));
    const travel = Math.min(remaining, length - result.offsetM);
    remaining -= travel; result.offsetM += travel;
    result.position = a.map((n, i) => n + (b[i] - n) * result.offsetM / length);
    if (result.offsetM >= length - 1e-9) { result.segment++; result.offsetM = 0; result.arrived = result.segment >= result.path.length - 1; }
  }
  return result;
}

export function lureReward(nowMs, target) {
  validTime(nowMs);
  if (!['EMITTER_A', 'EMITTER_B', 'CONTAINMENT'].includes(target)) throw new Error('Illegal earned target');
  return { target, issuedAtMs: nowMs, protectedUntilGameMs: nowMs + config.lure.minimumDiversionSeconds * 1000, arrivedAtMs: null, sealedAtMs: null };
}
export function applyEarnedLure(state, nowMs, target) {
  const lure = lureReward(nowMs, target);
  lure.protectedUntilGameMs = Math.max(lure.protectedUntilGameMs, state.lure?.protectedUntilGameMs ?? 0);
  // Call only after an earned, idempotently committed transmission. The scene
  // then derives a continuous legal outward route from the current position.
  return { ...state, lure, warning: null, approachStartedMs: null, mode: 'DIVERTED' };
}
export function markLureArrival(lure, actualNode, nowMs) {
  validTime(nowMs);
  if (actualNode !== lure.target || nowMs < lure.issuedAtMs) throw new Error('Arrival must match actual graph state');
  return { ...lure, arrivedAtMs: nowMs };
}
export function lureProtected(lure, nowMs) {
  if (!lure) return false;
  if (lure.target === 'CONTAINMENT') return lure.sealedAtMs === null;
  return nowMs < lure.protectedUntilGameMs || lure.arrivedAtMs === null || nowMs < lure.arrivedAtMs + config.lure.arrivalHoldSeconds * 1000;
}
export function containmentWon(completedStages, lure, nowMs) {
  return completedStages === 4 && lure?.target === 'CONTAINMENT' && finite(lure.arrivedAtMs) && nowMs - lure.arrivedAtMs >= config.tasks.stage5.sealSeconds * 1000;
}

export function enterQuiet(state, nowMs) {
  validTime(nowMs);
  if (state.quiet) return state;
  return { ...state, quiet: true, quietSinceMs: nowMs, warning: null, approachStartedMs: null, mode: lureProtected(state.lure, nowMs) ? 'DIVERTED' : 'QUIET_LISTEN' };
}
export function quietPhase(state, nowMs) {
  if (!state.quiet || !finite(state.quietSinceMs)) return 'ACTIVE';
  const elapsed = nowMs - state.quietSinceMs;
  if (elapsed < config.quiet.listeningSeconds * 1000) return 'LISTENING';
  if (elapsed >= (config.quiet.listeningSeconds + config.quiet.retreatMinimumSeconds) * 1000 && distanceToShelter(state.position) >= config.quiet.restoreClearDistanceM) return 'CLEAR';
  return 'RETREATING';
}
export function restoreEquipment(state, nowMs, heldMs) {
  validTime(nowMs); validTime(heldMs);
  if ((!state.quiet && !state.blackout) || heldMs < config.quiet.restoreHoldSeconds * 1000) return state;
  const safe = quietPhase(state, nowMs) === 'CLEAR';
  return { ...state, quiet: false, blackout: false, quietSinceMs: null, warning: null, approachStartedMs: nowMs, mode: lureProtected(state.lure, nowMs) ? 'DIVERTED' : 'SEARCH', restoreProtectedUntilMs: safe ? nowMs + config.quiet.restoreProtectionSeconds * 1000 : nowMs, startupNoise: config.quiet.startupSoundStrength };
}

function protectedNow(state, nowMs) {
  return state.quiet || lureProtected(state.lure, nowMs) || nowMs < (state.restoreProtectedUntilMs ?? 0) || nowMs < (state.recoveryUntilMs ?? 0);
}
function hasAudibleEvidence(state, nowMs) {
  return finite(state.lastAudibleEvidenceAtMs) && nowMs >= state.lastAudibleEvidenceAtMs && nowMs - state.lastAudibleEvidenceAtMs <= config.threat.audibleEvidenceFreshSeconds * 1000 && finite(state.lastAudibleStrength) && state.lastAudibleStrength <= 1 && state.lastAudibleStrength >= config.threat.audibleEvidenceMinimumStrength;
}
export function mayStartWarning(state, nowMs) {
  const band = sedationAt(nowMs);
  return !state.warning && !protectedNow(state, nowMs) && state.accessibleWarningReady === true && distanceToShelter(state.position) <= config.threat.wallRangeM && finite(state.approachStartedMs) && nowMs - state.approachStartedMs >= band.minimumApproachSeconds * 1000 && state.confidence >= config.threat.warningConfidenceMinimum && hasAudibleEvidence(state, nowMs) && (state.warningStarts ?? []).filter(t => nowMs - t < 60000).length < config.threat.maximumWarningsPerMinute;
}
export function beginWarning(state, nowMs) {
  if (!mayStartWarning(state, nowMs)) return state;
  return { ...state, warning: { startedAtMs: nowMs, durationMs: sedationAt(nowMs).warningSeconds * 1000, delivered: true }, warningStarts: [...(state.warningStarts ?? []), nowMs], mode: 'BREACH_WARNING' };
}
export function mayBreach(state, nowMs) {
  return !!state.warning?.delivered && (!state.lure || state.warning.startedAtMs > state.lure.issuedAtMs) && state.warning.durationMs >= config.lure.minimumFreshReentryWarningSeconds * 1000 && nowMs - state.warning.startedAtMs >= state.warning.durationMs && !protectedNow(state, nowMs) && distanceToShelter(state.position) <= config.threat.wallRangeM && hasAudibleEvidence(state, nowMs);
}

export function canBlackout({ nowMs, stage, count, lastBlackoutMs, tutorial, warning, lure, quietRetreat, finalContainment }) {
  return !tutorial && !warning && !lureProtected(lure, nowMs) && !quietRetreat && !finalContainment && nowMs >= config.blackout.firstEligibleAtSeconds * 1000 && nowMs - lastBlackoutMs >= config.blackout.minimumCooldownSeconds * 1000 && count < config.blackout.maximumPerRun && config.blackout.eligibleResearchStages.includes(stage);
}
export function blackoutSnapshot(state) {
  // Eligibility is checked before calling. Deliberately preserves puzzle data.
  return { ...state, blackout: true, visualPuzzlesPaused: true };
}
export function presentation(state, previousPosition, nowMs) {
  const distance = distanceToShelter(state.position), previous = distanceToShelter(previousPosition);
  const phase = quietPhase(state, nowMs);
  const receding = distance > previous + 0.01, approaching = distance < previous - 0.01;
  let caption = state.warning ? 'WALL STRAIN — BREACH WARNING — Q TO QUIET' : phase === 'CLEAR' ? (receding ? 'FOOTSTEPS RECEDING — RESTORE WINDOW' : 'NO NEARBY MOVEMENT — RESTORE WINDOW') : phase === 'LISTENING' && distance <= 8 ? 'NEARBY BREATHING — KEEP QUIET' : receding ? 'FOOTSTEPS RECEDING' : approaching ? 'FOOTSTEPS APPROACHING' : distance <= 8 ? 'NEARBY BREATHING / LISTENING' : 'NO NEARBY MOVEMENT';
  return { distanceM: state.blackout ? null : Math.round(distance / 2) * 2, danger: state.blackout ? null : state.warning ? 'BREACH' : distance <= config.threat.wallRangeM ? 'AT_WALL' : approaching ? 'APPROACHING' : 'DISTANT', caption, securityOnline: !state.blackout };
}

export function resolveFault(task, box, operational = true) {
  if (task.complete) return { task, noise: 0, result: 'IGNORED' };
  if (!operational) return { task, noise: 0, result: 'PAUSED' };
  if (!Number.isInteger(box) || box < 1 || box > 4) return { task, noise: 0, result: 'IGNORED' };
  if (!task.active.includes(box)) return { task, noise: config.tasks.mistakeStrength, result: 'MISTAKE' };
  const cleared = Math.min(task.required, task.cleared + 1), complete = cleared === task.required;
  return { task: { ...task, cleared, active: complete ? [] : task.active.filter(value => value !== box), complete }, noise: complete ? config.tasks.completionStrength : 0, result: complete ? 'COMPLETE' : 'CLEARED' };
}
export function createMemory(sequence, trend = 'UNKNOWN') {
  if (!Array.isArray(sequence) || sequence.length !== 4 || sequence.some(n => !Number.isInteger(n) || n < 1 || n > 4)) throw new Error('Exactly four authored inputs required');
  return { sequence: [...sequence], inputs: [], tempo: trend === 'ELEVATED' ? config.tasks.memory.maximumTempoMultiplier : 1, playbackCursor: 0, armed: false, transmitted: false };
}
export function enterMemory(memory, digit, operational = true) {
  if (!operational || memory.armed) return { memory, result: 'PAUSED', noise: 0 };
  if (!Number.isInteger(digit) || digit < 1 || digit > 4) return { memory, result: 'IGNORED', noise: 0 };
  if (memory.sequence[memory.inputs.length] !== digit) return { memory: { ...memory, inputs: [], playbackCursor: 0 }, result: 'MISTAKE', noise: config.tasks.mistakeStrength };
  const inputs = [...memory.inputs, digit];
  return { memory: { ...memory, inputs, armed: inputs.length === 4 }, result: inputs.length === 4 ? 'ARMED' : 'ACCEPTED', noise: 0 };
}
export function transmitMemory(memory, target, nowMs, operational = true) {
  if (!operational || !memory.armed || memory.transmitted || !['EMITTER_A', 'EMITTER_B'].includes(target)) return null;
  return { memory: { ...memory, transmitted: true }, lure: lureReward(nowMs, target), researchCompleted: true, localNoise: config.tasks.completionStrength };
}

export function validateProposal(proposal, context) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return 'BAD_SHAPE';
  const keys = proposalSchema.required;
  if (Object.keys(proposal).length !== keys.length || keys.some(key => !Object.hasOwn(proposal, key))) return 'BAD_SHAPE';
  if (typeof proposal.requestId !== 'string' || !proposal.requestId.length || proposal.requestId.length > 128 || !Number.isSafeInteger(proposal.stateVersion) || proposal.stateVersion < 0) return 'BAD_SHAPE';
  for (const key of ['tactic', 'target', 'reasonCode', 'tauntId']) if (!proposalSchema.properties[key].enum.includes(proposal[key])) return 'BAD_ENUM';
  if (!Array.isArray(proposal.evidenceEventIds) || proposal.evidenceEventIds.length > 3 || new Set(proposal.evidenceEventIds).size !== proposal.evidenceEventIds.length || proposal.evidenceEventIds.some(id => typeof id !== 'string')) return 'BAD_SHAPE';
  if (context.usedRequestIds.has(proposal.requestId)) return 'DUPLICATE';
  if (proposal.requestId !== context.requestId) return 'WRONG_REQUEST';
  if (context.nowMs > context.expiresAtGameMs) return 'EXPIRED';
  if (proposal.stateVersion !== context.stateVersion) return 'STALE_STATE';
  if (!context.allowedTactics.includes(proposal.tactic) || !context.allowedTargets.includes(proposal.target) || !context.allowedTauntIds.includes(proposal.tauntId)) return 'ILLEGAL_CHOICE';
  if (proposal.evidenceEventIds.some(id => !context.publicEventIds.has(id))) return 'UNKNOWN_EVIDENCE';
  if (context.previousRequestAtMs !== null && context.issuedAtGameMs - context.previousRequestAtMs < config.director.minimumRequestIntervalSeconds * 1000) return 'COOLDOWN';
  const shelterTactics = ['INVESTIGATE_SOUND', 'CIRCLE_SHELTER', 'LISTEN_NEAR'];
  if (shelterTactics.includes(proposal.tactic) && proposal.target !== 'SHELTER') return 'TARGET_MISMATCH';
  if (['WAIT', 'TAUNT', 'RETREAT'].includes(proposal.tactic) && proposal.target !== 'NONE') return 'TARGET_MISMATCH';
  if (proposal.tactic !== 'TAUNT' && proposal.tauntId !== 'NONE') return 'TAUNT_MISMATCH';
  if (context.quiet && !['WAIT', 'TAUNT', 'RETREAT', 'FOLLOW_LURE'].includes(proposal.tactic)) return 'QUIET_PROTECTED';
  if (proposal.tactic === 'LISTEN_NEAR' && context.distanceM > config.threat.nearPhysiologyRangeM) return 'NOT_NEAR';
  if (proposal.tauntId === 'HEARD_RHYTHM' && (context.trend !== 'ELEVATED' || context.quality !== 'accepted' || context.distanceM > 8 || context.quiet)) return 'NO_VALID_SIGNAL';
  if (proposal.reasonCode === 'SUSTAINED_NEARBY_TREND' && (context.trend !== 'ELEVATED' || context.quality !== 'accepted' || context.distanceM > 8 || context.quiet)) return 'NO_VALID_SIGNAL';
  if (lureProtected(context.lure, context.nowMs)) {
    if (!['FOLLOW_LURE', 'WAIT', 'TAUNT'].includes(proposal.tactic)) return 'LURE_PROTECTED';
    if (proposal.tactic === 'FOLLOW_LURE' && proposal.target !== context.lure.target) return 'LURE_TARGET_MISMATCH';
  } else if (proposal.tactic === 'FOLLOW_LURE') return 'NO_EARNED_LURE';
  return null;
}

const publicDataKeys = {
  FAULT_CLEARED: ['stage', 'count'], WRONG_INPUT: ['stage'], STAGE_COMPLETE: ['stage'],
  LURE_TRANSMITTED: ['target', 'protectedUntilGameMs'], QUIET_ENTERED: [], RESTORED: ['safe'],
  BLACKOUT_STARTED: ['index'], BLACKOUT_ENDED: ['index'], APPROACH: ['node'], NEAR_LISTEN: ['node'],
  BREACH_WARNING: ['durationMs'], RECEDING: ['node'], PHYSIO_TREND: ['source', 'quality', 'trend'],
  SCARE: ['cueId'], CONTAINMENT_COMPLETE: [], PAUSED: [], RESUMED: []
};
export function publicEvent(event) {
  const data = {};
  for (const key of publicDataKeys[event.type] ?? []) {
    const value = event.data?.[key];
    const enums = {
      target: ['EMITTER_A', 'EMITTER_B', 'CONTAINMENT'], node: Object.keys(config.graph.nodes),
      source: ['presage', 'simulated', 'manual'], quality: ['accepted', 'rejected', 'unknown'],
      trend: ['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'],
      cueId: ['WALL_IMPACT', 'FEED_INTERRUPTION', 'DISTANT_CRY', 'METAL_SCRAPE', 'REMOTE_PULSE']
    };
    if (enums[key]?.includes(value)) data[key] = value;
    else if (key === 'safe' && typeof value === 'boolean') data[key] = value;
    else if (key === 'stage' && Number.isInteger(value) && value >= 1 && value <= 5) data[key] = value;
    else if (key === 'count' && Number.isInteger(value) && value >= 0 && value <= 7) data[key] = value;
    else if (key === 'index' && Number.isInteger(value) && value >= 1 && value <= 3) data[key] = value;
    else if (key === 'durationMs' && finite(value) && value >= 6000 && value <= 10000) data[key] = value;
    else if (key === 'protectedUntilGameMs' && finite(value) && value >= 0) data[key] = value;
  }
  return { id: event.id, seq: event.seq, gameMs: event.gameMs, receivedMonotonicMs: event.receivedMonotonicMs, type: event.type, data };
}

export function eventClock(runId, seq, gameMs, receivedMonotonicMs, type, data = {}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId) || !Number.isSafeInteger(seq) || seq < 1 || !finite(gameMs) || gameMs < 0 || !finite(receivedMonotonicMs) || receivedMonotonicMs < 0) throw new Error('Invalid event clock');
  return { id: `${runId}:e${seq}`, seq, gameMs, receivedMonotonicMs, type, data };
}
