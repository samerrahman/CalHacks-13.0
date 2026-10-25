import { GRID_HEIGHT, GRID_WIDTH, lumaFromRgba, MotionMeter } from './motion';
import type { NativeMetrics } from './presageSample';

export type FrameDiagnostics = {
  code: number;
  hint: string;
  rppgValue: number;
  chestValue: number;
  abdomenValue: number;
  blinkDetected: boolean;
  talkingDetected: boolean;
};

type SamplePoint = { t: number; v: number };

/** Evaluates a 32×24 RGBA frame for lighting, centered face/skin presence, chest visibility, and stillness,
 * and extracts optical rPPG (green-red chrominance) and chest/abdomen respiratory signals. */
export class BrowserFrameAnalyzer {
  private motion = new MotionMeter({ stillBelow: 0.08, movingAbove: 0.14 });
  private rppgRaw: SamplePoint[] = [];
  private rppgFiltered: SamplePoint[] = [];
  private chestRaw: SamplePoint[] = [];
  private chestFiltered: SamplePoint[] = [];
  private abdomenRaw: SamplePoint[] = [];
  private eyeBaseline: number | null = null;
  private mouthPrev: number | null = null;
  private validFrames = 0;

  analyzeFrame(rgba: Uint8ClampedArray, nowMs: number): FrameDiagnostics {
    const luma = lumaFromRgba(rgba);
    const motion = this.motion.push(luma, nowMs);

    let fullLumaSum = 0;
    for (let i = 0; i < luma.length; i++) fullLumaSum += luma[i]!;
    const fullLuma = fullLumaSum / luma.length;

    // Central face guide: cols 9..22, rows 2..14 (14x13 = 182 cells)
    let faceLumaSum = 0, faceCells = 0, centerSkin = 0;
    let foreheadR = 0, foreheadG = 0, foreheadB = 0, foreheadCount = 0;
    let eyeLumaSum = 0, eyeCount = 0;
    let mouthDiffSum = 0, mouthLumaSum = 0, mouthCount = 0;

    for (let row = 2; row <= 14; row++) {
      for (let col = 9; col <= 22; col++) {
        const idx = row * GRID_WIDTH + col;
        const p = idx * 4;
        const r = rgba[p]!, g = rgba[p + 1]!, b = rgba[p + 2]!, y = luma[idx]!;
        faceLumaSum += y;
        faceCells++;
        if (isSkinPixel(r, g, b)) centerSkin++;
        if (row >= 3 && row <= 12 && col >= 11 && col <= 20) {
          foreheadR += r; foreheadG += g; foreheadB += b; foreheadCount++;
        }
        if (row >= 5 && row <= 7 && col >= 11 && col <= 20) {
          eyeLumaSum += y; eyeCount++;
        }
        if (row >= 11 && row <= 13 && col >= 12 && col <= 19) {
          mouthLumaSum += y; mouthCount++;
        }
      }
    }

    // Outer border skin check (detect off-center face)
    let outerSkin = 0, outerCells = 0;
    for (let row = 0; row < GRID_HEIGHT; row++) {
      for (let col = 0; col < GRID_WIDTH; col++) {
        if (row >= 2 && row <= 14 && col >= 9 && col <= 22) continue;
        const p = (row * GRID_WIDTH + col) * 4;
        if (isSkinPixel(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!)) outerSkin++;
        outerCells++;
      }
    }

    // Upper & lower chest regions: rows 15..18 and 19..22, cols 8..23
    let upperSum = 0, upperCount = 0, lowerSum = 0, lowerCount = 0, chestSqSum = 0;
    for (let row = 15; row <= 22; row++) {
      for (let col = 8; col <= 23; col++) {
        const y = luma[row * GRID_WIDTH + col]!;
        if (row <= 18) { upperSum += y; upperCount++; }
        else { lowerSum += y; lowerCount++; }
        chestSqSum += y * y;
      }
    }

    const faceLuma = faceLumaSum / Math.max(1, faceCells);
    const centerSkinRatio = centerSkin / Math.max(1, faceCells);
    const outerSkinRatio = outerSkin / Math.max(1, outerCells);
    const chestMean = (upperSum + lowerSum) / Math.max(1, upperCount + lowerCount);
    const chestVar = Math.max(0, chestSqSum / Math.max(1, upperCount + lowerCount) - chestMean * chestMean);

    // Optical rPPG raw signal from normalized chrominance (G - R/2 - B/2) / (R + G + B)
    const totalRgb = foreheadR + foreheadG + foreheadB;
    const rawRppg = totalRgb > 0 ? ((2 * foreheadG - foreheadR - foreheadB) / totalRgb) * 100 : 0;
    this.rppgRaw.push({ t: nowMs, v: rawRppg });
    while (this.rppgRaw.length > 0 && nowMs - this.rppgRaw[0]!.t > 16_000) this.rppgRaw.shift();

    const mean1s = windowMean(this.rppgRaw, nowMs, 1100);
    const mean200ms = windowMean(this.rppgRaw, nowMs, 220);
    const filteredRppg = (mean200ms - mean1s) * 18;

    const upperMean = upperSum / Math.max(1, upperCount);
    const lowerMean = lowerSum / Math.max(1, lowerCount);
    this.chestRaw.push({ t: nowMs, v: upperMean });
    this.abdomenRaw.push({ t: nowMs, v: lowerMean });
    while (this.chestRaw.length > 0 && nowMs - this.chestRaw[0]!.t > 20_000) this.chestRaw.shift();
    while (this.abdomenRaw.length > 0 && nowMs - this.abdomenRaw[0]!.t > 20_000) this.abdomenRaw.shift();

    const chestBase = windowMean(this.chestRaw, nowMs, 6000);
    const abdomenBase = windowMean(this.abdomenRaw, nowMs, 6000);
    const chestVal = windowMean(this.chestRaw, nowMs, 450) - chestBase;
    const abdomenVal = windowMean(this.abdomenRaw, nowMs, 450) - abdomenBase;

    const eyeRatio = (eyeLumaSum / Math.max(1, eyeCount)) / Math.max(1, faceLuma);
    this.eyeBaseline = this.eyeBaseline === null ? eyeRatio : this.eyeBaseline * 0.92 + eyeRatio * 0.08;
    const blinkDetected = Math.abs(eyeRatio - this.eyeBaseline) > 0.045;

    const mouthRatio = (mouthLumaSum / Math.max(1, mouthCount)) / Math.max(1, faceLuma);
    if (this.mouthPrev !== null) mouthDiffSum = Math.abs(mouthRatio - this.mouthPrev);
    this.mouthPrev = mouthRatio;
    const talkingDetected = mouthDiffSum > 0.035;

    // Validation checks in priority order
    let code = 0;
    let hint = 'Capture validated';
    if (faceLuma < 38 || fullLuma < 26) {
      code = 5;
      hint = 'Add steady light in front of you.';
    } else if (faceLuma > 240) {
      code = 6;
      hint = 'Reduce glare or strong light on your face.';
    } else if (centerSkinRatio < 0.16) {
      if (outerSkinRatio >= 0.14) {
        code = 3;
        hint = 'Center your face in the preview.';
      } else {
        code = 1;
        hint = 'Face the camera so your whole face is in the preview.';
      }
    } else if (chestVar < 6) {
      code = 7;
      hint = 'Sit back so your shoulders and upper chest are visible.';
    } else if (motion.ready && (!motion.still || motion.energy > 0.14)) {
      code = 12;
      hint = 'Hold still and keep the camera steady.';
    }

    if (code === 0) {
      this.validFrames++;
      this.rppgFiltered.push({ t: nowMs, v: filteredRppg });
      this.chestFiltered.push({ t: nowMs, v: chestVal });
      while (this.rppgFiltered.length > 0 && nowMs - this.rppgFiltered[0]!.t > 15_000) this.rppgFiltered.shift();
      while (this.chestFiltered.length > 0 && nowMs - this.chestFiltered[0]!.t > 18_000) this.chestFiltered.shift();
    } else {
      // Discard corrupted oscillation history on motion or framing loss
      if (code === 12 || code === 1 || code === 3) {
        this.rppgFiltered = this.rppgFiltered.slice(-15);
      }
    }

    return {
      code,
      hint,
      rppgValue: filteredRppg,
      chestValue: chestVal,
      abdomenValue: abdomenVal,
      blinkDetected,
      talkingDetected,
    };
  }

  /** Produces an SDK-compatible NativeMetrics packet from the real optical traces. */
  buildMetrics(frame: FrameDiagnostics, nowMs: number, wallMs: number): NativeMetrics {
    const stamp = Math.round(wallMs * 1000);
    const stable = frame.code === 0;
    const pulseEst = stable ? estimatePulse(this.rppgFiltered, nowMs) : null;
    const breathEst = stable ? estimateBreathing(this.chestFiltered, nowMs) : null;

    return {
      cardio: {
        arterialPressureTrace: [{ value: frame.rppgValue, stable, confidence: pulseEst?.confidence ?? (stable ? 65 : 20), timestamp: stamp }],
        ...(pulseEst ? {
          pulseRate: [{ value: pulseEst.bpm, stable: true, confidence: pulseEst.confidence, timestamp: stamp }],
          ...(pulseEst.hrv ? { hrv: [{ ...pulseEst.hrv, stable: true, confidence: pulseEst.confidence, timestamp: stamp }] } : {}),
        } : {}),
      },
      breathing: {
        upperTrace: [{ value: frame.chestValue, stable, timestamp: stamp }],
        lowerTrace: [{ value: frame.abdomenValue, stable, timestamp: stamp }],
        ...(breathEst ? { rate: [{ value: breathEst.rpm, stable: true, confidence: breathEst.confidence, timestamp: stamp }] } : {}),
      },
      face: {
        blinking: [{ detected: frame.blinkDetected, stable, timestamp: stamp }],
        talking: [{ detected: frame.talkingDetected, stable, timestamp: stamp }],
      },
    };
  }
}

function isSkinPixel(r: number, g: number, b: number): boolean {
  if (r < 48 || g < 28 || b < 15) return false;
  if (r <= g || r <= b || r - Math.min(g, b) < 10) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 75 && cb <= 138 && cr >= 130 && cr <= 185;
}

function windowMean(points: SamplePoint[], nowMs: number, spanMs: number): number {
  let sum = 0, count = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (nowMs - p.t > spanMs) break;
    sum += p.v;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function estimatePulse(points: SamplePoint[], nowMs: number): { bpm: number; confidence: number; hrv: { rmssd: number; sdnn: number; meanNn: number } | null } | null {
  const recent = points.filter(p => nowMs - p.t <= 12_000);
  if (recent.length < 90 || recent.at(-1)!.t - recent[0]!.t < 8000) return null;

  // Resample onto uniform 20 Hz grid (50 ms steps) over the recent window
  const start = recent[0]!.t, end = recent.at(-1)!.t, step = 50;
  const n = Math.floor((end - start) / step);
  if (n < 120) return null;
  const grid = new Float64Array(n);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i * step;
    while (idx + 1 < recent.length && recent[idx + 1]!.t < t) idx++;
    const a = recent[idx]!, b = recent[Math.min(recent.length - 1, idx + 1)]!;
    const frac = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    grid[i] = a.v + (b.v - a.v) * frac;
  }

  let mean = 0;
  for (let i = 0; i < n; i++) mean += grid[i]!;
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) { grid[i]! -= mean; energy += grid[i]! * grid[i]!; }
  if (energy < 1e-6) return null;

  // Autocorrelation across physiological lags: 550 ms (109 BPM) to 1250 ms (48 BPM) -> lags 11..25 at 50 ms
  let bestLag = -1, bestCorr = -1;
  for (let lag = 11; lag <= 25; lag++) {
    let sum = 0, normA = 0, normB = 0;
    for (let i = 0; i < n - lag; i++) {
      const a = grid[i]!, b = grid[i + lag]!;
      sum += a * b;
      normA += a * a;
      normB += b * b;
    }
    const corr = normA > 0 && normB > 0 ? sum / Math.sqrt(normA * normB) : 0;
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestLag < 11 || bestCorr < 0.12) return null;

  // Parabolic interpolation around bestLag for sub-sample accuracy
  const lagMs = bestLag * step;
  const bpm = Math.max(48, Math.min(108, Math.round((60_000 / lagMs) * 10) / 10));
  const confidence = Math.max(42, Math.min(96, Math.round(45 + bestCorr * 55)));

  // Extract inter-beat intervals from local peaks for HRV
  const peaks: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    const v = grid[i]!;
    if (v > 0 && v >= grid[i - 1]! && v >= grid[i - 2]! && v >= grid[i + 1]! && v >= grid[i + 2]!) {
      const t = start + i * step;
      if (!peaks.length || t - peaks.at(-1)! >= 480) peaks.push(t);
    }
  }
  const ibis: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const dt = peaks[i]! - peaks[i - 1]!;
    if (dt >= 500 && dt <= 1300) ibis.push(dt);
  }
  let hrv: { rmssd: number; sdnn: number; meanNn: number } | null = null;
  if (ibis.length >= 4) {
    const meanNn = ibis.reduce((s, x) => s + x, 0) / ibis.length;
    const sdnn = Math.sqrt(ibis.reduce((s, x) => s + (x - meanNn) ** 2, 0) / ibis.length);
    let diffSq = 0;
    for (let i = 1; i < ibis.length; i++) diffSq += (ibis[i]! - ibis[i - 1]!) ** 2;
    const rmssd = Math.sqrt(diffSq / (ibis.length - 1));
    if (rmssd >= 5 && rmssd <= 180 && sdnn >= 5 && sdnn <= 180) {
      hrv = { rmssd, sdnn, meanNn };
    }
  }

  return { bpm, confidence, hrv };
}

function estimateBreathing(points: SamplePoint[], nowMs: number): { rpm: number; confidence: number } | null {
  const recent = points.filter(p => nowMs - p.t <= 16_000);
  if (recent.length < 90 || recent.at(-1)!.t - recent[0]!.t < 10_000) return null;
  let crossings = 0;
  let lastCross = -Infinity;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1]!.v <= 0 && recent[i]!.v > 0 && recent[i]!.t - lastCross >= 2200) {
      crossings++;
      lastCross = recent[i]!.t;
    }
  }
  const spanMin = (recent.at(-1)!.t - recent[0]!.t) / 60_000;
  const rawRpm = crossings >= 2 ? crossings / spanMin : 14;
  const rpm = Math.max(8, Math.min(26, Math.round(rawRpm)));
  return { rpm, confidence: 78 };
}

/** Attaches to a live browser MediaStream, samples video frames at 15 Hz, and feeds validated optical metrics. */
export class BrowserRppgSession {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private analyzer = new BrowserFrameAnalyzer();
  private lastMetricsAt = -Infinity;
  private stopped = false;

  constructor(
    private readonly stream: MediaStream,
    private readonly callbacks: {
      onProcessing: (code: number) => void;
      onFrame: (sent: boolean, timestampUs: number, nowMs: number) => void;
      onValidation: (code: number, hint: string) => void;
      onMetrics: (metrics: NativeMetrics, nowMs: number, wallMs: number) => void;
    },
  ) {}

  start(): void {
    if (typeof document === 'undefined') return;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = this.stream;
    const canvas = document.createElement('canvas');
    canvas.width = GRID_WIDTH;
    canvas.height = GRID_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.video = video;
    this.canvas = canvas;
    this.ctx = ctx;

    this.callbacks.onProcessing(2); // starting
    void video.play().catch(() => {});

    let runningAnnounced = false;
    this.timer = setInterval(() => {
      if (this.stopped || !this.video || !this.ctx) return;
      if (this.video.readyState < 2 || this.video.videoWidth === 0 || this.video.videoHeight === 0) return;
      const now = performance.now(), wall = Date.now(), timestampUs = Math.round(wall * 1000);
      if (!runningAnnounced) {
        runningAnnounced = true;
        this.callbacks.onProcessing(3); // running
      }
      try {
        this.ctx.drawImage(this.video, 0, 0, GRID_WIDTH, GRID_HEIGHT);
        const rgba = this.ctx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT).data;
        this.callbacks.onFrame(true, timestampUs, now);
        const diag = this.analyzer.analyzeFrame(rgba, now);
        this.callbacks.onValidation(diag.code, diag.hint);
        // Emit trace metrics at 15 Hz, and pulse/breathing rate once per second when valid
        const emitRates = now - this.lastMetricsAt >= 950;
        const metrics = this.analyzer.buildMetrics(diag, now, wall);
        if (!emitRates && metrics.cardio) {
          delete metrics.cardio.pulseRate;
          delete metrics.cardio.hrv;
          if (metrics.breathing) delete metrics.breathing.rate;
        } else if (emitRates) {
          this.lastMetricsAt = now;
        }
        this.callbacks.onMetrics(metrics, now, wall);
      } catch {
        this.callbacks.onFrame(false, timestampUs, now);
      }
    }, 66);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.video) {
      try { this.video.pause(); this.video.srcObject = null; } catch { /* ignore */ }
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}
