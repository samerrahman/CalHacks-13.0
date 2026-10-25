// Pure co-op manual row rules, shared by the module (publishManual) and the client (publisher and
// spectator revalidation). No server imports, so the renderer can load it like physicsSim.ts.

/** One flat row per session: the key for the player's live task, or kind 'none'. `values` is a u8 array (a Uint8Array over SpacetimeDB). */
export type ManualRow = { kind: string; stage: number; panel: number; panels: number; size: number; start: number; end: number; values: ArrayLike<number> };
export const MANUAL_KINDS = ['none', 'faults', 'wires', 'routing'] as const;
export const MANUAL_MAX_VALUES = 36;

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
  }
  return false;
}
