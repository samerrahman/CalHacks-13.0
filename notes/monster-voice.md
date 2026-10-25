# Monster voice auditions

The game already sends Gemini's validated monster line to ElevenLabs. Set `ELEVENLABS_VOICE_ID` in the ignored `.env.local` to a voice available in the ElevenLabs account; restart the dev server or desktop app after changing it. The current checkout is configured locally with Malyx and `eleven_flash_v2_5`. The API key is not in Git.

Public ElevenLabs previews to compare:

| Voice | Character | Preview |
| --- | --- | --- |
| Malyx | Echoey, menacing, deep demon | [ElevenLabs voice page](https://elevenlabs.io/app/voice-library?voiceId=vfaqCOvlrKi4Zp7C2IAm) |
| Azazel | Menacing, gravelly demon | [ElevenLabs voice page](https://elevenlabs.io/app/voice-library?voiceId=ysswSXp8U9dFpzPJqFje) |
| Dracon | Feral, dangerous demon | [ElevenLabs voice page](https://elevenlabs.io/app/voice-library?voiceId=A921zklid24OpyVy1Elb) |

All three voices were added to the supplied ElevenLabs account and generated the same short line successfully with `eleven_flash_v2_5`. Original and distorted samples are in the ignored local `voice-auditions/` folder. The distorted files approximate the in-game Web Audio treatment for comparison; the in-game creature path lowers speech playback to 78% speed and blends a low-passed body with driven distortion and a short dark double. Human radio speech keeps its existing radio filter. Captions remain the exact spoken text. The full Gemini-to-ElevenLabs game flow has not yet been live-tested with this configuration.
