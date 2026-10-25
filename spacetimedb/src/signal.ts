import { table, t, SenderError } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';
import { capability, ownedSession, type HushCtx, type HushDb } from './access';
import { SIGNAL, TO_PLAYER, TO_SPECTATOR, validPayload, spend, type Direction } from './signalRules';

// WebRTC signaling for the separate "share my camera live" consent. Only offers, answers and
// ICE candidates pass through, each short-lived; video frames go peer to peer and never touch
// the database. See docs/CAMERA.md.
export const cameraShare = table({ name: 'camera_share' }, {
  sessionId: t.string().primaryKey(),
  live: t.bool(),
  epoch: t.u32(),
  windowStartMs: t.u64(),
  windowCount: t.u32(),
});
export const cameraPeer = table({ name: 'camera_peer' }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.string().index('btree'),
  spectatorKey: t.string(),
  joinedAtMs: t.u64(),
  windowStartMs: t.u64(),
  windowCount: t.u32(),
});
export const cameraSignal = table({ name: 'camera_signal' }, {
  id: t.u64().primaryKey().autoInc(),
  sessionId: t.string().index('btree'),
  spectatorKey: t.string(),
  direction: t.string(),
  kind: t.string(),
  payload: t.string(),
  createdAtMs: t.u64(),
});
/** At most one repeating row; it exists only while signaling messages or join rows exist. */
export const cameraSweep = table({ name: 'camera_sweep' }, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
});

type ShareRow = typeof cameraShare.rowType.type;
type PeerRow = typeof cameraPeer.rowType.type;

function watchedSession(ctx: HushCtx, id: string, judgeCapability: string) {
  const row = ctx.db.session.id.find(id);
  if (!row || !capability(judgeCapability) || row.judgeCapability !== judgeCapability || row.expiresAtMs < ctx.timestamp.toMillis()) throw new SenderError('Session unavailable');
  return row;
}
function liveShare(ctx: HushCtx, id: string): ShareRow {
  const share = ctx.db.cameraShare.sessionId.find(id);
  if (!share?.live) throw new SenderError('Camera not shared');
  return share;
}
function peerFor(ctx: HushCtx, id: string, key: string): PeerRow | undefined {
  for (const row of ctx.db.cameraPeer.sessionId.filter(id)) if (row.spectatorKey === key) return row;
  return undefined;
}
/** Charges one write to the session window (and the peer's, when given), or refuses it. */
function charge(ctx: HushCtx, share: ShareRow, peer?: PeerRow): void {
  const now = ctx.timestamp.toMillis();
  const session = spend(share, now, SIGNAL.SESSION_MAX), own = peer ? spend(peer, now, SIGNAL.PEER_MAX) : null;
  if (!session || peer && !own) throw new SenderError('Too many signaling messages');
  ctx.db.cameraShare.sessionId.update({ ...share, ...session });
  if (peer && own) ctx.db.cameraPeer.id.update({ ...peer, ...own });
}
function ensureSweep(ctx: HushCtx): void {
  if (ctx.db.cameraSweep.count() === 0n) ctx.db.cameraSweep.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BigInt(SIGNAL.SWEEP_MS) * 1000n) });
}
function post(ctx: HushCtx, sessionId: string, spectatorKey: string, direction: Direction, kind: string, payload: string): void {
  let pending = 0;
  for (const _ of ctx.db.cameraSignal.sessionId.filter(sessionId)) pending++;
  if (pending >= SIGNAL.MAX_PENDING) throw new SenderError('Too many signaling messages');
  ctx.db.cameraSignal.insert({ id: 0n, sessionId, spectatorKey, direction, kind, payload, createdAtMs: ctx.timestamp.toMillis() });
  ensureSweep(ctx);
}
function dropPeers(ctx: HushCtx, sessionId: string, key?: string): void {
  for (const row of [...ctx.db.cameraPeer.sessionId.filter(sessionId)]) if (key === undefined || row.spectatorKey === key) ctx.db.cameraPeer.id.delete(row.id);
  for (const row of [...ctx.db.cameraSignal.sessionId.filter(sessionId)]) if (key === undefined || row.spectatorKey === key) ctx.db.cameraSignal.id.delete(row.id);
}

/** Called when the owning session is removed or expires. */
export function dropSignal(ctx: HushCtx, sessionId: string): void {
  dropPeers(ctx, sessionId);
  ctx.db.cameraShare.sessionId.delete(sessionId);
}

const inboxRow = t.row('CameraInboxRow', {
  id: t.u64().primaryKey(), spectatorKey: t.string(), kind: t.string(), payload: t.string(),
});
const shareRow = t.row('CameraShareRow', { sessionId: t.string().primaryKey(), live: t.bool(), epoch: t.u32() });

export function signalExports(db: HushDb) {
  /** The owner turns the live camera on or off. Off deletes every join row and message at once. */
  const setCameraShare = db.reducer({ id: t.string(), ownerCapability: t.string(), live: t.bool() }, (ctx, args) => {
    ownedSession(ctx, args.id, args.ownerCapability);
    const share = ctx.db.cameraShare.sessionId.find(args.id);
    if (!share) { if (args.live) ctx.db.cameraShare.insert({ sessionId: args.id, live: true, epoch: 1, windowStartMs: ctx.timestamp.toMillis(), windowCount: 1 }); return; }
    if (!args.live) dropPeers(ctx, args.id);
    if (share.live === args.live) return;
    const spent = spend(share, ctx.timestamp.toMillis(), SIGNAL.SESSION_MAX);
    if (!spent && args.live) throw new SenderError('Too many signaling messages');
    ctx.db.cameraShare.sessionId.update({ ...share, ...(spent ?? {}), live: args.live, epoch: args.live ? share.epoch + 1 : share.epoch });
  });

  /** A spectator page asks for the stream with the link's judge capability and its own fresh key. */
  const joinCamera = db.reducer({ id: t.string(), judgeCapability: t.string(), spectatorKey: t.string() }, (ctx, args) => {
    const session = watchedSession(ctx, args.id, args.judgeCapability);
    if (!capability(args.spectatorKey) || args.spectatorKey === session.ownerCapability || args.spectatorKey === session.judgeCapability) throw new SenderError('Invalid spectator');
    const share = liveShare(ctx, args.id);
    if (peerFor(ctx, args.id, args.spectatorKey)) return; // A resent join is not a second spectator.
    let peers = 0;
    for (const _ of ctx.db.cameraPeer.sessionId.filter(args.id)) peers++;
    if (peers >= SIGNAL.MAX_PEERS) throw new SenderError('Camera full');
    charge(ctx, share);
    const now = ctx.timestamp.toMillis();
    ctx.db.cameraPeer.insert({ id: 0n, sessionId: args.id, spectatorKey: args.spectatorKey, joinedAtMs: now, windowStartMs: now, windowCount: 1 });
    post(ctx, args.id, args.spectatorKey, 'to_player', 'join', '');
  });

  /** Leaving removes that spectator's rows and tells the player to close the connection. */
  const leaveCamera = db.reducer({ id: t.string(), judgeCapability: t.string(), spectatorKey: t.string() }, (ctx, args) => {
    watchedSession(ctx, args.id, args.judgeCapability);
    if (!capability(args.spectatorKey)) throw new SenderError('Invalid spectator');
    dropPeers(ctx, args.id, args.spectatorKey);
    const share = ctx.db.cameraShare.sessionId.find(args.id);
    if (!share?.live || !spend(share, ctx.timestamp.toMillis(), SIGNAL.SESSION_MAX)) return;
    charge(ctx, share);
    post(ctx, args.id, args.spectatorKey, 'to_player', 'leave', '');
  });

  const signalToSpectator = db.reducer({ id: t.string(), ownerCapability: t.string(), spectatorKey: t.string(), kind: t.string(), payload: t.string() }, (ctx, args) => {
    ownedSession(ctx, args.id, args.ownerCapability);
    if (!(TO_SPECTATOR as readonly string[]).includes(args.kind) || !validPayload(args.kind, args.payload)) throw new SenderError('Invalid signal');
    const share = liveShare(ctx, args.id), peer = peerFor(ctx, args.id, args.spectatorKey);
    if (!peer) throw new SenderError('Spectator unavailable');
    charge(ctx, share, peer);
    post(ctx, args.id, args.spectatorKey, 'to_spectator', args.kind, args.payload);
  });

  const signalToPlayer = db.reducer({ id: t.string(), judgeCapability: t.string(), spectatorKey: t.string(), kind: t.string(), payload: t.string() }, (ctx, args) => {
    watchedSession(ctx, args.id, args.judgeCapability);
    if (!(TO_PLAYER as readonly string[]).includes(args.kind) || !validPayload(args.kind, args.payload)) throw new SenderError('Invalid signal');
    const share = liveShare(ctx, args.id), peer = capability(args.spectatorKey) ? peerFor(ctx, args.id, args.spectatorKey) : undefined;
    if (!peer) throw new SenderError('Spectator unavailable');
    charge(ctx, share, peer);
    post(ctx, args.id, args.spectatorKey, 'to_player', args.kind, args.payload);
  });

  const cameraSweepStep = db.reducer({ onSchedule: cameraSweep }, { arg: cameraSweep.rowType }, (ctx, { arg }) => {
    const now = ctx.timestamp.toMillis();
    for (const row of [...ctx.db.cameraSignal.iter()]) if (now - row.createdAtMs >= BigInt(SIGNAL.MESSAGE_TTL_MS) || !ctx.db.session.id.find(row.sessionId)) ctx.db.cameraSignal.id.delete(row.id);
    for (const row of [...ctx.db.cameraPeer.iter()]) if (now - row.joinedAtMs >= BigInt(SIGNAL.PEER_TTL_MS) || !ctx.db.session.id.find(row.sessionId)) ctx.db.cameraPeer.id.delete(row.id);
    if (ctx.db.cameraSignal.count() === 0n && ctx.db.cameraPeer.count() === 0n) ctx.db.cameraSweep.scheduledId.delete(arg.scheduledId);
  });

  /** The player's inbox: join/leave notices, answers and ICE from spectators. */
  const cameraPlayerInbox = db.anonymousView(
    { name: 'camera_player_inbox', public: true },
    { id: t.string(), ownerCapability: t.string() },
    t.array(inboxRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      if (!session || !capability(args.ownerCapability) || session.ownerCapability !== args.ownerCapability) return [];
      return [...ctx.db.cameraSignal.sessionId.filter(args.id)].filter(m => m.direction === 'to_player').map(m => ({ id: m.id, spectatorKey: m.spectatorKey, kind: m.kind, payload: m.payload }));
    },
  );

  /** One spectator's inbox: only messages addressed to its own key. */
  const cameraSpectatorInbox = db.anonymousView(
    { name: 'camera_spectator_inbox', public: true },
    { id: t.string(), judgeCapability: t.string(), spectatorKey: t.string() },
    t.array(inboxRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      if (!session || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability || !capability(args.spectatorKey)) return [];
      return [...ctx.db.cameraSignal.sessionId.filter(args.id)].filter(m => m.direction === 'to_spectator' && m.spectatorKey === args.spectatorKey).map(m => ({ id: m.id, spectatorKey: m.spectatorKey, kind: m.kind, payload: m.payload }));
    },
  );

  /** Whether the player is sharing right now; a new epoch means a fresh start. */
  const cameraShareFeed = db.anonymousView(
    { name: 'camera_share_feed', public: true },
    { id: t.string(), judgeCapability: t.string() },
    t.array(shareRow),
    (ctx, args) => {
      const session = ctx.db.session.id.find(args.id);
      const share = ctx.db.cameraShare.sessionId.find(args.id);
      if (!session || !share || !capability(args.judgeCapability) || session.judgeCapability !== args.judgeCapability) return [];
      return [{ sessionId: share.sessionId, live: share.live, epoch: share.epoch }];
    },
  );

  return db.exportGroup({ setCameraShare, joinCamera, leaveCamera, signalToSpectator, signalToPlayer, cameraSweepStep, cameraPlayerInbox, cameraSpectatorInbox, cameraShareFeed });
}
