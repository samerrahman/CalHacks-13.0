import { retreat, startProbe } from './creature';
import { allowedTactics, buildDirectorRequest, DIRECTOR_RESPONSE_BUDGET_SECONDS, validateProposal } from './directorValidation';
import { emit, type DirectorProposal, type GameState, type ProposalSource, type Tactic } from './state';
import { issueCall } from './verification';

export { buildDirectorRequest } from './directorValidation';

function commitTactic(state: GameState, tactic: Tactic, source: ProposalSource, evidenceIds: string[] = []): void {
  if (tactic === 'PROBE_LEFT') startProbe(state, 'left');
  if (tactic === 'PROBE_RIGHT') startProbe(state, 'right');
  if (tactic === 'REPLAY_ORDER') issueCall(state, 'expired');
  if (tactic === 'WRONG_HATCH') issueCall(state, 'wrong-hatch');
  if (tactic === 'RETREAT') retreat(state, 'Director granted a recovery window.');
  if (tactic === 'FEINT') {
    const side = state.creature.lastSide === 'left' ? 'right' : 'left';
    state.notice = `${side.toUpperCase()} corridor: a distant metallic knock. Inspect the corridor before acting.`;
    emit(state, 'DISTANT_SOUND', `Nonlethal sound from ${side}; physical creature position unchanged.`);
  }
  state.director.lastTactic = tactic; state.director.source = source; state.director.lastOutcome = 'APPLIED';
  state.director.lastEvidenceIds = evidenceIds;
  state.director.nextAt = state.time + (state.trend === 'ELEVATED' ? 20 : 12);
  emit(state, 'DIRECTOR_APPLIED', `${source} selected ${tactic}; evidence ${evidenceIds.join(', ') || 'none'}.`);
}

function consumeRequest(state: GameState): void {
  if (state.director.request) {
    state.director.usedRequestIds.push(state.director.request.requestId);
    state.director.request = null;
  }
}

export function fallbackDirector(state: GameState, reason: string): void {
  const legal = allowedTactics(state);
  const count = state.director.fallbackCount++;
  const preferred: Tactic[] = state.trend === 'ELEVATED'
    ? ['RETREAT', 'WRONG_HATCH', 'WAIT']
    : count === 0 ? ['PROBE_LEFT', 'WAIT']
      : [(['PROBE_RIGHT', 'REPLAY_ORDER', 'PROBE_LEFT', 'WRONG_HATCH', 'FEINT'] as Tactic[])[(count + Math.abs(state.seed)) % 5], 'WAIT'];
  const tactic = preferred.find(item => legal.includes(item)) ?? 'WAIT';
  consumeRequest(state);
  emit(state, 'DIRECTOR_FALLBACK', `Deterministic authored fallback: ${reason}.`);
  commitTactic(state, tactic, 'FALLBACK');
}

export function applyDirectorProposal(state: GameState, value: unknown, source: ProposalSource): void {
  const error = validateProposal(value, state);
  if (error) {
    state.director.lastOutcome = error;
    emit(state, 'DIRECTOR_REJECTED', `Proposal rejected: ${error}.`);
    // A late response for a consumed request must not consume a new request or replay a tactic.
    const id = value && typeof value === 'object' ? (value as Record<string, unknown>).requestId : undefined;
    if (state.director.request && (id === state.director.request.requestId || error === 'BAD_SHAPE')) fallbackDirector(state, error);
    return;
  }
  const proposal = value as DirectorProposal;
  consumeRequest(state);
  commitTactic(state, proposal.tactic, source, proposal.evidenceEventIds);
}

export function tickEncounters(state: GameState): void {
  // The teaching fake always arrives before the three-second cartridge interaction can finish.
  if (state.tasks.stage === 2 && !state.fakeDelivered && state.time - state.tasks.stageStarted >= 1 - 1e-8) {
    issueCall(state, 'wrong-hatch'); state.fakeDelivered = true; state.version++;
  }
  if (state.director.request && state.time - state.director.requestStarted >= DIRECTOR_RESPONSE_BUDGET_SECONDS - 1e-8) fallbackDirector(state, 'provider unavailable or timeout');
  if (!state.director.request && state.time >= state.director.nextAt - 1e-8) {
    state.director.request = buildDirectorRequest(state);
    state.director.requestStarted = state.time;
    state.director.requestSequence++;
    emit(state, 'DIRECTOR_REQUEST', `${state.director.request.requestId}; allowed ${state.director.request.allowedTactics.join(', ')}; trend ${state.trend}.`);
  }
}
