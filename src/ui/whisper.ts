/** Co-op whisper rule, UI side: turns the player's mic level (0–1, see useCameraShare.micLevel) into the
 * coarse loud/quiet input the game reads. Loud only after it stays above the line for a moment, quiet
 * again only after it stays below a lower line, so a cough or a pause doesn't flicker it. */
export const WHISPER = { line: 0.55, quietLine: 0.4, loudAfterMs: 300, quietAfterMs: 700 } as const;
export class WhisperGate {
  loud = false;
  private crossedAt: number | null = null;
  update(level: number, nowMs: number): boolean {
    const crossing = this.loud ? level < WHISPER.quietLine : level > WHISPER.line;
    if (!crossing) { this.crossedAt = null; return this.loud; }
    this.crossedAt ??= nowMs;
    if (nowMs - this.crossedAt >= (this.loud ? WHISPER.quietAfterMs : WHISPER.loudAfterMs)) { this.loud = !this.loud; this.crossedAt = null; }
    return this.loud;
  }
  reset(): void { this.loud = false; this.crossedAt = null; }
}
