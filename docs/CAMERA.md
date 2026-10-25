# Live camera for spectators

Friends watching a run (see [SPECTATE.md](SPECTATE.md)) can also see the player's webcam live, if the player turns it on. Video goes **peer to peer** over WebRTC from the player's device to each spectator's browser. SpacetimeDB carries only the handshake (offers, answers, ICE candidates), each message deleted within about a minute. No frame, image or recording is ever stored or sent through the database.

## Consent

**Play with a friend** is the single entry point. The camera check explains live sharing; **Continue with live camera** (browser) or enabling Presage and continuing (desktop) enables video for that run. **Play without camera** keeps it off. No extra sharing checkboxes appear in the normal game. The invitation shows camera status; **Stop sharing** closes every peer immediately and deletes the session. Pause, hiding the app, results, restart and leaving the run also stop outgoing video. Resuming an opted-in run restarts it.

Peer to peer means each spectator's browser connects directly to the player's device, so spectators can learn its network (IP) address, as in any video call. A TURN relay in `VITE_RTC_ICE_SERVERS` hides it only when the relay is forced, which this build does not do.

## Which camera

- **Desktop app:** the stream `SensorController` already owns for Presage. Sharing never opens a second camera and never stops that one. With capture off it waits ("waiting for camera") and switches tracks in place (`refreshTrack`, no renegotiation) when capture starts.
- **Browser build:** there is no Presage stream, so continuing with live camera opens a 640×480 camera (`getUserMedia`) after that explicit consent. Only that track is stopped on revoke.

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
- App, TraceBridge, the invitation and SpectateView are connected in the integrated branch. The combined local module passed 26 signaling checks (see `qa/integrated-camera-local.json`).
- Not published to Maincloud.

## Voice chat (optional)

Co-op runs can add two-way voice on the same peer connection. Each peer the player opens in a friend run carries a second, `sendrecv` audio line next to the video line; both stay silent until someone opts in, and switching a mic on or off uses `replaceTrack` (no renegotiation).

- **Player:** "Talk with your friend (microphone, optional)" in the invitation, or **MIC** in the bottom bar. On: opens the mic (echo cancellation, noise suppression) and plays friends' voices; off: closes the mic and mutes them. With no camera chosen, a voice-only share starts: no camera opens and the video line stays empty. The mic closes whenever the share stops (pause, hidden app, results, Stop sharing).
- **Spectator:** **Join voice** under the player camera opens their mic and plays the player. The card reads "Camera off · voice chat available" for a voice-only share.
- Nothing new passes through SpacetimeDB: the offer still has a video section, so the published signaling rules accept it unchanged. Echo cancellation is the browser's; headphones avoid game sound feeding back.
- Not verified: no real two-device audio test (Node has no WebRTC; the state machines are covered with mocks in `src/integrations/webrtc.test.ts`). An offer with audio is larger but expected to stay under the 8 KB signaling cap; if a browser exceeds it, the peer closes and video/voice are unavailable for that viewer.

