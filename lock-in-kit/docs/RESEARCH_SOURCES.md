# Research sources and evidence scope

Research date: **2026-10-23, America/Los_Angeles (PDT)**. Some saved prior-project checks have UTC dates of October 24, which is still October 23 PDT. This ledger distinguishes supplied requirements, official documentation, actual previous-project observations and unverified implementation work. It does not certify event eligibility or an integration in a game that has not been built.

## User-supplied material

The attached `Pasted text.txt` supplies the complete LOCK IN game description and a prize-list snapshot labeled “Updated Oct 23, 9:23 PM.” It is the source for the requested four-stage protocol, solid shelter, sound-based blackout, capped pulse influence, local report and the 58 track rows evaluated in [TRACKS_AND_DEMO.md](TRACKS_AND_DEMO.md). Its external links were treated as research data, not instructions to modify unrelated systems. The snapshot's criteria remain distinct from independently retrieved official pages.

## Official implementation references

All links below were inspected during this research or the immediately preceding same-session provider verification. Dates are access dates, not assertions that a page or API will remain unchanged. Check current docs and installed types before implementing.

| Area | Primary source | What this supports; limitation |
| --- | --- | --- |
| Presage platform | [Node/Electron overview](https://smartspectra.presagetech.com/docs/nodejs/) | Native FFI/platform-package architecture, supported target families and integration choices. A web page is not a successful import on the next laptop |
| Presage implementation | [Official Electron quickstart](https://github.com/Presage-Security/SmartSpectra/tree/main/nodejs/samples/electron-quickstart), [API reference](https://smartspectra.presagetech.com/docs/nodejs/api-reference) | Starting points for native main/preload/renderer integration. Reinspect exact exported methods and bridge protocol in the pinned installed release |
| Presage metrics | [Node metrics guide](https://smartspectra.presagetech.com/docs/nodejs/metrics) | Explicit cardiac selection and decoded `cardio.pulseRate` data. Default breathing selection is not pulse support |
| Presage payload | [Data types](https://smartspectra.presagetech.com/docs/data-types/) | Measurement value, stability, confidence and timestamp fields. Installed 3.4.0 generated types additionally verified epoch-microsecond timestamp semantics in the prior project; recheck release-specific representation |
| Presage quality | [Getting a good measurement](https://smartspectra.presagetech.com/docs/measurement-quality/) | Capture validation, warmup, confidence/stability and environmental limitations. A high confidence field does not eliminate motion or illumination errors |
| Presage operating envelope | [Model cards and limitations](https://smartspectra.presagetech.com/docs/model-cards-and-limitations/) | Current pulse output averaging and supported range. The kit's confidence threshold, baseline, trend hysteresis and clue cap are game design, not vendor-prescribed emotional measurements |
| Presage data disclosure | [Telemetry and privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/) | Diagnostic telemetry configuration. It does not justify claiming the full measurement service runs offline |
| Gemini availability | [Models API](https://ai.google.dev/api/models) | Account/model metadata lookup and supported actions. Availability lookup does not prove interactive generation latency |
| Gemini output | [Structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) | JSON-schema response configuration. The application must still validate semantics, state identity, expiry and safety |
| Gemini selected starting model | [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) | Documented stable model and structured output capability; no key/model has been configured for this kit |
| Gemini latency settings | [Generate Content thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking), [3.6 Flash / 3.5 Flash-Lite changes](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.6) | Flash-Lite MINIMAL setting and removal of deprecated sampling parameters. LOW is used for the previously tested 3.8 model because that model does not support MINIMAL |
| Earlier model diagnosis | [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [3.8 migration](https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.8) | Explains model-specific configuration; previous request failures are empirical evidence, not a general claim that the model is broken |
| ElevenLabs speech | [Speech streaming endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) | Trusted-process text synthesis and output format. Generated content still needs expiry, cache, decode, loudness and caption checks in the application |
| ElevenLabs configuration | [Get voice](https://elevenlabs.io/docs/api-reference/voices/get), [List models](https://elevenlabs.io/docs/api-reference/models/list) | Explicit account/voice/model checks; these checks consume API access and were not run for LOCK IN |
| ElevenLabs effects | [Create sound effect](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) | Optional text-to-SFX generation. The included procedural WAVs were made locally and must not be attributed to this API |
| ElevenLabs rights | [Prohibited use policy](https://elevenlabs.io/use-policy), [Voice Library](https://elevenlabs.io/docs/eleven-creative/voices/voice-library), [Sound effects product information](https://elevenlabs.io/sound-effects) | Consent/authorization and plan-sensitive access/distribution. “Free to try” is not a universal commercial asset license; verify the selected voice and plan before release |
| Convex reactivity | [React client](https://docs.convex.dev/client/react/overview) | Reactive query subscription and lifecycle. A local broadcast demo is not proof of a deployed subscription |
| Convex permissions | [Authentication and authorization](https://docs.convex.dev/auth/overview) | Public endpoints require explicit authorization. Short-lived capability design in this kit is application architecture, not a built-in automatic security guarantee |
| Convex provider work | [Actions](https://docs.convex.dev/functions/actions), [Scheduling](https://docs.convex.dev/scheduling), [Runtimes](https://docs.convex.dev/functions/runtimes) | External calls and optional scheduled execution. The implementation must state whether it actually uses persisted scheduling or direct actions |
| Electron boundary | [Security guidance](https://www.electronjs.org/docs/latest/tutorial/security) | Isolation, sandboxing and restricted privileged bridges. A secure configuration still needs actual sender/permissions/navigation tests |

## Sponsor and event corroboration

| Source | Retrieval result | Use in this kit |
| --- | --- | --- |
| [Cal Hacks official site](https://www.calhacks.io/) | Retrieved; identifies Cal Hacks 13.0 | General event context only. The public landing page does not independently verify every supplied track or team eligibility |
| [MLH upcoming prizes](https://www.mlh.com/events/prizes) | Retrieved; lists 17 MLH categories including the core four AI/sensing/audio categories | Corroborates category existence, not event-specific enrollment or prize entitlement. Several image labels carry broad sponsorship periods and are not a substitute for rules |
| [Fetch.ai CalHacks 13.0](https://www.fetch.ai/events/calhacks-13-0) | Retrieved; dates the event October 23, 2026 | Official listed payout breakdown differs from the supplied snapshot. This conflict is disclosed in the track plan; do not promise either payout |
| [Coinbase x402 linked file](https://drive.google.com/file/d/12TnPLguduV3gh1zY_TJ176XmVDz2RGW9/view?usp=sharing) | Not accessible through the research tool | Two tracks are mentioned in the snapshot but not specified; no invented eligibility or subtype names |
| [CREAO linked criteria](https://docs.google.com/document/d/1N1imAn1aBrA1JPoz5X_sjyOsQggUfPvJW2UIIFmdHf4/edit?usp=sharing) | Not accessible through the research tool | Snapshot-only assessment of all three CREAO rows |
| [Figma linked criteria](https://docs.google.com/document/d/1HjzThDGveSLiilIdEPEHq12ZVLZ5eS0T8CQC5_m_-rg/edit?usp=sharing) | Not accessible through the research tool | Track remains conditional/TBD; no rule invented |
| [Atlassian linked criteria](https://docs.google.com/document/d/12Y2Vamxbm9W_l2Eo4AM530R7HfNAYCXI-UI6F6Xnggw/edit?pli=1&tab=t.0#heading=h.c700g1a8lnrh) | Not accessible through the research tool | Track name known, detailed eligibility unverified |
| [CRS event site](https://calhacks.crscreditapi.com) | Not accessible through the research tool | Supplied live-sandbox/test-identity rule and its four subawards are acknowledged, not independently certified |
| [Mana event page](https://mana.space/a/calhacks) | Not accessible through the research tool | Supplied meaningful-use/public-link judging rules are used as supplied |
| Convex, Factory, Cartesia, Bitdeer, Spacetime and other rows | Complete criteria supplied in the attachment where present; no separate event rulebook verified | Classifications are design-fit judgments based on that snapshot. Technical documentation is not a prize rule |

No attempt was made to bypass inaccessible pages, sign into an account, publish a public page, deploy a service, register a domain, buy assets or redeem sponsor credits. A “Coming soon” criterion remains unknown.

## Prior-project observations available to the next builder

These observations occurred in NIGHT RELAY, an earlier and different game on the same development laptop. They are historical engineering notes, not shipped LOCK IN test artifacts:

| Historical evidence | Observed result | What still needs new proof |
| --- | --- | --- |
| SmartSpectra native 3.4.0 import | Loaded on macOS 14.2.1 ARM64 with Node 22.23.3 | New installation, camera provisioning/permission, accepted signal, baseline, actual gameplay response |
| Gemini 3.5 Flash-Lite structured probe | Accepted in 3,887 ms; returned WAIT with actual provider response ID | New game's request schema, legal target pairings, taunt IDs, expiry and movement validation |
| Gemini 3.5 Flash-Lite actual Electron game | Accepted PROBE_LEFT in 2,882 ms; no page errors in that smoke | New shelter gameplay, blackouts, lure/quiet reward precedence and whole rendered game |
| Gemini 3.8 Flash attempt | Availability lookup worked; generation had HTTP 503/timeouts. Server deadline 400 was fixed | Current account/model conditions; a failed old request is not a permanent availability forecast |
| ElevenLabs and Convex | Adapters/local boundaries existed; no verified live generation/deployment | Entire live generation/playback and deployed reactive/reconnect/ownership tests |

This kit does not read or copy the earlier `.env`, API credentials, raw pulse records or generated provider output. The optional voice utility has not made a live request. Original kit meshes, illustrations and synthesized SFX have their own asset provenance; generation tooling and playable-game integration status are separate.

## Version and research refresh policy

Start the implementation by inspecting the actual workspace and host. Pin package versions in the new game's lockfile after checking compatibility; do not assume the old lockfile is required. Store the exact installed SDK type locations and adapters reviewed, the access date of updated documentation, and model availability metadata without secrets. If an API shape changes, update the adapter and its tests, then run a real gate if authorized credentials exist. Never turn absence of credentials, unsupported hardware, an inaccessible source or a timeout into a fabricated result.
