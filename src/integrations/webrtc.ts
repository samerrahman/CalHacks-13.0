import { hex64, iceBatches, parseIce, PLAYER_INBOX, TO_SPECTATOR, validPayload, validSdp, type IceInit } from '../../spacetimedb/src/signalRules';
import { connectSpacetime, spacetimeConfig } from './spacetime';
import { parseWatchAccess } from './spectate';

// Live player camera for spectating friends. SpacetimeDB carries only the WebRTC handshake
// (offers, answers, ICE, all short-lived); video goes peer to peer and is never stored. Nothing
// here runs in the game step: everything is async, revalidated and disposable. See docs/CAMERA.md.

type Rows<R> = { iter(): Iterable<R>; onInsert(cb: () => void): void; onDelete(cb: () => void): void; removeOnInsert(cb: () => void): void; removeOnDelete(cb: () => void): void };
type Sub = { unsubscribe(): void };
type SubBuilder = { onApplied(cb: () => void): SubBuilder; onError(cb: () => void): SubBuilder; subscribe(queries: string[]): Sub };
type InboxRow = { id: bigint; spectatorKey: string; kind: string; payload: string };
type ShareFeedRow = { sessionId: string; live: boolean; epoch: number };
type OwnerSignal = { id: string; ownerCapability: string; spectatorKey: string; kind: string; payload: string };
type SpectatorArgs = { id: string; judgeCapability: string; spectatorKey: string };
/** The slice of the generated DbConnection this module uses (lets tests supply a fake). */
export type SignalConnection = {
  db: { cameraPlayerInbox: Rows<InboxRow>; cameraSpectatorInbox: Rows<InboxRow>; cameraShareFeed: Rows<ShareFeedRow> };
  reducers: {
    setCameraShare(args: { id: string; ownerCapability: string; live: boolean }): Promise<void>;
    joinCamera(args: SpectatorArgs): Promise<void>;
    leaveCamera(args: SpectatorArgs): Promise<void>;
    signalToSpectator(args: OwnerSignal): Promise<void>;
    signalToPlayer(args: SpectatorArgs & { kind: string; payload: string }): Promise<void>;
  };
  subscriptionBuilder(): SubBuilder;
  disconnect(): void;
};
type Timer = ReturnType<typeof setTimeout>;
type PeerFactory = (config: RTCConfiguration) => RTCPeerConnection;

const nodeEnv = typeof process === 'undefined' ? undefined : process.env;
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const MAX_QUEUED_ICE = 64, MAX_SENT_ICE = 40, ICE_FLUSH_MS = 120;
const byId = (a: InboxRow, b: InboxRow) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const defaultPeer: PeerFactory = config => new RTCPeerConnection(config);
const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach(t => { try { t.stop(); } catch { /* already stopped */ } });
const silence = () => { /* best effort; the next message or the sweep recovers */ };
function hex(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
function candidate(e: RTCPeerConnectionIceEvent): IceInit | null {
  if (!e.candidate?.candidate) return null;
  const c = e.candidate.toJSON();
  return { candidate: c.candidate ?? '', sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null, ...(c.usernameFragment ? { usernameFragment: c.usernameFragment } : {}) };
}
function inboxRows(rows: Iterable<InboxRow>, key: string | null, after: bigint): InboxRow[] {
  return [...rows].filter(r => typeof r?.id === 'bigint' && r.id > after && (key === null || r.spectatorKey === key)).sort(byId);
}
function subscribed(connection: SignalConnection, query: string, timeoutMs = 6000): Promise<Sub> {
  return new Promise((resolve, reject) => {
    let handle: Sub | null = null;
    const timer = setTimeout(() => { try { handle?.unsubscribe(); } catch { /* never applied */ } reject(new Error('Signaling subscription timed out')); }, timeoutMs);
    handle = connection.subscriptionBuilder().onApplied(() => { clearTimeout(timer); resolve(handle!); }).onError(() => { clearTimeout(timer); reject(new Error('Signaling subscription failed')); }).subscribe([query]);
  });
}

/** Public STUN/TURN list from VITE_RTC_ICE_SERVERS (JSON). Anything in it ships to every browser,
 * so it must never hold a secret; malformed input falls back to the public Google STUN server. */
export function iceServers(raw: unknown = import.meta.env?.VITE_RTC_ICE_SERVERS ?? nodeEnv?.VITE_RTC_ICE_SERVERS): RTCIceServer[] {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_ICE;
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list) || !list.length || list.length > 4) return DEFAULT_ICE;
    return list.map(entry => {
      const { urls, username, credential } = (entry ?? {}) as Record<string, unknown>;
      const all = typeof urls === 'string' ? [urls] : Array.isArray(urls) ? urls : [];
      if (!all.length || all.length > 4 || !all.every(u => typeof u === 'string' && /^(stun|turns?):[^\s]{1,250}$/.test(u))) throw new Error('urls');
      if (username !== undefined && typeof username !== 'string' || credential !== undefined && typeof credential !== 'string') throw new Error('credential');
      return { urls: all as string[], ...(username ? { username } : {}), ...(credential ? { credential } : {}) };
    });
  } catch { return DEFAULT_ICE; }
}

export function signalQuery(view: 'camera_player_inbox' | 'camera_share_feed', id: string, capability: string): string {
  if (!hex64(id) || !hex64(capability)) throw new Error('Invalid signaling access');
  return `SELECT * FROM ${view}('${id}', '${capability}')`;
}
export function spectatorInboxQuery(id: string, judgeCapability: string, spectatorKey: string): string {
  if (!hex64(id) || !hex64(judgeCapability) || !hex64(spectatorKey)) throw new Error('Invalid signaling access');
  return `SELECT * FROM camera_spectator_inbox('${id}', '${judgeCapability}', '${spectatorKey}')`;
}

export type CameraShareState = { status: 'off' | 'starting' | 'live' | 'stopping' | 'error'; viewers: number; connecting: number; camera: 'ready' | 'waiting'; message: string };
export const CAMERA_SHARE_OFF: CameraShareState = { status: 'off', viewers: 0, connecting: 0, camera: 'waiting', message: 'Camera sharing off' };
/** What TraceBridge hands over once its remote session exists. */
export type CameraSignalAccess = { connection: SignalConnection; sessionId: string; ownerCapability: string; judgeCapability?: string };
export type PlayerCameraOptions = {
  /** The camera stream the app already owns (SensorController in the desktop app). Never stopped here. */
  stream: () => MediaStream | null;
  /** Browser build only: opens a camera after consent when `stream` has none. Stopped on revoke. */
  capture?: () => Promise<MediaStream>;
  createPeer?: PeerFactory;
  iceServers?: RTCIceServer[];
  /** Open peer connections at once; each costs the player upload bandwidth. */
  maxViewers?: number;
  disconnectGraceMs?: number;
  /** False for a voice-only share: never opens a camera. The (empty) video line stays in the offer. */
  video?: boolean;
  /** Optional voice chat: every peer also carries a two-way audio line. `mic()` is the player's
   * microphone track (null keeps it silent); `onFriendAudio` receives each spectator's voice, or null when they leave. */
  voice?: { mic: () => MediaStreamTrack | null; onFriendAudio: (key: string, stream: MediaStream | null) => void };
};
type PlayerPeer = { key: string; pc: RTCPeerConnection; sender: RTCRtpSender | null; audio: RTCRtpSender | null; remote: boolean; answering: boolean; offered: boolean; inbound: IceInit[]; outbound: IceInit[]; sent: number; flush: Timer | null; grace: Timer | null };

/** The player's side: one sendonly peer connection per spectator key, offer first. */
export class PlayerCameraShare {
  private state: CameraShareState = CAMERA_SHARE_OFF;
  private listeners = new Set<(state: CameraShareState) => void>();
  private peers = new Map<string, PlayerPeer>();
  private owned: MediaStream | null = null;
  private handle: Sub | null = null;
  private lastId = 0n;
  private generation = 0;
  private active = false;
  private disposed = false;
  private readonly sync = () => this.drain();
  constructor(private readonly access: CameraSignalAccess, private readonly options: PlayerCameraOptions) {}

  get current(): CameraShareState { return this.state; }
  subscribe(listener: (state: CameraShareState) => void): () => void { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }

  /** Call only after the player's explicit consent. Resolves true once spectators can join. */
  async start(): Promise<boolean> {
    if (this.active || this.disposed) return this.state.status === 'live';
    const { connection, sessionId, ownerCapability } = this.access;
    if (!hex64(sessionId) || !hex64(ownerCapability)) { this.emit({ ...CAMERA_SHARE_OFF, status: 'error', message: 'Live camera needs the SpacetimeDB trace session' }); return false; }
    const generation = ++this.generation;
    this.active = true; this.lastId = 0n;
    this.emit({ ...CAMERA_SHARE_OFF, status: 'starting', message: 'Starting the live camera' });
    try {
      if (!this.track() && this.options.capture && this.options.video !== false) {
        const stream = await this.options.capture();
        if (generation !== this.generation) { stopTracks(stream); return false; }
        this.owned = stream;
        stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (generation === this.generation) this.refreshTrack(); }, { once: true }));
      }
      connection.db.cameraPlayerInbox.onInsert(this.sync); connection.db.cameraPlayerInbox.onDelete(this.sync);
      const handle = await subscribed(connection, signalQuery('camera_player_inbox', sessionId, ownerCapability));
      if (generation !== this.generation) { try { handle.unsubscribe(); } catch { /* ended */ } return false; }
      this.handle = handle;
      // Subscribe before turning sharing on: the server refuses joins while it is off, so none are missed.
      await connection.reducers.setCameraShare({ id: sessionId, ownerCapability, live: true });
      if (generation !== this.generation) return false;
      this.emit({ status: 'live', viewers: 0, connecting: 0, camera: this.track() ? 'ready' : 'waiting', message: 'Live · waiting for spectators' });
      this.drain();
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.generation++; this.teardown();
      this.emit({ ...CAMERA_SHARE_OFF, status: 'error', message: error instanceof Error && error.name === 'NotAllowedError' ? 'Camera permission denied · nothing was shared' : 'Live camera unavailable · nothing was shared' });
      return false;
    }
  }

  /** Revoke: closes every peer connection at once, stops only tracks opened here, then tells the server. */
  async stop(): Promise<void> {
    const wasActive = this.active;
    this.generation++; this.teardown();
    if (!wasActive) { this.emit(CAMERA_SHARE_OFF); return; }
    this.emit({ ...CAMERA_SHARE_OFF, status: 'stopping', message: 'Stopping the live camera' });
    try { await this.access.connection.reducers.setCameraShare({ id: this.access.sessionId, ownerCapability: this.access.ownerCapability, live: false }); this.emit(CAMERA_SHARE_OFF); }
    catch { this.emit({ ...CAMERA_SHARE_OFF, message: 'Camera stopped here · remote signaling is deleted with the session' }); }
  }
  dispose(): void { void this.stop().finally(() => { this.disposed = true; this.listeners.clear(); }); }

  /** Call when the app's camera stream changes; live connections switch tracks without renegotiating. */
  refreshTrack(): void {
    const track = this.track();
    for (const peer of this.peers.values()) if (peer.sender && peer.sender.track !== track) void peer.sender.replaceTrack(track).catch(silence);
    if (this.active && this.state.status === 'live') this.emit({ ...this.state, camera: track ? 'ready' : 'waiting' });
  }

  /** Call when the player's microphone turns on or off; live connections switch without renegotiating. */
  refreshMic(): void {
    const mic = this.options.voice?.mic() ?? null;
    for (const peer of this.peers.values()) if (peer.audio && peer.audio.track !== mic) void peer.audio.replaceTrack(mic).catch(silence);
  }

  private emit(state: CameraShareState): void { if (this.disposed) return; this.state = state; this.listeners.forEach(l => l(state)); }
  private track(): MediaStreamTrack | null {
    for (const stream of [this.options.stream(), this.owned]) { const track = stream?.getVideoTracks().find(t => t.readyState === 'live'); if (track) return track; }
    return null;
  }
  private teardown(): void {
    this.active = false;
    for (const key of [...this.peers.keys()]) this.close(key);
    const inbox = this.access.connection.db.cameraPlayerInbox;
    inbox.removeOnInsert(this.sync); inbox.removeOnDelete(this.sync);
    try { this.handle?.unsubscribe(); } catch { /* already ended */ }
    this.handle = null;
    stopTracks(this.owned); this.owned = null;
  }
  private drain(): void {
    if (!this.active || this.state.status !== 'live') return;
    for (const row of inboxRows(this.access.connection.db.cameraPlayerInbox.iter(), null, this.lastId)) { this.lastId = row.id; this.receive(row); }
  }
  private receive(row: InboxRow): void {
    if (!hex64(row.spectatorKey) || !(PLAYER_INBOX as readonly string[]).includes(row.kind) || !validPayload(row.kind, row.payload)) return;
    const peer = this.peers.get(row.spectatorKey);
    if (row.kind === 'join') { if (!peer) void this.open(row.spectatorKey); return; }
    if (!peer) return;
    if (row.kind === 'leave') this.close(peer.key);
    else if (row.kind === 'answer') void this.answer(peer, row.payload);
    else this.remoteIce(peer, parseIce(row.payload) ?? []);
  }
  private post(key: string, kind: 'offer' | 'ice' | 'bye', payload: string): Promise<void> {
    return this.access.connection.reducers.signalToSpectator({ id: this.access.sessionId, ownerCapability: this.access.ownerCapability, spectatorKey: key, kind, payload });
  }
  private async open(key: string): Promise<void> {
    if (this.peers.size >= (this.options.maxViewers ?? 4)) { void this.post(key, 'bye', 'full').catch(silence); return; }
    const generation = this.generation;
    const pc = (this.options.createPeer ?? defaultPeer)({ iceServers: this.options.iceServers ?? iceServers(), bundlePolicy: 'max-bundle' });
    const track = this.track();
    const { sender } = pc.addTransceiver(track ?? 'video', { direction: 'sendonly', sendEncodings: [{ maxBitrate: 600_000, maxFramerate: 24 }] });
    const voice = this.options.voice;
    const audio = voice ? pc.addTransceiver(voice.mic() ?? 'audio', { direction: 'sendrecv' }).sender : null;
    if (voice) pc.ontrack = e => { if (e.track.kind === 'audio' && this.peers.get(key)?.pc === pc) voice.onFriendAudio(key, e.streams[0] ?? new MediaStream([e.track])); };
    const peer: PlayerPeer = { key, pc, sender, audio, remote: false, answering: false, offered: false, inbound: [], outbound: [], sent: 0, flush: null, grace: null };
    this.peers.set(key, peer);
    pc.onicecandidate = e => { const c = candidate(e); if (c && peer.sent + peer.outbound.length < MAX_SENT_ICE) { peer.outbound.push(c); this.flushIce(peer); } };
    pc.onconnectionstatechange = () => this.peerState(peer);
    this.count();
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = pc.localDescription?.sdp ?? offer.sdp;
      if (this.peers.get(key) !== peer || generation !== this.generation) return;
      if (!validSdp(sdp)) throw new Error('Offer outside signaling limits');
      await this.post(key, 'offer', sdp);
      peer.offered = true; this.flushIce(peer);
    } catch { if (this.peers.get(key) === peer) this.close(key); }
  }
  private flushIce(peer: PlayerPeer): void {
    if (!peer.offered || peer.flush || !peer.outbound.length) return;
    peer.flush = setTimeout(() => {
      peer.flush = null;
      if (this.peers.get(peer.key) !== peer) return;
      const batch = peer.outbound.splice(0);
      peer.sent += batch.length;
      for (const payload of iceBatches(batch)) void this.post(peer.key, 'ice', payload).catch(silence);
    }, ICE_FLUSH_MS);
  }
  private async answer(peer: PlayerPeer, sdp: string): Promise<void> {
    if (peer.remote || peer.answering) return;
    peer.answering = true;
    try {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp });
      peer.remote = true;
      for (const c of peer.inbound.splice(0)) await peer.pc.addIceCandidate(c).catch(silence);
    } catch { this.close(peer.key); }
  }
  private remoteIce(peer: PlayerPeer, list: IceInit[]): void {
    if (!peer.remote) { peer.inbound.push(...list.slice(0, Math.max(0, MAX_QUEUED_ICE - peer.inbound.length))); return; }
    for (const c of list) void peer.pc.addIceCandidate(c).catch(silence);
  }
  private peerState(peer: PlayerPeer): void {
    if (this.peers.get(peer.key) !== peer) return;
    const state = peer.pc.connectionState;
    if (state === 'failed' || state === 'closed') { this.close(peer.key); return; }
    if (state === 'disconnected' && !peer.grace) peer.grace = setTimeout(() => { peer.grace = null; if (peer.pc.connectionState !== 'connected') this.close(peer.key); }, this.options.disconnectGraceMs ?? 15_000);
    if (state === 'connected' && peer.grace) { clearTimeout(peer.grace); peer.grace = null; }
    this.count();
  }
  private close(key: string): void {
    const peer = this.peers.get(key);
    if (!peer) return;
    this.peers.delete(key);
    if (peer.flush) clearTimeout(peer.flush);
    if (peer.grace) clearTimeout(peer.grace);
    peer.pc.onicecandidate = null; peer.pc.onconnectionstatechange = null; peer.pc.ontrack = null;
    try { peer.pc.close(); } catch { /* already closed */ }
    if (peer.audio) this.options.voice?.onFriendAudio(key, null);
    this.count();
  }
  private count(): void {
    if (!this.active || this.state.status !== 'live') return;
    const viewers = [...this.peers.values()].filter(p => p.pc.connectionState === 'connected').length, connecting = this.peers.size - viewers;
    if (viewers === this.state.viewers && connecting === this.state.connecting) return;
    this.emit({ ...this.state, viewers, connecting, message: viewers ? `Live · ${viewers} watching` : connecting ? 'Live · a spectator is connecting' : 'Live · waiting for spectators' });
  }
}

export type SpectatorCameraState = { status: 'unavailable' | 'connecting' | 'waiting' | 'joining' | 'live' | 'ended' | 'full' | 'error'; stream: MediaStream | null; message: string;
  /** The player's voice line, when their share offers voice chat. Play it only after the spectator chooses to listen. */
  audio?: MediaStream | null; voice?: boolean };
export type SpectatorCameraOptions = {
  sessionId: string;
  judgeCapability: string;
  connect: () => Promise<SignalConnection>;
  /** Disconnect on dispose (true when the connection was opened only for the camera). */
  ownsConnection?: boolean;
  createPeer?: PeerFactory;
  createStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  iceServers?: RTCIceServer[];
  newKey?: () => string;
  offerTimeoutMs?: number;
  retryMs?: number;
  fullRetryMs?: number;
  maxRetries?: number;
  disconnectGraceMs?: number;
};
type Attempt = { audio: RTCRtpSender | null; voice: MediaStream | null; key: string; handle: Sub | null; joined: boolean; pc: RTCPeerConnection | null; remote: boolean; answered: boolean; inbound: IceInit[]; outbound: IceInit[]; sent: number; stream: MediaStream | null; lastId: bigint; timer: Timer | null; flush: Timer | null; grace: Timer | null };

/** A spectator page's side: a fresh key per attempt, answer the player's offer, show the remote stream. */
export class SpectatorCamera {
  private state: SpectatorCameraState = { status: 'connecting', stream: null, message: 'Connecting to the live camera' };
  private listeners = new Set<(state: SpectatorCameraState) => void>();
  private connection: SignalConnection | null = null;
  private shareHandle: Sub | null = null;
  private attempt: Attempt | null = null;
  private epoch: number | null = null;
  private watched = false;
  private retries = 0;
  private retryTimer: Timer | null = null;
  private disposed = false;
  private mic: MediaStreamTrack | null = null;
  private readonly syncShare = () => this.share();
  private readonly syncInbox = () => this.drain();
  constructor(private readonly options: SpectatorCameraOptions) {}

  /** The spectator's own microphone for voice chat (null mutes it). Sent only on a voice line the player offered. */
  setMic(track: MediaStreamTrack | null): void {
    this.mic = track;
    const sender = this.attempt?.audio;
    if (sender && sender.track !== track) void sender.replaceTrack(track).catch(silence);
  }

  /** For `#watch=` pages: opens its own connection only when the link names this build's database. */
  static fromWatchHash(hash: string): SpectatorCamera {
    let access: ReturnType<typeof parseWatchAccess> | null = null;
    try { access = parseWatchAccess(hash); } catch { /* reported below */ }
    const remote = !!access && access.host === spacetimeConfig.uri && access.database === spacetimeConfig.database && !!spacetimeConfig.database && hex64(access.sessionId) && hex64(access.capability);
    const camera = new SpectatorCamera({ sessionId: access?.sessionId ?? '', judgeCapability: access?.capability ?? '', connect: () => connectSpacetime(), ownsConnection: true });
    if (remote) void camera.start();
    else camera.emit({ status: 'unavailable', stream: null, message: access ? 'The live camera needs SpacetimeDB; this link works in the same browser only' : 'Invalid or missing spectate link' });
    return camera;
  }

  get current(): SpectatorCameraState { return this.state; }
  subscribe(listener: (state: SpectatorCameraState) => void): () => void { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }

  async start(): Promise<void> {
    if (this.connection || this.disposed) return;
    const { sessionId, judgeCapability } = this.options;
    let query: string;
    try { query = signalQuery('camera_share_feed', sessionId, judgeCapability); }
    catch { this.emit({ status: 'unavailable', stream: null, message: 'Invalid spectate link' }); return; }
    try {
      const connection = await this.options.connect();
      if (this.disposed) { if (this.options.ownsConnection) connection.disconnect(); return; }
      this.connection = connection;
      connection.db.cameraShareFeed.onInsert(this.syncShare); connection.db.cameraShareFeed.onDelete(this.syncShare);
      connection.db.cameraSpectatorInbox.onInsert(this.syncInbox); connection.db.cameraSpectatorInbox.onDelete(this.syncInbox);
      this.shareHandle = await subscribed(connection, query);
      if (this.disposed) return;
      this.share();
    } catch { if (!this.disposed) this.emit({ status: 'unavailable', stream: null, message: 'SpacetimeDB unavailable · no live camera' }); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const leaving = this.end(true);
    const connection = this.connection;
    this.connection = null;
    if (connection) {
      connection.db.cameraShareFeed.removeOnInsert(this.syncShare); connection.db.cameraShareFeed.removeOnDelete(this.syncShare);
      connection.db.cameraSpectatorInbox.removeOnInsert(this.syncInbox); connection.db.cameraSpectatorInbox.removeOnDelete(this.syncInbox);
      try { this.shareHandle?.unsubscribe(); } catch { /* ended */ }
      // Give the leave call a moment to go out before closing the socket.
      if (this.options.ownsConnection) void Promise.race([leaving, new Promise(r => setTimeout(r, 800))]).finally(() => connection.disconnect());
    }
    this.listeners.clear();
  }

  private emit(state: SpectatorCameraState): void { if (this.disposed) return; this.state = state; this.listeners.forEach(l => l(state)); }
  private share(): void {
    const connection = this.connection;
    if (!connection || this.disposed) return;
    const row = [...connection.db.cameraShareFeed.iter()].find(r => r?.sessionId === this.options.sessionId);
    const live = row?.live === true && Number.isInteger(row.epoch) && row.epoch > 0;
    if (!live) {
      this.epoch = null; this.end(false);
      if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
      this.emit({ status: this.watched ? 'ended' : 'waiting', stream: null, message: this.watched ? 'The player stopped sharing their camera' : 'The player is not sharing their camera right now' });
      return;
    }
    if (this.epoch === row.epoch) return;
    this.epoch = row.epoch; this.retries = 0;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    void this.end(true);
    this.begin();
  }
  private begin(): void {
    const connection = this.connection;
    if (!connection || this.disposed || this.epoch === null) return;
    const { sessionId: id, judgeCapability } = this.options;
    const key = (this.options.newKey ?? hex)();
    const attempt: Attempt = { audio: null, voice: null, key, handle: null, joined: false, pc: null, remote: false, answered: false, inbound: [], outbound: [], sent: 0, stream: null, lastId: 0n, timer: null, flush: null, grace: null };
    this.attempt = attempt;
    this.emit({ status: 'joining', stream: null, message: 'Asking the player for their camera' });
    attempt.timer = setTimeout(() => this.retry(attempt, 'No answer from the player yet · retrying'), this.options.offerTimeoutMs ?? 20_000);
    let query: string;
    try { query = spectatorInboxQuery(id, judgeCapability, key); } catch { this.retry(attempt); return; }
    void subscribed(connection, query).then(handle => {
      if (this.attempt !== attempt) { try { handle.unsubscribe(); } catch { /* ended */ } return; }
      attempt.handle = handle;
      attempt.joined = true;
      return connection.reducers.joinCamera({ id, judgeCapability, spectatorKey: key }).then(() => this.drain(), (error: unknown) => {
        if (this.attempt !== attempt) return;
        attempt.joined = false;
        const text = error instanceof Error ? error.message : String(error);
        if (/full/i.test(text)) this.full(attempt);
        else if (/not shared/i.test(text)) { void this.end(false); this.emit({ status: 'waiting', stream: null, message: 'The player is not sharing their camera right now' }); }
        else this.retry(attempt);
      });
    }, () => this.retry(attempt));
  }
  private drain(): void {
    const attempt = this.attempt, connection = this.connection;
    if (!attempt || !connection) return;
    for (const row of inboxRows(connection.db.cameraSpectatorInbox.iter(), attempt.key, attempt.lastId)) {
      attempt.lastId = row.id;
      if (!(TO_SPECTATOR as readonly string[]).includes(row.kind) || !validPayload(row.kind, row.payload)) continue;
      if (row.kind === 'offer') { if (!attempt.pc) void this.accept(attempt, row.payload); }
      else if (row.kind === 'ice') this.remoteIce(attempt, parseIce(row.payload) ?? []);
      else if (row.payload === 'full') { this.full(attempt); return; }
      else { this.retry(attempt); return; }
      if (this.attempt !== attempt) return;
    }
  }
  private post(attempt: Attempt, kind: 'answer' | 'ice', payload: string): Promise<void> {
    if (!this.connection) return Promise.reject(new Error('Disconnected'));
    return this.connection.reducers.signalToPlayer({ id: this.options.sessionId, judgeCapability: this.options.judgeCapability, spectatorKey: attempt.key, kind, payload });
  }
  private async accept(attempt: Attempt, sdp: string): Promise<void> {
    const pc = (this.options.createPeer ?? defaultPeer)({ iceServers: this.options.iceServers ?? iceServers(), bundlePolicy: 'max-bundle' });
    attempt.pc = pc;
    pc.ontrack = e => {
      if (this.attempt !== attempt) return;
      if (e.track.kind === 'audio') { attempt.voice = e.streams[0] ?? (this.options.createStream ?? (tracks => new MediaStream(tracks)))([e.track]); if (this.state.status === 'live') this.emit({ ...this.state, audio: attempt.voice, voice: true }); return; }
      if (e.track.kind !== 'video') return;
      attempt.stream = e.streams[0] ?? (this.options.createStream ?? (tracks => new MediaStream(tracks)))([e.track]);
      if (pc.connectionState === 'connected') this.live(attempt);
    };
    pc.onicecandidate = e => { const c = candidate(e); if (c && attempt.sent + attempt.outbound.length < MAX_SENT_ICE) { attempt.outbound.push(c); this.flushIce(attempt); } };
    pc.onconnectionstatechange = () => this.peerState(attempt);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      attempt.remote = true;
      // Voice chat: answer the player's audio line two-way, silent until this spectator turns their mic on.
      const line = pc.getTransceivers?.().find(t => t.receiver?.track?.kind === 'audio');
      if (line) { line.direction = 'sendrecv'; attempt.audio = line.sender; if (this.mic) await line.sender.replaceTrack(this.mic).catch(silence); }
      for (const c of attempt.inbound.splice(0)) await pc.addIceCandidate(c).catch(silence);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const local = pc.localDescription?.sdp ?? answer.sdp;
      if (this.attempt !== attempt) return;
      if (!validSdp(local)) throw new Error('Answer outside signaling limits');
      await this.post(attempt, 'answer', local);
      attempt.answered = true; this.flushIce(attempt);
    } catch { this.retry(attempt); }
  }
  private flushIce(attempt: Attempt): void {
    if (!attempt.answered || attempt.flush || !attempt.outbound.length) return;
    attempt.flush = setTimeout(() => {
      attempt.flush = null;
      if (this.attempt !== attempt) return;
      const batch = attempt.outbound.splice(0);
      attempt.sent += batch.length;
      for (const payload of iceBatches(batch)) void this.post(attempt, 'ice', payload).catch(silence);
    }, ICE_FLUSH_MS);
  }
  private remoteIce(attempt: Attempt, list: IceInit[]): void {
    if (!attempt.pc || !attempt.remote) { attempt.inbound.push(...list.slice(0, Math.max(0, MAX_QUEUED_ICE - attempt.inbound.length))); return; }
    for (const c of list) void attempt.pc.addIceCandidate(c).catch(silence);
  }
  private peerState(attempt: Attempt): void {
    const pc = attempt.pc;
    if (this.attempt !== attempt || !pc) return;
    const state = pc.connectionState;
    if (state === 'connected') {
      if (attempt.timer) { clearTimeout(attempt.timer); attempt.timer = null; }
      if (attempt.grace) { clearTimeout(attempt.grace); attempt.grace = null; }
      this.retries = 0; this.watched = true;
      this.live(attempt);
    } else if (state === 'failed' || state === 'closed') this.retry(attempt, 'Lost the camera connection · retrying');
    else if (state === 'disconnected' && !attempt.grace) attempt.grace = setTimeout(() => { attempt.grace = null; if (pc.connectionState !== 'connected') this.retry(attempt, 'Lost the camera connection · retrying'); }, this.options.disconnectGraceMs ?? 10_000);
  }
  private live(attempt: Attempt): void {
    if (!attempt.stream && attempt.pc) {
      const tracks = attempt.pc.getReceivers().map(r => r.track).filter(t => t?.kind === 'video');
      if (tracks.length) attempt.stream = (this.options.createStream ?? (all => new MediaStream(all)))(tracks);
    }
    if (attempt.stream) this.emit({ status: 'live', stream: attempt.stream, message: 'Live · peer to peer from the player', audio: attempt.voice, voice: !!attempt.audio });
  }
  private full(attempt: Attempt): void {
    if (this.attempt !== attempt) return;
    void this.end(true);
    this.emit({ status: 'full', stream: null, message: 'The player’s camera has as many viewers as it can take · retrying soon' });
    this.later(this.options.fullRetryMs ?? 30_000);
  }
  private retry(attempt: Attempt, message = 'Reconnecting to the camera'): void {
    if (this.attempt !== attempt || this.disposed) return;
    void this.end(true);
    if (this.epoch === null) return;
    if (++this.retries > (this.options.maxRetries ?? 5)) { this.emit({ status: 'error', stream: null, message: 'Could not reach the player’s camera · reload to try again' }); return; }
    this.emit({ status: 'joining', stream: null, message });
    this.later((this.options.retryMs ?? 2000) * this.retries);
  }
  private later(ms: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (!this.attempt && this.epoch !== null && !this.disposed) this.begin(); }, ms);
  }
  /** Ends the current attempt; with `leave`, tells the server so the player closes its side. */
  private end(leave: boolean): Promise<void> {
    const attempt = this.attempt;
    if (!attempt) return Promise.resolve();
    this.attempt = null;
    for (const timer of [attempt.timer, attempt.flush, attempt.grace]) if (timer) clearTimeout(timer);
    if (attempt.pc) { attempt.pc.ontrack = null; attempt.pc.onicecandidate = null; attempt.pc.onconnectionstatechange = null; try { attempt.pc.close(); } catch { /* closed */ } }
    try { attempt.handle?.unsubscribe(); } catch { /* ended */ }
    if (!leave || !attempt.joined || !this.connection) return Promise.resolve();
    return this.connection.reducers.leaveCamera({ id: this.options.sessionId, judgeCapability: this.options.judgeCapability, spectatorKey: attempt.key }).catch(silence);
  }
}
