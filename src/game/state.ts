export type Side = 'left' | 'right';
export type Station = 'console' | Side | 'relay';
export type Trend = 'UNKNOWN' | 'STEADY' | 'ELEVATED' | 'RECOVERED';
export type Tactic = 'WAIT' | 'PROBE_LEFT' | 'PROBE_RIGHT' | 'REPLAY_ORDER' | 'WRONG_HATCH' | 'FEINT' | 'RETREAT';
export type OrderAction = 'SYNC_CARRIER' | 'OPEN_LEFT' | 'OPEN_RIGHT' | 'COMPLETE';
export type ProposalSource = 'GEMINI' | 'FALLBACK';
export interface PublicEvent { id: string; seq: number; time: number; type: string; detail: string }
export interface WorkOrder { id: string; action: OrderAction; instructions: string }
export interface RadioCall {
  id: string;
  text: string;
  orderId: string;
  action: OrderAction;
  expiresAt: number;
  authenticated: boolean;
  response?: string;
  verification?: 'MATCH' | 'MISMATCH';
  evidence: string[];
  inspected: boolean;
  rejected: boolean;
  /** Private local authority data. Never include this object in provider/event payloads. */
  origin: 'boss' | 'mimic';
  fakeAnswer?: string;
}
export interface DirectorRequest {
  requestId: string;
  stateVersion: number;
  allowedTactics: Tactic[];
  trend: Trend;
  events: PublicEvent[];
  evidenceEventIds: string[];
  expiresAt: number;
}
export interface DirectorProposal {
  requestId: string;
  stateVersion: number;
  tactic: Tactic;
  evidenceEventIds: string[];
  reasonCode: 'UNVERIFIED_OBEDIENCE' | 'REPEATED_DOOR_PATTERN' | 'VERIFIES_CALLS' | 'RECOVERY_NEEDED' | 'VARY_ENCOUNTER' | 'NO_VALID_SIGNAL';
}
export interface GameState {
  seed: number;
  mode: 'shift' | 'demo';
  time: number;
  deadline: number;
  status: 'playing' | 'won' | 'lost';
  paused: boolean;
  lossReason?: string;
  version: number;
  station: Station;
  doors: Record<Side, boolean>;
  energy: number;
  blackoutRemaining: number | null;
  tasks: {
    stage: 1 | 2 | 3 | 4;
    dials: number[];
    targets: number[];
    sync: number;
    cartridgeHold: number;
    insertHold: number;
    hasCartridge: boolean;
    inserted: boolean;
    bars: number[];
    barTargets: number[];
    upload: number;
    uploadCheckpoint: number;
    stageStarted: number;
  };
  creature: {
    phase: 'dormant' | 'approach' | 'threshold' | 'retreat' | 'recover';
    side: Side | null;
    phaseStarted: number;
    recoveryUntil: number;
    lastSide: Side | null;
    dormantSince: number;
    attacks: number[];
  };
  safeUntil: Record<Side, number>;
  sweepReadyAt: number;
  call: RadioCall | null;
  /** Private and local: exclude from logs, shared state, and model inputs. */
  privateChallenge: { prompt: string; answer: string; previousAnswer: string; generation: number };
  order: WorkOrder;
  orderHistory: WorkOrder[];
  events: PublicEvent[];
  eventSequence: number;
  director: {
    nextAt: number;
    request: DirectorRequest | null;
    requestStarted: number;
    requestSequence: number;
    usedRequestIds: string[];
    lastTactic: Tactic;
    source: ProposalSource;
    lastOutcome: string;
    lastEvidenceIds: string[];
    fallbackCount: number;
  };
  trend: Trend;
  holding: boolean;
  notice: string;
  inspected: boolean;
  fakeDelivered: boolean;
  fakeRejected: number;
  verifiedCalls: number;
  rng: number;
}
export type GameAction =
  | { type: 'station'; station: Station }
  | { type: 'door'; side: Side; open?: boolean }
  | { type: 'dial'; index: number; value: number }
  | { type: 'bar'; index: number; value: number }
  | { type: 'interact'; held: boolean }
  | { type: 'sweep'; side: Side }
  | { type: 'authenticate' }
  | { type: 'inspect' }
  | { type: 'reject' }
  | { type: 'pause'; paused?: boolean }
  | { type: 'trend'; trend: Trend }
  | { type: 'proposal'; proposal: unknown; source: ProposalSource };
export type Action = GameAction;

export function emit(state: GameState, type: string, detail: string): void {
  const seq = ++state.eventSequence;
  state.events.push({ id: `e${seq}`, seq, time: Math.round(state.time * 1000) / 1000, type, detail });
  if (state.events.length > 200) state.events.shift();
}

export function random(state: GameState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}
