import { canProbe } from './creature';
import type { DirectorProposal, DirectorRequest, GameState, Tactic } from './state';

const tactics: Tactic[] = ['WAIT', 'PROBE_LEFT', 'PROBE_RIGHT', 'REPLAY_ORDER', 'WRONG_HATCH', 'FEINT', 'RETREAT'];
const reasonCodes = ['UNVERIFIED_OBEDIENCE', 'REPEATED_DOOR_PATTERN', 'VERIFIES_CALLS', 'RECOVERY_NEEDED', 'VARY_ENCOUNTER', 'NO_VALID_SIGNAL'];

/** Provider waiting is asynchronous; physical warning/recovery timers never change. */
export const DIRECTOR_TIMEOUT_MS = 8000;
export const DIRECTOR_RESPONSE_BUDGET_SECONDS = DIRECTOR_TIMEOUT_MS / 1000;

export function allowedTactics(state: GameState): Tactic[] {
  const result: Tactic[] = ['WAIT'];
  if (state.blackoutRemaining !== null || state.status !== 'playing') return result;
  if (canProbe(state, 'left')) result.push('PROBE_LEFT');
  if (canProbe(state, 'right')) result.push('PROBE_RIGHT');
  if (!state.call || state.call.rejected || state.time >= state.call.expiresAt) result.push('REPLAY_ORDER', 'WRONG_HATCH');
  if (state.creature.phase === 'dormant') result.push('FEINT');
  if (state.creature.phase === 'approach' || state.creature.phase === 'threshold') result.push('RETREAT');
  return result;
}

/** Explicit allowlist: no state spreading and no private card, response, raw pulse, or radio provenance. */
export function buildDirectorRequest(state: GameState): DirectorRequest {
  const events = state.events.slice(-20).map(event => ({ id: event.id, seq: event.seq, time: event.time, type: event.type, detail: event.detail }));
  return {
    requestId: `request-${state.director.requestSequence + 1}`,
    stateVersion: state.version,
    allowedTactics: allowedTactics(state),
    trend: state.trend,
    events,
    evidenceEventIds: events.map(event => event.id),
    expiresAt: state.time + DIRECTOR_RESPONSE_BUDGET_SECONDS,
  };
}

export function validateProposal(value: unknown, state: GameState): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'BAD_SHAPE';
  const p = value as Record<string, unknown>;
  const allowedKeys = ['requestId', 'stateVersion', 'tactic', 'evidenceEventIds', 'reasonCode'];
  if (Object.keys(p).some(key => !allowedKeys.includes(key)) || allowedKeys.some(key => !(key in p))) return 'BAD_SHAPE';
  if (typeof p.requestId !== 'string' || !Number.isInteger(p.stateVersion) || typeof p.tactic !== 'string'
    || !tactics.includes(p.tactic as Tactic) || typeof p.reasonCode !== 'string' || !reasonCodes.includes(p.reasonCode)
    || !Array.isArray(p.evidenceEventIds) || p.evidenceEventIds.length > 3 || p.evidenceEventIds.some(id => typeof id !== 'string')) return 'BAD_SHAPE';
  if (state.director.usedRequestIds.includes(p.requestId)) return 'DUPLICATE';
  const request = state.director.request;
  if (!request || p.requestId !== request.requestId) return 'WRONG_REQUEST';
  if (state.time > request.expiresAt) return 'EXPIRED';
  if (p.stateVersion !== request.stateVersion || p.stateVersion !== state.version) return 'STALE_STATE';
  if (!request.allowedTactics.includes(p.tactic as Tactic) || !allowedTactics(state).includes(p.tactic as Tactic)) return 'ILLEGAL_TACTIC';
  if (p.evidenceEventIds.some(id => !request.evidenceEventIds.includes(id as string))) return 'UNKNOWN_EVIDENCE';
  return null;
}

export function isDirectorProposal(value: unknown, state: GameState): value is DirectorProposal {
  return validateProposal(value, state) === null;
}
