import { config, currentSedation } from './config';
import { beginApproach, lureProtected, routeTo, setPhase } from './creature';
import { emit, random, type DirectorPair, type DirectorProposal, type DirectorRequest, type GameState, type ReasonCode, type Tactic, type Target, type TauntId } from './state';

export const DIRECTOR_TIMEOUT_MS = config.director.responseBudgetMs;
export const DIRECTOR_RESPONSE_BUDGET_SECONDS = DIRECTOR_TIMEOUT_MS / 1000;
const TACTICS: Tactic[] = ['INVESTIGATE_SOUND', 'CIRCLE_SHELTER', 'LISTEN_NEAR', 'FOLLOW_LURE', 'WAIT', 'TAUNT', 'RETREAT'];
const TARGETS: Target[] = ['SHELTER', 'EMITTER_A', 'EMITTER_B', 'CONTAINMENT', 'NONE'];
const REASONS: ReasonCode[] = ['RECENT_SOUND', 'PATTERN_OF_MISTAKES', 'QUIET_AFTER_NOISE', 'SUSTAINED_NEARBY_TREND', 'EARNED_LURE', 'RECOVERY', 'VARY_PRESSURE', 'NO_VALID_SIGNAL'];
const TAUNTS: TauntId[] = ['NONE', 'AFTER_MISTAKE', 'MACHINES_QUIET', 'HEARD_RHYTHM', 'LURE_FOLLOWED'];
export function allowedPairs(state: GameState): DirectorPair[] {
  const pairs: DirectorPair[] = [{ tactic: 'WAIT', target: 'NONE' }];
  if (state.mode === 'tutorial' || state.status !== 'playing' || state.paused) return pairs;
  const c = state.creature;
  if (c.warning) return pairs;
  const mayTaunt = state.director.tauntCount < 7 && state.time - state.director.lastTauntAt >= 25 && allowedTaunts(state).some(id => id !== 'NONE');
  if (lureProtected(state) && c.lure) return [...pairs, { tactic: 'FOLLOW_LURE', target: c.lure.target }, ...(mayTaunt ? [{ tactic: 'TAUNT' as const, target: 'NONE' as const }] : [])];
  if (state.equipment === 'quiet' || c.warning) return pairs;
  if (mayTaunt) pairs.push({ tactic: 'TAUNT', target: 'NONE' });
  if (state.time < c.recoveryUntil || state.time < c.restoreProtectionUntil) return pairs;
  pairs.push({ tactic: 'RETREAT', target: 'NONE' });
  if (state.time - c.lastAudibleAt <= config.threat.audibleEvidenceFreshSeconds && c.lastAudibleStrength >= config.threat.audibleEvidenceMinimumStrength && c.distance <= config.threat.audibleRangeM) pairs.push({ tactic: 'INVESTIGATE_SOUND', target: 'SHELTER' });
  if (c.distance <= config.threat.nearPhysiologyRangeM) pairs.push({ tactic: 'CIRCLE_SHELTER', target: 'SHELTER' }, { tactic: 'LISTEN_NEAR', target: 'SHELTER' });
  return pairs;
}
export function allowedTactics(state: GameState): Tactic[] { return [...new Set(allowedPairs(state).map(pair => pair.tactic))]; }
export function allowedTaunts(state: GameState): TauntId[] {
  const ids: TauntId[] = ['NONE'];
  if (state.creature.distance > 10 || state.creature.warning) return ids;
  if (state.events.some(event => event.type === 'WRONG_INPUT' && state.time - event.time < 30)) ids.push('AFTER_MISTAKE');
  if (state.equipment === 'quiet') ids.push('MACHINES_QUIET');
  if (state.clues.physiology > 0 && state.sensor.quality === 'accepted' && state.sensor.trend === 'ELEVATED' && state.creature.distance <= config.threat.nearPhysiologyRangeM && state.equipment !== 'quiet') ids.push('HEARD_RHYTHM');
  if (lureProtected(state)) ids.push('LURE_FOLLOWED');
  return ids;
}
/** Exact public projection: private memory sequence, inputs and raw physiology never enter here. */
export function buildDirectorRequest(state: GameState): DirectorRequest {
  const pairs = allowedPairs(state);
  const events = state.events.slice(-20).map(({ id, seq, time, type, detail }) => ({ id, seq, time, type, detail }));
  return {
    requestId: `request-${state.director.requestSequence + 1}`,
    stateVersion: state.version,
    issuedAtGameMs: Math.round(state.time * 1000),
    expiresAtGameMs: Math.round(state.time * 1000) + DIRECTOR_TIMEOUT_MS,
    allowedPairs: pairs,
    allowedTactics: [...new Set(pairs.map(pair => pair.tactic))],
    allowedTargets: [...new Set(pairs.map(pair => pair.target))],
    allowedTauntIds: allowedTaunts(state),
    publicEventIds: events.map(event => event.id),
    events,
    observations: {
      equipmentState: state.equipment, researchStage: state.tasks.stage, creatureNode: state.creature.node,
      sedationBand: currentSedation(state).band as DirectorRequest['observations']['sedationBand'],
      machineryClue: state.clues.machinery, transientClue: state.clues.transient, physiologyClue: state.clues.physiology,
      sensor: { ...state.sensor },
      earnedLure: state.creature.lure && lureProtected(state) ? { target: state.creature.lure.target, protectedUntilGameMs: Math.round(state.creature.lure.protectedUntil * 1000) } : null,
    },
  };
}
export function validateProposal(value: unknown, state: GameState): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'BAD_SHAPE';
  const p = value as Record<string, unknown>;
  const keys = ['requestId', 'stateVersion', 'tactic', 'target', 'evidenceEventIds', 'reasonCode', 'tauntId'];
  if (Object.keys(p).length !== keys.length || Object.keys(p).some(key => !keys.includes(key)) || keys.some(key => !(key in p))) return 'BAD_SHAPE';
  if (typeof p.requestId !== 'string' || !Number.isSafeInteger(p.stateVersion) || !TACTICS.includes(p.tactic as Tactic) || !TARGETS.includes(p.target as Target) || !REASONS.includes(p.reasonCode as ReasonCode) || !TAUNTS.includes(p.tauntId as TauntId)
    || !Array.isArray(p.evidenceEventIds) || p.evidenceEventIds.length > 3 || p.evidenceEventIds.some(id => typeof id !== 'string') || new Set(p.evidenceEventIds).size !== p.evidenceEventIds.length) return 'BAD_SHAPE';
  if (state.director.usedRequestIds.includes(p.requestId)) return 'DUPLICATE';
  const request = state.director.request;
  if (!request || request.requestId !== p.requestId) return 'WRONG_REQUEST';
  if (state.time * 1000 > request.expiresAtGameMs + 1e-6) return 'EXPIRED';
  if (p.stateVersion !== request.stateVersion || p.stateVersion !== state.version) return 'STALE_STATE';
  if (state.paused || state.status !== 'playing' || state.mode === 'tutorial') return 'ILLEGAL_PHASE';
  const matches = (pair: DirectorPair) => pair.tactic === p.tactic && pair.target === p.target;
  if (!request.allowedPairs.some(matches) || !allowedPairs(state).some(matches)) return 'ILLEGAL_PAIR';
  if (!request.allowedTauntIds.includes(p.tauntId as TauntId) || !allowedTaunts(state).includes(p.tauntId as TauntId) || p.tactic !== 'TAUNT' && p.tauntId !== 'NONE' || p.tactic === 'TAUNT' && p.tauntId === 'NONE') return 'ILLEGAL_TAUNT';
  if (p.evidenceEventIds.some(id => !request.publicEventIds.includes(id as string))) return 'UNKNOWN_EVIDENCE';
  if (p.reasonCode === 'SUSTAINED_NEARBY_TREND' && state.clues.physiology <= 0 || p.reasonCode === 'EARNED_LURE' && !lureProtected(state)) return 'UNSUPPORTED_REASON';
  return null;
}
export function isDirectorProposal(value: unknown, state: GameState): value is DirectorProposal { return validateProposal(value, state) === null; }
function commit(state: GameState, proposal: DirectorProposal, source: 'GEMINI' | 'FALLBACK'): void {
  const c = state.creature;
  switch (proposal.tactic) {
    case 'INVESTIGATE_SOUND': beginApproach(state); break;
    case 'CIRCLE_SHELTER':
      c.approachStarted = null; setPhase(state, 'circle', 'SHELTER');
      routeTo(state, c.node === 'WEST_WALL' ? 'EAST_WALL' : 'WEST_WALL'); break;
    case 'LISTEN_NEAR': c.approachStarted = null; setPhase(state, 'listen', 'SHELTER', 4); emit(state, 'NEAR_LISTEN'); break;
    case 'FOLLOW_LURE':
      if (c.lure) { setPhase(state, 'lured', c.lure.target); routeTo(state, c.lure.target); } break;
    case 'RETREAT':
      c.approachStarted = null; c.recoveryUntil = Math.max(c.recoveryUntil, state.time + config.threat.minimumRecoverySeconds);
      setPhase(state, 'retreat', 'NONE'); routeTo(state, c.distance < 12 ? 'NEAR_PATH' : 'JUNCTION'); break;
    case 'WAIT':
      if (state.equipment !== 'quiet' && !lureProtected(state) && !c.warning) { setPhase(state, 'search', 'NONE', 2); c.approachStarted = null; }
      break;
    case 'TAUNT':
      state.director.lastTauntAt = state.time; state.director.tauntCount++;
      emit(state, 'TAUNT', proposal.tauntId); break;
  }
  state.director.lastTactic = proposal.tactic; state.director.lastTarget = proposal.target;
  state.director.lastEvidenceIds = [...proposal.evidenceEventIds]; state.director.tauntId = proposal.tauntId;
  state.director.source = source;
  state.director.lastOutcome = `${source} · ${proposal.tactic}`;
  state.director.request = null; state.director.nextAt = state.time + config.director.minimumRequestIntervalSeconds;
  if (!state.director.usedRequestIds.includes(proposal.requestId)) state.director.usedRequestIds.push(proposal.requestId);
  if (state.director.usedRequestIds.length > 100) state.director.usedRequestIds.shift();
  if (source === 'FALLBACK') state.director.fallbackCount++;
  emit(state, 'DIRECTOR_APPLIED', `${source} ${proposal.tactic} ${proposal.target}`);
}
export function applyFallback(state: GameState, reason: string): void {
  const request = state.director.request;
  const pairs = allowedPairs(state);
  let pair = pairs.find(pair => pair.tactic === 'FOLLOW_LURE') ?? pairs.find(pair => pair.tactic === 'INVESTIGATE_SOUND');
  if (!pair) {
    const choices = pairs.filter(pair => ['WAIT', 'LISTEN_NEAR', 'CIRCLE_SHELTER'].includes(pair.tactic));
    pair = choices[Math.floor(random(state) * choices.length)] ?? pairs[0];
  }
  const evidence = state.events.filter(event => event.type === 'WRONG_INPUT' || event.type === 'FAULT_STARTED' || event.type === 'LURE_TRANSMITTED').slice(-2).map(event => event.id);
  commit(state, { requestId: request?.requestId ?? `fallback-${state.director.requestSequence}`, stateVersion: state.version, ...pair, reasonCode: pair.tactic === 'FOLLOW_LURE' ? 'EARNED_LURE' : pair.tactic === 'INVESTIGATE_SOUND' ? 'RECENT_SOUND' : 'NO_VALID_SIGNAL', evidenceEventIds: evidence, tauntId: 'NONE' }, 'FALLBACK');
  state.director.lastOutcome = `FALLBACK · ${pair.tactic} · ${reason}`;
}
export function receiveProposal(state: GameState, value: unknown, source: 'GEMINI' | 'FALLBACK'): void {
  const error = validateProposal(value, state);
  if (error) {
    emit(state, 'DIRECTOR_REJECTED', error);
    state.director.lastOutcome = `REJECTED · ${error}`;
    // A duplicate old delivery cannot consume a newer pending request.
    const requestId = value && typeof value === 'object' ? (value as { requestId?: unknown }).requestId : undefined;
    if (state.director.request && error !== 'DUPLICATE' && (requestId === undefined || requestId === state.director.request.requestId)) applyFallback(state, error);
    return;
  }
  commit(state, value as DirectorProposal, source);
}
export function tickDirector(state: GameState): void {
  if (state.mode === 'tutorial' || state.status !== 'playing') return;
  if (state.director.request && state.time * 1000 >= state.director.request.expiresAtGameMs - 1e-6) applyFallback(state, 'TIMEOUT');
  if (!state.director.request && state.time >= state.director.nextAt && !state.creature.warning && state.equipment !== 'quiet') {
    const request = buildDirectorRequest(state);
    state.director.requestSequence++; state.director.request = request; state.director.requestStarted = state.time;
    emit(state, 'DIRECTOR_REQUESTED');
  }
}
