import type { Caption, Shot, SoundCue, SynthLayer } from './timeline';

/** Ending cutscene timing, the counterpart of timeline.ts for the opening. Shared by the offline
 * renderer (tools/cutscene.mjs render --film=ending) and the game's caption overlay. Seconds.
 * All four basement locks are released. The door motor is loud, and the noise is what gives you
 * away: on the sonar scope its contact leaves the tree line and comes straight at the shelter. It
 * hits the shelter door while the basement door grinds open; you squeeze through the gap, it
 * bursts in, and you slam the door on its claws. The pounding follows you down the stairs, then
 * stops. The basement is a specimen vault: one tank burst open from inside, a warning to keep all
 * four locks engaged, and something standing in the dark. It lunges as the torch dies.
 * As in the opening, it is only ever a contact, a hand, and a shape against the light. */
export const FILM = { fps: 30, renderFps: 60, duration: 46, width: 1920, height: 1080, video: 'assets/video/ending.mp4' } as const;

export const BEATS = {
  type: 0.7, engage: 2.6, turnDoor: 3.3, crack: 4.4, heard: 6.0, toScope: 6.4, scope: 7.1, moves: 8.15, near: 9.95,
  whip: 10.8, hit1: 12.2, backToDoor: 12.7, hit2: 14.0, lookBack: 14.6, hit3: 15.4, go: 16.7, squeeze: 17.3, through: 18.9, breach: 19.95,
  lever: 20.75, release: 21.1, shut: 21.5, bolts: 21.85, pound1: 23.4, pound2: 24.8, scrape: 25.7, turnAway: 27.6, descend: 28.6,
  pound3: 29.6, pound4: 31.0, silence: 32.0, bottom: 33.0, enter: 34.0, sign: 36.3, breath: 37.6, turn: 38.1, reveal: 38.75,
  flick: 39.5, lunge: 39.94, out: 40.12, end: 46,
} as const;
const B = BEATS;

/** Walking down metal stairs. Camera footfalls and the stair steps share this grid (t = k / rate). */
export const STEP_RATE = 1.9;

/** The sonar scope that replaced the security monitor: its sweep turns once per `period` and
 * passes the contact's `bearing` (radians, clockwise from up) at start + period · (bearing / 2π + k). */
export const SCOPE = { start: 6.3, period: 0.9, bearing: 0.35 } as const;
/** The contact's range (the game's 0–24 m sonar scale): holding at the tree line, then charging. */
export function contactAt(t: number): number {
  const keys: [number, number][] = [[7.6, 22], [B.moves, 20.5], [9.05, 14], [B.near, 7], [10.85, 2.5], [B.hit1, 0]];
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0); }
  return keys[keys.length - 1][1];
}
/** When the sweep last passed the contact at or before t (the scope shows the range sampled then). */
export function lastPing(t: number): number {
  const k = Math.floor((t - SCOPE.start) / SCOPE.period - SCOPE.bearing / (Math.PI * 2));
  return SCOPE.start + SCOPE.period * (SCOPE.bearing / (Math.PI * 2) + k);
}
const PINGS = [0, 1, 2, 3, 4, 5].map(k => SCOPE.start + SCOPE.period * (SCOPE.bearing / (Math.PI * 2) + k));

export const SHOTS: Shot[] = [
  { id: 'terminal', start: 0, end: B.turnDoor, summary: 'Close on the terminal: all four basement locks released. You engage the door motor; it clunks in and a klaxon starts.' },
  { id: 'door', start: B.turnDoor, end: B.toScope, summary: 'The beacon sweeps the room; the exposure needle on the wall unit swings into the red. The basement door jerks and starts to grind open, far too slowly and far too loud.' },
  { id: 'scope', start: B.toScope, end: B.whip, summary: 'The sonar scope: its contact sits at the tree line, then each sweep finds it closer, coming straight at the shelter.' },
  { id: 'siege', start: B.whip, end: B.squeeze, summary: 'Footsteps arrive. Three blows dent the shelter door; claws tear through its corner. The gap is barely wide enough.' },
  { id: 'gap', start: B.squeeze, end: B.release, summary: 'Squeeze through onto the landing and turn: through the slit the shelter door bursts in and it comes straight at you.' },
  { id: 'shut', start: B.release, end: B.turnAway, summary: 'The emergency lever drops the door shut on its reaching claws. Bolts shoot home. It pounds and scrapes on the other side.' },
  { id: 'descent', start: B.turnAway, end: B.bottom, summary: 'Turn away and go down the stairs by torchlight. The pounding fades above, then stops.' },
  { id: 'vault', start: B.bottom, end: B.out, summary: 'A specimen vault: a tank burst open from inside, gouges across the floor, a sign: KEEP ALL FOUR LOCKS ENGAGED. Breathing in the dark. The torch finds a shape standing still; it flickers, and the shape is closer each time. It lunges.' },
  { id: 'title', start: B.out, end: B.end, summary: 'Black. You are not alone down here.' },
];

export const CAPTIONS: Caption[] = [
  { start: B.engage + 0.1, end: B.heard - 0.1, text: '[the basement door motor grinds — loud]' },
  { start: B.moves - 0.1, end: B.near - 0.1, text: '[on the sonar, it turns toward the noise]' },
  { start: B.near, end: B.hit1 - 0.1, text: '[it is running at the shelter]' },
  { start: B.hit1, end: B.hit2 + 0.6, text: '[it slams into the shelter door]' },
  { start: B.hit3, end: B.go + 0.5, text: '[claws tear through the door]' },
  { start: B.squeeze, end: B.through, text: '[just wide enough]' },
  { start: B.breach, end: B.release, text: '[the shelter door bursts in]' },
  { start: B.shut, end: B.pound1, text: '[you drop the basement door on its claws]' },
  { start: B.pound1, end: B.turnAway, text: '[it pounds on the door above you]' },
  { start: B.silence + 0.3, end: B.enter, text: '[the pounding stops]' },
  { start: B.breath, end: B.reveal, text: '[something breathes in the dark]' },
  { start: B.lunge, end: B.out + 0.8, text: '[it lunges]' },
  { start: B.out + 1.2, end: B.end, text: 'You are not alone down here.' },
];

export const SOUND_CUES: SoundCue[] = [
  // Breathing under everything: held at the terminal, ragged through the siege, panic after the
  // slam, quieter in the vault, and held when something else breathes.
  { at: B.engage, file: 'breath_scared.opus', gain: 0.32, until: B.whip, fadeIn: 0.8, fadeOut: 0.3 },
  { at: B.whip, file: 'breath_run.opus', gain: 0.4, until: B.shut, fadeIn: 0.3, fadeOut: 0.1 },
  { at: B.shut + 0.3, file: 'breath_panic.opus', gain: 0.45, until: B.breath + 0.1, fadeIn: 0.2, fadeOut: 0.35, env: [[B.bottom, 1], [B.enter, 0.6]] },
  // The door motor dragging the leaf along its track, start to finish.
  { at: B.crack - 0.1, file: 'metal_grind.opus', from: 0.4, rate: 0.5, gain: 0.24, until: B.release, loop: 5, fadeIn: 0.2, fadeOut: 0.05 },
  // It comes out of the trees: heavy steps closing on the shelter as the contact nears.
  { at: B.near - 0.6, file: 'stomps_mud.opus', gain: 1, until: B.hit1, fadeIn: 0.6, fadeOut: 0.05, env: [[B.near - 0.6, 0.3], [B.hit1 - 0.2, 1]] },
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
  // Outside, it answers: a growl far off. Then the scope pings each time its sweep passes the contact.
  { kind: 'growl', at: B.heard, dur: 1.6, pitch: 42, level: 0.3 },
  ...PINGS.map((at, i) => ({ kind: 'ping', at, level: 0.22 + 0.05 * i }) as SynthLayer),
  { kind: 'gallop', gain: [[B.near - 0.3, 0], [B.hit1 - 0.6, 0.45], [B.hit1 - 0.02, 0.7], [B.hit1, 0]] },
  { kind: 'riser', gain: [[B.moves, 0], [B.hit1 - 0.05, 0.45], [B.hit1 + 0.05, 0]] },
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
  // It pounds on the door, scrapes it, and fades above you as you go down; then it stops.
  { kind: 'wham', at: B.pound1, level: 1.1, tail: 0.9 },
  { kind: 'crunch', at: B.pound1 + 0.01, dur: 0.4, level: 0.4 },
  { kind: 'wham', at: B.pound2, level: 1, tail: 0.8 },
  { kind: 'scrape', at: B.scrape, dur: 1.6, chatter: 18, modes: [1200, 2100], level: 0.4 },
  { kind: 'growl', at: B.scrape + 1.5, dur: 1.4, pitch: 40, level: 0.35 },
  { kind: 'click', at: B.turnAway + 0.5, level: 0.3 },
  { kind: 'steps', surface: 'hard', gain: [[B.descend - 0.1, 0], [B.descend + 0.1, 0.32], [B.bottom, 0.26], [B.enter, 0.18], [B.enter + 0.3, 0], [B.sign - 0.9, 0], [B.sign - 0.8, 0.12], [B.sign - 0.1, 0.12], [B.sign, 0]] },
  { kind: 'wham', at: B.pound3, level: 0.5, tail: 0.6 },
  { kind: 'wham', at: B.pound4, level: 0.28, tail: 0.5 },
  // The vault: water dripping, then something breathing in the dark, slow and deep.
  ...[33.4, 34.7, 35.95, 36.9, 38.3, 42.2, 44.4].map((at, i) => ({ kind: 'drip', at, level: 0.32 - 0.03 * i }) as SynthLayer),
  { kind: 'growl', at: B.breath, dur: 1.6, pitch: 24, level: 0.3 },
  { kind: 'growl', at: B.reveal + 0.15, dur: 1.2, pitch: 27, level: 0.38 },
  { kind: 'riser', gain: [[B.breath, 0], [B.flick, 0.4], [B.out - 0.01, 0.5], [B.out, 0]] },
  // The torch fails: its switch rattles, the bulb buzzes. It lunges; the torch smashes. Silence.
  { kind: 'buzz', gain: [[B.flick - 0.05, 0], [B.flick, 0.08], [B.out - 0.01, 0.08], [B.out, 0]] },
  { kind: 'click', at: B.flick, level: 0.35 },
  { kind: 'click', at: B.flick + 0.12, level: 0.3 },
  { kind: 'click', at: B.lunge - 0.08, level: 0.35 },
  { kind: 'growl', at: B.lunge - 0.1, dur: 0.42, pitch: 72, level: 1.2 },
  { kind: 'wham', at: B.out, level: 1.1, tail: 0.5 },
  { kind: 'crunch', at: B.out + 0.01, dur: 0.25, level: 0.5 },
  // In the black, under the last card: one slow breath, close.
  { kind: 'growl', at: B.out + 3.0, dur: 1.8, pitch: 22, level: 0.22 },
  // The heartbeat: steady at the terminal, racing through the siege, slowing on the stairs, racing again in the vault.
  {
    kind: 'heartbeat',
    rate: [[0, 1.2], [B.engage, 1.4], [B.moves, 1.9], [B.hit1, 2.2], [B.breach, 2.5], [B.shut, 2.5], [B.descend, 2.0], [B.silence, 1.7], [B.breath, 2.3], [B.reveal, 2.7], [B.out, 2.8]],
    gain: [[0, 0.08], [B.engage, 0.12], [B.moves, 0.2], [B.hit1, 0.25], [B.breach, 0.35], [B.shut, 0.42], [B.turnAway, 0.38], [B.bottom, 0.3], [B.breath, 0.42], [B.reveal, 0.55], [B.out - 0.01, 0.55], [B.out, 0]],
  },
  { kind: 'drone', gain: [[0, 0.03], [B.engage, 0.09], [B.moves, 0.24], [B.hit1, 0.28], [B.breach, 0.45], [B.shut - 0.05, 0.5], [B.shut + 0.05, 0.2], [B.descend, 0.16], [B.silence, 0.1], [B.breath, 0.2], [B.reveal, 0.35], [B.out - 0.01, 0.4], [B.out, 0], [B.out + 2, 0], [B.out + 3, 0.07], [B.end, 0]] },
];

export function captionAt(time: number): Caption | null {
  return CAPTIONS.find(c => time >= c.start && time < c.end) ?? null;
}
