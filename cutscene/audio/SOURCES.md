# Cutscene recordings

These are render inputs for the opening cutscene only (`SOUND_CUES` in `src/cutscene/timeline.ts`). They are not shipped in the game; only the rendered video is. Everything else in the soundtrack is synthesised by `tools/cutscene.mjs`.

| File | Source | Author | License | Processing | Used for |
|---|---|---|---|---|---|
| `door_creak.opus` | [Door handle creaking.ogg](https://commons.wikimedia.org/wiki/File:Door_handle_creaking.ogg) (Wikimedia Commons, from pdsounds.org) | stephan | Public domain | first 2.7 s | the exit door; the shed door's hinge (played slow and low) |
| `metal_grind.opus` | [Metal cabinet door jarring.ogg](https://commons.wikimedia.org/wiki/File:Metal_cabinet_door_jarring.ogg) (Wikimedia Commons, from pdsounds.org) | stephan | Public domain | full 12.8 s | the tube groaning, the hatch tearing open, the arm dragging back, the shed door scraping open and shut |

Both were cleaned with ffmpeg (high-pass at 50–70 Hz, `loudnorm=I=-18:TP=-1.5:LRA=11`) and encoded as mono 48 kHz Opus at 64 kb/s.
