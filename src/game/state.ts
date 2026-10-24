export type Vec3 = [number, number, number];
export type Station = 'terminal' | 'cameras' | 'equipment';
export type CameraFeed = 'A' | 'B' | 'C';
export type Trend = 'UNKNOWN' | 'STEADY' | 'ELEVATED' | 'RECOVERED';
export type SensorSource = 'presage' | 'simulated' | 'manual';
export type SensorQuality = 'accepted' | 'rejected' | 'unknown';
export type Equipment = 'on' | 'quiet' | 'blackout';
export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type NodeId = 'SHELTER_WALL' | 'WEST_WALL' | 'EAST_WALL' | 'NEAR_PATH' | 'JUNCTION' | 'EMITTER_A' | 'EMITTER_B' | 'CONTAINMENT';
export type Tactic = 'INVESTIGATE_SOUND' | 'CIRCLE_SHELTER' | 'LISTEN_NEAR' | 'FOLLOW_LURE' | 'WAIT' | 'TAUNT' | 'RETREAT';
export type Target = 'SHELTER' | 'EMITTER_A' | 'EMITTER_B' | 'CONTAINMENT' | 'NONE';
export type LureTarget = 'EMITTER_A' | 'EMITTER_B' | 'CONTAINMENT';
export type TauntId = 'NONE' | 'AFTER_MISTAKE' | 'MACHINES_QUIET' | 'HEARD_RHYTHM' | 'LURE_FOLLOWED';
export type ReasonCode = 'RECENT_SOUND' | 'PATTERN_OF_MISTAKES' | 'QUIET_AFTER_NOISE' | 'SUSTAINED_NEARBY_TREND' | 'EARNED_LURE' | 'RECOVERY' | 'VARY_PRESSURE' | 'NO_VALID_SIGNAL';
export type ProposalSource = 'GEMINI' | 'FALLBACK';
export interface PublicEvent { id: string; seq: number; time: number; type: string; detail: string }
export interface SensorState { source: SensorSource; quality: SensorQuality; trend: Trend }
export interface DirectorPair { tactic: Tactic; target: Target }
export interface DirectorRequest {
  requestId: string;
  stateVersion: number;
  issuedAtGameMs: number;
  expiresAtGameMs: number;
  allowedTactics: Tactic[];
  allowedTargets: Target[];
  allowedTauntIds: TauntId[];
  allowedPairs: DirectorPair[];
  publicEventIds: string[];
  events: PublicEvent[];
  observations: {
    equipmentState: Equipment;
    researchStage: Stage;
    creatureNode: NodeId;
    sedationBand: 'SEDATED' | 'RECOVERING' | 'ALERT';
    machineryClue: number;
    transientClue: number;
    physiologyClue: number;
    sensor: SensorState;
    earnedLure: { target: LureTarget; protectedUntilGameMs: number } | null;
  };
}
export interface DirectorProposal {
  requestId: string;
  stateVersion: number;
  tactic: Tactic;
  target: Target;
  evidenceEventIds: string[];
  reasonCode: ReasonCode;
  tauntId: TauntId;
}
export interface MemoryState {
  /** Private local puzzle state. Never include in provider requests or public events. */
  sequence: number[];
  input: number[];
  playbackIndex: number;
  cue: number | null;
  playbackElapsed: number;
  playing: boolean;
  tempo: number;
  responseElapsed: number;
  armed: boolean;
  needsReplay: boolean;
}
export interface GameState {
  seed: number;
  mode: 'standard' | 'demo' | 'tutorial';
  time: number;
  status: 'playing' | 'won' | 'lost';
  paused: boolean;
  lossReason?: string;
  version: number;
  station: Station;
  cameraFeed: CameraFeed;
  equipment: Equipment;
  tasks: {
    stage: Stage;
    stageStarted: number;
    completedStages: number[];
    faults: { active: number[]; completed: number; required: number; spawned: number; spawnElapsed: number; maximumActive: number };
    memory: MemoryState;
    finalTransmitted: boolean;
  };
  creature: {
    position: Vec3;
    /** Last node physically reached; route[0] is the next connected node. */
    node: NodeId;
    route: NodeId[];
    target: Target;
    phase: 'search' | 'approach' | 'circle' | 'listen' | 'retreat' | 'lured' | 'containment' | 'breach';
    distance: number;
    confidence: number;
    approachStarted: number | null;
    phaseStarted: number;
    phaseUntil: number;
    recoveryUntil: number;
    restoreProtectionUntil: number;
    lastAudibleAt: number;
    lastAudibleStrength: number;
    /** Irreversible committed attack; deadline is internal and never a rescue countdown. */
    warning: { started: number; deadline: number; duration: number } | null;
    alarmLatched: boolean;
    warningStarts: number[];
    lure: { target: LureTarget; issuedAt: number; protectedUntil: number; arrivedAt: number | null } | null;
    containmentStarted: number | null;
    lastMotion: 'approaching' | 'receding' | 'stationary' | 'circling';
  };
  quiet: { phase: 'listening' | 'retreat' | 'ready'; started: number; retreatStarted: number | null; movedAway: boolean } | null;
  scare: { id: number; at: number; kind: 'impact' | 'monitor' | 'breach' } | null;
  scareCount: number;
  restoreHeld: boolean;
  restoreHold: number;
  blackout: { count: number; lastAt: number; nextAt: number; startedAt: number | null };
  clues: { machinery: number; transient: number; physiology: number };
  transients: { at: number; strength: number; duration: number }[];
  sensor: SensorState;
  /** Alias for concise HUDs; always identical to sensor.trend. */
  trend: Trend;
  fixedMemoryTempo: boolean;
  events: PublicEvent[];
  eventSequence: number;
  director: {
    nextAt: number;
    request: DirectorRequest | null;
    requestStarted: number;
    requestSequence: number;
    usedRequestIds: string[];
    lastTactic: Tactic;
    lastTarget: Target;
    source: ProposalSource;
    lastOutcome: string;
    lastEvidenceIds: string[];
    fallbackCount: number;
    tauntId: TauntId;
    lastTauntAt: number;
    tauntCount: number;
  };
  notice: string;
  caption: string;
  rng: number;
  /** Fixed-step remainder; callers may step at any frame rate. */
  accumulator: number;
}
export type GameAction =
  | { type: 'station'; station: Station }
  | { type: 'camera'; feed: CameraFeed }
  | { type: 'input'; value: number }
  | { type: 'practice-memory' }
  | { type: 'replay' }
  | { type: 'transmit' }
  | { type: 'quiet' }
  | { type: 'restore'; held: boolean }
  | { type: 'pause'; paused?: boolean }
  | { type: 'sensor'; source: SensorSource; quality: SensorQuality; trend: Trend }
  | { type: 'trend'; trend: Trend }
  | { type: 'accessibility'; fixedMemoryTempo: boolean }
  | { type: 'proposal'; proposal: unknown; source: ProposalSource };
export type Action = GameAction;

export function emit(state: GameState, type: string, detail = ''): void {
  const seq = ++state.eventSequence;
  state.events.push({ id: `e${seq}`, seq, time: Math.round(state.time * 1000) / 1000, type, detail });
  if (state.events.length > 300) state.events.shift();
}
export function random(state: GameState): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}
