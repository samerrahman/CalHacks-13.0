// Pure WebRTC signaling rules shared by the module (signal.ts) and the browser (webrtc.ts).
// No server imports, so Node tests and the client can load it. Frames never pass through here.

export const SIGNAL = {
  MAX_PAYLOAD: 8192,
  MESSAGE_TTL_MS: 60_000,
  /** A join row gates a spectator's writes for the handshake only; media then flows peer to peer. */
  PEER_TTL_MS: 90_000,
  SWEEP_MS: 10_000,
  WINDOW_MS: 10_000,
  /** Messages a single spectator handshake may post or receive per window. */
  PEER_MAX: 30,
  /** Every signaling write in one session per window, joins and toggles included. */
  SESSION_MAX: 120,
  /** Fresh join rows per session; the player separately caps open peer connections. */
  MAX_PEERS: 6,
  MAX_PENDING: 200,
  MAX_ICE_BATCH: 16,
} as const;

/** Kinds a client may post in each direction. `join` and `leave` are written only by the server. */
export const TO_PLAYER = ['answer', 'ice'] as const;
export const TO_SPECTATOR = ['offer', 'ice', 'bye'] as const;
export const PLAYER_INBOX = ['join', 'leave', 'answer', 'ice'] as const;
export type Direction = 'to_player' | 'to_spectator';
export type SignalKind = 'join' | 'leave' | 'offer' | 'answer' | 'ice' | 'bye';
export type IceInit = { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null; usernameFragment?: string | null };

export const hex64 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** SDP is ASCII text lines; anything else (control bytes, oversize, no video section) is refused. */
export function validSdp(sdp: unknown): sdp is string {
  return typeof sdp === 'string' && sdp.length >= 20 && sdp.length <= SIGNAL.MAX_PAYLOAD && sdp.startsWith('v=0\r\n') && /^[\x20-\x7e\r\n]+$/.test(sdp) && /\r\nm=video /.test(sdp);
}

function validCandidate(c: unknown): c is IceInit {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  const { candidate, sdpMid, sdpMLineIndex, usernameFragment, ...rest } = c as Record<string, unknown>;
  if (Object.keys(rest).length) return false;
  if (typeof candidate !== 'string' || candidate.length > 512 || !/^candidate:[\x20-\x7e]+$/.test(candidate)) return false;
  if (sdpMid !== null && (typeof sdpMid !== 'string' || !/^[A-Za-z0-9_-]{0,32}$/.test(sdpMid))) return false;
  if (sdpMLineIndex !== null && (!Number.isInteger(sdpMLineIndex) || (sdpMLineIndex as number) < 0 || (sdpMLineIndex as number) > 7)) return false;
  if (sdpMid === null && sdpMLineIndex === null) return false;
  return usernameFragment === undefined || usernameFragment === null || typeof usernameFragment === 'string' && /^[\x21-\x7e]{0,64}$/.test(usernameFragment);
}

/** A batch of trickled ICE candidates, or null when any part is malformed. */
export function parseIce(payload: unknown): IceInit[] | null {
  if (typeof payload !== 'string' || payload.length > SIGNAL.MAX_PAYLOAD) return null;
  let value: unknown;
  try { value = JSON.parse(payload); } catch { return null; }
  if (!Array.isArray(value) || !value.length || value.length > SIGNAL.MAX_ICE_BATCH || !value.every(validCandidate)) return null;
  return value.map(c => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, ...(typeof c.usernameFragment === 'string' ? { usernameFragment: c.usernameFragment } : {}) }));
}

/** Shape check for every kind; the server applies it to writes and both clients to reads. */
export function validPayload(kind: string, payload: unknown): boolean {
  if (typeof payload !== 'string' || payload.length > SIGNAL.MAX_PAYLOAD) return false;
  if (kind === 'offer' || kind === 'answer') return validSdp(payload);
  if (kind === 'ice') return parseIce(payload) !== null;
  if (kind === 'bye') return payload === 'full' || payload === 'closed';
  if (kind === 'join' || kind === 'leave') return payload === '';
  return false;
}

export type RateWindow = { windowStartMs: bigint; windowCount: number };
/** Fixed-window counter. Returns the spent window, or null when the limit is already reached. */
export function spend(window: RateWindow, nowMs: bigint, max: number, spanMs = SIGNAL.WINDOW_MS): RateWindow | null {
  if (nowMs - window.windowStartMs >= BigInt(spanMs) || nowMs < window.windowStartMs) return { windowStartMs: nowMs, windowCount: 1 };
  if (window.windowCount >= max) return null;
  return { windowStartMs: window.windowStartMs, windowCount: window.windowCount + 1 };
}

/** Splits candidates into posts that each stay inside the batch and payload caps. */
export function iceBatches(candidates: readonly IceInit[]): string[] {
  const out: string[] = [];
  let batch: IceInit[] = [];
  for (const c of candidates) {
    if (!validCandidate(c)) continue;
    const next = [...batch, c];
    if (batch.length && (next.length > SIGNAL.MAX_ICE_BATCH || JSON.stringify(next).length > SIGNAL.MAX_PAYLOAD)) { out.push(JSON.stringify(batch)); batch = [c]; }
    else batch = next;
  }
  if (batch.length) out.push(JSON.stringify(batch));
  return out;
}
