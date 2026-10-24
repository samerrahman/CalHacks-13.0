import type { Feeling } from './storage';

/** Reviewed, local game-comfort copy. Selection uses only a player's answer,
 * never a camera classification or inferred emotion. */
const TIP_LIBRARY: Record<Feeling | 'none', readonly string[]> = {
  Calm: ['Keep the pace that felt comfortable if you play another shift.'],
  Mixed: ['Take your time before choosing whether to play another shift.'],
  Tense: ['You can lower the game volume or step away before another shift.'],
  none: ['You can finish here or play another shift when you feel ready.'],
};

export function selectSuggestions(choice: Feeling | null): string[] {
  return [...TIP_LIBRARY[choice ?? 'none']];
}
