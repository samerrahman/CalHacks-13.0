# Lucy — AI, wellness & pitch

What my agent did and why. Newest first, one or two lines each.

- 2026-10-24 (on `main`, user-authorized across owners and contracts): personalized physiology. Heartbeat mask uses the rounded resting pulse; calm pacer starts at the resting breathing pace and slows 0.25 s per breath to the standard 4 s; accepted ELEVATED → RECOVERED gives an 8 s lost-trail bias once per stage (`RECOVERY_REWARD`, no manual equivalent by user choice). Run report now charts breathing alongside pulse with jump-scare and recovery markers.
  Touched: `src/game/{state,config,reducer,tasks,creature}.ts` (James), `src/sensing/{types,controller,breathingBaseline}.ts` (Samer), `src/ui/{App,ThinkingTasks,PulseReport}.tsx` + `style.css` (Lea), `contracts.ts` event whitelist, `src/report/analysis.ts`. New `tests/personal-physiology.test.ts`. Only rounded frozen resting values enter game state; director request and trace summary exclude them (tested). No live Presage verification yet.
  Dropped: abdominal-breathing calm hold (Presage's lower trace needs the waistline in frame; laptop framing is shoulders/chest). Talking-as-noise not built: ElevenLabs is TTS/STT with no documented player-vs-room separation, and the game's own speakers would feed the mic.

- 2026-10-24: Audited the HUSH rename on current `main` and restored the existing internal bridge, IPC, local API, trace schema and protocol identifiers so title branding does not break integrations or future wellness storage migration.
