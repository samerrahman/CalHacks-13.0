import { CanvasTexture, SRGBColorSpace } from 'three';
import type { RenderState } from './state';

export function createDisplay(width = 1024, height = 512, _gltf = true) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  // The supplied generated mesh UVs are bottom-left (0,0), like Three planes.
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.flipY = true;
  return { canvas, context, texture };
}
export type Display = ReturnType<typeof createDisplay>;
const glassCache = new WeakMap<Display, HTMLCanvasElement>();
function wornGlass(display: Display, width: number, height: number) {
  const ctx = display.context;
  if (display.canvas && typeof ctx.drawImage === 'function' && typeof document !== 'undefined') {
    let cached = glassCache.get(display);
    if (!cached) {
      cached = document.createElement('canvas'); cached.width = width; cached.height = height;
      const gctx = cached.getContext('2d')!;
      gctx.fillStyle = 'rgba(0,0,0,.13)'; for (let y = 0; y < height; y += 4) gctx.fillRect(0, y, width, 1);
      const edge = gctx.createRadialGradient(width * .5, height * .48, height * .18, width * .5, height * .5, width * .62);
      edge.addColorStop(0, 'rgba(3,4,2,0)'); edge.addColorStop(.75, 'rgba(3,4,2,.16)'); edge.addColorStop(1, 'rgba(3,4,2,.70)');
      gctx.fillStyle = edge; gctx.fillRect(0, 0, width, height);
      glassCache.set(display, cached);
    }
    ctx.drawImage(cached, 0, 0);
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,.13)'; for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);
  const edge = ctx.createRadialGradient(width * .5, height * .48, height * .18, width * .5, height * .5, width * .62);
  edge.addColorStop(0, 'rgba(3,4,2,0)'); edge.addColorStop(.75, 'rgba(3,4,2,.16)'); edge.addColorStop(1, 'rgba(3,4,2,.70)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, width, height);
}
export function plateTexture(title: string, lines: string[]): CanvasTexture {
  const { context: ctx, texture } = createDisplay(1024, 512, false);
  ctx.fillStyle = '#aeb49b'; ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = '#334d40'; ctx.lineWidth = 6; ctx.strokeRect(20, 20, 984, 472);
  ctx.fillStyle = '#1d382d'; ctx.font = 'bold 52px monospace'; ctx.fillText(title, 52, 112);
  ctx.font = '34px monospace'; lines.forEach((line, i) => ctx.fillText(line, 52, 207 + i * 67));
  return texture;
}
const STEP_SCREENS: Record<string, [string, string]> = {
  wires: ['PATCH THE RELAY', 'MATCH EACH CABLE TO ITS SOCKET'], routing: ['RECONNECT THE CONDUIT', 'ROTATE TILES FROM INLET TO OUTLET'],
  locate: ['MARK ITS POSITION', 'USE THE SECURITY MONITOR'], pulse: ['MASK YOUR HEARTBEAT', 'TAP IN RHYTHM WITH THE PULSE'], calm: ['LET IT LOSE YOUR TRAIL', 'BREATHE WITH THE RING'],
};
const PROGRESS_UNITS: Record<string, string> = { wires: 'CABLES LINKED', routing: 'CONDUITS JOINED', locate: 'POSITIONS MARKED', pulse: 'BEATS IN RHYTHM', calm: 'CALM SECONDS' };
export function drawTerminal(display: Display, state: RenderState): void {
  const on = state.power === 'on', ctx = display.context;
  ctx.fillStyle = on ? '#14170d' : '#030403'; ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = on ? '#aca77e' : '#33362a'; ctx.font = '26px monospace'; ctx.fillText('SHELTER 04 / RESEARCH TERMINAL', 42, 51);
  ctx.strokeStyle = '#3a5940'; ctx.strokeRect(23, 23, 978, 466);
  ctx.font = 'bold 43px monospace'; ctx.fillStyle = '#a2c18b';
  if (!on) {
    ctx.fillText(state.power === 'quiet' ? 'EMERGENCY QUIET' : 'POWER INTERRUPTED', 48, 205);
    ctx.font = '30px monospace'; ctx.fillStyle = '#5d6e56'; ctx.fillText('PROGRESS PRESERVED', 48, 278);
  } else if (state.step && STEP_SCREENS[state.step]) {
    const [title, detail] = STEP_SCREENS[state.step]!, [done, total] = state.progress ?? [0, 0];
    ctx.fillText(title, 45, 120);
    ctx.font = '28px monospace'; ctx.fillStyle = '#8fae80'; ctx.fillText(detail, 48, 168);
    if (state.step === 'pulse') {
      const flash = Math.max(0, Math.min(1, state.pulseFlash ?? 0));
      ctx.fillStyle = `rgba(${Math.round(60 + flash * 150)}, ${Math.round(30 + flash * 30)}, 24, 1)`; ctx.beginPath(); ctx.arc(512, 290, 70 + flash * 10, 0, Math.PI * 2); ctx.fill();
    } else if (state.step === 'calm') {
      ctx.strokeStyle = state.breathMatched === false ? '#c78b4f' : '#93a873'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(512, 290, 22 + Math.max(0, Math.min(1, state.breath ?? 0)) * 88, 0, Math.PI * 2); ctx.stroke();
    } else {
      for (let i = 0; i < total; i++) { const x = 48 + i * Math.min(60, 920 / Math.max(1, total)); ctx.fillStyle = i < done ? '#a2c18b' : '#1b3d29'; ctx.fillRect(x, 250, Math.min(48, 920 / Math.max(1, total) - 8), 80); }
    }
    ctx.fillStyle = '#b8c8a2'; ctx.font = '27px monospace'; ctx.fillText(`${done} / ${total} ${PROGRESS_UNITS[state.step] ?? ''}`, 48, 448);
  } else if (state.stage === 1 || state.stage === 3) {
    // Faults are found by ear, so the screen never marks which machine is failing; it lights only the rack key.
    ctx.fillText(state.listening !== null && state.listening !== undefined ? 'LISTEN TO THE RACK' : 'FIND THE FAULTS BY EAR', 45, 120);
    for (let i = 0; i < 4; i++) {
      const lit = state.listening === i, x = 48 + i * 240;
      ctx.fillStyle = lit ? '#b18b4c' : '#153425'; ctx.fillRect(x, 175, 211, 205);
      ctx.strokeStyle = lit ? '#eac58a' : '#476b47'; ctx.lineWidth = lit ? 7 : 2; ctx.strokeRect(x, 175, 211, 205);
      ctx.fillStyle = lit ? '#172019' : '#8baf82'; ctx.font = 'bold 78px monospace'; ctx.fillText(String(i + 1), x + 78, 300);
    }
    ctx.fillStyle = '#b8c8a2'; ctx.font = '27px monospace'; ctx.fillText(`${state.faultsResolved ?? 0} / ${state.faultsRequired ?? (state.stage === 1 ? 5 : 7)} FAULTS RESOLVED`, 48, 448);
  } else if (state.stage === 2 || state.stage === 4) {
    ctx.fillText(`CALIBRATE EMITTER ${state.stage === 2 ? 'A' : 'B'}`, 45, 120);
    for (let i = 1; i <= 4; i++) {
      const x = 50 + (i - 1) * 241; ctx.fillStyle = state.sequenceCue === i ? '#d7c78c' : '#1b3d29'; ctx.fillRect(x, 180, 203, 150);
      ctx.fillStyle = state.sequenceCue === i ? '#153322' : '#9dbc90'; ctx.font = 'bold 72px monospace'; ctx.fillText(String(i), x + 76, 282);
    }
    ctx.fillStyle = '#bdc9a0'; ctx.font = '32px monospace'; ctx.fillText(state.armed ? 'SIGNAL CALIBRATED / TRANSMIT' : `INPUT  ${(state.entered ?? []).map(() => '●').join(' ')}${' _'.repeat(Math.max(0, (state.sequenceLength ?? 4) - (state.entered?.length ?? 0)))}`, 48, 421);
  } else {
    ctx.fillText(state.status === 'won' ? 'DOOR MOTOR ENGAGED' : 'BASEMENT ACCESS', 48, 225);
    ctx.font = '29px monospace'; ctx.fillText(state.status === 'won' ? 'OPENING / MOTOR NOISE HIGH' : 'LOCKS 4/4 RELEASED / SEND DECOY', 48, 300);
  }
  wornGlass(display, 1024, 512); display.texture.needsUpdate = true;
}
/** In-room ping radar: rings for the close band and camera bands, a sweeping ping each detector
 * reading, and a fading contact at the sampled range and bearing. It never prints a range number. */
export function drawProximity(display: Display, state: RenderState): void {
  const on = state.power === 'on', ctx = display.context;
  ctx.fillStyle = '#0b0d07'; ctx.fillRect(0, 0, 512, 384); ctx.textAlign = 'center';
  if (!on) { display.texture.needsUpdate = true; return; }
  const cx = 256, cy = 205, radius = 150, length = 24, sampled = state.blind ? null : state.creature.sensorDistance, since = Math.max(0, state.time - (state.creature.sensorSampleAt ?? state.time));
  ctx.fillStyle = '#b0a97c'; ctx.font = '25px monospace'; ctx.fillText('PROXIMITY RADAR', 256, 38);
  ctx.strokeStyle = '#4c5a3c'; ctx.lineWidth = 2;
  for (const edge of [7, 14, 22, 24]) { ctx.strokeStyle = edge === 7 ? '#8a4430' : '#4c5a3c'; ctx.beginPath(); ctx.arc(cx, cy, edge / length * radius, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#c9c194'; ctx.fillRect(cx - 6, cy - 6, 12, 12);
  if (typeof sampled === 'number' && Number.isFinite(sampled)) {
    const sweep = Math.min(1, since / 1.2), share = sampled / length;
    ctx.strokeStyle = `rgba(166, 188, 135, ${1 - sweep * .85})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, sweep * radius, 0, Math.PI * 2); ctx.stroke();
    if (sweep >= share) {
      const bearing = state.creature.sensorBearing ?? 0, fade = Math.max(.18, 1 - (since - share * 1.2) / 4);
      ctx.fillStyle = `rgba(231, 164, 106, ${fade})`; ctx.beginPath(); ctx.arc(cx + Math.sin(bearing) * share * radius, cy - Math.cos(bearing) * share * radius, 9, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.fillStyle = '#6c704e'; ctx.font = '21px monospace'; ctx.fillText('PING EVERY 4 SECONDS', 256, 372);
  wornGlass(display, 512, 384); display.texture.needsUpdate = true;
}
// Seven-segment digit: segments a–g as [x, y, horizontal] in a 1×2 cell.
const SEGMENTS: [number, number, boolean][] = [[0, 0, true], [1, 0, false], [1, 1, false], [0, 2, true], [0, 1, false], [0, 0, false], [0, 1, true]];
const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
function sevenSegment(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, lit: string, on: string, off: string) {
  const t = size * .17, l = size - t * .6;
  SEGMENTS.forEach(([sx, sy, horizontal], i) => {
    ctx.fillStyle = lit.includes('abcdefg'[i]!) ? on : off;
    const px = x + sx * size, py = y + sy * size;
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(px + t * .5, py); ctx.lineTo(px + t, py - t / 2); ctx.lineTo(px + l, py - t / 2); ctx.lineTo(px + size - t * .5, py); ctx.lineTo(px + l, py + t / 2); ctx.lineTo(px + t, py + t / 2); }
    else { ctx.moveTo(px, py + t * .5); ctx.lineTo(px + t / 2, py + t); ctx.lineTo(px + t / 2, py + l); ctx.lineTo(px, py + size - t * .5); ctx.lineTo(px - t / 2, py + l); ctx.lineTo(px - t / 2, py + t); }
    ctx.closePath(); ctx.fill();
  });
}
/** Wall status unit: LED countdown, three battery cells and an exposure needle. No text.
 * The clock and cells run on backup; the exposure gauge goes dark without power. */
/** Isolation remote screen. Its job is to say plainly what QUIET does: the machines stop and
 * exposure falls. Exposure is shown only while powered, like every other danger readout. */
export function drawRemote(display: Display, state: RenderState): void {
  const ctx = display.context, r = state.remote, powered = state.power === 'on', exposure = state.survival?.exposure ?? 0;
  ctx.fillStyle = '#0b130b'; ctx.fillRect(0, 0, 512, 384); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const dim = '#3d5236', lit = '#b6d38a', warm = '#f0864a';
  function machine(x: number, y: number, loud: boolean, color: string) {
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(x, y, 64, 74); ctx.beginPath(); ctx.arc(x + 32, y + 30, 14, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = color; ctx.fillRect(x + 14, y + 54, 36, 8);
    if (loud) for (const radius of [22, 40]) { ctx.beginPath(); ctx.arc(x + 70, y + 37, radius, -.7, .7); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(x + 80, y + 18); ctx.lineTo(x + 114, y + 56); ctx.moveTo(x + 114, y + 18); ctx.lineTo(x + 80, y + 56); ctx.stroke(); }
  }
  if (powered) {
    ctx.fillStyle = lit; ctx.font = 'bold 30px monospace'; ctx.fillText('EXPOSURE', 28, 50); ctx.textAlign = 'right'; ctx.fillText(`${Math.round(exposure)}%`, 484, 50); ctx.textAlign = 'left';
    ctx.fillStyle = '#1c2a19'; ctx.fillRect(28, 64, 456, 16); ctx.fillStyle = exposure >= 70 ? '#e0573a' : exposure >= 20 ? '#d8a24a' : lit; ctx.fillRect(28, 64, 456 * Math.min(1, exposure / 100), 16);
    const ready = !!r?.quietReady, color = ready ? lit : dim;
    machine(34, 112, true, color); ctx.fillStyle = color; ctx.font = 'bold 54px monospace'; ctx.fillText('→', 172, 168); machine(250, 112, false, color);
    ctx.fillStyle = ready ? warm : dim; ctx.font = 'bold 60px monospace'; ctx.fillText('▼', 410, 172);
    ctx.font = 'bold 36px monospace'; ctx.fillStyle = ready ? warm : dim;
    ctx.fillText(ready ? 'Q  QUIET' : (r?.cells ?? 0) === 0 ? 'NO CELLS LEFT' : `RECHARGING ${Math.ceil(r?.cooldown ?? 0)}s`, 28, 268);
    ctx.font = '26px monospace'; ctx.fillStyle = ready ? lit : dim;
    ctx.fillText(ready ? 'silences the machines' : (r?.cells ?? 0) === 0 ? 'finish a stage to recharge' : 'one press per cell', 28, 312);
    if (ready) ctx.fillText('exposure drops', 28, 346);
  } else {
    ctx.fillStyle = lit; ctx.font = 'bold 34px monospace'; ctx.fillText(state.power === 'quiet' ? 'MACHINES SILENT' : 'POWER LOST', 28, 58);
    if (state.power === 'quiet') { machine(34, 92, false, lit); ctx.fillStyle = warm; ctx.font = 'bold 30px monospace'; ctx.fillText('noise cooling ▼', 170, 140); }
    const ready = !!r?.restoreReady;
    ctx.font = 'bold 34px monospace'; ctx.fillStyle = ready ? lit : dim; ctx.fillText(ready ? 'F  HOLD TO RESTORE' : 'LISTEN · WAIT', 28, 262);
    ctx.font = '26px monospace'; ctx.fillStyle = dim;
    if (state.power === 'quiet') ctx.fillText(`auto restore in ${Math.ceil(r?.autoRestore ?? 0)}s`, 28, 306);
    if ((r?.restoreHold ?? 0) > 0) { ctx.fillStyle = '#1c2a19'; ctx.fillRect(28, 326, 456, 14); ctx.fillStyle = lit; ctx.fillRect(28, 326, 456 * Math.min(1, r!.restoreHold), 14); }
  }
  wornGlass(display, 512, 384); display.texture.needsUpdate = true;
}
const needles = new WeakMap<Display, number>();
export function drawStatus(display: Display, state: RenderState): void {
  const ctx = display.context, s = state.survival, powered = state.power === 'on';
  // The needle sweeps toward the live exposure rather than jumping, and drops to rest without power.
  const target = powered ? Math.max(0, Math.min(1, (s?.exposure ?? 0) / 100)) : 0, last = needles.get(display) ?? target;
  const needle = state.paused ? last : last + (target - last) * .3; needles.set(display, needle);
  ctx.fillStyle = '#0c0e0a'; ctx.fillRect(0, 0, 640, 800);
  // LED clock window.
  ctx.fillStyle = '#050201'; ctx.fillRect(24, 24, 592, 252); ctx.strokeStyle = '#2b2a20'; ctx.lineWidth = 4; ctx.strokeRect(24, 24, 592, 252);
  const left = s?.secondsLeft ?? null, urgent = left !== null && left <= 60;
  const digits = left === null ? null : `${Math.floor(left / 60) % 100}`.padStart(2, '0') + `${left % 60}`.padStart(2, '0');
  const on = urgent ? '#ff3b1c' : '#f0642a', off = '#26100a', size = 88;
  [62, 190, 362, 490].forEach((x, i) => sevenSegment(ctx, x, 62, size, digits ? DIGITS[Number(digits[i])]! : 'g', on, off));
  const colon = !digits || state.paused || Math.floor(state.time * (urgent ? 2 : 1)) % 2 === 0;
  ctx.fillStyle = colon ? on : off; for (const y of [118, 182]) { ctx.beginPath(); ctx.arc(320, y, 11, 0, Math.PI * 2); ctx.fill(); }
  // Battery cells.
  const cells = s?.maxCells ?? 3;
  for (let i = 0; i < cells; i++) {
    const x = 52 + i * 192, charged = i < (s?.cells ?? 0);
    ctx.fillStyle = '#2b2d23'; ctx.fillRect(x + 50, 312, 46, 20);
    ctx.strokeStyle = charged ? '#a9c06c' : '#3a3d30'; ctx.lineWidth = 7; ctx.strokeRect(x, 332, 146, 186);
    if (charged) { ctx.fillStyle = '#93ad5a'; for (let bar = 0; bar < 3; bar++) ctx.fillRect(x + 16, 347 + bar * 57, 114, 43); }
  }
  // Exposure needle gauge.
  const cx = 320, cy = 770, r = 190;
  ctx.lineWidth = 22; ctx.lineCap = 'butt';
  // Below ~20 the creature drifts away; above it closes in, faster toward the red end (see lineBias).
  for (const [from, to, live, dark] of [[0, .2, '#3b3d2f', '#17180f'], [.2, .7, '#8a6326', '#1d160b'], [.7, 1, '#8f2a16', '#1d0e09']] as const) {
    ctx.strokeStyle = powered ? live : dark; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * (1 + from), Math.PI * (1 + to)); ctx.stroke();
  }
  ctx.strokeStyle = powered ? '#77755c' : '#1d1e15'; ctx.lineWidth = 4;
  for (let tick = 0; tick <= 10; tick++) { const a = Math.PI * (1 + tick / 10), inner = r - (tick % 5 ? 46 : 62); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30)); ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner); ctx.stroke(); }
  if (powered) {
    const share = needle, a = Math.PI * (1 + share);
    ctx.strokeStyle = share >= .7 ? '#ff6a3a' : '#e7d6a6'; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20)); ctx.stroke();
  }
  ctx.fillStyle = '#4a4a3a'; ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fill();
  wornGlass(display, 640, 800); display.texture.needsUpdate = true;
}
/** Grime baked once per display: specks, scratches, smudges and a burnt-in ring. Deterministic. */
const grimes = new WeakMap<Display, HTMLCanvasElement>();
function sonarGrime(display: Display): HTMLCanvasElement {
  const cached = grimes.get(display); if (cached) return cached;
  const { width: W, height: H } = display.canvas, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!; let seed = 4127; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9; i++) { const x = rnd() * W, y = rnd() * H, r = 40 + rnd() * 160, g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(70,60,40,${.18 + rnd() * .18})`); g.addColorStop(1, 'rgba(70,60,40,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${rnd() < .5 ? '0,0,0' : '160,170,140'},${.15 + rnd() * .35})`; ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); }
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i++) { const x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI, l = 20 + rnd() * 160; ctx.strokeStyle = `rgba(190,200,170,${.05 + rnd() * .12})`; ctx.lineWidth = .6 + rnd(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(90,150,90,.07)'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(W / 2 + 6, H / 2 - 4, H * .3, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,.32)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  grimes.set(display, canvas); return canvas;
}
/** Security monitor as a worn submarine sonar: a phosphor scope, a sweep with afterglow, a contact
 * that flares as the sweep passes the last ping and then fades, and only the four marking rings.
 * It shows the sampled reading (never the hidden current position) and goes dark without power. */
export function drawSonar(display: Display, state: RenderState): void {
  const ctx = display.context, W = display.canvas.width, H = display.canvas.height, on = state.power === 'on', length = 24;
  ctx.fillStyle = '#020403'; ctx.fillRect(0, 0, W, H);
  if (on) {
    const cx = W / 2, cy = H / 2, R = H * .44, sweep = (state.time % 4) / 4 * Math.PI * 2, toCanvas = (bearing: number) => bearing - Math.PI / 2;
    const glass = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); glass.addColorStop(0, '#0d2214'); glass.addColorStop(1, '#030805');
    ctx.fillStyle = glass; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,120,.16)'; ctx.lineWidth = 2;
    for (const edge of [7, 14, 22]) { ctx.beginPath(); ctx.arc(cx, cy, edge / length * R, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(120,190,120,.07)'; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.strokeStyle = 'rgba(130,200,130,.32)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    // Ring numbers match the marking keys 1–4 (near the wall → farthest out).
    ctx.fillStyle = 'rgba(150,210,150,.34)'; ctx.font = '22px monospace'; ctx.textAlign = 'center';
    [[0, 7], [7, 14], [14, 22], [22, 24]].forEach(([inner, outer], i) => ctx.fillText(String(i + 1), cx, cy - (inner + outer) / 2 / length * R + 8));
    for (let k = 0; k < 24; k++) { const a = toCanvas(sweep) - k * .035; ctx.fillStyle = `rgba(140,225,140,${.16 * (1 - k / 24) ** 2})`; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - .035, a); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = 'rgba(170,240,170,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(toCanvas(sweep)) * R, cy + Math.sin(toCanvas(sweep)) * R); ctx.stroke();
    const sampled = state.blind ? null : state.creature.sensorDistance;
    if (state.blind) { ctx.fillStyle = 'rgba(190,220,170,.75)'; ctx.font = '26px monospace'; ctx.fillText('READING SENT', cx, cy - 14); ctx.fillText('ASK YOUR FRIEND', cx, cy + 22); }
    if (typeof sampled === 'number' && Number.isFinite(sampled)) {
      const bearing = state.creature.sensorBearing ?? 0, behind = ((sweep - bearing) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2), glow = Math.exp(-behind / (Math.PI * 2) * 4 / 1.7);
      const r = sampled / length * R, x = cx + Math.sin(bearing) * r, y = cy - Math.cos(bearing) * r, blob = ctx.createRadialGradient(x, y, 0, x, y, 30);
      blob.addColorStop(0, `rgba(210,255,190,${.85 * glow})`); blob.addColorStop(.35, `rgba(120,220,120,${.45 * glow})`); blob.addColorStop(1, 'rgba(120,220,120,0)');
      ctx.fillStyle = blob; ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = on ? .6 : .35; ctx.drawImage(sonarGrime(display), 0, 0); ctx.globalAlpha = 1;
  // Unsteady tube: a faint, irregular dimming.
  if (on) { const flicker = Math.sin(state.time * 31) * Math.sin(state.time * 7.3); if (flicker > .6) { ctx.fillStyle = `rgba(0,0,0,${(flicker - .6) * .5})`; ctx.fillRect(0, 0, W, H); } }
  wornGlass(display, W, H); display.texture.needsUpdate = true;
}
export function drawCameraOverlay(display: Display, state: RenderState, corruption = 0, reducedMotion = false): void {
  const feed = state.cameraFeed ?? 'A', on = state.power === 'on', ctx = display.context;
  ctx.clearRect(0, 0, 1024, 576);
  ctx.fillStyle = 'rgba(7,6,3,.20)'; ctx.fillRect(0, 0, 1024, 576);
  ctx.fillStyle = 'rgba(0,15,8,.48)'; ctx.fillRect(0, 0, 1024, 69); ctx.fillRect(0, 529, 1024, 47);
  ctx.fillStyle = on ? '#d1dbc2' : '#566a52'; ctx.font = 'bold 28px monospace'; ctx.fillText(`SECURITY FEED ${feed} / ${feed === 'A' ? 'CLEARING' : feed === 'B' ? 'SERVICE PATH' : 'FACILITY'}`, 25, 45);
  ctx.font = '19px monospace'; ctx.fillText('FICTIONAL FACILITY CAMERA   ·   LIMITED COVERAGE', 25, 559);
  if (corruption > 0 && on) {
    ctx.fillStyle = `rgba(1,3,2,${corruption * .85})`; ctx.fillRect(0, 69, 1024, 460);
    const tick = reducedMotion ? 0 : Math.floor(state.time * 14);
    for (let stripe = 0; stripe < (reducedMotion ? 3 : 19); stripe++) {
      const y = 76 + ((stripe * 83 + tick * 37) % 445), length = 100 + ((stripe * 197 + tick * 53) % 900);
      ctx.fillStyle = `rgba(${stripe % 4 ? '98,105,71' : '109,43,25'},${corruption * .36})`; ctx.fillRect((stripe * 67) % 110, y, length, stripe % 3 + 1);
    }
  }
  wornGlass(display, 1024, 576); display.texture.needsUpdate = true;
}
