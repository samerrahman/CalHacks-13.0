import type { Caption, Shot, SoundCue, SynthLayer } from './timeline';

/** Ending cutscene timing, the counterpart of timeline.ts for the opening. Shared by the offline
 * renderer (tools/cutscene.mjs render --film=ending) and the game's caption overlay. Seconds.
 * All four basement locks are released. The door motor is loud, and the noise is what gives you
 * away: on the feed it turns its head, then charges. It hits the shelter door while the basement
 * door grinds open; you squeeze through the gap, it bursts in, and you slam the door on its claws.
 * As in the opening, it is only ever a silhouette on CCTV, a hand, and a shape against the light. */
export const FILM = { fps: 30, renderFps: 60, duration: 38.5, width: 1920, height: 1080, video: 'assets/video/ending.mp4' } as const;

export const BEATS = {
  type: 0.7, engage: 2.6, turnDoor: 3.3, crack: 4.4, heard: 6.0, toMonitor: 6.4, cctv: 7.1, turnHead: 7.7, charge: 8.5, fill: 10.1, cut: 10.35,
  whip: 10.8, hit1: 12.2, backToDoor: 12.7, hit2: 14.0, lookBack: 14.6, hit3: 15.4, go: 16.7, squeeze: 17.3, through: 18.9, breach: 19.95,
  lever: 20.75, release: 21.1, shut: 21.5, bolts: 21.85, pound1: 23.4, pound2: 24.8, scrape: 25.7, turnAway: 27.6, descend: 28.6,
  pound3: 29.6, pound4: 31.6, black: 33.8, end: 38.5,
} as const;
const B = BEATS;

/** Walking down metal stairs. Camera footfalls and the stair steps share this grid (t = k / rate). */
export const STEP_RATE = 1.9;

export const SHOTS: Shot[] = [
  { id: 'terminal', start: 0, end: B.turnDoor, summary: 'Close on the terminal: all four basement locks released. You engage the door motor; it clunks in and a klaxon starts.' },
  { id: 'door', start: B.turnDoor, end: B.toMonitor, summary: 'The beacon sweeps the room. The basement door jerks and starts to grind open, far too slowly and far too loud.' },
  { id: 'feed', start: B.toMonitor, end: B.whip, summary: 'CAM A: it stands at the tree line. Its head turns toward the shelter. It charges the camera; the feed dies.' },
  { id: 'siege', start: B.whip, end: B.squeeze, summary: 'Footsteps arrive. Three blows dent the shelter door; claws tear through its corner. The gap is barely wide enough.' },
  { id: 'gap', start: B.squeeze, end: B.release, summary: 'Squeeze through onto the landing and turn: through the slit the shelter door bursts in and it comes straight at you.' },
  { id: 'shut', start: B.release, end: B.turnAway, summary: 'The emergency lever drops the door shut on its reaching claws. Bolts shoot home. It pounds and scrapes on the other side.' },
  { id: 'descent', start: B.turnAway, end: B.black, summary: 'Turn away and go down the stairs into the dark while the pounding fades above.' },
  { id: 'title', start: B.black, end: B.end, summary: 'Black.' },
];

export const CAPTIONS: Caption[] = [
  { start: B.engage + 0.1, end: B.heard - 0.1, text: '[the basement door motor grinds — loud]' },
  { start: B.turnHead, end: B.cut, text: '[on the feed, it hears the motor]' },
  { start: B.cut + 0.2, end: B.hit1 - 0.1, text: '[it is running at the shelter]' },
  { start: B.hit1, end: B.hit2 + 0.6, text: '[it slams into the shelter door]' },
  { start: B.hit3, end: B.go + 0.5, text: '[claws tear through the door]' },
  { start: B.squeeze, end: B.through, text: '[just wide enough]' },
  { start: B.breach, end: B.release, text: '[the shelter door bursts in]' },
  { start: B.shut, end: B.pound1, text: '[you drop the basement door on its claws]' },
  { start: B.pound1, end: B.turnAway, text: '[it pounds on the door above you]' },
  { start: B.black + 0.6, end: B.end, text: 'You escaped.' },
];

export const SOUND_CUES: SoundCue[] = [
  // Breathing under everything: held at the terminal, ragged through the siege, panic after the slam.
  { at: B.engage, file: 'breath_scared.opus', gain: 0.32, until: B.whip, fadeIn: 0.8, fadeOut: 0.3 },
  { at: B.whip, file: 'breath_run.opus', gain: 0.4, until: B.shut, fadeIn: 0.3, fadeOut: 0.1 },
  { at: B.shut + 0.3, file: 'breath_panic.opus', gain: 0.45, until: B.end - 1, fadeIn: 0.2, fadeOut: 3 },
  // The door motor dragging the leaf along its track, start to finish.
  { at: B.crack - 0.1, file: 'metal_grind.opus', from: 0.4, rate: 0.5, gain: 0.24, until: B.release, loop: 5, fadeIn: 0.2, fadeOut: 0.05 },
  // It comes out of the trees: heavy steps closing on the shelter after the feed dies.
  { at: B.cut - 0.4, file: 'stomps_mud.opus', gain: 1, until: B.hit1, fadeIn: 0.6, fadeOut: 0.05, env: [[B.cut - 0.4, 0.35], [B.hit1 - 0.2, 1]] },
  // The shelter door tearing; the basement door's release and the dropped leaf.
  { at: B.hit3 + 0.05, file: 'metal_grind.opus', from: 10.5, rate: 0.75, gain: 0.55, until: B.hit3 + 0.8, fadeOut: 0.25 },
  { at: B.breach, file: 'metal_grind.opus', from: 10.5, rate: 0.6, gain: 0.7, until: B.breach + 0.9, fadeOut: 0.3 },
  { at: B.release, file: 'metal_grind.opus', from: 5.1, rate: 1.1, gain: 0.6, until: B.shut, fadeIn: 0.05 },
  { at: B.scrape, file: 'metal_grind.opus', from: 6, rate: 0.8, gain: 0.25, until: B.scrape + 1.4, fadeIn: 0.2, fadeOut: 0.5 },
];

export const SYNTH: SynthLayer[] = [
  // The shelter: mains hum and a low drone; rain on the roof outside.
  { kind: 'hum', gain: [[0, 0.12], [B.hit1, 0.12], [B.hit1 + 0.2, 0.06], [B.through, 0.04], [B.shut, 0]] },
  { kind: 'rain_muffled', gain: [[0, 0.05], [B.breach, 0.05], [B.breach + 0.2, 0.12], [B.shut, 0.03], [B.shut + 0.05, 0]] },
  // Typing the command, then the motor clunks in and the klaxon starts.
  ...[0.75, 0.88, 1.02, 1.18, 1.3, 1.45, 1.62, 1.74, 1.9, 2.05, 2.3].map(at => ({ kind: 'click', at, level: 0.1 }) as SynthLayer),
  { kind: 'click', at: B.engage - 0.05, level: 0.35 },
  { kind: 'hit', at: B.engage, level: 0.8, ring: [120, 205, 330], decay: 5, crack: 0.3 },
  { kind: 'motor', gain: [[B.engage, 0], [B.engage + 0.5, 0.28], [B.hit1, 0.25], [B.release - 0.05, 0.25], [B.release, 0]] },
  { kind: 'alarm', gain: [[B.engage, 0], [B.engage + 0.3, 0.1], [B.release, 0.1], [B.release + 0.1, 0]] },
  { kind: 'creak', at: B.crack, dur: 0.6, rate: [30, 14], modes: [300, 610, 980], level: 0.7 },
  { kind: 'hiss', at: B.crack + 0.05, dur: 0.6, level: 0.15 },
  // Outside, it answers: a growl far off. Then the feed: its charge, and the cut.
  { kind: 'growl', at: B.heard, dur: 1.6, pitch: 42, level: 0.3 },
  { kind: 'buzz', gain: [[B.cut - 0.02, 0], [B.cut, 0.2], [B.cut + 0.7, 0.12], [B.cut + 0.8, 0]] },
  { kind: 'hiss', at: B.cut, dur: 0.9, level: 0.25 },
  { kind: 'gallop', gain: [[B.cut + 0.3, 0], [B.hit1 - 0.6, 0.45], [B.hit1 - 0.02, 0.7], [B.hit1, 0]] },
  { kind: 'riser', gain: [[B.cut, 0], [B.hit1 - 0.05, 0.45], [B.hit1 + 0.05, 0]] },
  // Three blows on the shelter door; the last one tears it, and claws come through.
  { kind: 'wham', at: B.hit1, level: 1.2, tail: 0.8 },
  { kind: 'crunch', at: B.hit1 + 0.01, dur: 0.5, level: 0.6 },
  { kind: 'growl', at: B.hit1 + 0.6, dur: 0.9, pitch: 46, level: 0.45 },
  { kind: 'wham', at: B.hit2, level: 1.1, tail: 0.7 },
  { kind: 'crunch', at: B.hit2 + 0.01, dur: 0.6, level: 0.7 },
  { kind: 'wham', at: B.hit3, level: 1.3, tail: 0.9 },
  { kind: 'crunch', at: B.hit3 + 0.01, dur: 0.8, level: 0.9 },
  { kind: 'scrape', at: B.hit3 + 0.2, dur: 1.1, chatter: 30, modes: [1900, 3100], level: 0.5 },
  { kind: 'growl', at: B.hit3 + 0.3, dur: 1.2, pitch: 52, level: 0.7 },
  // Squeezing through: shoulders scraping the frame, a few steps onto the landing.
  { kind: 'scrape', at: B.squeeze + 0.3, dur: 0.9, chatter: 12, modes: [700, 1300], level: 0.25 },
  { kind: 'steps', surface: 'hard', gain: [[B.squeeze, 0], [B.squeeze + 0.2, 0.3], [B.through + 0.6, 0.3], [B.through + 0.8, 0]] },
  // It bursts in and comes at you; the lever; the leaf drops on its claws.
  { kind: 'wham', at: B.breach, level: 1.4, tail: 1 },
  { kind: 'crunch', at: B.breach + 0.02, dur: 0.9, level: 1 },
  { kind: 'growl', at: B.breach + 0.25, dur: 1.1, pitch: 60, level: 1 },
  { kind: 'gallop', gain: [[B.breach + 0.2, 0], [B.breach + 0.4, 0.5], [B.shut - 0.02, 0.8], [B.shut, 0]] },
  { kind: 'click', at: B.release - 0.03, level: 0.5 },
  { kind: 'hit', at: B.release, level: 0.6, ring: [260, 410, 590], decay: 9, crack: 0.4 },
  { kind: 'wham', at: B.shut, level: 1.5, tail: 1 },
  { kind: 'crunch', at: B.shut + 0.02, dur: 0.4, level: 0.6 },
  { kind: 'growl', at: B.shut + 0.08, dur: 1.3, pitch: 66, level: 0.9 },
  // Four bolts shoot home.
  ...[0, 0.27, 0.54, 0.81].map((dt, i) => ({ kind: 'hit', at: B.bolts + dt, level: 0.5, ring: [420 + i * 30, 690, 1010], decay: 14, crack: 0.5 }) as SynthLayer),
  // It pounds on the door, scrapes it, and fades above you as you go down.
  { kind: 'wham', at: B.pound1, level: 1.1, tail: 0.9 },
  { kind: 'crunch', at: B.pound1 + 0.01, dur: 0.4, level: 0.4 },
  { kind: 'wham', at: B.pound2, level: 1, tail: 0.8 },
  { kind: 'scrape', at: B.scrape, dur: 1.6, chatter: 18, modes: [1200, 2100], level: 0.4 },
  { kind: 'growl', at: B.scrape + 1.5, dur: 1.4, pitch: 40, level: 0.35 },
  { kind: 'click', at: B.turnAway + 0.5, level: 0.3 },
  { kind: 'steps', surface: 'hard', gain: [[B.descend - 0.1, 0], [B.descend + 0.1, 0.32], [B.black - 0.3, 0.26], [B.black, 0]] },
  { kind: 'wham', at: B.pound3, level: 0.5, tail: 0.6 },
  { kind: 'wham', at: B.pound4, level: 0.28, tail: 0.5 },
  // The heartbeat: steady at the terminal, racing through the siege, slowing in the dark.
  {
    kind: 'heartbeat',
    rate: [[0, 1.2], [B.engage, 1.4], [B.charge, 1.9], [B.hit1, 2.2], [B.breach, 2.5], [B.shut, 2.5], [B.descend, 2.0], [B.end, 1.3]],
    gain: [[0, 0.08], [B.engage, 0.12], [B.charge, 0.2], [B.hit1, 0.25], [B.breach, 0.35], [B.shut, 0.42], [B.turnAway, 0.38], [B.black, 0.45], [B.end - 1, 0.3], [B.end, 0]],
  },
  { kind: 'drone', gain: [[0, 0.03], [B.engage, 0.09], [B.charge, 0.24], [B.hit1, 0.28], [B.breach, 0.45], [B.shut - 0.05, 0.5], [B.shut + 0.05, 0.2], [B.descend, 0.16], [B.black, 0.24], [B.end, 0]] },
];

export function captionAt(time: number): Caption | null {
  return CAPTIONS.find(c => time >= c.start && time < c.end) ?? null;
}
