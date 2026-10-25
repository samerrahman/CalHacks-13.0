# Kit verification

Scope: preparation of LOCK IN assets, implementation instructions and reference utilities. These checks do not establish a completed game or a live provider integration.

Tested preparation environment: macOS 14.2.1, Apple Silicon, Node 22.23.3, Python 3. Browser inspection used installed Chrome through Playwright after the in-app browser connection failed with a missing runtime sandbox-policy field.

| Check | Actual result |
| --- | --- |
| Reference rules and report | 31 passed: 26 core invariants + 5 report boundaries |
| Model parse / animation | 10 actual GLBs, 209 UV-mapped meshes, 11 clips loaded and advanced |
| Source audio | 27 mono 16-bit 22,050 Hz WAVs; four loop beds; maximum source peak 0.679993 |
| Structural assets | GLB accessor bounds/finite values; PNG CRC/decompression; SVG XML/no external code; WAV format/peak/seams passed |
| Browser viewer | All 10 models, 11 clips, 27 sound catalogue entries; no page errors/missing resources; no 1280px horizontal clipping |
| Visual inspection | Shelter, restrained task panel, tutorial arrow, sealed door and blackout switch/captions inspected; overbright initial preview lighting corrected |
| Voice helper | 33-line dry run and four offline boundaries verified; zero generated speech/API calls |
| Track coverage | All 11 overall and 47 sponsor rows from supplied snapshot classified |
| Locked tool install | npm ci with pinned Three.js/Playwright completed; no runtime remote art dependencies |
| Manifest/archive | Final SHA-256 inventory verified and ZIP contents checked after packaging; no real .env or node_modules shipped |

The screenshots show the asset viewer/UI storyboard only. Its buttons demonstrate reference presentation, not completed gameplay. Camera backgrounds were generated with the built-in image tool and copied into the package. No live sensing, real pulse recording, new game playthrough, auditory human playtest, provider speech or backend synchronization occurred during kit preparation.

Detailed machine-readable evidence is in ASSET_VALIDATION.json and PREVIEW_CHECK.json. Source model/audio manifests contain sizes/clip names/mixing metadata; MANIFEST.json contains final file hashes. Full future-game acceptance criteria are in PLAYTEST_PLAN.md and the master build prompt.

