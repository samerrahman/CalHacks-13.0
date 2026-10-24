# /assets — Lea (Person 3: art & UI)

Lea makes the art. The agent handles importing it: export settings, naming and the manifest. This folder is Vite's `publicDir`, so `assets/models/booth.glb` is served as `models/booth.glb`.

## Layout and naming
- `models/` GLB files · `audio/` sfx, ambience and cached voice lines · `decals/` SVG/PNG labels and cards · `ui/` menu and HUD art
- Lowercase snake_case: `<thing>.glb`, `<thing>_<variant>.wav`.
- Models are **GLB, meters, Y up**, with the origin at the object's base. Name nodes and animation clips meaningfully (`shutter_leaf`, `idle`, `reach`), because the game looks them up by name.
- **Placeholders first:** add a simple box under each model's **final** file name, so the game never needs a code change when the real art arrives.
- Starting point: James's `Night_Relay_Codex_Build_Kit.zip` (repo root) has 8 original GLB models, 9 WAV effects and 5 SVG decals. Unpack what the team decides to use into these folders. Its `LICENSE.txt` covers reuse.

## manifest.json (the contract with the game)
Every asset gets one entry. The game loads only through this file and refers to assets by key.

```json
{
  "models": { "booth": { "url": "models/booth.glb", "clips": [] }, "mimic": { "url": "models/mimic.glb", "clips": ["idle", "listen", "reach"] } },
  "audio":  { "radio_static": { "url": "audio/radio_static.wav", "loop": true } },
  "decals": { "work_order": { "url": "decals/work_order.svg" } }
}
```

Once a key is in use, don't rename it. Add a new key instead and tell James.
