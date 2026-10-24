# LOCK IN — asset integration guide

This pack contains **10 usable original GLB models, 11 named animation clips, and 27 original synthesized mono WAV effects**. It is an asset/build kit, not an implemented game. Geometry, named screen surfaces, mechanical moving parts and effects are provided; the eventual game must connect them to authoritative state and accessible UI.

The look follows the original Night Relay kit: dirty teal steel, dark recesses, muted cream controls, restrained amber indicators, and low-poly industrial forms. The environment is newly authored for LOCK IN: **a completely enclosed, windowless shelter with no corridors, glass walls, openable shutters, or direct creature view**.

## Rebuild and provenance

```sh
python3 tools/generate_assets.py
```

Run from `lock-in-kit/`, or use that prefix from its parent. Python 3.10+ standard library is sufficient. Generation performs no network calls, API requests, downloads or paid operations. It produces models, base-pose geometry previews and audio. It does not generate provider speech or fictional security-camera images.

All model geometry and effects are original deterministic procedural assets. The compact GLB-writing approach adapts the permitted original Night Relay kit; its permission notice is retained in the generator. Retain the accompanying kit license/notice when redistributing. These assets contain no third-party model pack, sampled music, recorded person, cloned voice or provider-generated output. Later provider-generated speech has separate provider and voice-authorization terms.

Machine-readable inventories:

- `assets/models/model-manifest.json`: model filenames, node/mesh counts and named clip descriptions.
- `assets/audio/audio-manifest.json`: every effect's duration, PCM format, looping flag, measured peak/RMS and intended usage.
- `assets/previews/*.geometry.json`: base-pose polygon faces, world-space normals, colors and mesh-node names for asset previews. These are inspection data, not replacement runtime geometry.

The repository's overall asset manifest/checksum validator is maintained separately. Regenerating assets requires regenerating that overall manifest too.

## Coordinates and room contract

Units are **metres**, up is **+Y**. Unrotated props face **+Z**. The shelter origin is its interior floor center. The interior occupies x = −3…+3, z = −2.5…+2.5, y = 0…3. Solid wall/ceiling slabs extend beyond those interior bounds; the full shell is approximately 6.4 × 5.4 × 3.3 m. Wall thickness is 0.2 m. There are no openings through which the creature can be seen.

The supplied door is mounted over the solid rear wall and **never opens in gameplay**. Its animations only vibrate/deform the visible steel panels. The wall behind it intentionally remains solid. The room and door must not be repurposed into a shutter-management or window-watching loop.

Recommended assembly transforms, all relative to shelter origin:

| Model file under `assets/models/` | Position `(x, y, z)` | Rotation Y | Origin / purpose |
| --- | --- | --- | --- |
| `shelter.glb` | `(0, 0, 0)` | `0` | Floor center; full sealed shell, floor seams, structural ribs, vent cover and ceiling fixtures |
| `sealed_door.glb` | `(-1.75, 0, 2.39)` | `π` | Floor center of sealed reinforced door; faces into room |
| `workdesk.glb` | `(0, 0, -1.8)` | `0` | Floor center; 3.25 m workbench, surface at y = 0.92 |
| `terminal.glb` | `(-0.62, 0.92, -1.8)` | `0` | Base on worktop; interactive task terminal |
| `security_monitor.glb` | `(0.72, 0.92, -1.8)` | `0` | Base on worktop; fictional CCTV display |
| `radio_speaker.glb` | `(-1.30, 0.92, -1.8)` | `0` | Base on worktop; emergency message source |
| `proximity_detector.glb` | `(1.85, 1.60, -2.35)` | `0` | Wall-panel center; distance and danger information |
| `machine_rack.glb` | `(2.67, 0, 0.05)` | `−π/2` | Floor center of four-unit rack; fronts face toward room center |
| `emergency_switch.glb` | `(-0.70, 1.35, 2.36)` | `π` | Wall-panel center beside sealed door; fixed location in every state |
| `creature_cctv.glb` | **Separate fictional CCTV composition only** | Per shot | Floor-centered silhouette, +Z facing; never add to the interior scene |

The assembled room leaves a clear central observation area. Camera station positions and framing belong to the game/design configuration; the asset geometry does not constrain the player to look through a nonexistent window. A preview gallery may temporarily hide the roof to inspect assembly, but the playable interior remains enclosed.

## Named surfaces and code-controlled states

All meshes have normals and **TEXCOORD_0 UVs**; box front faces map bottom-left `(0,0)` to top-right `(1,1)`. Named front-facing display meshes are ready for runtime canvas/video textures. The decorative screen material is deliberately blank; no fake distance, game progress, live sensor claim or hardcoded secret is baked into the geometry.

| Model | Useful named nodes | Required runtime behavior |
| --- | --- | --- |
| Terminal | `terminal_screen`, `terminal_status_led`, `terminal_key_0_0`…`terminal_key_1_5` | Draw the current four-box fault UI, waveform destination cards and four numbered sequence inputs from game state. Keep accessible HTML equivalents. |
| Security monitor | `security_screen`, `security_on_led` | The screen is 0.80 × 0.45 m, exactly 16:9. Feed textures represent fictional facility cameras. Show OFFLINE during blackout; do not substitute a webcam image. |
| Proximity detector | `proximity_screen`, `distance_segment_0`…`distance_segment_4` | Derive distance/danger from the same creature position used for footsteps, CCTV events and voice. Hide distance/danger during blackout rather than leaving stale visible values. |
| Machine rack | `unit_01`…`unit_04`, each `unit_NN_fault_lamp`, `unit_NN_reset_button`, `unit_NN_fault_assembly` | Only active faults animate, glow amber and emit ongoing noise. Clone a material before changing one unit's emissive/color. Each number plate also carries 1–4 physical notch marks. Quiet boxes remain distinguishable without color. |
| Emergency switch | `switch_lever`, `emergency_locator`, `switch_blank_label` | Keep locator emissive during blackout. Position never changes. Bind the same fixed keyboard control and accessible button before and during blackout. |
| Door | `sealed_door_root`, `dent_panel_1`…`dent_panel_3`, `door_warning_band` | Cosmetic response only. Never infer a breach from animation completion; deterministic rules commit it first. |
| Shelter | `ceiling_diffuser_-1.65`, `ceiling_diffuser_1.65`, structural wall/floor nodes | Soft readable fill and a warm desk pool suit the palette. Blackout may darken room equipment while retaining the emergency locator and accessible captions. |

Screen meshes are thin boxes with +Z front surfaces. Assign a canvas texture to their cloned material or put a matching plane immediately in front of that surface. Set the texture's color space and orientation explicitly; do not accidentally mirror the sequence numerals. Render tutorial arrows and concise labels in the UI rather than baking control bindings into textures.

## Animation contracts

Use `GLTFLoader` and an `AnimationMixer` for each animated model instance. The following names are present in the actual files:

| Model | Clip | Duration | Use |
| --- | --- | ---: | --- |
| `sealed_door` | `impact` | 0.45 s | Brief local panel vibration returning to base. Suitable for an eligible contact event; no door/root translation. |
| `sealed_door` | `dent` | 0.80 s | Final shallow panel crease. `LoopOnce`, clamp after the code-authored breach, then cut/fade to black. No interior monster reveal. |
| `machine_rack` | `fault_01`, `fault_02`, `fault_03`, `fault_04` | 0.32 s each | Independent looping captive rotor vibration. Each clip targets only its corresponding unit. Stop/reset when that fault is silenced. |
| `emergency_switch` | `flip_off` | 0.35 s | Cosmetic lever on→off rotation. |
| `emergency_switch` | `flip_on` | 0.35 s | Cosmetic lever off→on rotation. The fixed input remains available regardless of clip state. |
| `creature_cctv` | `idle` | 3.00 s | Subtle silhouette sway in a separate fictional security feed. |
| `creature_cctv` | `listen` | 1.80 s | Listening tilt for an eligible camera event. |
| `creature_cctv` | `recoil` | 0.70 s | Brief feed silhouette movement associated with a camera interruption. |

Do not apply a second translation/rotation to a node already driven by a clip. A wrapper group can position a model, while the mixer owns its named local nodes. The four fault clips can play concurrently because they target distinct assemblies. Cross-fade or stop/reset mutually exclusive door/switch/CCTV clips to avoid transform conflicts. Reduced motion can hold the correct endpoint instead of vibrating; the written fault and warning cues must still work.

The CCTV silhouette is an optional **feed source**, not a character to place outside a fully rendered window. Render it into an offscreen fictional camera layer, composite it into stills, or capture a small authored clip. Its world translation is intentionally absent from animation tracks; game state decides if/when a relevant camera can see it. Missing or interrupted CCTV never authorizes teleportation.

## Audio inventory

All effects are **22,050 Hz, signed 16-bit PCM, mono**. The generated files' maximum measured peak is below **0.68 full scale**; runtime mixing still needs its own bounded master gain, mute and limiter because simultaneous sounds add together. No effect is a recording of a human or an ElevenLabs/Cartesia output.

| WAV basename | Seconds | Loop | Purpose |
| --- | ---: | :---: | --- |
| `intro_alarm` | 4.00 | No | Opening containment alarm, distinct from the learned breach warning |
| `forest_run` | 3.80 | No | Running footfalls plus synthesized foliage rustle under the dark intro |
| `door_slam` | 1.80 | No | Entry into shelter and reinforced door sealing; not an open/close gameplay mechanic |
| `room_hum` | 6.00 | Yes | Quiet mains/vent bed; stops when equipment powers down |
| `fault_rattle` | 2.00 | Yes | Ongoing active-machine noise; spatialize at the faulty unit |
| `fault_silenced` | 0.42 | No | Correct fault reset |
| `machine_mistake` | 1.25 | No | Loud quiet-box misclick clang |
| `relay_confirm` | 0.60 | No | Stage completion relay, paired with earned progress |
| `terminal_press` | 0.14 | No | Ordinary tactile UI feedback |
| `sequence_tone_1` | 0.42 | No | Visible sequence input 1, 330 Hz |
| `sequence_tone_2` | 0.42 | No | Visible sequence input 2, 440 Hz |
| `sequence_tone_3` | 0.42 | No | Visible sequence input 3, 554 Hz |
| `sequence_tone_4` | 0.42 | No | Visible sequence input 4, 659 Hz |
| `lure_heartbeat` | 4.00 | Yes | Synthetic remote heartbeat, not recorded player pulse |
| `lure_transmit` | 1.30 | No | Short local activation before stronger remote lure playback |
| `steps_approaching` | 5.00 | No | Growing nearby footsteps; must match authoritative movement |
| `steps_receding` | 5.00 | No | Clearly receding version of the same footsteps; truthful restart opportunity |
| `wall_breath` | 4.00 | No | Synthesized close exhalation texture outside the wall |
| `wall_scrape` | 2.80 | No | Slow external metal contact |
| `breach_warning` | 3.20 | No | **Reserved** three low knocks then drag: learnable real-breach warning signature |
| `breach_impact` | 1.80 | No | Final heavy impact after the complete legal warning and committed loss |
| `blackout` | 1.40 | No | Motor/power decay; puzzles preserve progress |
| `power_restart` | 2.20 | No | Audible startup ramp and relay; a local noise clue |
| `containment_success` | 2.50 | No | Remote latch plus restrained confirmation chord |
| `radio_static` | 2.00 | Yes | Neutral interference bed under radio processing |
| `radio_chime` | 0.65 | No | Message/caption fallback cue, contains no spoken words |
| `monitor_interrupt` | 0.80 | No | Fictional CCTV dropout, distinct from webcam status |

### Audio truth and accessibility

- **One creature position is the source of truth.** Place approaching/receding footsteps, breath, scraping and occasional voice on that same position. The buffers are mono so a spatializer can place them correctly; do not hard-pan recordings independently of world state.
- The approach/recede buffers share the same footstep cadence, with a clearly increasing/decreasing envelope. Choose the truthful cue for the current movement segment and stop/fade it when direction changes. Do not advertise a safe restart with a receding cue while the creature is still approaching.
- A successful lure moves the stronger sustained signal to its actual remote emitter. It does not move the physical shelter speaker or instantly reset the creature's memory. Keep the local transmit click brief and quieter than the remote heartbeat.
- `breach_warning` lasts 3.2 seconds; **that file duration is not a gameplay warning duration**. The game must provide its full authored warning window, and may repeat the cue or continue a warning caption while time remains. Never use the same signature for harmless atmosphere.
- Supply captions such as `FOOTSTEPS APPROACHING — REAR WALL`, `FOOTSTEPS RECEDING`, and `BREACH WARNING` derived from the same state. During blackout, captions convey the relevant audible clue without revealing hidden exact distance, danger meters or security imagery. The sound-led survival decision remains playable with hearing limitations.
- `lure_heartbeat` is a fixed 60-cycle/minute synthetic example. It is not an exported user heartbeat, a claim of measured physiology, or a breath-control target. The gameplay pulse trend may modestly alter the next sequence's fixed playback tempo within documented limits; sequence tones remain paired with visible numerals and a generous response window.
- Loopable beds use periodic synthesis with checked boundary continuity. Start/stop or gain changes still need short fades to avoid discontinuities. Do not loop the entire intro, impact, breathing or warning file merely because it is available.
- Generated speech is optional and separate. Keep exact matching captions, expiry, source/encounter identity, priority cancellation and an authored fallback. All radio roles should use the intended consistent processing. Audio loading must never gate an accessible clue or stall input.

## Verification performed on these files

The generator ran successfully using only the Python standard library. All **10 actual GLBs** parsed with Three.js `GLTFLoader`; all **11 clips** changed their authored local transforms when advanced by an `AnimationMixer`. The 27 WAVs were checked for mono/16-bit/22,050 Hz encoding, bounded peaks (maximum measured **0.679993**), and continuity at all four loop-bed seams. These checks establish structural usability and bounded source levels, not a finished game, auditory playtest, complete render QA, live provider integration, or hardware sensing behavior.

Inspect the supplied models in the kit gallery, including the sealed interior from inside the room, each moving unit, the switch endpoints and door deformation. Verify the actual display UV orientation with runtime textures before shipping. Test mixed audio at the judging laptop's real output volume; source-file peak limits alone are not a loudness guarantee.


## Generated CCTV backgrounds and editable graphics

Four fictional CCTV plates are bundled in `assets/cameras/`: `cam_a_clearing.png`, `cam_b_path.png`, `cam_c_containment.png`, and the matched closed-gate `cam_c_sealed.png`. They are original built-in image-generation outputs at 1672×941, not photographs, webcam frames or live facility feeds. Their prompts, use rights and provenance are retained. No runtime external image service is needed. `camera-manifest.json` maps each feed to legal graph coverage and normalized silhouette art anchors. Render camera IDs/status separately so the text remains readable.

Only show the CCTV creature when its authoritative graph position is within that feed’s coverage. The open and sealed bay images are matched viewpoints; change to the sealed image only after physical arrival and the completed capture interval. A cosmetic static interruption cannot imply a second creature or teleport.

Seven SVGs in `assets/decals/` supply title, protocol, emergency control, security-camera, optional-sensing and door labels plus an offline-feed plate. They are editable vector assets; the implementation must also provide required controls/instructions as accessible DOM text. Blank model labels and screens are intentional runtime surfaces.

The four PNGs in `assets/previews/` show the rendered asset viewer, tutorial-arrow storyboard, door and blackout. They are reference screenshots, not shipped camera textures or proof of a playable game.
