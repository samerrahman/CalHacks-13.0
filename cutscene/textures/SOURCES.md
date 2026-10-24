# Cutscene textures

These are used only by the offline cutscene renderer's `ironlung` look (`src/cutscene/look.ts`). They are not shipped in the game; only the rendered video is.

All of them come from [Poly Haven](https://polyhaven.com) and are **CC0** (public domain), so no attribution is required. Each is the 1k diffuse JPG, downscaled to 128×128 PNG with ffmpeg (`scale=128:128:flags=area`). The renderer point-samples them for a low-res, PS1-era grain.

| File | Poly Haven asset | Authors | Used for |
|---|---|---|---|
| `rusty_metal_04.png` | [Rusty Metal 04](https://polyhaven.com/a/rusty_metal_04) | Amal Kumar | `metal`, `metal_dark`, `deep_steel`, `screen_teal`, `screen_amber` (grime over the glow) |
| `rusty_metal_02.png` | [Rusty Metal 02](https://polyhaven.com/a/rusty_metal_02) | Rob Tuytel | `rust`, `lab_panel`, `steel_teal` |
| `rusty_painted_metal.png` | [Rusty Painted Metal](https://polyhaven.com/a/rusty_painted_metal) | Amal Kumar | `hazard_yellow` |
| `metal_plate.png` | [Metal Plate](https://polyhaven.com/a/metal_plate) | Rob Tuytel | `lab_floor` |
| `peeling_painted_wall.png` | [Peeling Painted Wall](https://polyhaven.com/a/peeling_painted_wall) | Dimitrios Savva | `wall_teal`, `cream` |
| `chipped_concrete.png` | [Chipped Concrete](https://polyhaven.com/a/chipped_concrete) | Amal Kumar | `concrete`, `concrete_dark`, `concrete_stain`, `labcoat` |
| `anti_slip_concrete.png` | [Anti Slip Concrete](https://polyhaven.com/a/anti_slip_concrete) | Charlotte Baglioni | `glove` |
| `bark_brown_02.png` | [Bark Brown 02](https://polyhaven.com/a/bark_brown_02) | Rob Tuytel | `bark` |
| `forest_leaves_03.png` | [Forest Leaves 03](https://polyhaven.com/a/forest_leaves_03) | Rob Tuytel, Dimitrios Savva | `pine`, `pine_dark` |
| `forest_ground_04.png` | [Forest Ground 04](https://polyhaven.com/a/forest_ground_04) | Rob Tuytel, Rico Cilliers | `moss` |
| `brown_mud_leaves_01.png` | [Brown Mud Leaves 01](https://polyhaven.com/a/brown_mud_leaves_01) | Rob Tuytel | `dirt` |
| `brown_mud_02.png` | [Brown Mud 02](https://polyhaven.com/a/brown_mud_02) | Rob Tuytel | `mud` |
| `dark_rock.png` | [Dark Rock](https://polyhaven.com/a/dark_rock) | Amal Kumar | `rock` |
| `rock_pitted_mossy.png` | [Rock Pitted Mossy](https://polyhaven.com/a/rock_pitted_mossy) | Dimitrios Savva, Rico Cilliers | `claw_skin`, `creature_skin` |

To swap a texture, replace its PNG and keep the file name, or point the palette key at a new file in `SURFACES` in `src/cutscene/look.ts`. Then re-render.
