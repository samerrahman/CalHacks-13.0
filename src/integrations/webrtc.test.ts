import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { iceServers, PlayerCameraShare, signalQuery, SpectatorCamera, spectatorInboxQuery, type SignalConnection, type SpectatorCameraOptions } from './webrtc';
import { hex64, TO_PLAYER, TO_SPECTATOR, validPayload, validSdp } from '../../spacetimedb/src/signalRules';

// WebRTC cannot run in Node: RTCPeerConnection and MediaStream are mocks, and the SpacetimeDB
// connection is an in-memory fake with the module's view and reducer rules. The real module is
// exercised separately by spacetimedb/tests/liveSignal.mts against a local server.

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await tick(5); }
}
const SDP = (tag: string) => `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=x-tag:${tag}\r\n`;
const jsonBig = (value: unknown) => JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v);

type Msg = { id: bigint; key: string; direction: 'to_player' | 'to_spectator'; kind: string; payload: string };
type Call = { name: string; args: Record<string, unknown> };
class FakeTable<R> {
  cache: R[] = [];
  private ins = new Set<() => void>();
  private del = new Set<() => void>();
  iter(): Iterable<R> { return [...this.cache]; }
  onInsert(cb: () => void) { this.ins.add(cb); }
  onDelete(cb: () => void) { this.del.add(cb); }
  removeOnInsert(cb: () => void) { this.ins.delete(cb); }
  removeOnDelete(cb: () => void) { this.del.delete(cb); }
  get callbacks() { return this.ins.size + this.del.size; }
  set(rows: R[]) { if (jsonBig(rows) === jsonBig(this.cache)) return; this.cache = rows; this.ins.forEach(c => c()); this.del.forEach(c => c()); }
}
class Hub {
  readonly id = hex(); readonly owner = hex(); readonly judge = hex();
  share: { live: boolean; epoch: number } | null = null;
  peers = new Set<string>();
  messages: Msg[] = [];
  calls: Call[] = [];
  conns = new Set<FakeConn>();
  maxPeers = 6;
  private next = 1n;
  connect() { const c = new FakeConn(this); this.conns.add(c); return c; }
  changed() { setTimeout(() => this.conns.forEach(c => c.refresh()), 0); }
  post(key: string, direction: Msg['direction'], kind: string, payload: string) { this.messages.push({ id: this.next++, key, direction, kind, payload }); this.changed(); }
  calledWith(name: string) { return this.calls.filter(c => c.name === name).map(c => c.args); }
}
class FakeConn {
  subs: { view: string; args: string[] }[] = [];
  disconnected = false;
  db = { cameraPlayerInbox: new FakeTable<Msg & { spectatorKey: string }>(), cameraSpectatorInbox: new FakeTable<Msg & { spectatorKey: string }>(), cameraShareFeed: new FakeTable<{ sessionId: string; live: boolean; epoch: number }>() };
  constructor(private hub: Hub) {}
  private async call(name: string, args: Record<string, unknown>, apply: () => void): Promise<void> {
    await Promise.resolve();
    this.hub.calls.push({ name, args });
    apply();
    this.hub.changed();
  }
  private owner(a: { id: string; ownerCapability: string }) { if (a.id !== this.hub.id || a.ownerCapability !== this.hub.owner) throw new Error('Session unavailable'); }
  private watcher(a: { id: string; judgeCapability: string }) { if (a.id !== this.hub.id || a.judgeCapability !== this.hub.judge) throw new Error('Session unavailable'); }
  private live() { if (!this.hub.share?.live) throw new Error('Camera not shared'); }
  reducers: SignalConnection['reducers'] = {
    setCameraShare: a => this.call('setCameraShare', a, () => {
      this.owner(a);
      const s = this.hub.share;
      if (!s) { if (a.live) this.hub.share = { live: true, epoch: 1 }; return; }
      if (!a.live) { this.hub.peers.clear(); this.hub.messages = []; }
      if (s.live !== a.live) this.hub.share = { live: a.live, epoch: a.live ? s.epoch + 1 : s.epoch };
    }),
    joinCamera: a => this.call('joinCamera', a, () => {
      this.watcher(a); if (!hex64(a.spectatorKey)) throw new Error('Invalid spectator'); this.live();
      if (this.hub.peers.has(a.spectatorKey)) return;
      if (this.hub.peers.size >= this.hub.maxPeers) throw new Error('Camera full');
      this.hub.peers.add(a.spectatorKey); this.hub.post(a.spectatorKey, 'to_player', 'join', '');
    }),
    leaveCamera: a => this.call('leaveCamera', a, () => {
      this.watcher(a);
      this.hub.peers.delete(a.spectatorKey); this.hub.messages = this.hub.messages.filter(m => m.key !== a.spectatorKey);
      if (this.hub.share?.live) this.hub.post(a.spectatorKey, 'to_player', 'leave', '');
    }),
    signalToSpectator: a => this.call('signalToSpectator', a, () => {
      this.owner(a); if (!(TO_SPECTATOR as readonly string[]).includes(a.kind) || !validPayload(a.kind, a.payload)) throw new Error('Invalid signal'); this.live();
      if (!this.hub.peers.has(a.spectatorKey)) throw new Error('Spectator unavailable');
      this.hub.post(a.spectatorKey, 'to_spectator', a.kind, a.payload);
    }),
    signalToPlayer: a => this.call('signalToPlayer', a, () => {
      this.watcher(a); if (!(TO_PLAYER as readonly string[]).includes(a.kind) || !validPayload(a.kind, a.payload)) throw new Error('Invalid signal'); this.live();
      if (!this.hub.peers.has(a.spectatorKey)) throw new Error('Spectator unavailable');
      this.hub.post(a.spectatorKey, 'to_player', a.kind, a.payload);
    }),
  };
  subscriptionBuilder() {
    let applied: (() => void) | undefined;
    const builder = {
      onApplied: (cb: () => void) => { applied = cb; return builder; },
      onError: (_cb: () => void) => builder,
      subscribe: (queries: string[]) => {
        const subs = queries.map(q => { const m = /^SELECT \* FROM (\w+)\((.*)\)$/.exec(q)!; return { view: m[1]!, args: m[2]!.split(', ').map(s => s.slice(1, -1)) }; });
        this.subs.push(...subs);
        setTimeout(() => { this.refresh(); applied?.(); }, 0);
        return { unsubscribe: () => { this.subs = this.subs.filter(s => !subs.includes(s)); this.hub.changed(); } };
      },
    };
    return builder;
  }
  refresh() {
    const h = this.hub, row = (m: Msg) => ({ ...m, spectatorKey: m.key });
    const has = (view: string, match: (args: string[]) => boolean) => this.subs.some(s => s.view === view && match(s.args));
    this.db.cameraPlayerInbox.set(has('camera_player_inbox', a => a[0] === h.id && a[1] === h.owner) ? h.messages.filter(m => m.direction === 'to_player').map(row) : []);
    this.db.cameraSpectatorInbox.set(h.messages.filter(m => m.direction === 'to_spectator' && has('camera_spectator_inbox', a => a[0] === h.id && a[1] === h.judge && a[2] === m.key)).map(row));
    this.db.cameraShareFeed.set(h.share && has('camera_share_feed', a => a[0] === h.id && a[1] === h.judge) ? [{ sessionId: h.id, ...h.share }] : []);
  }
  disconnect() { this.disconnected = true; this.hub.conns.delete(this); }
}

class MockTrack { kind = 'video'; readyState: MediaStreamTrackState = 'live'; stopped = false; constructor(readonly label: string) {} stop() { this.stopped = true; this.readyState = 'ended'; } addEventListener() { /* unused */ } }
const streamOf = (...tracks: MockTrack[]) => ({ id: tracks.map(t => t.label).join('+'), getVideoTracks: () => tracks, getTracks: () => tracks }) as unknown as MediaStream;
class MockSender { replaced: unknown[] = []; constructor(public track: unknown) {} async replaceTrack(t: unknown) { this.replaced.push(t); this.track = t; } }
const candidateEvent = (n: number) => { const init = { candidate: `candidate:${n} 1 udp 2122260223 192.0.2.${n} ${54400 + n} typ host`, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: `u${n}` }; return { candidate: { ...init, toJSON: () => init } }; };
class MockPeer {
  static all: MockPeer[] = [];
  static offers = new Map<string, MockPeer>();
  static seq = 0;
  readonly n = ++MockPeer.seq;
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  onicecandidate: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  transceivers: { sender: MockSender; init: RTCRtpTransceiverInit }[] = [];
  added: RTCIceCandidateInit[] = [];
  remoteCalls = 0;
  closed = false;
  other: MockPeer | null = null;
  constructor(readonly config: RTCConfiguration) { MockPeer.all.push(this); }
  addTransceiver(trackOrKind: unknown, init: RTCRtpTransceiverInit) { const sender = new MockSender(typeof trackOrKind === 'string' ? null : trackOrKind); this.transceivers.push({ sender, init }); return { sender }; }
  async createOffer() { return { type: 'offer' as const, sdp: SDP(`offer-${this.n}`) }; }
  async createAnswer() { return { type: 'answer' as const, sdp: SDP(`answer-${this.n}`) }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.localDescription = d;
    if (d.type === 'offer') MockPeer.offers.set(d.sdp!, this);
    setTimeout(() => { if (!this.closed) { this.onicecandidate?.(candidateEvent(this.n)); this.onicecandidate?.({ candidate: null }); } }, 1);
    this.settle();
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remoteCalls++;
    this.remoteDescription = d;
    const offerer = d.type === 'offer' ? MockPeer.offers.get(d.sdp!) : undefined;
    if (offerer) { this.other = offerer; offerer.other = this; this.ontrack?.({ track: offerer.transceivers[0]?.sender.track ?? new MockTrack('placeholder'), streams: [] }); }
    this.settle();
  }
  async addIceCandidate(c: RTCIceCandidateInit) { this.added.push(c); }
  getReceivers() { return []; }
  /** Answerer side of the player's optional voice line (the offerer's second, sendrecv transceiver). */
  audioLine: { receiver: { track: { kind: string } }; direction: RTCRtpTransceiverDirection; sender: MockSender } | null = null;
  getTransceivers() {
    if (!this.transceivers.length && this.other?.transceivers.some(t => t.init.direction === 'sendrecv')) this.audioLine ??= { receiver: { track: { kind: 'audio' } }, direction: 'recvonly', sender: new MockSender(null) };
    return this.audioLine ? [this.audioLine] : [];
  }
  settle() { const o = this.other; if (!o || !this.localDescription || !this.remoteDescription || !o.localDescription || !o.remoteDescription) return; for (const p of [this, o]) if (p.connectionState === 'new') p.state('connected'); }
  state(s: RTCPeerConnectionState) { this.connectionState = s; this.onconnectionstatechange?.(); }
  close() { this.closed = true; this.connectionState = 'closed'; }
}
const createPeer = (c: RTCConfiguration) => new MockPeer(c) as unknown as RTCPeerConnection;
const createStream = (tracks: MediaStreamTrack[]) => streamOf(...(tracks as unknown as MockTrack[]));
const senders = () => MockPeer.all.filter(p => p.transceivers.length);
const receivers = () => MockPeer.all.filter(p => !p.transceivers.length);
const playerFor = (hub: Hub, options: Partial<ConstructorParameters<typeof PlayerCameraShare>[1]> = {}) => new PlayerCameraShare({ connection: hub.connect(), sessionId: hub.id, ownerCapability: hub.owner }, { stream: () => null, createPeer, iceServers: [], ...options });
const spectatorFor = (hub: Hub, options: Partial<SpectatorCameraOptions> = {}) => { const conn = hub.connect(); return { conn, camera: new SpectatorCamera({ sessionId: hub.id, judgeCapability: hub.judge, connect: async () => conn, ownsConnection: true, createPeer, createStream, iceServers: [], retryMs: 10, ...options }) }; };
beforeEach(() => { MockPeer.all = []; MockPeer.offers.clear(); });

test('ICE servers come from public JSON config and fall back to public STUN', () => {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  assert.deepEqual(iceServers(undefined), fallback);
  assert.deepEqual(iceServers(''), fallback);
  assert.deepEqual(iceServers('not json'), fallback);
  assert.deepEqual(iceServers('[{"urls":"https://example.com"}]'), fallback, 'only stun/turn URLs');
  assert.deepEqual(iceServers('[{"urls":"stun:a.example:3478"},{"urls":["turn:b.example:3478?transport=udp"],"username":"u","credential":"c"}]'), [{ urls: ['stun:a.example:3478'] }, { urls: ['turn:b.example:3478?transport=udp'], username: 'u', credential: 'c' }]);
  assert.deepEqual(iceServers('[{"urls":"stun:a","credential":5}]'), fallback);
});

test('signaling queries only carry validated hex access', () => {
  const a = hex(), b = hex(), c = hex();
  assert.equal(signalQuery('camera_player_inbox', a, b), `SELECT * FROM camera_player_inbox('${a}', '${b}')`);
  assert.equal(spectatorInboxQuery(a, b, c), `SELECT * FROM camera_spectator_inbox('${a}', '${b}', '${c}')`);
  assert.throws(() => signalQuery('camera_share_feed', a, `${b.slice(1)}'`));
  assert.throws(() => spectatorInboxQuery(a, b, 'x'));
});

test('a spectator gets the player camera peer to peer, then revoke closes every connection', async () => {
  const hub = new Hub(), sensor = new MockTrack('sensor');
  const player = playerFor(hub, { stream: () => streamOf(sensor) });
  assert.equal(await player.start(), true);
  assert.deepEqual(hub.share, { live: true, epoch: 1 });
  assert.equal(player.current.camera, 'ready');
  const a = spectatorFor(hub), b = spectatorFor(hub);
  void a.camera.start(); void b.camera.start();
  await until(() => a.camera.current.status === 'live' && b.camera.current.status === 'live');
  await until(() => player.current.viewers === 2);
  const out = senders(), into = receivers();
  assert.equal(out.length, 2);
  assert.ok(out.every(p => p.transceivers[0]!.init.direction === 'sendonly' && p.transceivers[0]!.sender.track === sensor), 'sends the existing SensorController track, sendonly');
  assert.ok(into.every(p => p.transceivers.length === 0), 'spectators never send media');
  assert.equal((a.camera.current.stream!.getVideoTracks()[0] as unknown as MockTrack), sensor);
  await until(() => out.every(p => p.added.length > 0) && into.every(p => p.added.length > 0));
  // Only SDP and ICE ever crossed the database, each within the signaling limits.
  const posts = [...hub.calledWith('signalToSpectator'), ...hub.calledWith('signalToPlayer')];
  assert.deepEqual([...new Set(posts.map(p => p.kind))].sort(), ['answer', 'ice', 'offer']);
  assert.ok(posts.every(p => validPayload(p.kind as string, p.payload)));
  assert.ok(hub.calledWith('signalToSpectator').filter(p => p.kind === 'offer').every(p => validSdp(p.payload)));

  await player.stop();
  assert.ok(out.every(p => p.closed), 'revoke closes every player peer connection at once');
  assert.equal(sensor.stopped, false, 'the camera owned by SensorController keeps running');
  assert.deepEqual(hub.share, { live: false, epoch: 1 });
  assert.equal(hub.messages.length, 0);
  assert.equal(hub.peers.size, 0);
  assert.equal(player.current.status, 'off');
  await until(() => a.camera.current.status === 'ended' && b.camera.current.status === 'ended');
  assert.ok(into.every(p => p.closed));
  assert.equal(a.camera.current.stream, null);
  const playerConn = [...hub.conns][0]!;
  assert.equal(playerConn.db.cameraPlayerInbox.callbacks, 0, 'player listeners removed');
  assert.equal(playerConn.subs.length, 0, 'player inbox unsubscribed');

  // Turning it back on is a new epoch; waiting spectators reconnect with fresh keys.
  const firstKeys = new Set(hub.calledWith('joinCamera').map(j => j.spectatorKey));
  assert.equal(await player.start(), true);
  await until(() => a.camera.current.status === 'live');
  assert.equal(hub.share!.epoch, 2);
  assert.ok(hub.calledWith('joinCamera').slice(2).every(j => !firstKeys.has(j.spectatorKey as string)));
  a.camera.dispose(); b.camera.dispose(); await player.stop();
  await until(() => a.conn.disconnected && b.conn.disconnected);
});

test('the browser build opens its own camera only after consent and stops only that track', async () => {
  const hub = new Hub(), own = new MockTrack('browser');
  let captures = 0;
  const player = playerFor(hub, { capture: async () => { captures++; return streamOf(own); } });
  assert.equal(captures, 0, 'nothing opens before start()');
  await player.start();
  assert.equal(captures, 1);
  assert.equal(player.current.camera, 'ready');
  const s = spectatorFor(hub);
  void s.camera.start();
  await until(() => s.camera.current.status === 'live');
  await player.stop();
  assert.equal(own.stopped, true, 'a camera opened for sharing is released on revoke');
  s.camera.dispose();

  const denied = new Hub();
  const refused = playerFor(denied, { capture: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } });
  assert.equal(await refused.start(), false);
  assert.equal(refused.current.status, 'error');
  assert.match(refused.current.message, /permission denied · nothing was shared/);
  assert.equal(denied.calledWith('setCameraShare').length, 0, 'sharing never turned on');
});

test('desktop without a running capture waits, then switches tracks without renegotiating', async () => {
  const hub = new Hub();
  let stream: MediaStream | null = null;
  const player = playerFor(hub, { stream: () => stream });
  await player.start();
  assert.equal(player.current.camera, 'waiting');
  const s = spectatorFor(hub);
  void s.camera.start();
  await until(() => s.camera.current.status === 'live');
  const sender = senders()[0]!.transceivers[0]!.sender;
  assert.equal(sender.track, null);
  const sensor = new MockTrack('sensor');
  stream = streamOf(sensor); player.refreshTrack();
  assert.deepEqual(sender.replaced, [sensor]);
  assert.equal(player.current.camera, 'ready');
  const offers = hub.calledWith('signalToSpectator').filter(p => p.kind === 'offer').length;
  await tick();
  assert.equal(hub.calledWith('signalToSpectator').filter(p => p.kind === 'offer').length, offers, 'no new offer');
  s.camera.dispose(); await player.stop();
});

test('malformed signaling rows are ignored by the player and the spectator', async () => {
  const hub = new Hub();
  const player = playerFor(hub);
  await player.start();
  const key = hex();
  hub.peers.add(key); hub.post(key, 'to_player', 'join', '');
  await until(() => senders().some(p => p.localDescription));
  const pc = MockPeer.all.at(-1)!;
  hub.post(key, 'to_player', 'answer', SDP('x').replace('m=video', 'm=audio'));
  hub.post(key, 'to_player', 'answer', `${SDP('x')}a=x:${'y'.repeat(9000)}\r\n`);
  hub.post(key, 'to_player', 'answer', `${SDP('x')}a=x:\u0007\r\n`);
  hub.post(key, 'to_player', 'offer', SDP('reversed'));
  hub.post(key, 'to_player', 'ice', '[{"candidate":"evil"}]');
  hub.post(key, 'to_player', 'ice', JSON.stringify([{ candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0, __proto__x: 1 }]));
  hub.post('not-a-key', 'to_player', 'join', '');
  await tick(40);
  assert.equal(pc.remoteCalls, 0, 'no bad answer reached setRemoteDescription');
  assert.equal(pc.added.length, 0, 'no bad candidate reached addIceCandidate');
  assert.equal(senders().length, 1, 'a malformed key opens no connection');
  hub.post(key, 'to_player', 'answer', SDP('good'));
  await until(() => pc.remoteCalls === 1);
  await player.stop();

  const watch = new Hub();
  watch.share = { live: true, epoch: 1 };
  const before = MockPeer.all.length, k = hex();
  const s = spectatorFor(watch, { newKey: () => k, offerTimeoutMs: 5000 });
  void s.camera.start();
  await until(() => watch.peers.has(k));
  watch.post(k, 'to_spectator', 'offer', `${SDP('x')}\u0000`);
  watch.post(k, 'to_spectator', 'offer', 'v=0\r\n');
  watch.post(k, 'to_spectator', 'join', '');
  watch.post(k, 'to_spectator', 'bye', 'nonsense');
  watch.post(k, 'to_spectator', 'answer', SDP('wrong direction'));
  await tick(40);
  assert.equal(MockPeer.all.length, before, 'no peer connection for malformed offers');
  assert.equal(s.camera.current.status, 'joining');
  watch.post(k, 'to_spectator', 'offer', SDP('fine'));
  await until(() => MockPeer.all.length === before + 1 && MockPeer.all.at(-1)!.remoteCalls === 1);
  s.camera.dispose();
});

test('a player at capacity turns extra spectators away', async () => {
  const hub = new Hub();
  const player = playerFor(hub, { maxViewers: 1 });
  await player.start();
  const a = spectatorFor(hub), b = spectatorFor(hub, { fullRetryMs: 60_000 });
  void a.camera.start();
  await until(() => a.camera.current.status === 'live');
  void b.camera.start();
  await until(() => b.camera.current.status === 'full');
  assert.ok(hub.calledWith('signalToSpectator').some(p => p.kind === 'bye' && p.payload === 'full'));
  assert.equal(senders().filter(p => !p.closed).length, 1);
  a.camera.dispose(); b.camera.dispose(); await player.stop();
});

test('leaving and failed connections are cleaned up on both sides', async () => {
  const hub = new Hub();
  const player = playerFor(hub, { stream: () => streamOf(new MockTrack('sensor')) });
  await player.start();
  const a = spectatorFor(hub);
  void a.camera.start();
  await until(() => player.current.viewers === 1);
  const first = senders().at(-1)!;
  a.camera.dispose();
  await until(() => first.closed);
  assert.equal(hub.calledWith('leaveCamera').length, 1);
  await until(() => player.current.viewers === 0);

  const b = spectatorFor(hub);
  void b.camera.start();
  await until(() => b.camera.current.status === 'live');
  const out = senders().at(-1)!, into = receivers().at(-1)!;
  out.state('failed'); into.state('failed');
  assert.equal(out.closed, true, 'a failed player connection is closed and forgotten');
  await until(() => b.camera.current.status === 'live' && receivers().at(-1) !== into);
  const keys = hub.calledWith('joinCamera').map(j => j.spectatorKey);
  assert.equal(new Set(keys).size, keys.length, 'every retry uses a fresh key');
  assert.equal(player.current.viewers, 1);
  b.camera.dispose(); await player.stop();
});

test('without an answer the spectator retries with fresh keys, leaves each, then gives up', async () => {
  const hub = new Hub();
  hub.share = { live: true, epoch: 1 };
  const s = spectatorFor(hub, { offerTimeoutMs: 30, retryMs: 5, maxRetries: 2 });
  void s.camera.start();
  await until(() => s.camera.current.status === 'error');
  const joins = hub.calledWith('joinCamera').map(j => j.spectatorKey), leaves = hub.calledWith('leaveCamera').map(l => l.spectatorKey);
  assert.equal(joins.length, 3);
  assert.equal(new Set(joins).size, 3);
  assert.deepEqual(leaves, joins);
  assert.equal(hub.peers.size, 0);
  s.camera.dispose();
  await until(() => s.conn.disconnected);
  assert.equal(s.conn.subs.length, 0);
});

test('a spectate link without SpacetimeDB reports the camera as unavailable', () => {
  const camera = SpectatorCamera.fromWatchHash(`#watch=${encodeURIComponent(btoa(JSON.stringify({ channel: `hush-${'c'.repeat(64)}` })))}`);
  assert.equal(camera.current.status, 'unavailable');
  assert.equal(SpectatorCamera.fromWatchHash('#watch=garbage').current.status, 'unavailable');
  camera.dispose();
});

test('voice chat: an optional two-way audio line rides on each peer, and mics switch without renegotiating', async () => {
  const hub = new Hub(), audio = (label: string) => Object.assign(new MockTrack(label), { kind: 'audio' });
  let mic: MockTrack | null = null;
  const heard: [string, unknown][] = [];
  const player = playerFor(hub, { video: false, voice: { mic: () => mic as unknown as MediaStreamTrack, onFriendAudio: (key, stream) => heard.push([key, stream]) } });
  assert.equal(await player.start(), true);
  assert.equal(player.current.camera, 'waiting', 'voice only: no camera opened');
  const a = spectatorFor(hub);
  void a.camera.start();
  await until(() => a.camera.current.status === 'live');
  const out = senders()[0]!, into = receivers()[0]!;
  assert.equal(out.transceivers.length, 2);
  assert.equal(out.transceivers[0]!.init.direction, 'sendonly'); assert.equal(out.transceivers[0]!.sender.track, null, 'the video line stays empty');
  assert.equal(out.transceivers[1]!.init.direction, 'sendrecv'); assert.equal(out.transceivers[1]!.sender.track, null, 'silent until the player turns the mic on');
  assert.equal(into.transceivers.length, 0); assert.equal(into.audioLine?.direction, 'sendrecv', 'the spectator answers the voice line two-way');
  assert.equal(into.audioLine?.sender.track, null, 'and stays silent until they join voice');
  assert.equal(a.camera.current.voice, true);
  mic = audio('player-mic'); player.refreshMic(); await tick();
  assert.equal(out.transceivers[1]!.sender.track, mic);
  const friendMic = audio('friend-mic');
  a.camera.setMic(friendMic as unknown as MediaStreamTrack); await tick();
  assert.equal(into.audioLine?.sender.track, friendMic);
  mic = null; player.refreshMic(); a.camera.setMic(null); await tick();
  assert.equal(out.transceivers[1]!.sender.track, null); assert.equal(into.audioLine?.sender.track, null);
  await player.stop();
  assert.ok(heard.some(([, stream]) => stream === null), 'a closed peer drops its friend audio');
  a.camera.dispose();
});

test('a camera share without voice carries no audio line', async () => {
  const hub = new Hub(), player = playerFor(hub, { stream: () => streamOf(new MockTrack('sensor')) });
  assert.equal(await player.start(), true);
  const a = spectatorFor(hub); void a.camera.start();
  await until(() => a.camera.current.status === 'live');
  assert.equal(senders()[0]!.transceivers.length, 1); assert.equal(receivers()[0]!.audioLine, null); assert.equal(a.camera.current.voice, false);
  await player.stop(); a.camera.dispose();
});
