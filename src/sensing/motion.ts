/** Prototype stillness meter for the proposed "hold still" webcam mechanic (docs/WEBCAM_FREEZE.md).
 * Frames are reduced to a tiny luma grid in memory and compared with the previous grid only.
 * Nothing is stored, recorded or sent; it is not wired into game state or any shared trace. */
export type MotionReading = { energy: number; still: boolean; stillForMs: number; ready: boolean };
export type MotionOptions = { noiseFloor?: number; fullScale?: number; smoothing?: number; stillBelow?: number; movingAbove?: number };

export const GRID_WIDTH = 32;
export const GRID_HEIGHT = 24;

export class MotionMeter {
  private previous: Uint8Array | null = null;
  private energy = 0;
  private still = false;
  private stillSince: number | null = null;
  private readonly noiseFloor: number;
  private readonly fullScale: number;
  private readonly smoothing: number;
  private readonly stillBelow: number;
  private readonly movingAbove: number;
  constructor(options: MotionOptions = {}) {
    this.noiseFloor = options.noiseFloor ?? 6;
    this.fullScale = options.fullScale ?? 28;
    this.smoothing = options.smoothing ?? 0.35;
    this.stillBelow = options.stillBelow ?? 0.08;
    this.movingAbove = options.movingAbove ?? 0.16;
  }
  /** `luma` is a GRID_WIDTH × GRID_HEIGHT brightness grid; `atMs` is one local monotonic clock. */
  push(luma: Uint8Array, atMs: number): MotionReading {
    if (luma.length !== GRID_WIDTH * GRID_HEIGHT || !Number.isFinite(atMs)) throw new Error('Invalid motion frame');
    const previous = this.previous;
    this.previous = luma.slice();
    if (!previous) return { energy: 0, still: false, stillForMs: 0, ready: false };
    // Subtracting each frame's mean ignores auto-exposure and lamp flicker that brighten
    // the whole image at once; only local change (a head or hand moving) counts.
    const meanNow = mean(luma), meanBefore = mean(previous);
    let moved = 0;
    for (let i = 0; i < luma.length; i++) {
      const change = Math.abs((luma[i]! - meanNow) - (previous[i]! - meanBefore));
      if (change > this.noiseFloor) moved += change - this.noiseFloor;
    }
    const raw = Math.min(1, moved / luma.length / this.fullScale);
    this.energy += (raw - this.energy) * this.smoothing;
    if (this.still && this.energy > this.movingAbove) { this.still = false; this.stillSince = null; }
    else if (!this.still && this.energy < this.stillBelow) { this.still = true; this.stillSince = atMs; }
    return { energy: this.energy, still: this.still, stillForMs: this.still && this.stillSince !== null ? Math.max(0, atMs - this.stillSince) : 0, ready: true };
  }
  reset(): void { this.previous = null; this.energy = 0; this.still = false; this.stillSince = null; }
}

/** Rec. 601 luma from canvas RGBA pixels of a GRID_WIDTH × GRID_HEIGHT draw. */
export function lumaFromRgba(rgba: Uint8ClampedArray): Uint8Array {
  if (rgba.length !== GRID_WIDTH * GRID_HEIGHT * 4) throw new Error('Unexpected frame size');
  const out = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!);
  return out;
}

function mean(values: Uint8Array): number { let sum = 0; for (const v of values) sum += v; return sum / values.length; }
