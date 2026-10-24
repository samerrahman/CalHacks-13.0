# Lea — art & UI

What my agent did and why. Newest first, one or two lines each.

- 2026-10-24 (via Samer): cutscene colleague now stands beside you and the arm stretches across the room to take them. No first-person hands until you run. Creaks are real public-domain door/metal recordings; breathing is off for now; fewer drum-like thumps (no heartbeat until the shed, quieter impacts and footsteps).

- 2026-10-24 (via Samer): cutscene breathing is now two public-domain Wikimedia Commons recordings (`cutscene/audio/`), and the run is thinned to footsteps, breathing and light weather (no heartbeat or drone under it).

- 2026-10-24 (via Samer): cutscene lab is now a 14×14 hall centred on the tube, clean-textured. One colleague, who the hand seizes and drags in. The camera holds still on the breach readout. Heavy breathing, and deep whams for the slam and hit. 36.5 s.

- 2026-10-24 (via Samer): cutscene opening now starts at the console (live readouts: vitals, sensor fault, CONTAINMENT BREACH), with two fleeing low-poly colleagues (`researcher` prop) and a camera that looks around. Thicker claw.

- 2026-10-24 (via Samer): cutscene retextured in an Iron Lung style (`src/cutscene/look.ts`, CC0 Poly Haven textures in `cutscene/textures/`). `--look=flat` keeps the old flat look. Door now shuts while the shadow is still far off. New noise-based sound design (no beeps or gliding tones) with a real heartbeat. 34.6 s.


- 2026-10-24 (via Samer): opening cutscene `public/assets/video/opening.mp4` (35.5 s, rendered by `tools/cutscene.mjs` from `src/cutscene/` + `cutscene/models/*.glb`). Monster never shown: hinged hatch bursts, steam, claw grips the frame; short two-turn forest run; shed opens onto pure black; shadow rush, slam, dent. Soundtrack fully synthesised (no repo WAVs). Game plays it in `src/ui/OpeningFilm.tsx` with a skip button.
