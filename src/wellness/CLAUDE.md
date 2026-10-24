# /src/wellness — Lucy (Person 4: AI, wellness & pitch)

Pure renderer-side logic with no network and no DOM. The game and the journal UI import it.

- **Tip library:** `tips.js` exports tips as `{ id, title, body, when }`, where `when` says which session pattern triggers the tip. `CheckIn.tipIds` stores the ids.
- **Suggestion rules:** given a `SessionRecord` (and recent `CheckIn`s), return the tip ids to show. Keep them as simple, testable functions.
- **Safety rules:** the director's safety overrides can import thresholds from here, so the game and the AI agree on what "too stressed" means.
- **Sample data:** write `sample-data.js` with a few `SessionRecord`s and `CheckIn`s, all with `isSample: true`, for the journal demo.
- Keep claims modest: this is a calm-practice game, not medical advice. Phrase tips that way.
