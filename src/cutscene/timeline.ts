/** Opening cutscene timing. Shared by the offline renderer (tools/cutscene.mjs) and the
 * game's caption overlay, so captions, sound and picture always agree. Times are seconds.
 * The monster is never shown: only a clawed hand gripping the tube's doorframe, and at the
 * end a shadow far off in the fog. The door is shut before it gets close. */
export const CUTSCENE = { fps: 30, renderFps: 60, duration: 34.6, width: 1920, height: 1080, video: 'assets/video/opening.mp4' } as const;

/** Story beats; scene.ts keys all animation off these. */
export const BEATS = {
  flicker: 2.4, alarm: 3.4, thud1: 4.4, thud2: 5.6, thud3: 6.5, open: 7.0, grab: 7.8, turn: 8.4, flashlight: 9.4,
  steam0: 9.9, steam1: 11.2, barge: 12.7, forest: 13.2, arrive: 21.0, doorOpen: 21.4, enter: 22.4, lookBack: 23.2,
  shadow: 23.5, rush: 23.9, haul: 24.2, slam: 25.2, crash: 27.4, scrape: 28.6, lightDies: 29.4, black: 29.8, end: 34.6,
} as const;
const B = BEATS;

/** Running cadence. Camera footfalls and the footstep sound share this grid (t = k / rate). */
export const STEP_RATE = 2.7;

export type Shot = { id: string; start: number; end: number; summary: string };
export const SHOTS: Shot[] = [
  { id: 'lab', start: 0, end: B.turn, summary: 'A sealed steel tube. Thuds, a bulge; the hatch bursts open, steam, a claw grips the frame.' },
  { id: 'corridor', start: B.turn, end: B.forest, summary: 'Turn away before it emerges, sprint the red corridor, barge the exit.' },
  { id: 'forest', start: B.forest, end: B.arrive, summary: 'A short flashlight sprint through fog and pines, two turns. Never look back.' },
  { id: 'shelter', start: B.arrive, end: B.slam, summary: 'Pull the shed door open onto black, step in, turn: a shadow far off in the fog, coming fast. Haul it shut.' },
  { id: 'impact', start: B.slam, end: B.black, summary: 'Heartbeat in the dark. Then it hits the door; a huge dent. The light dies.' },
  { id: 'title', start: B.black, end: B.end, summary: 'Black, with the first instruction.' },
];

export type Caption = { start: number; end: number; text: string };
export const CAPTIONS: Caption[] = [
  { start: 3.5, end: 6.4, text: 'Containment failure. Proceed to the emergency observation shelter.' },
  { start: B.open, end: B.turn, text: '[the hatch bursts open — something grips the frame]' },
  { start: 13.6, end: 18.0, text: '[running through wet branches — something follows]' },
  { start: B.slam, end: B.crash - 0.1, text: '[the door slams shut — a heartbeat in the dark]' },
  { start: B.crash, end: B.crash + 2.3, text: '[something slams into the door]' },
  { start: B.black + 0.5, end: B.end, text: 'Silence the faults. Test the emitters. Lead it back into containment.' },
];

/** Optional WAV cues from public/assets/audio. The film's soundtrack is fully synthesised
 * (SYNTH below), so this is empty; the renderer still supports it. */
export type SoundCue = { at: number; file: string; gain: number; until?: number; fadeOut?: number; loop?: number; rate?: number };
export const SOUND_CUES: SoundCue[] = [];

type Env = [number, number][];
/** Generated sound, synthesised by the renderer with ffmpeg (deterministic). Envelopes are
 * piecewise-linear [[time, value], …]; a layer is silent outside its gain envelope. Events
 * (`at`, `dur`) are one-shots. `modes` are a resonating body's frequencies (Hz). */
export type SynthLayer =
  | { kind: 'steps'; surface: 'hard' | 'soft'; gain: Env }
  | { kind: 'gallop'; gain: Env }
  | { kind: 'breath'; rate: number; gain: Env }
  | { kind: 'heartbeat'; rate: Env; gain: Env }
  | { kind: 'drone' | 'rain' | 'rain_muffled' | 'wind' | 'riser' | 'hum' | 'alarm' | 'buzz'; gain: Env }
  | { kind: 'hit'; at: number; level: number; ring: number[]; decay: number; crack: number }
  | { kind: 'creak'; at: number; dur: number; rate: [number, number]; modes: number[]; level: number }
  | { kind: 'scrape'; at: number; dur: number; chatter: number; modes: number[]; level: number }
  | { kind: 'growl'; at: number; dur: number; pitch: number; level: number }
  | { kind: 'crunch' | 'hiss'; at: number; dur: number; level: number }
  | { kind: 'click'; at: number; level: number };

export const SYNTH: SynthLayer[] = [
  // Lab: mains hum, the lights buzz as they stutter, then a low industrial horn.
  // Typing at the console; later, colleagues' feet as they run past.
  { kind: 'click', at: 0.45, level: 0.1 },
  { kind: 'click', at: 0.6, level: 0.1 },
  { kind: 'click', at: 0.83, level: 0.1 },
  { kind: 'click', at: 0.97, level: 0.1 },
  { kind: 'click', at: 1.21, level: 0.1 },
  { kind: 'click', at: 1.34, level: 0.1 },
  { kind: 'click', at: 1.52, level: 0.1 },
  { kind: 'click', at: 1.78, level: 0.1 },
  { kind: 'steps', surface: 'hard', gain: [[3.65, 0], [3.8, 0.28], [4.7, 0.3], [5.6, 0.18], [6.2, 0]] },
  { kind: 'hum', gain: [[0, 0.16], [6.9, 0.16], [7.3, 0.08], [8.6, 0.05], [9.4, 0]] },
  { kind: 'buzz', gain: [[B.flicker - 0.05, 0], [B.flicker, 0.12], [B.alarm - 0.1, 0.12], [B.alarm, 0]] },
  { kind: 'alarm', gain: [[B.alarm - 0.1, 0], [B.alarm + 0.2, 0.32], [B.barge - 0.1, 0.34], [B.forest, 0.08], [15, 0]] },
  // Something inside the tube: three impacts, the metal groaning, a seam hissing.
  { kind: 'hit', at: B.thud1, level: 0.45, ring: [180, 290, 430], decay: 7, crack: 0.15 },
  { kind: 'hit', at: B.thud2, level: 0.7, ring: [170, 275, 420], decay: 6, crack: 0.25 },
  { kind: 'creak', at: B.thud2 + 0.1, dur: 0.7, rate: [18, 30], modes: [310, 720, 1350], level: 0.5 },
  { kind: 'hiss', at: B.thud2 + 0.15, dur: 1.1, level: 0.12 },
  { kind: 'hit', at: B.thud3, level: 0.85, ring: [160, 262, 405], decay: 5, crack: 0.35 },
  { kind: 'creak', at: B.thud3 + 0.05, dur: 0.4, rate: [25, 40], modes: [340, 800, 1500], level: 0.45 },
  // The hatch bursts: impact, the hinge tearing, a blast of steam; claws on the frame; a growl.
  { kind: 'hit', at: B.open, level: 1, ring: [140, 233, 377], decay: 4, crack: 0.6 },
  { kind: 'creak', at: B.open, dur: 0.45, rate: [90, 55], modes: [700, 1650, 2900], level: 0.5 },
  { kind: 'hiss', at: B.open, dur: 2.8, level: 0.42 },
  { kind: 'scrape', at: B.grab, dur: 0.5, chatter: 30, modes: [1900, 3100], level: 0.5 },
  { kind: 'growl', at: B.grab + 0.15, dur: 1.6, pitch: 50, level: 0.9 },
  // Escape.
  { kind: 'click', at: B.flashlight, level: 0.35 },
  { kind: 'hiss', at: B.steam0, dur: 1.3, level: 0.28 },
  { kind: 'hiss', at: B.steam1, dur: 1.3, level: 0.28 },
  { kind: 'hit', at: B.barge, level: 0.7, ring: [260, 410, 590], decay: 9, crack: 0.4 },
  { kind: 'creak', at: B.barge + 0.02, dur: 0.3, rate: [40, 25], modes: [420, 980, 1900], level: 0.35 },
  { kind: 'steps', surface: 'hard', gain: [[8.5, 0], [8.7, 0.5], [B.barge - 0.1, 0.5], [B.barge + 0.1, 0]] },
  { kind: 'steps', surface: 'soft', gain: [[B.forest - 0.2, 0], [B.forest, 0.48], [B.arrive - 0.4, 0.48], [B.arrive, 0], [B.enter, 0], [B.enter + 0.1, 0.25], [B.enter + 0.5, 0.2], [B.enter + 0.7, 0]] },
  { kind: 'breath', rate: 1.05, gain: [[8.5, 0], [9.5, 0.2], [B.arrive - 0.2, 0.38], [B.slam, 0.5], [B.slam + 0.4, 0.15], [B.crash, 0.1], [B.crash + 0.8, 0.5], [B.black, 0.3], [B.black + 1.3, 0]] },
  // The heartbeat climbs through the escape and owns the silence after the slam.
  {
    kind: 'heartbeat',
    rate: [[0, 1.1], [B.open, 1.3], [B.flashlight, 1.7], [B.forest, 1.9], [B.arrive, 2.0], [B.lookBack, 2.1], [B.rush, 2.35], [B.slam, 2.4], [B.crash + 2, 2.2], [B.end, 1.5]],
    gain: [[B.alarm, 0], [B.open, 0.2], [B.flashlight, 0.3], [B.forest, 0.35], [B.arrive, 0.4], [B.lookBack, 0.6], [B.slam, 0.75], [B.slam + 0.2, 1], [B.crash - 0.05, 1], [B.crash, 0.6], [B.black, 0.9], [B.end - 1, 0.6], [B.end, 0]],
  },
  { kind: 'drone', gain: [[0, 0.03], [B.alarm, 0.1], [B.open, 0.3], [B.forest, 0.16], [B.arrive - 0.4, 0.26], [B.rush, 0.42], [B.slam - 0.05, 0.62], [B.slam + 0.05, 0], [B.crash - 0.05, 0], [B.crash + 0.05, 0.7], [B.black, 0.32], [B.end, 0]] },
  { kind: 'rain', gain: [[B.barge + 0.1, 0], [B.forest, 0.1], [B.slam - 0.1, 0.12], [B.slam + 0.05, 0]] },
  { kind: 'rain_muffled', gain: [[B.slam, 0], [B.slam + 0.1, 0.05], [B.black, 0.05], [B.black + 0.9, 0]] },
  { kind: 'wind', gain: [[B.barge + 0.1, 0], [B.forest + 0.1, 0.16], [B.slam - 0.1, 0.2], [B.slam + 0.05, 0]] },
  // The shed: latch, a rusty door; a distant growl, the rush, the haul, the slam.
  { kind: 'click', at: B.doorOpen - 0.1, level: 0.3 },
  { kind: 'creak', at: B.doorOpen, dur: 0.9, rate: [22, 14], modes: [260, 610, 1180], level: 0.55 },
  { kind: 'growl', at: B.shadow + 0.1, dur: 1.2, pitch: 44, level: 0.35 },
  { kind: 'riser', gain: [[B.rush - 0.2, 0], [B.slam - 0.05, 0.5], [B.slam + 0.05, 0]] },
  { kind: 'gallop', gain: [[B.rush, 0], [B.rush + 0.4, 0.2], [B.slam - 0.05, 0.6], [B.slam + 0.02, 0]] },
  { kind: 'creak', at: B.haul, dur: B.slam - B.haul, rate: [30, 18], modes: [230, 540, 1050], level: 0.6 },
  { kind: 'hit', at: B.slam, level: 1.15, ring: [112, 187, 311, 467], decay: 6, crack: 0.7 },
  // Something just outside, breathing low through the door. Then the impact.
  { kind: 'growl', at: B.crash - 1.2, dur: 1.1, pitch: 40, level: 0.3 },
  { kind: 'hit', at: B.crash, level: 1.5, ring: [93, 157, 251, 389, 571], decay: 5, crack: 1.1 },
  { kind: 'crunch', at: B.crash + 0.01, dur: 0.7, level: 0.8 },
  { kind: 'scrape', at: B.scrape, dur: 1.3, chatter: 18, modes: [1200, 2100], level: 0.45 },
  { kind: 'buzz', gain: [[B.lightDies - 0.05, 0], [B.lightDies, 0.18], [B.black - 0.02, 0.18], [B.black, 0]] },
  { kind: 'click', at: B.black, level: 0.3 },
];

export function captionAt(time: number): Caption | null {
  return CAPTIONS.find(c => time >= c.start && time < c.end) ?? null;
}
