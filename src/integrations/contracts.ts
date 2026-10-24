import type { DirectorRequest, PublicEvent } from '../game/state';

export type DirectorResult = { proposal: unknown | null; source: 'gemini' | 'fallback'; latencyMs: number; reason?: string; providerRequestId?: string };
export type SpeechRequest = { requestId: string; caption: string; encounterId: string; expiresAtMs: number };
export type SpeechResult = { audioBase64: string | null; mimeType: string; source: 'elevenlabs' | 'cached' | 'fallback'; reason?: string; latencyMs: number; providerRequestId?: string };
export type IntegrationStatus = { desktop: boolean; presage: boolean; gemini: boolean; elevenlabs: boolean; convex: boolean; reasons: string[] };
export interface DesktopBridge {
  status(): Promise<IntegrationStatus>;
  director(request: DirectorRequest): Promise<DirectorResult>;
  speech(request: SpeechRequest): Promise<SpeechResult>;
}
declare global { interface Window { nightRelay?: DesktopBridge } }

export const DIRECTOR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['requestId', 'stateVersion', 'tactic', 'evidenceEventIds', 'reasonCode'],
  properties: {
    requestId: { type: 'string' }, stateVersion: { type: 'integer' },
    tactic: { type: 'string', enum: ['WAIT', 'PROBE_LEFT', 'PROBE_RIGHT', 'REPLAY_ORDER', 'WRONG_HATCH', 'FEINT', 'RETREAT'] },
    evidenceEventIds: { type: 'array', maxItems: 3, items: { type: 'string' } },
    reasonCode: { type: 'string', enum: ['UNVERIFIED_OBEDIENCE', 'REPEATED_DOOR_PATTERN', 'VERIFIES_CALLS', 'RECOVERY_NEEDED', 'VARY_ENCOUNTER', 'NO_VALID_SIGNAL'] },
  },
} as const;

export function publicEvent(event: PublicEvent): PublicEvent {
  let detail = '';
  if (event.type === 'DOOR' && /^(left|right) shutter (open|closed)\.$/.test(event.detail)) detail = event.detail;
  else if (event.type === 'CALL_VERIFIED') {
    const match = /^(?:Checked call-\d+; result (MATCH|MISMATCH)\.|Verification result (MATCH|MISMATCH))$/.exec(event.detail);
    detail = match ? `Verification result ${match[1] ?? match[2]}` : '';
  } else if (event.type === 'APPROACH' || event.type === 'THRESHOLD' || event.type === 'SWEEP') {
    const patterns = {
      APPROACH: /^Footsteps and silhouette in the (left|right) corridor\. Minimum approach: 8 seconds\.$/,
      THRESHOLD: /^(left|right) threshold warning\. At least 6 seconds remain to defend\.$/,
      SWEEP: /^(left|right) confirmed clear until \d+(?:\.\d+)? seconds; 8 energy spent\.$/,
    };
    detail = /^(left|right)$/.test(event.detail) ? event.detail : patterns[event.type].exec(event.detail)?.[1] ?? '';
  }
  else if (event.type === 'SENSOR_TREND') detail = /^Quality-gated trend: (UNKNOWN|STEADY|ELEVATED|RECOVERED)\.$/.test(event.detail) ? event.detail : '';
  else if (event.type === 'TASK_COMPLETE') detail = /^Operation [1-3] completed\. Current task (2|3|complete)\.$/.test(event.detail) ? event.detail : '';
  else if (event.type === 'DIRECTOR_REJECTED') detail = /^Proposal rejected: (BAD_SHAPE|DUPLICATE|WRONG_REQUEST|EXPIRED|STALE_STATE|ILLEGAL_TACTIC|UNKNOWN_EVIDENCE)\.$/.test(event.detail) ? event.detail : '';
  else if (event.type === 'DIRECTOR_APPLIED') detail = /^(GEMINI|FALLBACK) selected (WAIT|PROBE_LEFT|PROBE_RIGHT|REPLAY_ORDER|WRONG_HATCH|FEINT|RETREAT); evidence (none|e\d+(, e\d+){0,2})\.$/.test(event.detail) ? event.detail : '';
  return { id: String(event.id).slice(0, 128), seq: event.seq, time: event.time, type: String(event.type).slice(0, 64), detail };
}

/** Explicit projection: objects carrying hidden game state cannot pass it through. */
export function publicDirectorRequest(raw: DirectorRequest): DirectorRequest {
  if (!raw || typeof raw.requestId !== 'string' || raw.requestId.length > 128 || !Number.isSafeInteger(raw.stateVersion) || !Number.isFinite(raw.expiresAt)) throw new Error('Invalid director identity');
  const allowed = DIRECTOR_SCHEMA.properties.tactic.enum;
  if (!Array.isArray(raw.allowedTactics) || !raw.allowedTactics.length || raw.allowedTactics.some(t => !(allowed as readonly string[]).includes(t))) throw new Error('Invalid tactics');
  if (!['UNKNOWN', 'STEADY', 'ELEVATED', 'RECOVERED'].includes(raw.trend)) throw new Error('Invalid trend');
  if (!Array.isArray(raw.events) || !Array.isArray(raw.evidenceEventIds)) throw new Error('Invalid evidence');
  return {
    requestId: raw.requestId, stateVersion: raw.stateVersion, allowedTactics: [...raw.allowedTactics], trend: raw.trend,
    // Whitelisted behavioral details preserve door choices and verification
    // outcomes without forwarding arbitrary prose or private challenge answers.
    events: raw.events.slice(-20).map(publicEvent),
    evidenceEventIds: raw.evidenceEventIds.slice(-20).map(id => String(id).slice(0, 128)), expiresAt: raw.expiresAt,
  };
}
