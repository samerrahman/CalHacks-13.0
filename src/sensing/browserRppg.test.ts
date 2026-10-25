import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_HEIGHT, GRID_WIDTH } from './motion';
import { BrowserFrameAnalyzer } from './browserRppg';

const PIXELS = GRID_WIDTH * GRID_HEIGHT;

function makeFrame(opts: {
  bgLuma?: number;
  faceCols?: [number, number];
  faceRows?: [number, number];
  skinRgb?: [number, number, number];
  chestPattern?: boolean;
  shiftX?: number;
} = {}): Uint8ClampedArray {
  const {
    bgLuma = 60,
    faceCols = [10, 21],
    faceRows = [3, 13],
    skinRgb = [195, 138, 112],
    chestPattern = true,
    shiftX = 0,
  } = opts;
  const rgba = new Uint8ClampedArray(PIXELS * 4);
  for (let row = 0; row < GRID_HEIGHT; row++) {
    for (let col = 0; col < GRID_WIDTH; col++) {
      const idx = (row * GRID_WIDTH + col) * 4;
      const inFace = col >= faceCols[0] + shiftX && col <= faceCols[1] + shiftX && row >= faceRows[0] && row <= faceRows[1];
      const inChest = chestPattern && row >= 15 && row <= 22 && col >= 8 && col <= 23;
      if (inFace) {
        rgba[idx] = skinRgb[0];
        rgba[idx + 1] = skinRgb[1];
        rgba[idx + 2] = skinRgb[2];
        rgba[idx + 3] = 255;
      } else if (inChest) {
        const v = bgLuma + ((row + col) % 2 === 0 ? 18 : -12);
        rgba[idx] = v; rgba[idx + 1] = v; rgba[idx + 2] = v; rgba[idx + 3] = 255;
      } else {
        rgba[idx] = bgLuma; rgba[idx + 1] = bgLuma; rgba[idx + 2] = bgLuma; rgba[idx + 3] = 255;
      }
    }
  }
  return rgba;
}

test('BrowserFrameAnalyzer validates lighting, face presence, framing, chest visibility, and motion', () => {
  const analyzer = new BrowserFrameAnalyzer();

  // 1. Too dark (code 5)
  const dark = makeFrame({ bgLuma: 10, skinRgb: [25, 18, 14] });
  assert.equal(analyzer.analyzeFrame(dark, 0).code, 5);

  // 2. Too bright / overexposed (code 6)
  const bright = makeFrame({ bgLuma: 250, skinRgb: [252, 248, 245] });
  assert.equal(analyzer.analyzeFrame(bright, 100).code, 6);

  // 3. No face in frame (code 1)
  const noFace = makeFrame({ faceCols: [99, 98] });
  assert.equal(analyzer.analyzeFrame(noFace, 200).code, 1);

  // 4. Face off-center at edge (code 3)
  const offCenter = makeFrame({ faceCols: [0, 7], faceRows: [2, 13] });
  assert.equal(analyzer.analyzeFrame(offCenter, 300).code, 3);

  // 5. Well-lit centered face + chest, holding still -> code 0
  const steadyAnalyzer = new BrowserFrameAnalyzer();
  steadyAnalyzer.analyzeFrame(makeFrame(), 0);
  const steady = steadyAnalyzer.analyzeFrame(makeFrame(), 100);
  assert.equal(steady.code, 0);

  // 6. Excessive motion -> code 12
  for (let i = 1; i <= 6; i++) {
    steadyAnalyzer.analyzeFrame(makeFrame({ shiftX: i % 2 === 0 ? 5 : -5 }), 100 + i * 66);
  }
  const moving = steadyAnalyzer.analyzeFrame(makeFrame({ shiftX: 6 }), 600);
  assert.equal(moving.code, 12);
});

test('BrowserFrameAnalyzer extracts pulse BPM only after sufficient steady periodic rPPG frames', () => {
  const analyzer = new BrowserFrameAnalyzer();
  // Simulate 72 BPM (1.2 Hz) green-channel cardiac oscillation over 13 seconds at 15 Hz
  let lastMetrics = null;
  for (let t = 0; t <= 13_000; t += 66) {
    const beat = Math.sin(2 * Math.PI * 1.2 * (t / 1000));
    const g = Math.round(138 + beat * 4);
    const frame = makeFrame({ skinRgb: [195, g, 112] });
    const diag = analyzer.analyzeFrame(frame, t);
    assert.equal(diag.code, 0);
    lastMetrics = analyzer.buildMetrics(diag, t, 1_700_000_000_000 + t);
  }
  const pulse = lastMetrics?.cardio?.pulseRate?.[0];
  assert.ok(pulse, 'pulse estimate produced after 12s window');
  assert.ok(pulse!.value! >= 68 && pulse!.value! <= 76, `expected ~72 BPM, got ${pulse!.value}`);
  assert.equal(pulse!.stable, true);
  assert.ok(pulse!.confidence! >= 42);
});
