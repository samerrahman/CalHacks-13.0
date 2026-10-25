// Pure spectator-prediction rules, shared by the module (predictOutcome) and the spectate page. No server
// imports, so the renderer can load it like coopRules.ts. Predictions never reach the player's game.

export const PREDICTION_CHOICES = ['escape', 'caught'] as const;
export type PredictionChoice = typeof PREDICTION_CHOICES[number];
/** Calls lock once the run reaches research stage 3; one row per spectator, at most 64 per session. */
export const PREDICTION_LIMITS = { lastStage: 2, maxPerSession: 64, gapMs: 1000, nameMax: 16 } as const;
export const predictionChoiceValid = (choice: unknown): choice is PredictionChoice => typeof choice === 'string' && (PREDICTION_CHOICES as readonly string[]).includes(choice);

/** A display name: letters, digits, spaces and . _ - only, 1–16 characters after trimming; null if unusable. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= PREDICTION_LIMITS.nameMax && /^[A-Za-z0-9 ._-]+$/.test(name) ? name : null;
}

/** What spectators see of each prediction: a short voter tag (not an identity), the name, the call and the stage it was made at. */
export type PredictionRow = { voter: string; name: string; choice: string; stage: number };
export function predictionRowValid(row: unknown): row is PredictionRow {
  const r = row as PredictionRow;
  return !!r && typeof r === 'object' && typeof r.voter === 'string' && /^[a-f0-9]{8}$/.test(r.voter) && cleanName(r.name) === r.name && predictionChoiceValid(r.choice)
    && Number.isInteger(r.stage) && r.stage >= 1 && r.stage <= PREDICTION_LIMITS.lastStage;
}

export type Standing = { voter: string; name: string; choice: PredictionChoice; stage: number; points: number };
/** Right calls score 200 made in stage 1, 150 in stage 2; wrong calls 0. Highest first, then by name. */
export function standings(rows: readonly PredictionRow[], outcome: 'won' | 'lost'): Standing[] {
  const right: PredictionChoice = outcome === 'won' ? 'escape' : 'caught';
  return rows.filter(predictionRowValid).map(r => ({ voter: r.voter, name: r.name, choice: r.choice as PredictionChoice, stage: r.stage, points: r.choice === right ? (r.stage <= 1 ? 200 : 150) : 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
