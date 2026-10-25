# LOCK IN — complete build kit

A windowless research shelter, one unseen creature, and a containment protocol powered by sound, remote lures and optional pulse trends.

**This package prepares the next build. It is not a completed LOCK IN game.** It contains usable assets, a detailed implementation specification, schemas, tested reference utilities, a minimal UI/tutorial storyboard, integration research and the exact prompt to give a coding agent. The existing NIGHT RELAY application is untouched.

## Give this to Codex

Extract this folder into a fresh application workspace. Keep the name `lock-in-kit`. Paste:

```text
Read lock-in-kit/prompts/CODEX_BUILD_PROMPT.txt and execute its full implementation instructions.

Build LOCK IN from scratch using the accompanying design, assets, dialogue, schemas,
reference utilities and integration documentation. Inspect the workspace and actual
target platform first. Preserve unrelated projects.

Complete and play-test the offline game, then connect available live integrations in
the documented order. Continue independent work when credentials are unavailable.
Inspect the rendered game, run the required checks, and distinguish live results from
fixtures, cached audio, fallbacks and blocked access. Do not stop at a plan or scaffold.
```

The [full implementation prompt](prompts/CODEX_BUILD_PROMPT.txt) supplies the exact rules, architecture, milestones and acceptance checks. In a workspace already containing another game, it directs the builder to create a separate application directory. Do not run the old NIGHT RELAY prompt.

## Included material

| Material | Contents |
| --- | --- |
| [Design](design/GAME_SPEC.md) and [configuration](design/config.json) | Four research stages plus final containment, a physical route graph, sound evidence, sedation, reliable quiet/restore response, guaranteed lure rewards and blackout rules |
| Models | 10 original GLBs: sealed shelter, deforming sealed door, desk, terminal, CCTV monitor, proximity unit, radio speaker, four-unit machine rack, emergency switch and CCTV-only creature |
| Animation | 11 named clips: impacts/dent, four machine faults, switch endpoints and three silhouette motions |
| Sound | 27 original synthesized mono WAVs, including intro, faults, four sequence tones, lure heartbeat, approaching/receding steps, breath/scrape, learned breach warning, blackout, restart and success |
| Camera art | Four locally bundled generated PNGs: clearing, service path, containment open and matching containment sealed; no exterior level is required |
| Graphics | Seven editable themed SVGs; runtime clues remain accessible text |
| [Dialogue](design/dialogue.json) | 33 authored exact-caption lines and constrained taunt IDs; voice recordings are not included |
| [UI and tutorial](docs/UI_AND_TUTORIAL.md) | One contextual panel, compact status, persistent emergency controls, seven short arrow-guided practice steps |
| [Pulse report](docs/PHYSIOLOGY_REPORT.md) | Separate local-recording consent, quality-gated samples, gap-aware timeline, conservative event associations, observed return toward baseline and delete behavior |
| Reference code | 26 gameplay/sensing/director tests plus five report tests; utilities are examples and invariants, not an entire game loop |
| [Integrations](docs/INTEGRATIONS.md) | Native Presage, constrained Gemini, ElevenLabs speech, consenting Convex observer, exact contracts and live verification gates |
| [Tracks and demo](docs/TRACKS_AND_DEMO.md) | All 58 supplied prize rows assessed; five natural sponsor targets prioritized, remaining fits/optional/skips explained |
| Reproducibility | Original asset generator, binary validators, real Three.js animation checks, pinned viewer dependencies, SHA-256 inventory and licenses |

The monster's presence is inferred through one underlying position. The shelter door is sealed scenery, not a defense button. The core choice is **work, quiet the equipment, or transmit a false lead**. Correct puzzles always count; physiology adds only bounded pressure and optional descriptive feedback.

## Inspect the assets and storyboard

From this folder, use Node 20+ (Node 22 recommended) and Python 3.10+:

```sh
npm ci
npm test
npm run validate
npm run check:models
npm run preview
```

Open the local address printed by the preview server, normally `http://127.0.0.1:5186`. It renders the real room/props, lets you inspect the sealed-door and blackout views, displays the tutorial arrow, and provides the four camera plates and sound players. It is deliberately labeled **asset and interface reference**; it does not simulate creature behavior or estimate pulse. Stop it with Ctrl+C.

Optional automated browser check, while preview runs:

```sh
npm run check:preview
```

This defaults to an installed Google Chrome. If Chrome is absent, install Playwright Chromium with `npx playwright install chromium`, then use `PLAYWRIGHT_BROWSER=chromium npm run check:preview`. Browser downloading is a tool dependency, not a runtime game requirement. The viewer fetches no remote asset URLs.

[Rendered shelter](assets/previews/shelter-preview.png) · [Tutorial arrow](assets/previews/tutorial-preview.png) · [Sealed door](assets/previews/door-preview.png) · [Blackout](assets/previews/blackout-preview.png)

## Rebuild and verify the kit

```sh
python3 tools/generate_assets.py
python3 tools/validate_assets.py --report docs/ASSET_VALIDATION.json
node tools/check_models.mjs
node --test reference/*.test.mjs
python3 tools/build_manifest.py
python3 tools/validate_assets.py --manifest
```

The standard-library generator recreates only its original GLBs/WAVs/geometry metadata. It does not overwrite the generated CCTV PNGs or the SVGs. Image prompts and provenance are in [CCTV_ART_PROMPTS.txt](prompts/CCTV_ART_PROMPTS.txt) and [camera manifest](assets/cameras/camera-manifest.json). Rebuild the overall manifest after intentionally changing files; a hash mismatch before rebuilding is expected.

The optional [voice utility](tools/generate_voices.py) defaults to a network-free dry run. Use its help and the integration guide before enabling paid API requests or distributing generated voices. Missing speech never blocks this kit or the future offline game.

## What was actually verified for this package

Prepared on macOS 14.2.1 / Apple Silicon. Reference and model checks ran with Node 22.23.3; the pinned dependency installation also succeeded with the host npm launcher. Browser checks used real installed Chrome and the actual Three.js loader.

- 31 reference tests passed.
- All 10 GLBs parse; all 11 animation clips affect their authored transforms.
- WAV format, source peaks and loop seams pass; maximum source peak is 0.679993. This is not a completed-game audio mix or human listening test.
- PNG structure/CRC, SVG XML and binary geometry checks pass.
- Rendered asset viewer loaded all models and listed all sounds, with no page errors or missing resources. The room, arrow tutorial, sealed door and blackout screenshots were visually inspected. Laptop layout had no horizontal clipping.
- Voice utility dry-run and offline safety boundaries pass. All 58 supplied track IDs are accounted for.
- No provider calls, camera recordings or new remote deployments were made for LOCK IN. There is no completed-game playthrough yet.

See [verification record](docs/KIT_VERIFICATION.md), [asset validation](docs/ASSET_VALIDATION.json) and [browser evidence](docs/PREVIEW_CHECK.json).

## Integration and prize status

**Presage, Gemini, ElevenLabs and Convex still need implementation and live checks in LOCK IN.** A different project on this laptop previously proved native Presage import and accepted Gemini behavior; those facts are explicitly separated in the docs and do not count as LOCK IN evidence. No secret environment file or provider cache is included. Fill the blank names in [.env.example](.env.example) locally when building the game.

The supplied prize list is preserved as a user-provided snapshot in [source/USER_BRIEF.txt](source/USER_BRIEF.txt). The [research ledger](docs/RESEARCH_SOURCES.md) distinguishes official sources, inaccessible pages, changes and uncertainty. No entry is guaranteed eligibility. Do not add unrelated financial, scraping, blockchain or productivity features to chase tracks.

## Rights and limitations

Original code, procedural assets, dialogue and documentation have a permissive use grant in [LICENSE.txt](LICENSE.txt), with the original generator notice retained. No downloaded third-party art or sampled recording is bundled. Generated CCTV art is included with its provenance and applicable service-term caveat. Third-party SDKs, future voices and sponsor materials retain their own terms.

This is a detailed implementation kit, not validated final difficulty, a medical instrument, signed installer, camera compatibility certification or live sponsor submission. The reference suite checks invariants; the future builder must still implement a complete simulation/UI, run full seeded win/loss sequences, assess the audio mix and perform the requested real integration gates. Optional pulse recording is local and revocable within the app; already downloaded files remain under the user's control.

