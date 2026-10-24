import { emit, random, type GameState, type OrderAction, type RadioCall, type WorkOrder } from './state';
import { MARA_DIALOGUE } from './dialogue';

const words = ['AMBER', 'BIRCH', 'CINDER', 'DELTA', 'EMBER', 'FABLE', 'GROVE', 'HERON', 'IVORY', 'JUNIPER', 'KESTREL', 'LILAC', 'MARBLE', 'NORTH', 'OPAL', 'PINE', 'QUARTZ', 'RIDGE', 'SABLE', 'THISTLE', 'UMBER', 'VALE', 'WILLOW', 'YARROW', 'ZINC', 'TUNDRA', 'CEDAR', 'FROST', 'MOSS', 'RAVEN', 'STILL', 'COPPER'];

export function rotateChallenge(state: GameState): void {
  const previousAnswer = state.privateChallenge.answer;
  const generation = state.privateChallenge.generation + 1;
  const pick = () => words[Math.floor(random(state) * words.length)];
  const prompt = `${pick()} ${generation.toString().padStart(2, '0')}`;
  let answer = `${pick()} ${pick()} ${Math.floor(random(state) * 90 + 10)}`;
  if (answer === previousAnswer) answer = `${answer} ${generation}`;
  state.privateChallenge = { prompt, answer, previousAnswer, generation };
}

export function makeOrder(state: GameState): WorkOrder {
  const serial = 300 + (Math.abs(state.seed) % 500) * 4 + state.tasks.stage;
  const id = `NR-${serial}`;
  if (state.tasks.stage === 1) return { id, action: 'SYNC_CARRIER', instructions: 'Match all three carrier targets. Keep at least one shutter open for 20 seconds of link.' };
  if (state.tasks.stage === 2) return { id, action: 'OPEN_LEFT', instructions: 'Sweep LEFT. Open the LEFT hatch and hold collect for 3 seconds. Insert the cartridge at RELAY.' };
  if (state.tasks.stage === 3) return { id, action: 'OPEN_RIGHT', instructions: 'Sweep RIGHT. Open RIGHT, match both alignment targets, and hold upload. Progress saves every 4 seconds.' };
  return { id, action: 'COMPLETE', instructions: 'Transmission received. All three operations complete.' };
}

export function orderText(orderId: string, action: OrderAction): string {
  if (action === 'SYNC_CARRIER') return `Order ${orderId}. Match the three carrier targets. Leave the clear shutter open to establish the link.`;
  if (action === 'OPEN_LEFT') return `Order ${orderId}. Sweep the left tunnel, then open the left hatch for the cartridge. Insert it at the relay.`;
  if (action === 'OPEN_RIGHT') return `Order ${orderId}. Sweep the right tunnel, then open the right hatch. Align both bars and hold the uplink.`;
  return MARA_DIALOGUE.complete;
}

export function issueCall(state: GameState, kind: 'genuine' | 'expired' | 'wrong-hatch' | 'challenge' = 'genuine'): void {
  rotateChallenge(state);
  const fake = kind !== 'genuine';
  let orderId = state.order.id;
  let action = state.order.action;
  if (kind === 'expired') orderId = state.orderHistory.at(-1)?.id ?? `${state.order.id}-CLOSED`;
  if (kind === 'wrong-hatch') action = state.order.action === 'OPEN_LEFT' ? 'OPEN_RIGHT' : 'OPEN_LEFT';
  const fakeAnswer = state.privateChallenge.previousAnswer && state.privateChallenge.previousAnswer !== state.privateChallenge.answer ? state.privateChallenge.previousAnswer : 'NO RESPONSE';
  const introduction = !fake && state.privateChallenge.generation === 1 ? `${MARA_DIALOGUE.intro} ` : '';
  const text = `${introduction}${orderText(orderId, action)}`;
  if (text.length > 600) throw new Error('Authored radio instruction exceeds the speech boundary');
  const call: RadioCall = {
    id: `call-${state.privateChallenge.generation}`, text, orderId, action,
    expiresAt: state.time + 24, authenticated: false, evidence: [], inspected: false, rejected: false,
    origin: fake ? 'mimic' : 'boss', ...(fake ? { fakeAnswer } : {}),
  };
  state.call = call;
  // Never log the private challenge, response or provenance. Public narration is intentionally minimal.
  emit(state, 'RADIO_CALL', `Radio request ${call.id}; cited order ${call.orderId}; requested action ${call.action}.`);
}

export function inspectCall(state: GameState): void {
  state.inspected = true;
  const call = state.call;
  if (!call || call.rejected || state.time >= call.expiresAt) return;
  call.inspected = true;
  call.evidence = call.evidence.filter(item => item.startsWith('Challenge'));
  if (call.orderId !== state.order.id) call.evidence.push(`Expired order: radio cites ${call.orderId}; active order is ${state.order.id}.`);
  if (call.action !== state.order.action) call.evidence.push(`Wrong instruction: radio requests ${call.action.replaceAll('_', ' ')}; console requires ${state.order.action.replaceAll('_', ' ')}.`);
  state.notice = call.evidence.length ? call.evidence.join(' ') : 'Order and requested action match. Press R to compare the current challenge response.';
  emit(state, 'ORDER_INSPECTED', `Compared ${call.id} with the active work order.`);
}

export function authenticate(state: GameState): void {
  const call = state.call;
  if (!call || call.rejected || state.time >= call.expiresAt) { state.notice = 'No active radio request. Read the current work order.'; return; }
  if (call.authenticated) return;
  call.authenticated = true;
  call.response = call.origin === 'boss' ? state.privateChallenge.answer : call.fakeAnswer ?? 'NO RESPONSE';
  call.verification = call.response === state.privateChallenge.answer ? 'MATCH' : 'MISMATCH';
  if (call.verification === 'MISMATCH') call.evidence.push('Challenge failed: the radio response does not match the private card.');
  state.verifiedCalls++;
  state.notice = call.verification === 'MATCH' ? 'Response matches this call’s private card. Follow the current work order and check the corridor.' : 'Response differs from this call’s private card. Reject this request.';
  emit(state, 'CALL_VERIFIED', `Checked ${call.id}; result ${call.verification}.`);
}

export function rejectCall(state: GameState): void {
  const call = state.call;
  if (!call || call.rejected || state.time >= call.expiresAt) return;
  if (!call.evidence.length) { state.notice = 'Inspect the order or request authentication before rejecting by evidence.'; return; }
  call.rejected = true;
  state.fakeRejected++;
  state.notice = 'Request rejected by evidence. You checked this time. Continue the trusted work order.';
  emit(state, 'CALL_REJECTED', `Rejected ${call.id} using ${call.evidence.length} independently checked discrepancy/discrepancies.`);
}
