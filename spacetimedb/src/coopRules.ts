// Pure co-op manual row rules, shared by the module (publishManual) and the client (publisher and
// spectator revalidation). No server imports, so the renderer can load it like physicsSim.ts.

/** One flat row per session: the key for the player's live task, or kind 'none'. `values` is a u8 array (a Uint8Array over SpacetimeDB). */
export type ManualRow = { kind: string; stage: number; panel: number; panels: number; size: number; start: number; end: number; values: ArrayLike<number> };
export const MANUAL_KINDS = ['none', 'faults', 'wires', 'routing', 'memory', 'locate', 'calm', 'door'] as const;
export const MANUAL_MAX_VALUES = 36;
/** Basement door key digits (1–4); matches config.coop.doorKeyLength. */
export const DOOR_KEY_LENGTH = 4;

/** What a co-op friend may send the player: a warning lamp or a remote decoy. The game revalidates
 * both against its own cooldowns and charges; these server limits only stop floods. */
export const FRIEND_SIGNALS = ['warn', 'decoy'] as const;
export type FriendSignal = typeof FRIEND_SIGNALS[number];
export const FRIEND_LIMITS = { warnGapMs: 2000, decoyGapMs: 15_000, maxDecoys: 3 } as const;
export const friendSignalValid = (kind: unknown): kind is FriendSignal => typeof kind === 'string' && (FRIEND_SIGNALS as readonly string[]).includes(kind);
/** The owner inbox row: running counts only. The player acts on increases it has not seen yet. */
export type FriendRow = { warnCount: number; decoyCount: number };
export function friendRowValid(row: unknown): row is FriendRow {
  const r = row as FriendRow;
  return !!r && typeof r === 'object' && Number.isInteger(r.warnCount) && r.warnCount >= 0 && r.warnCount < 100_000 && Number.isInteger(r.decoyCount) && r.decoyCount >= 0 && r.decoyCount <= FRIEND_LIMITS.maxDecoys;
}

const permutation = (values: readonly number[]) => [...values].sort((a, b) => a - b).every((v, i) => v === i);
const small = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Exact shapes only; anything else is refused by the server and treated as no manual by a spectator. */
export function manualRowValid(row: ManualRow): boolean {
  if (!row || typeof row !== 'object' || !(MANUAL_KINDS as readonly string[]).includes(row.kind) || !(Array.isArray(row.values) || row.values instanceof Uint8Array) || row.values.length > MANUAL_MAX_VALUES) return false;
  const values = Array.from(row.values);
  if (!values.every(v => small(v, 15))) return false;
  if (![row.stage, row.panel, row.panels, row.size, row.start, row.end].every(v => small(v, 255))) return false;
  const rest = (...names: ('panel' | 'panels' | 'size' | 'start' | 'end')[]) => names.every(name => row[name] === 0);
  switch (row.kind) {
    case 'none': return row.stage === 0 && values.length === 0 && rest('panel', 'panels', 'size', 'start', 'end');
    case 'faults': return (row.stage === 1 || row.stage === 3) && values.length === 4 && permutation(values) && rest('panel', 'panels', 'size', 'start', 'end');
    case 'wires': return (row.stage === 1 || row.stage === 3) && row.panels >= 1 && row.panels <= 4 && row.panel < row.panels && values.length >= 1 && values.length <= 6 && permutation(values) && rest('size', 'start', 'end');
    case 'routing': return row.stage === 1 && row.size >= 2 && row.size <= 6 && row.start < row.size && row.end < row.size && values.length === row.size * row.size && rest('panel', 'panels');
    // memory: values are the digits 1–4; panel is how many the player has entered, panels 1 while playback runs.
    case 'memory': return (row.stage === 2 || row.stage === 4) && values.length >= 1 && values.length <= 12 && values.every(v => v >= 1 && v <= 4) && row.panel <= values.length && row.panels <= 1 && rest('size', 'start', 'end');
    // locate: values are the rings (0–3, ascending) where a mark lands now; panel marks made of panels required.
    case 'locate': return row.stage === 3 && values.length >= 1 && values.length <= 2 && values.every((v, i) => v <= 3 && (i === 0 || v > values[i - 1]!)) && row.panels >= 1 && row.panels <= 15 && row.panel < row.panels && rest('size', 'start', 'end');
    // calm: panel 1 while breathing in; size the half-breath and start how far into it (tenths of a second); end progress of panels required.
    case 'calm': return row.stage === 4 && row.panel <= 1 && row.size >= 5 && row.start <= row.size && row.panels >= 1 && row.end <= row.panels && values.length === 0;
    case 'door': return row.stage === 5 && values.length === DOOR_KEY_LENGTH && values.every(v => v >= 1 && v <= 4) && rest('panel', 'panels', 'size', 'start', 'end');
  }
  return false;
}
