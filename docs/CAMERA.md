# Live camera for spectators

Friends watching a run (see [SPECTATE.md](SPECTATE.md)) can also see the player's webcam live, if the player turns it on. Video goes **peer to peer** over WebRTC from the player's device to each spectator's browser. SpacetimeDB carries only the handshake (offers, answers, ICE candidates), each message deleted within about a minute. No frame, image or recording is ever stored or sent through the database.

## Consent

A third, separate opt-in in the J panel: **Share my camera live with spectators (peer-to-peer video, never stored)**. It needs trace sharing connected to SpacetimeDB, starts off on every run and can be stopped at any time from the always-visible LIVE badge. Stopping closes every peer connection at once, then deletes every signaling row on the server. Deleting the session or the 24-hour expiry removes everything too.

Peer to peer means each spectator's browser connects directly to the player's device, so spectators can learn its network (IP) address, as in any video call. A TURN relay in `VITE_RTC_ICE_SERVERS` hides it only when the relay is forced, which this build does not do.

## Which camera

- **Desktop app:** the stream `SensorController` already owns for Presage. Sharing never opens a second camera and never stops that one. With capture off it waits ("waiting for camera") and switches tracks in place (`refreshTrack`, no renegotiation) when capture starts.
- **Browser build:** there is no Presage stream, so ticking the box opens a 640×480 camera (`getUserMedia`) after that explicit consent. Only that track is stopped on revoke.

Each spectator gets one sendonly connection at 600 kbps and 24 fps at most; the player accepts four at once and tells the rest the camera is full.

## How it flows

| Step | Player (`PlayerCameraShare`) | Server (`spacetimedb/src/signal.ts`) | Spectator (`SpectatorCamera`) |
| --- | --- | --- | --- |
| Consent | subscribes to `camera_player_inbox(id, owner)`, then `setCameraShare(true)` | `camera_share` row, `live`, new `epoch` | sees `camera_share_feed(id, judge)` go live |
| Join | | `joinCamera` stores a join row for a fresh random 64-hex key and posts `join` | subscribes to `camera_spectator_inbox(id, judge, key)`, then joins |
| Offer | creates the peer connection, posts `offer` | `signalToSpectator` | validates, answers with `signalToPlayer` |
| ICE | trickles candidates in batches of up to 16 | stored ≤ 60 s | same |
| Media | | (nothing) | `LIVE · PLAYER CAMERA` |
| End | `leave` message or failed connection closes that peer | `leaveCamera`; `setCameraShare(false)` deletes all | retries with a new key on failure or no offer in 20 s |

Every received payload is revalidated on both sides (`spacetimedb/src/signalRules.ts`): SDP must be ASCII, start with `v=0`, contain a video section and fit in 8 KB; ICE batches must be arrays of 1–16 candidates with only the four standard fields. The server applies the same checks to writes, plus direction (spectators cannot offer, nobody can forge `join`/`leave`), capabilities, a live share flag, 30 messages per spectator and 120 per session every 10 s, six join rows and 200 pending messages per session. A scheduled sweep deletes messages after 60 s and join rows after 90 s, and removes itself when nothing is left.

## Configuration

`VITE_RTC_ICE_SERVERS` (optional, public): a JSON array of `RTCIceServer`, for example `[{"urls":"stun:stun.l.google.com:19302"}]`. Only `stun:`, `turn:` and `turns:` URLs are accepted; anything malformed falls back to Google's public STUN server. The value ships to every browser, so TURN credentials here are public.

## Verified

- `npm test`: payload validation, rate windows and ICE batching (`spacetimedb/tests/signalRules.test.ts`); the player and spectator state machines with mocked `RTCPeerConnection`/`MediaStream` and an in-memory signaling fake (`src/integrations/webrtc.test.ts`): end-to-end handshake, revoke closing every peer, only self-opened tracks stopped, malformed rows ignored, capacity, leave, failure and retry with fresh keys.
- [Local SpacetimeDB 2.13](qa/p2p-camera-signaling-local.json): 29/29 reducer and view checks against a local database (`node --import tsx spacetimedb/tests/liveSignal.mts [out.json] [--sweep]`), including capability isolation, the 8 KB cap, the per-peer limit, revoke, the 60 s sweep and the 90 s join expiry. Afterwards the owner-only `camera_sweep`, `camera_signal` and `camera_peer` tables were empty.

## Not verified

- No real WebRTC media: Node has no `RTCPeerConnection`, and no browser or Electron run with two devices has been recorded yet. NAT traversal with STUN only can fail on strict networks; there is no TURN relay configured.
- The App, client and SpectateView wiring is not in this change; see the integration notes.
- Not published to Maincloud.
