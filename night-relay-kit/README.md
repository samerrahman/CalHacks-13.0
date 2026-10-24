# NIGHT RELAY — two-day hackathon build kit

A short first-person horror game: complete a night shift while an intruder learns which instructions you obey and which encounters change your measured pulse. It can copy the supervisor's voice; it cannot copy the independent evidence on your console.

This is a specification, original asset pack, tested reference utilities, and Codex handoff. It is NOT a finished game. Sponsor services have not been authenticated or tested here. No paid voice generation has been run. The GLBs are simple authored geometry with node animations, not scanned or professionally rigged characters.

## Start

1. Put this entire folder in a new local project workspace.
2. Open `assets/previews/asset-sheet.png` to see the supplied assets.
3. Give Codex the full contents of `prompts/CODEX_BUILD_PROMPT.txt`. It tells Codex to implement, run, verify, and iterate, with external API access as a separate gate.
4. Have a Presage key, an ElevenLabs key plus a licensed voice ID, a Gemini key/model available in your account, and a Convex development project ready. Keep credentials out of chat, source control, browser bundles, and screenshots.
5. First prove the real Presage sample works on the actual judging laptop. Then build the game. A browser-only demo does not establish that the native SDK works.

## Contents

- `design/GAME_SPEC.md`: complete rules, tasks, deception, biometrics, pacing, implementation priorities.
- `design/dialogue.json`: authored voiced lines, subtitles and explicit fake-message tells.
- `design/config.json`: starting balance values, not a claim of playtested difficulty.
- `docs/INTEGRATIONS.md`: selected sponsor documentation, verified boundaries, data contracts.
- `docs/TRACKS_AND_DEMO.md`: honest track mapping, demo sequence, evidence and 48-hour plan.
- `prompts/CODEX_BUILD_PROMPT.txt`: exact detailed implementation prompt.
- `prompts/MONSTER_DIRECTOR.txt`: bounded strategy-selection prompt.
- `reference/rules.mjs`, `reference/rules.test.mjs`: original deterministic rules and meaningful edge-case tests.
- `reference/director.schema.json`: AI proposal schema; semantic checks are still mandatory.
- `assets/models/`: eight original GLB files; the mimic includes idle/listen/reach animations, the shutter has open animation.
- `assets/audio/`: nine original synthesized WAV effects, no spoken voice.
- `assets/decals/`: five editable SVG graphics; replace example IDs/challenge values with runtime text.
- `tools/generate_assets.py`: reproducible sources for geometry, audio and decals.
- `tools/generate_voices.py`: optional ElevenLabs batch script; consumes your API quota only when you explicitly run it.
- `tools/validate_assets.py`: binary/mesh/animation/audio structural checks, not a substitute for engine QA.
- `VALIDATION.txt`: checks performed on this kit.

To run the reference tests: `node --test reference/rules.test.mjs`.
To regenerate assets: `python3 tools/generate_assets.py` (Python, NumPy and Pillow).

Original materials in this kit may be used and modified for your project; see `LICENSE.txt`. No third-party model files are bundled. Optional CC0 packs are linked in the integration guide; verify the download's license before adding them. Provider-generated audio has its provider's terms, separate from this kit's license.
