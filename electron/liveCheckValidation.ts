import { createGame, dispatch } from '../src/game/reducer';
import { startProbe } from '../src/game/creature';
import { buildDirectorRequest, validateProposal } from '../src/game/directorValidation';
import type { GameState } from '../src/game/state';
import { publicDirectorRequest } from '../src/integrations/contracts';

/** Synthetic local authority for the live sponsor probe. It supplies actual
 * legal WAIT/RETREAT choices and observable door history, never a private card. */
export function createDirectorProbe(requestId: string) {
  let state = createGame(17, 'demo');
  state = dispatch(state, { type: 'door', side: 'right', open: true });
  state = dispatch(state, { type: 'door', side: 'left', open: false });
  if (!startProbe(state, 'left')) throw new Error('Smoke scenario cannot start its authored probe');
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
