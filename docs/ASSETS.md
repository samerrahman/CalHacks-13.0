# LOCK IN runtime assets

The playable application serves **10 GLB models, 11 animation clips, 27 synthesized WAV effects, four fictional CCTV backgrounds, one original breach image and seven SVG graphics** from `public/assets`. [manifest.json](../public/assets/manifest.json) records all 54 shipped asset/support files, their provenance, byte sizes and SHA-256 hashes. The models/effects/CCTV/graphics originate in the preserved [LOCK IN kit](../lock-in-kit/). The runtime protocol placard is an explicitly recorded harder-mode variation; all other copied kit asset bytes remain unchanged. The previous Night Relay models are not used by the current game.

The models, animations, effects and SVG graphics are original procedural or vector work. The generator adapts the permitted Night Relay GLB-writing approach; the new shelter layout, machines and sound synthesis belong to LOCK IN. Retain [LICENSE.txt](../public/assets/LICENSE.txt) and the [Night Relay notice](../public/assets/NIGHT_RELAY_LICENSE.txt) with redistribution. The four CCTV PNGs are original built-in image-generation outputs; their service terms and prompt provenance are described in the kit's [asset guide](../lock-in-kit/docs/ASSETS.md) and [art prompts](../lock-in-kit/prompts/CCTV_ART_PROMPTS.txt). They are fictional camera images, not webcam frames or live facility footage. No recorded person, cloned voice, sampled music, external model pack or provider-generated speech is bundled in these files.

`public/assets/scares/breach-creature.png` is an additional original OpenAI built-in image-generation output created for LOCK IN on 2026-10-23, recorded separately in the runtime manifest. Its use is subject to the applicable image-generation service terms. It is separate from the fictional camera feeds and is not a creature model placed inside the Three.js shelter. Its presentation belongs to the application UI.

## Room and model placement

Units are metres, up is +Y, and unrotated props face +Z. The enclosed, windowless shelter interior is 6 × 5 × 3 m, centered on its floor origin. All four walls and the ceiling are solid. The reinforced door sits over the rear wall and has no open state. The runtime camera starts inside at `(0.05, 1.62, 0.60)`, with bounded mouse look and terminal, cameras and equipment station targets. Inspecting the terminal or monitor moves closer to that actual object; closing inspection returns to the seat. The equipment view faces the rear door and fixed emergency switch. There is no hallway.

| Model in `public/assets/models/` | Position | Rotation Y | Runtime use |
| --- | --- | --- | --- |
| `shelter.glb` | `(0, 0, 0)` | `0` | Solid shell, ribs, seams, ceiling fixtures and vent |
| `sealed_door.glb` | `(-1.75, 0, 2.39)` | `π` | Local impact/dent after authoritative contact/loss; never opens |
| `workdesk.glb` | `(0, 0, -1.8)` | `0` | Workbench, surface at y = 0.92 |
| `terminal.glb` | `(-0.62, 0.92, -1.8)` | `0` | Current fault and memory state on `terminal_screen` |
| `security_monitor.glb` | `(0.72, 0.92, -1.8)` | `0` | Offscreen fictional CCTV composition on `security_screen` |
| `proximity_detector.glb` | `(1.85, 1.60, -2.35)` | `0` | Actual creature distance on `proximity_screen`; offline with equipment down |
| `radio_speaker.glb` | `(-1.30, 0.92, -1.8)` | `0` | Physical location for radio playback |
| `machine_rack.glb` | `(2.67, 0, 0.05)` | `−π/2` | Four independent fault assemblies and cloned indicator materials |
| `emergency_switch.glb` | `(-0.70, 1.35, 2.36)` | `π` | Fixed lever and locator, visible through quiet/blackout |
| `creature_cctv.glb` | Separate offscreen scene | Per composition | Silhouette only on a feed that covers its actual exterior graph position |

All 209 model meshes have position, normal and UV attributes. The authored UVs use bottom-left `(0,0)`, so the canvas display textures explicitly retain `flipY=true`; the render-target texture uses `flipY=false`. Displays are drawn from the root application's state adapter and have accessible HTML controls/captions in the main UI. These runtime textures contain no independent creature state or puzzle solution. Physical equipment clicks use ray intersections with the actual GLBs; the first visible surface blocks anything behind it. Moving the pointer more than six pixels changes camera look rather than opening an interface.

### Procedural industrial surface treatment

The current runtime art direction uses near-black corroded steel, damp stains, dirty cream controls, a small amber task-light pool and a dim red alarm fixture. `src/render/weathering.ts` creates five deterministic canvas material families (wall, steel, cream, dark metal and rust), with pigment noise, irregular rust blooms, leaking streaks, scratches, chipped edges, bump relief and roughness variation. Wall maps are 1024×1024; other maps are 512×512. These are original code-generated runtime materials, not external textures, edited source PNGs or new files in the hashed asset pack. GLB bytes and both preserved kits remain unchanged. Procedural cables, a corroded tray and a caged alarm bulb add local environmental detail.

Lighting is deliberately localized and substantially darker than the original kit preview. Quiet dims the small remaining task lights; blackout retains the fixed emergency locator. `alarm.active/urgency` controls a slow bounded red glow, held steady under reduced motion. Authoritative `scare` events may cause a brief local door impact and low-luminance monitor interference; they do not create a second creature, invent a position or expose a breach countdown. Softer scares reduce visual intensity. CRT scanlines, dark glass edges and interference affect only the physical displays; accessible DOM controls remain separately readable.

## Animation and CCTV truth

| Model | Clips | Runtime behavior |
| --- | --- | --- |
| Door | `impact` 0.45 s; `dent` 0.80 s | Clips animate only `dent_panel_1..3`. The doorway root remains fixed. Loss animation follows the committed game result. |
| Machine rack | `fault_01..04` 0.32 s | Each clip owns only its matching `unit_NN_fault_assembly`; only active powered faults move. Reduced motion holds the rest pose while keeping fault labels/indicators. |
| Emergency switch | `flip_off`, `flip_on` 0.35 s | Runtime scrubs the off clip to the correct power endpoint; both supplied clips are structurally tested. Locator position never changes. |
| CCTV silhouette | `idle` 3 s; `listen` 1.8 s; `recoil` 0.7 s | Runtime uses idle sway in its separate offscreen scene. All three authored clips are tested. No creature object is added to the shelter scene. |

The four image files are `cam_a_clearing.png`, `cam_b_path.png`, `cam_c_containment.png` and `cam_c_sealed.png`. Runtime composites a model silhouette onto the selected image only when its authoritative position lies on that feed's covered edge. A covers junction→emitter A, B covers junction→emitter B, and C covers emitter B→containment. Projection uses the normalized art anchors recorded in [camera-manifest.json](../public/assets/cameras/camera-manifest.json). Positions near the shelter, on another branch, outside the edge or outside valid ground coordinates remain hidden. The sealed plate is used only for a completed win on feed C. Equipment down makes the feed offline and hides the silhouette.

All seven SVGs are used: `title`, `protocol_card`, `camera_notice`, `sensor_notice`, `door_label` and `emergency_switch` are placed in the shelter; `feed_offline` supplies the unpowered monitor plate. The runtime `protocol_card.svg` has weathered vector borders/stains and correct harder-mode instructions: eight faults, five pulses at emitter A, twelve faults, six pulses at emitter B, then containment transmission. Its manifest source explicitly records the runtime-authored variation and updated hash; the original kit placard is preserved. Personal camera sensing is separate from these fictional security images.

## Audio and speech

The 27 effects are mono, signed 16-bit PCM at 22,050 Hz. Their measured maximum source peak is **0.679993**. [audio-manifest.json](../public/assets/audio/audio-manifest.json) records exact durations, peaks, looping flags and synthesis provenance.

| Group | WAV basenames |
| --- | --- |
| Opening | `intro_alarm`, `forest_run`, `door_slam` |
| Equipment | `room_hum`, `fault_rattle`, `fault_silenced`, `machine_mistake`, `relay_confirm`, `terminal_press` |
| Memory | `sequence_tone_1`, `sequence_tone_2`, `sequence_tone_3`, `sequence_tone_4` |
| Remote signal | `lure_heartbeat`, `lure_transmit` |
| Exterior creature | `steps_approaching`, `steps_receding`, `wall_breath`, `wall_scrape` |
| Warning/results | `breach_warning`, `breach_impact`, `blackout`, `power_restart`, `containment_success` |
| Radio/security | `radio_static`, `radio_chime`, `monitor_interrupt` |

The Web Audio engine decodes all 27 after a player gesture. A bounded master gain (maximum 0.7), mute and compressor apply to effects and speech. The four authored loop beds have checked seams; runtime uses short gain transitions for room hum, individual fault noise and the remote heartbeat. All other sounds are event cues. Source-file peaks alone do not establish comfortable hardware output volume.

Approaching/receding footsteps follow the simulation's `lastMotion` and actual creature vector; they stop when that direction changes. Breath is eligible only within 4.2 m in listening/breach phases, and scraping only when circling within 4.2 m. These sources and creature-attached speech update from the same position used for CCTV and distance. A remote lure is placed at its actual emitter. The engine does not fabricate a second encounter clock or teleport audio between walls.

Optional generated speech is distinct from the bundled effects. The queue accepts an exact caption plus expiry, priority, identity and optional live/cache source metadata. It cancels obsolete instructions, preempts lower priorities and avoids repeated IDs. Missing/unavailable audio falls back to captions with a chime. Live and cached labels describe actual request metadata; bundled WAVs are never labelled as provider output. Provider verification belongs in the integration status report.

## Opening cutscene video

`public/assets/video/opening.mp4` (640×360 pixel art shown scaled up, 30 fps with motion blur, H.264 + AAC, 36.5 s) is rendered offline by `tools/cutscene.mjs render` from `src/cutscene/` and the low-poly GLBs in `cutscene/models/`. Those models are original placeholders generated for this project and meant to be replaced; see [cutscene/README.md](../cutscene/README.md). Its default `ironlung` look textures them with 15 CC0 Poly Haven textures in `cutscene/textures/`, credited in [SOURCES.md](../cutscene/textures/SOURCES.md). Those textures are render inputs only and are not shipped in `public/assets`. Its soundtrack is synthesised by ffmpeg from the layers listed in `src/cutscene/timeline.ts` (metal impacts, steam hiss, footsteps, heartbeat, drone, rain, wind), plus public-domain door and metal recordings from Wikimedia Commons and CC0 breathing from OpenGameArt in `cutscene/audio/` (credited in its [SOURCES.md](../cutscene/audio/SOURCES.md)). It uses none of the bundled WAVs and has no speech. Captions come from the same timeline at runtime. The video is listed in `manifest.json` like every other asset, and `npm run assets:validate` checks its hash and MP4 container.

## Checks

Run from the application root:

```sh
npm run assets:validate
node --import tsx --test src/render/*.test.ts src/audio/*.test.ts
```

The asset validator checked all 55 inventory hashes, all 10 actual GLBs/209 meshes and 11 animated clips, the 27 WAV formats and bounded peaks, four loop boundaries, four CCTV PNG headers/resolutions and seven SVGs. It rejects asset paths outside `public/assets`, symlinks, duplicates and unlisted files. The current 12 render tests passed, covering actual GLB parsing, fixed door roots, independent fault targets, emergency lever endpoints, truthful CCTV projection, visible-object click occlusion, bounded alarm lighting, current-event-only scares and the absence of breach/countdown text on physical displays. Audio queue and Web Audio graph checks are separate from these rendering checks.

These checks establish file integrity and behavior contracts. Render screenshots, complete game playthroughs, physical output listening and live provider results are reported separately by the main application verification. The preserved kit's gallery screenshots do not establish those application results.

The darker runtime was visually inspected in [room](../artifacts/harder-room.png), [terminal inspection](../artifacts/harder-terminal.png), [unpowered monitor](../artifacts/harder-dark-monitor.png) and [emergency equipment](../artifacts/harder-equipment.png) screenshots. These show the near-black room, localized amber light, worn surfaces, legible inspection controls and visible emergency locator. [The browser evidence](../artifacts/harder-visual-evidence.json) records actual terminal/monitor mesh clicks and the absence of browser errors. Subsequent [active-alarm](../artifacts/harder-alarm-active.png) and [active breach-scare](../artifacts/harder-breach-scare-active.png) screenshots were also inspected. Their [loss evidence](../artifacts/harder-loss-evidence.json) records actual alarm graph activity, late Q failing after commitment, a visible scare before results and no browser errors. Complete gameplay evidence is recorded in HANDOFF.

The separate generated breach image uses the built-in image generation tool. Its exact prompt, method and final workspace path are recorded in [breach artwork provenance](qa/breach-art-provenance.md). It is shown briefly on loss; softer scares suppress the face.
