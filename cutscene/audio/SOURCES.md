# Cutscene recordings

These are render inputs for the opening cutscene only (`SOUND_CUES` in `src/cutscene/timeline.ts`). They are not shipped in the game; only the rendered video is. Everything else in the soundtrack is synthesised by `tools/cutscene.mjs`.

| File | Source | Author | License | Processing | Used for |
|---|---|---|---|---|---|
| `door_creak.opus` | [Door handle creaking.ogg](https://commons.wikimedia.org/wiki/File:Door_handle_creaking.ogg) (Wikimedia Commons, from pdsounds.org) | stephan | Public domain | first 2.7 s | the exit door; the shed door's hinge (played slow and low) |
| `breath_scared.opus`, `breath_run.opus`, `breath_panic.opus` | [Breathing Tired](https://opengameart.org/content/breathing-tired) (OpenGameArt) | mikeask | CC0 | its three breaths, re-sequenced (see below) | your breathing: in the lab, on the run, after the hit |
| `stomps_stone.opus`, `stomps_mud.opus` | [Fantozzi's Footsteps (Grass/Sand & Stone)](https://opengameart.org/content/fantozzis-footsteps-grasssand-stone) (OpenGameArt) | Fantozzi | CC0 | single steps re-sequenced (see below) | the creature behind you: the corridor (stone) and the woods (sand as wet ground) |
| `metal_grind.opus` | [Metal cabinet door jarring.ogg](https://commons.wikimedia.org/wiki/File:Metal_cabinet_door_jarring.ogg) (Wikimedia Commons, from pdsounds.org) | stephan | Public domain | full 12.8 s | the tube groaning, the hatch tearing open, the arm dragging back, the shed door scraping open and shut |

The door and metal files were cleaned with ffmpeg (high-pass at 50–70 Hz, `loudnorm=I=-18:TP=-1.5:LRA=11`). Every file is mono 48 kHz Opus at 64 kb/s.

The breathing tracks are assembled from the three breaths in "Breathing Tired" (0.12–1.02 s, 1.28–2.10 s, 2.43–3.17 s): high-passed at 250 Hz, +21 dB, and placed at seeded intervals (about 1.1 s on the run, 1.2–1.55 s scared, 0.85–1.4 s in the panic), each with ±3% pitch and a little level variation. No noise reduction (it made the earlier version warble).

The creature's footsteps are the Stone or Sand steps played at 0.5–0.55 speed (an octave down), each with a falling ~38 Hz thud added under it, at a heavy uneven gait (about 1.5 steps a second, alternate steps lighter, ±10% timing). The stone track has a metal-hall echo (`aecho=0.8:0.6:45|95:0.4|0.25`); the mud track is low-passed at 1.5 kHz.
