# Opening cutscene

A 36-second first-person film. You never see the monster. You stand at the observation console in a clean, wide hall built around a sealed containment tube, a colleague beside you. The screen goes from STABLE to SENSOR FAULT to CONTAINMENT BREACH. Something pounds on the tube until its hatch bursts open in a blast of steam, and a clawed hand grips the frame. Then its arm shoots across the room, seizes your colleague right beside you and drags them into the dark. You run the red corridor and a short, winding forest path, its heavy footsteps gaining behind you, and pull open the shelter door onto pitch black. Inside, you look back: a shadow is coming fast out of the fog. You haul the door shut while it's still far off. In the dark there's only your heartbeat and breathing, then it slams into the door and dents it inward. The game plays the pre-rendered `public/assets/video/opening.mp4` (`src/ui/OpeningFilm.tsx`), so it looks and sounds identical every run, with captions and a **Skip cutscene →** button. With reduced motion on, or if the video can't play, the game falls back to the old text cards.

| Path | What it is |
|---|---|
| `src/cutscene/timeline.ts` | Shots, captions and sound cues (seconds). The game reads its captions from here too. |
| `src/cutscene/scene.ts` | Sets, lights, camera path and all animation, as a pure function of time. |
| `src/cutscene/props/` | Low-poly placeholder builders, one file per prop. `index.ts` holds each prop's **contract**. |
| `src/cutscene/style.ts` | Shared palette and low-poly helpers. |
| `src/cutscene/look.ts` | The film's look: `ironlung` (default) or `flat`. Texture assignments per palette key, and the final image pass. |
| `cutscene/textures/` | CC0 Poly Haven textures for the `ironlung` look (credits in `SOURCES.md`). |
| `cutscene/audio/` | Door, metal, breathing and footstep recordings mixed into the soundtrack (credits in `SOURCES.md`). |
| `cutscene/models/*.glb` | The props the renderer actually loads. **Replace these to change the art.** |
| `tools/cutscene.mjs` | Offline tool: previews, GLB export, stills, final render. |

## Replacing a model

1. Make the new model in Blender (or any tool) and export a GLB with the **same file name** as in `cutscene/models/`.
2. Keep the contract from `src/cutscene/props/index.ts`: metres, +Y up, the same origin and facing, and the **same node names** for anything the scene animates (for example the tube's `hatch_door`/`hatch_panel`/`hatch_bulge`/`claw_mount`, the claws' `talon_0..3` and stretchable `forearm`, the researcher's `body`/`torso`/`head`/`arm_l`/`arm_r`/`leg_l`/`leg_r`, the exit's `door_leaf`, the shelter's `hatch_door`/`hatch_dent`). Pivot nodes must sit at their joint or hinge.
3. Re-render the film (below) and commit the GLB, `public/assets/video/opening.mp4` and `public/assets/manifest.json` (render rewrites the video's bytes and sha256).

`npm run cutscene -- models` never overwrites an existing GLB. Use `--force` only to throw away a replacement and go back to the placeholder.



## Commands

```bash
npm run cutscene -- prop claws             # contact sheet of a procedural prop → cutscene/.previews/
npm run cutscene -- nodes claws            # node names and pivots
npm run cutscene -- stills 8 21.9 28.6     # PNG keyframes from the GLBs
npm run cutscene -- render                 # full MP4 + soundtrack → public/assets/video/opening.mp4
npm run cutscene -- audio                  # soundtrack only → cutscene/.previews/soundtrack.wav
```

## Looks

`ironlung` is the default, in the spirit of Iron Lung. It uses grimy photo textures shrunk to 128 px and point-sampled, so you see the texels. The scene renders at 640×360 and is graded toward rust and sepia, with film grain, ordered dither and a vignette. The textures are box-projected by world size, so props need no UVs, and their brightness is matched to the palette colour, so the lighting still reads as tuned.

`render` encodes the `ironlung` film at its native 640×360 (about 6 MB), and the game scales it up with crisp pixels (`image-rendering: pixelated` in `src/ui/style.css`). Encoding those 3×3 blocks at 1080p would cost about 5× the bytes for no gain.

Inside the facility (lab, tube, corridor, exit), `ironlung` uses a clean set: brushed concrete and washed-out steel and diamond plate (`CLEAN` in `look.ts`). The grime starts outdoors.

`flat` is the original look: flat palette colours at full resolution, encoded at 1920×1080. Pass `--look=flat` to `stills` or `render`, or add `&look=flat` to the preview URL.

`render` also refreshes the video's entry (bytes and sha256) in `public/assets/manifest.json`, so `npm run assets:validate` keeps passing. For a quick look, add `--scale=0.5 --seconds=10 --out=cutscene/.previews/test.mp4`. To preview in real time, run `npm run dev` and open `/cutscene/index.html?preview` (the space bar pauses; drag the slider to scrub).

It renders in headless Chrome on the GPU and encodes with `ffmpeg` (`brew install ffmpeg`). Every frame is a pure function of its time: there are no clocks, and randomness comes from seeded `rng()`. Two renders give identical frames.

## Rules

- Never use `Math.random()` or `Date` in `src/cutscene/`.
- Keep props **low detail**: simple blocky placeholders of a few hundred triangles. They're meant to be replaced.
- The soundtrack is synthesised by ffmpeg from the `SYNTH` layers in `timeline.ts` (impacts, hiss, steps, heartbeat, rain, wind, drone), except the doors, the groaning metal, your breathing and the creature's footsteps behind you. Those use public-domain and CC0 recordings in `cutscene/audio/` (credits in its `SOURCES.md`), mixed by `SOUND_CUES`. Breathing and the heartbeat sit well under the impacts on purpose: loud, they make the film feel cluttered. It uses none of the game's WAVs. Change either list, then re-render.
- Keep the run sparse: footsteps, breathing and light weather. Layers that pile up there read as mush.
- Materials named `void` render pure black and unlit. Use them for openings into darkness.
- Textures must be CC0 or similarly free, and credited in `cutscene/textures/SOURCES.md`.
