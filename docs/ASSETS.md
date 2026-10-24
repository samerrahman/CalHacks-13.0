# Asset provenance and runtime use

The playable app ships the original Night Relay kit's **8 GLB models, 9 synthesized WAV effects, and 5 SVG decals**. The 22 files in `public/assets` were compared byte for byte with `night-relay-kit/assets`; all match. The machine-readable [manifest](../public/assets/manifest.json) records every served URL, source path, byte count, SHA-256 digest, and license identifier. `public/assets/kit-manifest.json` preserves the original kit-wide manifest; it is not the app asset inventory.

All 22 assets use **LicenseRef-Night-Relay-Kit**, the custom permissive grant preserved in [public/assets/LICENSE.txt](../public/assets/LICENSE.txt) and [night-relay-kit/LICENSE.txt](../night-relay-kit/LICENSE.txt). The notice must accompany redistributed source or asset packs. No external model pack, downloaded art, cloned voice, or provider-generated speech is included. Bundled WAVs are synthesized effects, not ElevenLabs output. Any later provider-generated speech is subject to the provider's terms and the selected voice's authorization.

## Runtime behavior

- `booth`, `console`, `radio`, `relay`, `fuse`, `floodlight`, `shutter`, and `mimic` load through Three.js `GLTFLoader`. Shutter and floodlight models are cloned for the two corridors.
- Both shutters use their supplied `open` clip. The clip alone moves `shutter_leaf`; the doorway root remains fixed at x = -4 or +4.
- The mimic uses the supplied `idle`, `listen`, and `reach` clips. Its wrapper position follows deterministic encounter state, and its authored +Z facing is rotated toward the booth.
- All nine WAVs are decoded when audio starts from a player gesture. Room hum loops; radio, shutter, relay, threat, and completion events use bounded positional audio. Speech and effects share a bounded master bus with mute and a compressor.
- `rules_card`, `warning`, and `title` are applied as supplied SVG decals. `work_order` and `challenge_card` supply the card frames; every example ID and secret is covered before the texture is displayed, then current local game values are drawn. The files retain their original hashes; replacement happens only in runtime canvas textures.
- Supplemental structural detail, monitor text, lighting, and dust are authored in scene code. The booth's neutral wall material is recolored dirty teal at runtime; source GLB bytes remain unchanged. No additional downloaded textures are needed. Gameplay clues are also available in accessible HTML controls and captions.

## Verification

`node --import tsx --test src/render/assets.test.ts src/audio/queue.test.ts` checks that all eight real GLBs parse, all three mimic clips change their authored nodes, the shutter leaf moves while its root stays fixed, paused clip scrubbing reaches the open/closed endpoints, and speech expiry/preemption/invalidation/reset behave correctly. These eight tests passed during implementation. Visual game inspection is tracked separately in the project handoff; parser tests alone do not establish rendering quality or sound playback.

## Shipped asset checksums

Every row uses `LicenseRef-Night-Relay-Kit` and the notice linked above.

| Repository path | Bytes | SHA-256 |
| --- | ---: | --- |
| `public/assets/models/booth.glb` | 27840 | `dcb8a7ecc060d3a9b2ef71672d911d01c8719f770c28f773a616d58bd27d71c8` |
| `public/assets/models/console.glb` | 9324 | `c0fd48f79f44bce2a9daf67ad105a3561a2d814e06e977ae7fce054663534c5f` |
| `public/assets/models/floodlight.glb` | 6608 | `8b708ef651ab3b8aba8d5d997a146f3d17c47838e23455a5503332b37b4c5258` |
| `public/assets/models/fuse.glb` | 5336 | `394a6bdfb008f945e59722ce9a5960ddb899d49455806c77826e39927d8d2ff9` |
| `public/assets/models/mimic.glb` | 18384 | `61cb1984867f0e5ba009f45a00ff759cfbf31dbba74009dfa9f995d5c24c0930` |
| `public/assets/models/radio.glb` | 11980 | `4b42df673eb5356e3236c1437d4c3ccbcd5f226d51e6cd869dede83575ccb682` |
| `public/assets/models/relay.glb` | 10628 | `b2b5033f877fd033a89c6cc734c09d49b1340be7f7b4ca852d2335342c5898c9` |
| `public/assets/models/shutter.glb` | 16512 | `1b314af555bf662fd71a15db6d27a4d5db1f85ff716c35ba838e0079ea1f46b6` |
| `public/assets/audio/knock.wav` | 48554 | `a48050a21ff636da58d088c74719587a097dbe39723d88af9d15e9a512f27f11` |
| `public/assets/audio/mimic_rustle.wav` | 70604 | `b60271843c05f1d7842434c209f04b642f9dd50c5362f1587445e5accce654ba` |
| `public/assets/audio/radio_chime.wav` | 28708 | `2d27bbdedfa72e6249efe5ea7b1cda18621b8e242b2ce141b5a542741648b362` |
| `public/assets/audio/radio_static.wav` | 52964 | `1489b155ec015e6644e0398faa1d90342f0491c1d5ba0957516c839d2b23288f` |
| `public/assets/audio/relay_click.wav` | 11068 | `08b1dde6c49046b09532856bc9366a07e499b84bd642bfcc2d4c3b3551dbc5a9` |
| `public/assets/audio/room_hum.wav` | 264644 | `91375ca3dcb700ff0d26d76513d64d540e101562503f144b19798df11ea47809` |
| `public/assets/audio/shutter_motor.wav` | 48554 | `0ec353655a77ff52870e745b6b8f52c02dcbf3912f6e6c171a44663166f70995` |
| `public/assets/audio/success.wav` | 61782 | `fce3f3d55d8fe4968b49c42d3f5d7932f8a601372afd322edc8c14729fe255bd` |
| `public/assets/audio/warning_pulse.wav` | 52964 | `b42acba980d5227db1f5d874ac215888c063a9b0e7345978d8c86cf0232c4aec` |
| `public/assets/decals/challenge_card.svg` | 673 | `2db2902fd4ecfc399978ff25ee9a8df7116a5ae231ade50bd77b613465274b0c` |
| `public/assets/decals/rules_card.svg` | 758 | `a27129bd15d603c5b772e5265827d061e636468dde91b6418e660de23619bd08` |
| `public/assets/decals/title.svg` | 550 | `64904ac4ac286abb4c2ccacd525800a86beac1d6dac760b12c39780d1c8be39d` |
| `public/assets/decals/warning.svg` | 598 | `0f9c83178190864cc2d250c0fd8383d7a36215d6e1c4b8b2f167ce4eac2dcddd` |
| `public/assets/decals/work_order.svg` | 755 | `42b4c46faa391aaf24ad54cfcd6109c737b9c92dcbd96000eae9d95bb64fc91c` |
