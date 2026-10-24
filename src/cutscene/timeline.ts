/** Opening cutscene timing. Shared by the offline renderer (tools/cutscene.mjs) and the
 * game's caption overlay, so captions, sound and picture always agree. Times are seconds.
 * The monster is never shown: only a clawed hand gripping the tube's doorframe, and at the
 * end a shadow far off in the fog. The door is shut before it gets close. */
export const CUTSCENE = { fps: 30, renderFps: 60, duration: 36.5, width: 1920, height: 1080, video: 'assets/video/opening.mp4' } as const;

/** Story beats; scene.ts keys all animation off these. */
export const BEATS = {
  flicker: 2.6, alarm: 3.6, thud1: 5.6, thud2: 6.6, thud3: 7.4, open: 7.9, grab: 8.7, snatch: 9.3, turn: 10.3,
  flashlight: 11.3, steam0: 11.8, steam1: 13.1, barge: 14.6, forest: 15.1, arrive: 22.9, doorOpen: 23.3, enter: 24.3,
  lookBack: 25.1, shadow: 25.4, rush: 25.8, haul: 26.1, slam: 27.1, crash: 29.3, scrape: 30.5, lightDies: 31.3, black: 31.7, end: 36.5,
} as const;
const B = BEATS;

/** Running cadence. Camera footfalls and the footstep sound share this grid (t = k / rate). */
export const STEP_RATE = 2.7;

export type Shot = { id: string; start: number; end: number; summary: string };
export const SHOTS: Shot[] = [
  { id: 'lab', start: 0, end: B.turn, summary: 'At the console: vitals, then CONTAINMENT BREACH. Thuds, a bulge; the hatch bursts, a claw grips the frame, then seizes your colleague and drags them in.' },
  { id: 'corridor', start: B.turn, end: B.forest, summary: 'Turn away before it emerges, sprint the red corridor, barge the exit.' },
  { id: 'forest', start: B.forest, end: B.arrive, summary: 'A short flashlight sprint through fog and pines, two turns. Never look back.' },
  { id: 'shelter', start: B.arrive, end: B.slam, summary: 'Pull the shed door open onto black, step in, turn: a shadow far off in the fog, coming fast. Haul it shut.' },
  { id: 'impact', start: B.slam, end: B.black, summary: 'Heartbeat in the dark. Then it hits the door; a huge dent. The light dies.' },
  { id: 'title', start: B.black, end: B.end, summary: 'Black, with the first instruction.' },
];

export type Caption = { start: number; end: number; text: string };
export const CAPTIONS: Caption[] = [
  { start: B.alarm + 0.1, end: B.thud2 - 0.2, text: 'Containment failure. Proceed to the emergency observation shelter.' },
  { start: B.open, end: B.snatch, text: '[the hatch bursts open — something grips the frame]' },
  { start: B.snatch, end: B.turn + 0.4, text: '[it seizes your colleague and drags them inside]' },
  { start: B.forest + 0.4, end: B.forest + 4.8, text: '[running through wet branches — something follows]' },
  { start: B.slam, end: B.crash - 0.1, text: '[the door slams shut — a heartbeat in the dark]' },
  { start: B.crash, end: B.crash + 2.3, text: '[something slams into the door]' },
  { start: B.black + 0.5, end: B.end, text: 'Silence the faults. Test the emitters. Lead it back into containment.' },
];

/** Recorded cues from cutscene/audio (render inputs only; credits in cutscene/audio/SOURCES.md).
 * Everything else is synthesised (SYNTH below). `from` skips into the file, `rate` speeds it up
 * (and raises the pitch), `until` ends it. */
export type SoundCue = { at: number; file: string; gain: number; from?: number; until?: number; fadeIn?: number; fadeOut?: number; loop?: number; rate?: number };
export const SOUND_CUES: SoundCue[] = [
  // (No breathing for now: it is being redone.)
  // Real metal: the tube groaning, the hatch tearing open, the arm dragging back over the frame.
  { at: B.thud2 + 0.1, file: 'metal_grind.opus', from: 0.5, rate: 0.55, gain: 0.35, until: B.thud2 + 0.9, fadeOut: 0.3 },
  { at: B.open, file: 'metal_grind.opus', from: 10.5, rate: 0.7, gain: 0.6, until: B.open + 0.6, fadeOut: 0.25 },
  { at: B.snatch + 0.4, file: 'metal_grind.opus', from: 6, gain: 0.4, until: B.snatch + 0.75, fadeOut: 0.15 },
  // Doors: the exit barged open; the shed door hauled open on a rusty hinge, then dragged shut.
  { at: B.barge, file: 'door_creak.opus', from: 1, rate: 0.75, gain: 0.5, until: B.barge + 0.6, fadeOut: 0.2 },
  { at: B.doorOpen - 0.1, file: 'door_creak.opus', rate: 0.62, gain: 0.9, until: B.doorOpen + 1.4, fadeOut: 0.5 },
  { at: B.doorOpen, file: 'metal_grind.opus', from: 0.4, rate: 0.8, gain: 0.3, until: B.doorOpen + 0.9, fadeOut: 0.3 },
  { at: B.haul, file: 'metal_grind.opus', from: 5.1, rate: 0.85, gain: 0.6, until: B.slam, fadeIn: 0.1 },
];

type Env = [number, number][];
/** Generated sound, synthesised by the renderer with ffmpeg (deterministic). Envelopes are
 * piecewise-linear [[time, value], …]; a layer is silent outside its gain envelope. Events
 * (`at`, `dur`) are one-shots. `modes` are a resonating body's frequencies (Hz). */
export type SynthLayer =
  | { kind: 'steps'; surface: 'hard' | 'soft'; gain: Env }
  | { kind: 'gallop'; gain: Env }
  | { kind: 'breath'; rate: Env; gain: Env }
  | { kind: 'heartbeat'; rate: Env; gain: Env }
  | { kind: 'drone' | 'rain' | 'rain_muffled' | 'wind' | 'riser' | 'hum' | 'alarm' | 'buzz'; gain: Env }
  | { kind: 'hit'; at: number; level: number; ring: number[]; decay: number; crack: number }
  | { kind: 'wham'; at: number; level: number; tail: number }
  | { kind: 'creak'; at: number; dur: number; rate: [number, number]; modes: number[]; level: number }
  | { kind: 'scrape'; at: number; dur: number; chatter: number; modes: number[]; level: number }
  | { kind: 'growl'; at: number; dur: number; pitch: number; level: number }
  | { kind: 'crunch' | 'hiss'; at: number; dur: number; level: number }
  | { kind: 'click'; at: number; level: number };

export const SYNTH: SynthLayer[] = [
  // Lab: mains hum, the lights buzz as they stutter, then a low industrial horn.
  // Typing at the console.
  { kind: 'click', at: 0.45, level: 0.1 },
  { kind: 'click', at: 0.6, level: 0.1 },
  { kind: 'click', at: 0.83, level: 0.1 },
  { kind: 'click', at: 0.97, level: 0.1 },
  { kind: 'click', at: 1.21, level: 0.1 },
  { kind: 'click', at: 1.34, level: 0.1 },
  { kind: 'click', at: 1.52, level: 0.1 },
  { kind: 'click', at: 1.78, level: 0.1 },
  { kind: 'hum', gain: [[0, 0.16], [B.open - 0.1, 0.16], [B.open + 0.3, 0.08], [B.turn + 0.2, 0.05], [B.flashlight, 0]] },
  { kind: 'buzz', gain: [[B.flicker - 0.05, 0], [B.flicker, 0.12], [B.alarm - 0.1, 0.12], [B.alarm, 0]] },
  { kind: 'alarm', gain: [[B.alarm - 0.1, 0], [B.alarm + 0.2, 0.24], [B.turn + 1, 0.2], [B.barge - 0.1, 0.18], [B.forest, 0.05], [B.forest + 1, 0]] },
  // Something inside the tube: three impacts, the metal groaning, a seam hissing.
  { kind: 'hit', at: B.thud1, level: 0.45, ring: [180, 290, 430], decay: 7, crack: 0.15 },
  { kind: 'hit', at: B.thud2, level: 0.7, ring: [170, 275, 420], decay: 6, crack: 0.25 },
  { kind: 'hiss', at: B.thud2 + 0.15, dur: 1.1, level: 0.12 },
  { kind: 'hit', at: B.thud3, level: 0.85, ring: [160, 262, 405], decay: 5, crack: 0.35 },
  // The hatch bursts: impact, the hinge tearing, a blast of steam; claws on the frame; a growl.
  { kind: 'hit', at: B.open, level: 1, ring: [140, 233, 377], decay: 4, crack: 0.6 },
  { kind: 'hiss', at: B.open, dur: 2.8, level: 0.42 },
  { kind: 'scrape', at: B.grab, dur: 0.5, chatter: 30, modes: [1900, 3100], level: 0.5 },
  { kind: 'growl', at: B.grab + 0.15, dur: 0.9, pitch: 50, level: 0.8 },
  // The hand lets go of the frame, lunges, seizes your colleague and drags them into the dark.
  { kind: 'scrape', at: B.snatch - 0.02, dur: 0.2, chatter: 40, modes: [1900, 3100], level: 0.4 },
  { kind: 'growl', at: B.snatch, dur: 1.0, pitch: 58, level: 1 },
  { kind: 'crunch', at: B.snatch + 0.22, dur: 0.3, level: 0.35 },
  // Escape.
  { kind: 'click', at: B.flashlight, level: 0.35 },
  { kind: 'hiss', at: B.steam0, dur: 1.3, level: 0.28 },
  { kind: 'hiss', at: B.steam1, dur: 1.3, level: 0.28 },
  { kind: 'hit', at: B.barge, level: 0.7, ring: [260, 410, 590], decay: 9, crack: 0.4 },
  { kind: 'steps', surface: 'hard', gain: [[B.turn + 0.1, 0], [B.turn + 0.3, 0.55], [B.barge - 0.1, 0.55], [B.barge + 0.1, 0]] },
  { kind: 'steps', surface: 'soft', gain: [[B.forest - 0.2, 0], [B.forest, 0.58], [B.arrive - 0.4, 0.58], [B.arrive, 0], [B.enter, 0], [B.enter + 0.1, 0.25], [B.enter + 0.5, 0.2], [B.enter + 0.7, 0]] },
  // The heartbeat comes in at the shed and owns the silence after the slam.
  {
    kind: 'heartbeat',
    rate: [[0, 1.1], [B.open, 1.3], [B.flashlight, 1.7], [B.forest, 1.9], [B.arrive, 2.0], [B.lookBack, 2.1], [B.rush, 2.35], [B.slam, 2.4], [B.crash + 2, 2.2], [B.end, 1.5]],
    gain: [[B.arrive - 0.5, 0], [B.lookBack, 0.55], [B.slam, 0.6], [B.slam + 0.2, 0.5], [B.crash - 0.05, 0.5], [B.crash, 0.35], [B.black, 0.9], [B.end - 1, 0.6], [B.end, 0]],
  },
  { kind: 'drone', gain: [[0, 0.03], [B.alarm, 0.1], [B.open, 0.3], [B.turn + 0.8, 0.1], [B.forest, 0.07], [B.arrive - 1, 0.08], [B.lookBack, 0.26], [B.rush, 0.42], [B.slam - 0.05, 0.62], [B.slam + 0.05, 0], [B.crash - 0.05, 0], [B.crash + 0.05, 0.7], [B.black, 0.32], [B.end, 0]] },
  { kind: 'rain', gain: [[B.barge + 0.1, 0], [B.forest, 0.1], [B.slam - 0.1, 0.12], [B.slam + 0.05, 0]] },
  { kind: 'rain_muffled', gain: [[B.slam, 0], [B.slam + 0.1, 0.05], [B.black, 0.05], [B.black + 0.9, 0]] },
  { kind: 'wind', gain: [[B.barge + 0.1, 0], [B.forest + 0.1, 0.09], [B.arrive, 0.1], [B.lookBack, 0.18], [B.slam - 0.1, 0.2], [B.slam + 0.05, 0]] },
  // The shed: latch, a rusty door; a distant growl, the rush, the haul, the slam.
  { kind: 'click', at: B.doorOpen - 0.1, level: 0.3 },
  { kind: 'growl', at: B.shadow + 0.1, dur: 1.2, pitch: 44, level: 0.35 },
  { kind: 'riser', gain: [[B.rush - 0.2, 0], [B.slam - 0.05, 0.5], [B.slam + 0.05, 0]] },
  { kind: 'gallop', gain: [[B.rush, 0], [B.rush + 0.4, 0.2], [B.slam - 0.05, 0.6], [B.slam + 0.02, 0]] },
  { kind: 'wham', at: B.slam, level: 0.8, tail: 0.5 },
  // Something just outside, breathing low through the door. Then the impact.
  { kind: 'growl', at: B.crash - 1.2, dur: 1.1, pitch: 40, level: 0.3 },
  { kind: 'wham', at: B.crash, level: 1.3, tail: 1 },
  { kind: 'crunch', at: B.crash + 0.01, dur: 0.7, level: 0.8 },
  { kind: 'scrape', at: B.scrape, dur: 1.3, chatter: 18, modes: [1200, 2100], level: 0.45 },
  { kind: 'buzz', gain: [[B.lightDies - 0.05, 0], [B.lightDies, 0.18], [B.black - 0.02, 0.18], [B.black, 0]] },
  { kind: 'click', at: B.black, level: 0.3 },
];

export function captionAt(time: number): Caption | null {
  return CAPTIONS.find(c => time >= c.start && time < c.end) ?? null;
}
