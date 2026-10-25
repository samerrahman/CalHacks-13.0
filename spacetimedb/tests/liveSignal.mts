// Live check of the WebRTC signaling module against a running SpacetimeDB. It exercises reducers
// and views with real connections but fake SDP/ICE strings: WebRTC itself cannot run in Node.
// VITE_SPACETIMEDB_HOST=ws://127.0.0.1:3000 VITE_SPACETIMEDB_DB_NAME=<db> node --import tsx spacetimedb/tests/liveSignal.mts [out.json] [--sweep]
import { writeFileSync } from 'node:fs';
import { connectSpacetime } from '../../src/integrations/spacetime';
import { signalQuery, spectatorInboxQuery } from '../../src/integrations/webrtc';
import { SIGNAL } from '../src/signalRules';

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const results: { check: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { results.push({ check: name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); };
const refused = async (call: () => Promise<unknown>): Promise<string | null> => { try { await call(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };
const sdp = (tag: string) => `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=x-tag:${tag}\r\n`;
const ice = (n: number) => JSON.stringify([{ candidate: `candidate:${n} 1 udp 2122260223 192.0.2.${n % 250} ${50000 + n} typ host`, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abcd' }]);
const args = process.argv.slice(2), out = args.find(a => !a.startsWith('--')), sweep = args.includes('--sweep');
const started = Date.now();

const id = hex(), owner = hex(), judge = hex(), keyA = hex(), keyB = hex();
const [player, a, b, stranger] = await Promise.all([connectSpacetime(), connectSpacetime(), connectSpacetime(), connectSpacetime()]);
const subscribe = (conn: typeof player, queries: string[]) => new Promise<void>((resolve, reject) => conn.subscriptionBuilder().onApplied(() => resolve()).onError(() => reject(new Error('subscription failed'))).subscribe(queries));
const rows = <R,>(t: { iter(): Iterable<R> }) => [...t.iter()];

await player.reducers.createSession({ id, ownerCapability: owner, judgeCapability: judge, consent: true, seed: 17, mode: 'standard' });
await subscribe(player, [signalQuery('camera_player_inbox', id, owner)]);
await subscribe(a, [signalQuery('camera_share_feed', id, judge), spectatorInboxQuery(id, judge, keyA)]);
await subscribe(b, [signalQuery('camera_share_feed', id, judge), spectatorInboxQuery(id, judge, keyB)]);
await subscribe(stranger, [signalQuery('camera_share_feed', id, hex()), spectatorInboxQuery(id, hex(), keyA), signalQuery('camera_player_inbox', id, hex())]);
let strangerRows = 0;
for (const t of [stranger.db.cameraShareFeed, stranger.db.cameraSpectatorInbox, stranger.db.cameraPlayerInbox] as const) (t as { onInsert(cb: () => void): void }).onInsert(() => { strangerRows++; });

// 1. Consent gates everything.
check('a spectator cannot join before the player turns the camera on', (await refused(() => a.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: keyA })))?.includes('Camera not shared') === true);
check('the share feed is empty before consent', rows(a.db.cameraShareFeed).length === 0);
check('a wrong owner capability cannot turn the camera on', (await refused(() => player.reducers.setCameraShare({ id, ownerCapability: hex(), live: true }))) !== null);
await player.reducers.setCameraShare({ id, ownerCapability: owner, live: true });
await wait(300);
const feed = rows(a.db.cameraShareFeed)[0];
check('turning it on shows live epoch 1 to spectators with the link', feed?.live === true && feed.epoch === 1, feed);

// 2. Joining.
check('a malformed spectator key is refused', (await refused(() => a.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: 'nope' }))) !== null);
check('the judge capability cannot double as a spectator key', (await refused(() => a.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: judge }))) !== null);
check('a wrong judge capability cannot join', (await refused(() => stranger.reducers.joinCamera({ id, judgeCapability: hex(), spectatorKey: hex() }))) !== null);
await a.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: keyA });
await a.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: keyA });
await b.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: keyB });
await wait(300);
const joins = rows(player.db.cameraPlayerInbox).filter(r => r.kind === 'join');
check('each spectator appears once in the player inbox (a resent join is ignored)', joins.length === 2 && joins.some(r => r.spectatorKey === keyA) && joins.some(r => r.spectatorKey === keyB), joins.map(r => r.spectatorKey.slice(0, 8)));

// 3. Addressed delivery.
await player.reducers.signalToSpectator({ id, ownerCapability: owner, spectatorKey: keyA, kind: 'offer', payload: sdp('offer-a') });
await wait(300);
check('the offer reaches only the spectator it is addressed to', rows(a.db.cameraSpectatorInbox).some(r => r.kind === 'offer' && r.payload === sdp('offer-a')) && rows(b.db.cameraSpectatorInbox).length === 0);
await a.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyA, kind: 'answer', payload: sdp('answer-a') });
await a.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyA, kind: 'ice', payload: ice(1) });
await wait(300);
const inbox = rows(player.db.cameraPlayerInbox);
check('the answer and ICE reach the player', inbox.some(r => r.kind === 'answer' && r.spectatorKey === keyA) && inbox.some(r => r.kind === 'ice' && r.payload === ice(1)));
check('player inbox rows expose no timestamps or session data', Object.keys(inbox[0] ?? {}).sort().join() === 'id,kind,payload,spectatorKey', Object.keys(inbox[0] ?? {}));

// 4. Shape and direction checks on the server.
const big = `${sdp('big')}a=x:${'y'.repeat(SIGNAL.MAX_PAYLOAD)}\r\n`;
check('an offer over 8 KB is refused', (await refused(() => player.reducers.signalToSpectator({ id, ownerCapability: owner, spectatorKey: keyA, kind: 'offer', payload: big }))) !== null);
check('a spectator cannot send an offer', (await refused(() => a.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyA, kind: 'offer', payload: sdp('x') }))) !== null);
check('the player cannot forge a join', (await refused(() => player.reducers.signalToSpectator({ id, ownerCapability: owner, spectatorKey: keyA, kind: 'join', payload: '' }))) !== null);
check('unknown kinds (e.g. frames) are refused', (await refused(() => player.reducers.signalToSpectator({ id, ownerCapability: owner, spectatorKey: keyA, kind: 'frame', payload: 'data:image/jpeg;base64,AAAA' }))) !== null);
check('malformed ICE is refused', (await refused(() => a.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyA, kind: 'ice', payload: '[{"candidate":"x"}]' }))) !== null);
check('signals to a key that never joined are refused', (await refused(() => player.reducers.signalToSpectator({ id, ownerCapability: owner, spectatorKey: hex(), kind: 'offer', payload: sdp('ghost') }))) === 'Spectator unavailable');

// 5. Per-peer rate limit (the join, offer, answer and first ICE already used 4 of the window).
let accepted = 0, limit: string | null = null;
for (let i = 0; i < SIGNAL.PEER_MAX + 5 && !limit; i++) { limit = await refused(() => a.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyA, kind: 'ice', payload: ice(100 + i) })); if (!limit) accepted++; }
check('one spectator handshake is capped per 10 s window', accepted === SIGNAL.PEER_MAX - 4 && limit === 'Too many signaling messages', { accepted, limit });
const bStill = await refused(() => b.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyB, kind: 'answer', payload: sdp('answer-b') }));
check('the cap is per peer: another spectator can still answer', bStill === null, bStill);

// 6. Leave, revoke, restart, delete.
await b.reducers.leaveCamera({ id, judgeCapability: judge, spectatorKey: keyB });
await wait(300);
check('leaving notifies the player and drops that spectator\'s rows', rows(player.db.cameraPlayerInbox).some(r => r.kind === 'leave' && r.spectatorKey === keyB) && !rows(player.db.cameraPlayerInbox).some(r => r.kind === 'answer' && r.spectatorKey === keyB));
check('a spectator that left can no longer post', (await refused(() => b.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyB, kind: 'ice', payload: ice(2) }))) === 'Spectator unavailable');
await player.reducers.setCameraShare({ id, ownerCapability: owner, live: false });
await wait(300);
const off = rows(a.db.cameraShareFeed)[0];
check('turning it off deletes every message and join at once', rows(player.db.cameraPlayerInbox).length === 0 && rows(a.db.cameraSpectatorInbox).length === 0 && off?.live === false, { off, playerRows: rows(player.db.cameraPlayerInbox).length });
check('after revoke a spectator cannot rejoin or post', (await refused(() => a.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: hex() })))?.includes('Camera not shared') === true && (await refused(() => a.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: keyA, kind: 'ice', payload: ice(3) }))) !== null);
await player.reducers.setCameraShare({ id, ownerCapability: owner, live: true });
await wait(300);
check('turning it back on is a new epoch', rows(a.db.cameraShareFeed)[0]?.epoch === 2 && rows(a.db.cameraShareFeed)[0]?.live === true);
check('a wrong capability never received a row', strangerRows === 0, { strangerRows });

if (sweep) {
  const key = hex();
  await a.reducers.joinCamera({ id, judgeCapability: judge, spectatorKey: key });
  await wait(300);
  check('sweep setup: a fresh join is in the inbox', rows(player.db.cameraPlayerInbox).some(r => r.spectatorKey === key));
  await wait(SIGNAL.MESSAGE_TTL_MS + SIGNAL.SWEEP_MS + 2000);
  check('the scheduled sweep deletes messages older than 60 s', !rows(player.db.cameraPlayerInbox).some(r => r.spectatorKey === key));
  await wait(SIGNAL.PEER_TTL_MS - SIGNAL.MESSAGE_TTL_MS + 2000);
  check('join rows expire after 90 s, ending that handshake', (await refused(() => a.reducers.signalToPlayer({ id, judgeCapability: judge, spectatorKey: key, kind: 'ice', payload: ice(4) }))) === 'Spectator unavailable');
}

await player.reducers.removeSession({ id, ownerCapability: owner });
await wait(300);
check('deleting the session removes the share flag', rows(a.db.cameraShareFeed).length === 0);

for (const c of [player, a, b, stranger]) c.disconnect();
const passed = results.filter(r => r.ok).length;
console.log(`${passed}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (out) writeFileSync(out, JSON.stringify({ kind: 'webrtc-signaling-live-check', host: process.env.VITE_SPACETIMEDB_HOST, database: process.env.VITE_SPACETIMEDB_DB_NAME, at: new Date().toISOString(), note: 'Reducers and views only; fake SDP/ICE strings. No media and no RTCPeerConnection in Node.', passed, total: results.length, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
