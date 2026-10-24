import { createGame, dispatch, step } from '../src/game/reducer';
import { buildDirectorRequest, validateProposal } from '../src/game/directorValidation';
import type { GameState } from '../src/game/state';
import { publicDirectorRequest } from '../src/integrations/contracts';

/** Labeled synthetic LOCK IN authority, separate from an actual UI playthrough.
 * A visible quiet-box mistake supplies sound evidence, never memory answers. */
export function createDirectorProbe(requestId: string) {
  let state = step(createGame(17, 'demo'), 2);
  const quietBox = [0, 1, 2, 3].find(index => !state.tasks.faults.active.includes(index))!;
  state = dispatch(state, { type: 'input', value: quietBox + 1 });
  const request = publicDirectorRequest({ ...buildDirectorRequest(state), requestId });
  state.director.request = request;
  return { state, request };
}
export function validateDirectorProbe(state: GameState, proposal: unknown, elapsedMs: number): string | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 'INVALID_LATENCY';
  // Same strict validator used at runtime: complete schema, legal action,
  // request/state identity, expiry, provenance, duplicate and safety boundaries.
  return validateProposal(proposal, { ...state, time: state.time + elapsedMs / 1000 });
}
