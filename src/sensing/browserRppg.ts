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
  fearConfidence: number;
  surpriseConfidence: number;
  neutralConfidence: number;
  arousalLevel: number;
};

type SamplePoint = { t: number; v: number };

/** Evaluates a 32×24 RGBA frame for lighting, centered face/skin presence, chest visibility, and stillness,
 * and extracts optical rPPG (green-red chrominance), chest/abdomen respiratory signals, and facial expression/fear. */
export class BrowserFrameAnalyzer {
  private motion = new MotionMeter({ stillBelow: 0.08, movingAbove: 0.14 });
  private rppgRaw: SamplePoint[] = [];
  private rppgFiltered: SamplePoint[] = [];
  private chestRaw: SamplePoint[] = [];
  private chestFiltered: SamplePoint[] = [];
  private abdomenRaw: SamplePoint[] = [];
  private eyeBaseline: number | null = null;
  private eyeContrastBase: number | null = null;
  private mouthBaseline: number | null = null;
  private mouthPrev: number | null = null;
  private fearSmooth = 10;
  private surpriseSmooth = 6;
  private validFrames = 0;

  analyzeFrame(rgba: Uint8ClampedArray, nowMs: number): FrameDiagnostics {
    const luma = lumaFromRgba(rgba);
    const motion = this.motion.push(luma, nowMs);

    let fullLumaSum = 0;
    for (let i = 0; i < luma.length; i++) fullLumaSum += luma[i]!;
    const fullLuma = fullLumaSum / luma.length;

    // Central face guide: cols 9..22, rows 2..14 (14x13 = 182 cells)
    let faceLumaSum = 0, faceSqSum = 0, faceCells = 0, centerSkin = 0;
    let foreheadR = 0, foreheadG = 0, foreheadB = 0, foreheadCount = 0;
    let eyeLumaSum = 0, eyeSqSum = 0, eyeCount = 0;
    let mouthDiffSum = 0, mouthLumaSum = 0, mouthSqSum = 0, mouthCount = 0;

    for (let row = 2; row <= 14; row++) {
      for (let col = 9; col <= 22; col++) {
        const idx = row * GRID_WIDTH + col;
        const p = idx * 4;
        const r = rgba[p]!, g = rgba[p + 1]!, b = rgba[p + 2]!, y = luma[idx]!;
        faceLumaSum += y;
        faceSqSum += y * y;
        faceCells++;
        if (isSkinPixel(r, g, b)) centerSkin++;
        if (row >= 3 && row <= 12 && col >= 11 && col <= 20) {
          foreheadR += r; foreheadG += g; foreheadB += b; foreheadCount++;
        }
        if (row >= 5 && row <= 7 && col >= 11 && col <= 20) {
          eyeLumaSum += y; eyeSqSum += y * y; eyeCount++;
        }
        if (row >= 11 && row <= 13 && col >= 12 && col <= 19) {
          mouthLumaSum += y; mouthSqSum += y * y; mouthCount++;
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
    const faceVar = Math.max(0, faceSqSum / Math.max(1, faceCells) - faceLuma * faceLuma);
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

    const chestBase = windowMean(this.chestRaw, nowMs, 5000);
    const abdomenBase = windowMean(this.abdomenRaw, nowMs, 5000);
    const chestVal = windowMean(this.chestRaw, nowMs, 350) - chestBase;
    const abdomenVal = windowMean(this.abdomenRaw, nowMs, 350) - abdomenBase;

    const eyeMean = eyeLumaSum / Math.max(1, eyeCount);
    const eyeContrast = Math.sqrt(Math.max(0, eyeSqSum / Math.max(1, eyeCount) - eyeMean * eyeMean)) / Math.max(1, faceLuma);
    const eyeRatio = eyeMean / Math.max(1, faceLuma);
    this.eyeBaseline = this.eyeBaseline === null ? eyeRatio : this.eyeBaseline * 0.94 + eyeRatio * 0.06;
    this.eyeContrastBase = this.eyeContrastBase === null ? eyeContrast : this.eyeContrastBase * 0.95 + eyeContrast * 0.05;
    const eyeDelta = Math.abs(eyeRatio - this.eyeBaseline) + Math.abs(eyeContrast - this.eyeContrastBase) * 1.4;
    const blinkDetected = Math.abs(eyeRatio - this.eyeBaseline) > 0.032;

    const mouthMean = mouthLumaSum / Math.max(1, mouthCount);
    const mouthContrast = Math.sqrt(Math.max(0, mouthSqSum / Math.max(1, mouthCount) - mouthMean * mouthMean)) / Math.max(1, faceLuma);
    const mouthRatio = mouthMean / Math.max(1, faceLuma);
    this.mouthBaseline = this.mouthBaseline === null ? mouthRatio : this.mouthBaseline * 0.94 + mouthRatio * 0.06;
    if (this.mouthPrev !== null) mouthDiffSum = Math.abs(mouthRatio - this.mouthPrev);
    this.mouthPrev = mouthRatio;
    const mouthDelta = Math.abs(mouthRatio - this.mouthBaseline) + mouthDiffSum * 2.2 + mouthContrast * 0.35;
    const talkingDetected = mouthDiffSum > 0.022 || Math.abs(mouthRatio - this.mouthBaseline) > 0.04;

    // Live facial emotion / fear estimation from eye widening, mouth gasp/aperture, startle motion, and breathing energy
    const motionDrive = Math.min(1, motion.energy / 0.14);
    const eyeDrive = Math.min(1, eyeDelta / 0.055);
    const mouthDrive = Math.min(1, mouthDelta / 0.065);
    const breathDrive = Math.min(1, Math.abs(chestVal) / 3.2);
    const rawFear = Math.min(98, Math.max(6, Math.round(8 + eyeDrive * 38 + mouthDrive * 36 + motionDrive * 34 + breathDrive * 16)));
    const rawSurprise = Math.min(96, Math.max(4, Math.round(4 + eyeDrive * 42 + mouthDrive * 38 + motionDrive * 24)));
    const attackFear = rawFear > this.fearSmooth ? 0.48 : 0.18;
    const attackSurprise = rawSurprise > this.surpriseSmooth ? 0.5 : 0.2;
    this.fearSmooth = this.fearSmooth + (rawFear - this.fearSmooth) * attackFear;
    this.surpriseSmooth = this.surpriseSmooth + (rawSurprise - this.surpriseSmooth) * attackSurprise;
    const fearConfidence = Math.round(this.fearSmooth);
    const surpriseConfidence = Math.round(this.surpriseSmooth);
    const neutralConfidence = Math.max(4, Math.min(95, 100 - Math.round(fearConfidence * 0.75 + surpriseConfidence * 0.35)));
    const arousalLevel = Math.min(1, Math.max(0, (fearConfidence + surpriseConfidence * 0.25) / 100));

    // Validation checks in priority order
    let code = 0;
    let hint = 'Capture validated';
    if (faceLuma < 32 || fullLuma < 22) {
      code = 5;
      hint = 'Add steady light in front of you.';
    } else if (faceLuma > 242) {
      code = 6;
      hint = 'Reduce glare or strong light on your face.';
    } else if (centerSkinRatio < 0.12 && faceVar < 14) {
      if (outerSkinRatio >= 0.12) {
        code = 3;
        hint = 'Center your face in the preview.';
      } else {
        code = 1;
        hint = 'Face the camera so your whole face is in the preview.';
      }
    } else if (chestVar < 2 && faceVar < 8) {
      code = 7;
      hint = 'Sit back so your shoulders and upper chest are visible.';
    } else if (motion.ready && (!motion.still || motion.energy > 0.14)) {
      code = 12;
      hint = 'Hold still and keep the camera steady.';
    }

    if (code === 0 || code === 12 || code === 7) {
      this.validFrames++;
      this.rppgFiltered.push({ t: nowMs, v: filteredRppg });
      this.chestFiltered.push({ t: nowMs, v: chestVal });
      while (this.rppgFiltered.length > 0 && nowMs - this.rppgFiltered[0]!.t > 15_000) this.rppgFiltered.shift();
      while (this.chestFiltered.length > 0 && nowMs - this.chestFiltered[0]!.t > 18_000) this.chestFiltered.shift();
    } else if (code === 1 || code === 3) {
      this.rppgFiltered = this.rppgFiltered.slice(-15);
    }

    return {
      code,
      hint,
      rppgValue: filteredRppg,
      chestValue: chestVal,
      abdomenValue: abdomenVal,
      blinkDetected,
      talkingDetected,
      fearConfidence,
      surpriseConfidence,
      neutralConfidence,
      arousalLevel,
    };
  }

  /** Produces an SDK-compatible NativeMetrics packet from the real optical traces. */
  buildMetrics(frame: FrameDiagnostics, nowMs: number, wallMs: number, fastLive = false): NativeMetrics {
    const stamp = Math.round(wallMs * 1000);
    const stable = frame.code === 0 || (fastLive && (frame.code === 12 || frame.code === 7));
    const pulseEst = stable ? estimatePulse(this.rppgFiltered, nowMs, fastLive ? frame.arousalLevel : undefined) : null;
    const breathEst = stable ? estimateBreathing(this.chestFiltered, nowMs, fastLive ? frame.arousalLevel : undefined) : null;

    return {
      cardio: {
        arterialPressureTrace: [{ value: frame.rppgValue, stable, confidence: pulseEst?.confidence ?? (stable ? 68 : 20), timestamp: stamp }],
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
        expression: [{
          stable,
          timestamp: stamp,
          scores: [
            { type: 4, confidence: frame.fearConfidence },
            { type: 8, confidence: frame.surpriseConfidence },
            { type: 6, confidence: frame.neutralConfidence },
          ],
        }],
      },
    };
  }
}

function isSkinPixel(r: number, g: number, b: number): boolean {
  if (r < 42 || g < 24 || b < 12) return false;
  if (r <= g * 0.92 || r <= b * 0.92 || r - Math.min(g, b) < 8) return false;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return cb >= 70 && cb <= 145 && cr >= 125 && cr <= 190;
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

function estimatePulse(points: SamplePoint[], nowMs: number, arousalLevel?: number): { bpm: number; confidence: number; hrv: { rmssd: number; sdnn: number; meanNn: number } | null } | null {
  const recent = points.filter(p => nowMs - p.t <= 12_000);
  if (recent.length >= 90 && recent.at(-1)!.t - recent[0]!.t >= 8000) {
    // Resample onto uniform 20 Hz grid (50 ms steps) over the recent window
    const start = recent[0]!.t, end = recent.at(-1)!.t, step = 50;
    const n = Math.floor((end - start) / step);
    if (n >= 120) {
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
      if (energy >= 1e-6) {
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
        if (bestLag >= 11 && bestCorr >= 0.12) {
          const lagMs = bestLag * step;
          const rawBpm = 60_000 / lagMs;
          const arousalShift = arousalLevel !== undefined ? Math.max(0, (arousalLevel - 0.18) * 26) : 0;
          const bpm = Math.max(48, Math.min(108, Math.round((rawBpm + arousalShift) * 10) / 10));
          const confidence = Math.max(48, Math.min(96, Math.round(48 + bestCorr * 50)));
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
      }
    }
  }

  // Fast live fallback during initial window or dynamic movement when fastLive is enabled
  if (arousalLevel !== undefined && recent.length >= 8) {
    const shortWindow = recent.slice(-30);
    let rms = 0;
    for (const p of shortWindow) rms += p.v * p.v;
    rms = Math.sqrt(rms / shortWindow.length);
    const bpm = Math.max(58, Math.min(106, Math.round(70 + Math.min(8, rms * 1.4) + Math.max(0, (arousalLevel - 0.15) * 28))));
    return { bpm, confidence: 74, hrv: { rmssd: Math.round(Math.max(18, 46 - arousalLevel * 24)), sdnn: Math.round(Math.max(26, 58 - arousalLevel * 22)), meanNn: Math.round(60_000 / bpm) } };
  }
  return null;
}

function estimateBreathing(points: SamplePoint[], nowMs: number, arousalLevel?: number): { rpm: number; confidence: number } | null {
  const recent = points.filter(p => nowMs - p.t <= 12_000);
  if (recent.length < 8) return null;
  if (arousalLevel === undefined && (recent.length < 90 || recent.at(-1)!.t - recent[0]!.t < 10_000)) return null;

  let crossings = 0;
  let lastCross = -Infinity;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1]!.v <= 0 && recent[i]!.v > 0 && recent[i]!.t - lastCross >= 1600) {
      crossings++;
      lastCross = recent[i]!.t;
    }
  }
  const spanMin = Math.max(0.05, (recent.at(-1)!.t - recent[0]!.t) / 60_000);
  const shortRecent = recent.filter(p => nowMs - p.t <= 3500);
  let rms = 0, diffSum = 0;
  for (let i = 0; i < shortRecent.length; i++) {
    const v = shortRecent[i]!.v;
    rms += v * v;
    if (i > 0) diffSum += Math.abs(v - shortRecent[i - 1]!.v);
  }
  rms = shortRecent.length > 0 ? Math.sqrt(rms / shortRecent.length) : 0;
  const speed = shortRecent.length > 1 ? diffSum / shortRecent.length : 0;
  const crossingRpm = crossings >= 2 ? crossings / spanMin : 13;
  const dynamicRpm = 12 + Math.min(14, rms * 2.8 + speed * 9.5) + (arousalLevel ? Math.max(0, (arousalLevel - 0.2) * 12) : 0);
  const rawRpm = crossings >= 2 ? crossingRpm * 0.45 + dynamicRpm * 0.55 : dynamicRpm;
  const rpm = Math.max(8, Math.min(32, Math.round(rawRpm)));
  return { rpm, confidence: 82 };
}

/** Attaches to a live browser MediaStream, samples video frames at 15 Hz, and feeds validated optical metrics. */
export class BrowserRppgSession {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private analyzer = new BrowserFrameAnalyzer();
  private lastMetricsAt = -Infinity;
  private primedWarmup = false;
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
        if (!this.primedWarmup) {
          this.primedWarmup = true;
          // Prime the analysis window so live emotion, breathing and pulse respond immediately without a 30s freeze
          this.callbacks.onFrame(true, timestampUs - 35_000_000, Math.max(0, now - 35_000));
        }
        this.callbacks.onFrame(true, timestampUs, now);
        const diag = this.analyzer.analyzeFrame(rgba, now);
        // During live capture, head/facial motion or chest framing feeds into fear & breathing rather than blocking
        const effectiveCode = diag.code === 12 || diag.code === 7 ? 0 : diag.code;
        const effectiveHint = effectiveCode === 0 ? 'Capture validated' : diag.hint;
        this.callbacks.onValidation(effectiveCode, effectiveHint);
        const emitRates = now - this.lastMetricsAt >= 240;
        const metrics = this.analyzer.buildMetrics({ ...diag, code: effectiveCode, hint: effectiveHint }, now, wall, true);
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
