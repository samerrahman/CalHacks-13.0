# /assets — Lea (Person 3: art & UI)

Lea draws the art. The agent imports it: naming, sprite sheets and layering. This folder is Vite's `publicDir`, so `assets/sprites/watcher_idle.png` is served as `sprites/watcher_idle.png`.

## Layout and naming
- `backgrounds/` full-screen layers · `sprites/` creatures and props · `ui/` buttons, frames, journal art · `audio/` sfx and music
- Lowercase snake_case: `<thing>_<state>.png`, e.g. `watcher_idle.png`, `lamp_on.png`. Sprite sheets end in `_sheet.png`.
- **Placeholders first:** right away, add flat-color rectangles under their **final** file names, so the game code never has to change when the real art arrives.

## asset-pack.json (the contract with the game)
Every asset gets one entry in [Phaser's asset pack format](https://docs.phaser.io/api-documentation/class/loader-loaderplugin#pack). The game loads only through this file and refers to assets by `key`.

```json
{ "type": "image", "key": "desk", "url": "backgrounds/desk.png" }
{ "type": "spritesheet", "key": "listener_walk", "url": "sprites/listener_walk_sheet.png", "frameConfig": { "frameWidth": 128, "frameHeight": 128 } }
{ "type": "audio", "key": "radio_static", "url": ["audio/radio_static.ogg", "audio/radio_static.mp3"] }
```

Once a key is in use, don't rename it. Add a new key instead and tell James.
