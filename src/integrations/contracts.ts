import type { DirectorRequest, PublicEvent } from '../game/state';
import { config } from '../game/config';
import dialogue from '../game/dialogue.json';

export type DirectorResult = { proposal: unknown | null; source: 'gemini' | 'fallback'; latencyMs: number; reason?: string; providerRequestId?: string };
/** expiry is a wall-clock transport deadline, never a remote monotonic clock. */
export type SpeechRequest = { requestId: string; caption: string; encounterId: string; expiresAtMs: number };
export type SpeechResult = { audioBase64: string | null; mimeType: string; source: 'elevenlabs' | 'cached' | 'fallback'; reason?: string; latencyMs: number; providerRequestId?: string };
export const MONSTER_FALLBACK_IDS = ['FIRST_APPROACH', 'AFTER_MISTAKE', 'MACHINES_QUIET', 'HEARD_RHYTHM', 'LURE_FOLLOWED'] as const;
export type MonsterFallbackId = typeof MONSTER_FALLBACK_IDS[number];
export const MONSTER_TEXT_TIMEOUT_MS = 5000;
export const MONSTER_TOTAL_TIMEOUT_MS = 12000;
export const MONSTER_MIN_INTERVAL_MS = 18000;
export const TRACE_SCHEMA_VERSION = 'lock-in-v2';
export type MonsterRequest = { requestId: string; context: DirectorRequest; fallbackId: MonsterFallbackId; expiresAtMs: number };
export type MonsterResult = { requestId: string; caption: string; textSource: 'gemini' | 'authored-fallback'; textLatencyMs: number; textReason?: string; textProviderRequestId?: string; evidenceEventIds: string[]; speech: SpeechResult; totalLatencyMs: number };
export type IntegrationStatus = { desktop: boolean; offline?: boolean; presage: boolean; gemini: boolean; elevenlabs: boolean; convex: boolean; reasons: string[] };
export interface DesktopBridge {
  status(): Promise<IntegrationStatus>;
  director(request: DirectorRequest): Promise<DirectorResult>;
  speech(request: SpeechRequest): Promise<SpeechResult>;
  monster(request: MonsterRequest): Promise<MonsterResult>;
}
declare global { interface Window { lockIn?: DesktopBridge } }

/** The public speech route accepts authored captions only. Generated speech
 * can be reached only by the server's contextual monster pipeline. */
export function isAuthoredCaption(caption: unknown): caption is string {
  return typeof caption === 'string' && dialogue.lines.some(line => line.text === caption);
}
export function monsterFallbackCaption(id: MonsterFallbackId): string {
  return dialogue.lines.find(line => line.id === id && line.role === 'creature')?.text ?? 'I can hear you working.';
}
export function authoredMonsterFallback(request: Pick<MonsterRequest, 'requestId' | 'fallbackId'>, reason: string): MonsterResult {
  return { requestId: request.requestId, caption: monsterFallbackCaption(request.fallbackId), textSource: 'authored-fallback', textLatencyMs: 0, textReason: reason, evidenceEventIds: [], totalLatencyMs: 0, speech: { audioBase64: null, mimeType: 'audio/mpeg', source: 'fallback', latencyMs: 0, reason } };
}
export function publicMonsterRequest(raw: MonsterRequest, nowMs = Date.now()): MonsterRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'context,expiresAtMs,fallbackId,requestId') throw new Error('Invalid monster request');
  const expiresAtMs = finite(raw.expiresAtMs);
  if (expiresAtMs <= nowMs || expiresAtMs > nowMs + 30000) throw new Error('Expired monster request');
  return { requestId: identity(raw.requestId, 128), fallbackId: member(raw.fallbackId, MONSTER_FALLBACK_IDS), expiresAtMs, context: publicDirectorRequest(raw.context) };
}

export const TACTICS = ['INVESTIGATE_SOUND', 'CIRCLE_SHELTER', 'LISTEN_NEAR', 'FOLLOW_LURE', 'WAIT', 'TAUNT', 'RETREAT'] as const;
export const TARGETS = ['SHELTER', 'EMITTER_A', 'EMITTER_B', 'CONTAINMENT', 'NONE'] as const;
export const TAUNTS = ['NONE', 'AFTER_MISTAKE', 'MACHINES_QUIET', 'HEARD_RHYTHM', 'LURE_FOLLOWED'] as const;
export const REASONS = ['RECENT_SOUND', 'PATTERN_OF_MISTAKES', 'QUIET_AFTER_NOISE', 'SUSTAINED_NEARBY_TREND', 'EARNED_LURE', 'RECOVERY', 'VARY_PRESSURE', 'NO_VALID_SIGNAL'] as const;
const NODES = ['SHELTER_WALL', 'WEST_WALL', 'EAST_WALL', 'NEAR_PATH', 'JUNCTION', 'EMITTER_A', 'EMITTER_B', 'CONTAINMENT'] as const;
const TRENDS = ['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'] as const;
const EVENT_TYPES = new Set(['NEAR_LISTEN', 'TAUNT', 'DIRECTOR_APPLIED', 'DIRECTOR_REJECTED', 'DIRECTOR_REQUESTED', 'MEMORY_REPLAY', 'TASK_COMPLETE', 'WRONG_INPUT', 'FAULT_CLEARED', 'MEMORY_ARMED', 'FINAL_BROADCAST', 'FAULT_STARTED', 'MEMORY_READY', 'MEMORY_EXPIRED', 'LURE_TRANSMITTED', 'QUIET_ENTERED', 'RESTORED', 'APPROACH', 'LURE_ARRIVED', 'WON', 'LURE_RELEASED', 'QUIET_RETREAT', 'RESTORE_WINDOW', 'BREACH_WARNING', 'LOST', 'RUN_STARTED', 'BLACKOUT_STARTED', 'SENSOR_TREND', 'PAUSED', 'RESUMED', 'PROXIMITY_ALARM', 'ATTACK_COMMITTED', 'SCARE', 'MONSTER_STEP', 'QUIET_EXHAUSTED', 'QUIET_COOLDOWN', 'TIMEOUT', 'WIRE_CONNECTED']);
export const DIRECTOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['requestId', 'stateVersion', 'tactic', 'target', 'evidenceEventIds', 'reasonCode', 'tauntId'],
  properties: {
    requestId: { type: 'string' }, stateVersion: { type: 'integer' },
    tactic: { type: 'string', enum: TACTICS }, target: { type: 'string', enum: TARGETS },
    evidenceEventIds: { type: 'array', maxItems: 3, items: { type: 'string' } },
    reasonCode: { type: 'string', enum: REASONS }, tauntId: { type: 'string', enum: TAUNTS },
  },
} as const;
function member<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new Error('Invalid public enum');
  return value as T;
}
function finite(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid public number');
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  const number = finite(value, min, max);
  if (!Number.isSafeInteger(number)) throw new Error('Invalid public integer');
  return number;
}
function identity(value: unknown, limit = 160): string {
  if (typeof value !== 'string' || !value.length || value.length > limit || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) throw new Error('Invalid public identity');
  return value;
}

/** Exact authored finite detail formats. No puzzle inputs or arbitrary prose. */
export function publicEvent(event: PublicEvent): PublicEvent {
  const type = EVENT_TYPES.has(event.type) ? event.type : 'UNKNOWN';
  let detail = '';
  const value = typeof event.detail === 'string' ? event.detail : '';
  if (type === 'RUN_STARTED' && /^(standard|demo|tutorial)$/.test(value)) detail = value;
  else if (type === 'FAULT_CLEARED' && /^(1|3)$/.test(value)) detail = value;
  else if (type === 'TASK_COMPLETE' && /^[1-4]$/.test(value)) detail = value;
  else if (type === 'WRONG_INPUT' && /^(FAULT|MEMORY|WIRE)$/.test(value)) detail = value;
  else if (['LURE_TRANSMITTED', 'LURE_ARRIVED'].includes(type) && /^(EMITTER_A|EMITTER_B|CONTAINMENT)$/.test(value)) detail = value;
  else if (type === 'APPROACH' && value === 'SHELTER') detail = value;
  else if (type === 'BREACH_WARNING' && /^(6|8|10)$/.test(value)) detail = value;
  else if (type === 'RESTORED' && /^(CLEAR|EARLY)$/.test(value)) detail = value;
  else if (type === 'SENSOR_TREND' && /^source=(presage|simulated|manual) quality=(accepted|rejected|unknown) trend=(UNKNOWN|STEADY|ELEVATED|RECOVERED)$/.test(value)) detail = value;
  else if (type === 'DIRECTOR_APPLIED' && /^(GEMINI|FALLBACK) (INVESTIGATE_SOUND|CIRCLE_SHELTER|LISTEN_NEAR|FOLLOW_LURE|WAIT|TAUNT|RETREAT) (SHELTER|EMITTER_A|EMITTER_B|CONTAINMENT|NONE)$/.test(value)) detail = value;
  else if (type === 'DIRECTOR_REJECTED' && /^(BAD_SHAPE|DUPLICATE|WRONG_REQUEST|EXPIRED|STALE_STATE|ILLEGAL_PHASE|ILLEGAL_PAIR|ILLEGAL_TAUNT|UNKNOWN_EVIDENCE|UNSUPPORTED_REASON)$/.test(value)) detail = value;
  else if (type === 'TAUNT' && (TAUNTS as readonly string[]).includes(value)) detail = value;
  else if (type === 'SCARE' && /^(impact|monitor|breach)$/.test(value)) detail = value;
  else if (type === 'MONSTER_STEP') {
    const match = /^from=(\d{1,2}) to=(\d{1,2}) step=(-?\d)$/.exec(value);
    if (match) {
      const from = Number(match[1]), to = Number(match[2]), step = Number(match[3]);
      if (from <= config.line.length && to <= config.line.length && Math.abs(step) <= config.line.maximumStep && to - from === step) detail = `from=${from} to=${to} step=${step}`;
    }
  }
  return { id: identity(event.id), seq: finite(event.seq, 1), time: finite(event.time), type, detail };
}

/** Repeated projection in renderer/main/server; hidden state cannot leak. */
export function publicDirectorRequest(raw: DirectorRequest): DirectorRequest {
  if (!raw || !Number.isSafeInteger(raw.stateVersion)) throw new Error('Invalid director request');
  const observed = raw.observations;
  if (!observed || !observed.sensor || !Array.isArray(raw.allowedTactics) || !raw.allowedTactics.length || !Array.isArray(raw.allowedTargets) || !raw.allowedTargets.length || !Array.isArray(raw.allowedTauntIds) || !Array.isArray(raw.allowedPairs) || !Array.isArray(raw.events) || !Array.isArray(raw.publicEventIds)) throw new Error('Invalid director observations');
  const issuedAtGameMs = finite(raw.issuedAtGameMs), expiresAtGameMs = finite(raw.expiresAtGameMs);
  if (expiresAtGameMs <= issuedAtGameMs || expiresAtGameMs - issuedAtGameMs > 10_000) throw new Error('Invalid request lifetime');
  const researchStage = finite(observed.researchStage, 1, 6);
  if (!Number.isInteger(researchStage)) throw new Error('Invalid stage');
  return {
    requestId: identity(raw.requestId, 128), stateVersion: finite(raw.stateVersion), issuedAtGameMs, expiresAtGameMs,
    allowedTactics: raw.allowedTactics.slice(0, 7).map(value => member(value, TACTICS)),
    allowedTargets: raw.allowedTargets.slice(0, 5).map(value => member(value, TARGETS)),
    allowedTauntIds: raw.allowedTauntIds.slice(0, 5).map(value => member(value, TAUNTS)),
    allowedPairs: raw.allowedPairs.slice(0, 35).map(pair => ({ tactic: member(pair.tactic, TACTICS), target: member(pair.target, TARGETS) })),
    publicEventIds: raw.publicEventIds.slice(-20).map(value => identity(value)), events: raw.events.slice(-20).map(publicEvent),
    observations: {
      equipmentState: member(observed.equipmentState, ['on', 'quiet', 'blackout']), researchStage: researchStage as DirectorRequest['observations']['researchStage'],
      creatureNode: member(observed.creatureNode, NODES), sedationBand: member(observed.sedationBand, ['SEDATED', 'RECOVERING', 'ALERT']),
      linePosition: integer(observed.linePosition, 0, config.line.length), lineLength: integer(observed.lineLength, config.line.length, config.line.length), danger: finite(observed.danger, 0, 100), quietChargesRemaining: integer(observed.quietChargesRemaining, 0, config.shutdown.charges),
      machineryClue: finite(observed.machineryClue, 0, 1), transientClue: finite(observed.transientClue, 0, 1), physiologyClue: finite(observed.physiologyClue, 0, 0.18),
      sensor: { source: member(observed.sensor.source, ['presage', 'simulated', 'manual']), quality: member(observed.sensor.quality, ['accepted', 'rejected', 'unknown']), trend: member(observed.sensor.trend, TRENDS) },
      earnedLure: observed.earnedLure ? { target: member(observed.earnedLure.target, ['EMITTER_A', 'EMITTER_B', 'CONTAINMENT']), protectedUntilGameMs: finite(observed.earnedLure.protectedUntilGameMs) } : null,
    },
  };
}
