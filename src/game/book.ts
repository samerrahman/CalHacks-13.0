import { config } from './config';
import { doorKeyFor } from './coop';
import { faultSounds, generateRouting, tileOpenings } from './tasks';
import type { RoutingState, Sector } from './state';

/** The co-op friend's manual: a book with every answer for the run, derived from the seed alone, so the
 * spectate page prints it from the seed in the public trace and nothing live is needed to look things
 * up. Every mapping is reshuffled for each seed. The player has to describe what they see (a sound, a
 * panel and cable symbol, a board's IN and OUT rows, the signal's glyphs, how many keys) and the friend
 * finds the answer. Only the breathing pacer is live (coopManual in coop.ts), because it is timing. */

/** What the player sees during co-op memory playback instead of digits: name them to the friend. */
export const MEMORY_GLYPHS = [{ glyph: '☾', name: 'MOON' }, { glyph: '◉', name: 'EYE' }, { glyph: '✕', name: 'CROSS' }, { glyph: '☰', name: 'BARS' }] as const;
/** The radar's distance bands, nearest first, as sectorsAt draws them (line units; the spectate page
 * reads 5 m per unit). On a shared boundary either key is accepted. */
export const LOCATE_BANDS: { sector: Sector; from: number; to: number; name: string }[] = [
  { sector: 'NEAR', from: 0, to: 7, name: 'Under 35 m · at the wall' }, { sector: 'A', from: 7, to: 14, name: '35–70 m · the clearing' }, { sector: 'B', from: 14, to: 22, name: '70–110 m · the path' }, { sector: 'C', from: 22, to: 24, name: 'Over 110 m · the tree line' },
];
const SECTOR_ORDER: Sector[] = ['NEAR', 'A', 'B', 'C'];
/** Boards in the book; the game picks one for each co-op conduit, so the player must say which. */
export const BOOK_BOARDS = 4;

function hash(seed: number, salt: number, i: number): number {
  return Math.imul((Math.imul((seed >>> 0) ^ 0x7f4a7c15, 2246822519) + salt * 0x9e3779b1 + i * 0x85ebca6b) >>> 0, 2654435761) >>> 0;
}
/** A permutation of 0..n−1 from the seed and a salt. */
function shuffled(seed: number, salt: number, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = hash(seed, salt, i) % (i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  return order;
}
function seededRandom(seed: number, salt: number): () => number {
  let state = hash(seed, salt, 0) || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** Machine (0–3) that makes each fault sound (FAULT_SOUNDS order) in research stage 1 or 3. */
export function faultMachines(seed: number, stage: 1 | 3): number[] {
  const sounds = faultSounds({ seed, tasks: { stage } as never });
  return [0, 1, 2, 3].map(sound => sounds.indexOf(sound));
}
/** Socket code (0 = A …) for each cable symbol on one six-cable panel. The player's sockets show these codes. */
export function wireCodes(seed: number, stage: number, panel: number): number[] {
  return shuffled(seed, 100 + stage * 10 + panel, config.tasks.wirePanelSize);
}
export function wirePanels(stage: 1 | 3): number { return Math.ceil((stage === 1 ? config.tasks.stage1.wires : config.tasks.stage3.wires) / config.tasks.wirePanelSize); }
/** Glyph (MEMORY_GLYPHS index) shown for each digit 1–4 in research stage 2 or 4: glyphFor[digit − 1]. */
export function memoryGlyphs(seed: number, stage: number): number[] { return shuffled(seed, 200 + stage, 4); }
/** Key (1–4) for each radar band, nearest first, this run. */
export function locateKeys(seed: number): number[] { return shuffled(seed, 300, 4).map(k => k + 1); }
/** The sector a co-op locate key marks. */
export function locateSector(seed: number, key: number): Sector { return SECTOR_ORDER[Math.max(0, locateKeys(seed).indexOf(key))]!; }

/** The book's conduit boards, each with a different pair of IN and OUT rows so the player can name theirs. */
export function coopBoards(seed: number): RoutingState[] {
  const boards: RoutingState[] = [];
  for (let attempt = 0; boards.length < BOOK_BOARDS && attempt < 64; attempt++) {
    const board = generateRouting(seededRandom(seed, 400 + attempt), 0);
    if (!boards.some(b => b.start === board.start && b.end === board.end)) boards.push(board);
  }
  return boards;
}
/** Solved openings (N1 E2 S4 W8) for every route tile of a board; 0 off the route. */
export function solvedTiles(board: Pick<RoutingState, 'kinds' | 'answer'>): number[] {
  return board.answer.map((turns, tile) => turns < 0 ? 0 : tileOpenings(board.kinds[tile]!, turns));
}

export type CoopBook = {
  faults: { stage: 1 | 3; machines: number[] }[];
  cables: { stage: 1 | 3; panel: number; panels: number; codes: number[] }[];
  boards: { start: number; end: number; size: number; tiles: number[] }[];
  memory: { stage: 2 | 4; glyphFor: number[] }[];
  locate: number[];
  door: number[];
};
export function coopBook(seed: number): CoopBook {
  return {
    faults: ([1, 3] as const).map(stage => ({ stage, machines: faultMachines(seed, stage) })),
    cables: ([1, 3] as const).flatMap(stage => Array.from({ length: wirePanels(stage) }, (_, panel) => ({ stage, panel, panels: wirePanels(stage), codes: wireCodes(seed, stage, panel) }))),
    boards: coopBoards(seed).map(b => ({ start: b.start, end: b.end, size: b.size, tiles: solvedTiles(b) })).sort((a, b) => a.start - b.start || a.end - b.end),
    memory: ([2, 4] as const).map(stage => ({ stage, glyphFor: memoryGlyphs(seed, stage) })),
    locate: locateKeys(seed),
    door: doorKeyFor(seed),
  };
}
