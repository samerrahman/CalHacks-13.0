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
function wornGlass(display: Display, width: number, height: number) {
  const ctx = display.context;
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
export function drawTerminal(display: Display, state: RenderState): void {
  const on = state.power === 'on', ctx = display.context;
  ctx.fillStyle = on ? '#14170d' : '#030403'; ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = on ? '#aca77e' : '#33362a'; ctx.font = '26px monospace'; ctx.fillText('SHELTER 04 / RESEARCH TERMINAL', 42, 51);
  ctx.strokeStyle = '#3a5940'; ctx.strokeRect(23, 23, 978, 466);
  ctx.font = 'bold 43px monospace'; ctx.fillStyle = '#a2c18b';
  if (!on) {
    ctx.fillText(state.power === 'quiet' ? 'EMERGENCY QUIET' : 'POWER INTERRUPTED', 48, 205);
    ctx.font = '30px monospace'; ctx.fillStyle = '#5d6e56'; ctx.fillText('PROGRESS PRESERVED', 48, 278);
  } else if (state.stage === 1 || state.stage === 3) {
    ctx.fillText(state.stage === 1 ? 'SILENCE THE FAULTS' : 'REPAIR THE OVERLOAD', 45, 120);
    for (let i = 0; i < 4; i++) {
      const active = state.faults.includes(i), x = 48 + i * 240;
      ctx.fillStyle = active ? '#b18b4c' : '#153425'; ctx.fillRect(x, 175, 211, 205);
      ctx.strokeStyle = active ? '#eac58a' : '#476b47'; ctx.lineWidth = active ? 7 : 2; ctx.strokeRect(x, 175, 211, 205);
      ctx.fillStyle = active ? '#172019' : '#8baf82'; ctx.font = 'bold 78px monospace'; ctx.fillText(String(i + 1), x + 78, 273);
      ctx.font = '25px monospace'; ctx.fillText(active ? 'FAULT' : 'QUIET', x + 68, 333);
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
    ctx.fillText(state.status === 'won' ? 'CONTAINMENT SECURED' : 'FINAL BROADCAST', 48, 225);
    ctx.font = '29px monospace'; ctx.fillText(state.status === 'won' ? 'RESEARCH ARCHIVED / SURVIVED' : 'ALL FOUR STAGES COMPLETE', 48, 300);
  }
  wornGlass(display, 1024, 512); display.texture.needsUpdate = true;
}
export function drawProximity(display: Display, state: RenderState): void {
  const on = state.power === 'on', ctx = display.context;
  ctx.fillStyle = '#0b0d07'; ctx.fillRect(0, 0, 512, 384); ctx.textAlign = 'center';
  if (!on) { display.texture.needsUpdate = true; return; }
  ctx.fillStyle = '#b0a97c'; ctx.font = '25px monospace'; ctx.fillText('PROXIMITY', 256, 57);
  const sampled = state.creature.sensorDistance;
  ctx.font = 'bold 104px monospace'; ctx.fillText(typeof sampled === 'number' && Number.isFinite(sampled) ? `${sampled}` : '—', 256, 202);
  ctx.font = '24px monospace'; ctx.fillText('LINE UNITS / LAST SAMPLE', 256, 252);
  ctx.fillStyle = '#6c704e'; ctx.font = '23px monospace';
  ctx.fillText('SAMPLE INTERVAL 4 SECONDS', 256, 325);
  wornGlass(display, 512, 384); display.texture.needsUpdate = true;
}
export function drawCameraOverlay(display: Display, state: RenderState, corruption = 0, reducedMotion = false): void {
  const feed = state.cameraFeed ?? 'A', on = state.power === 'on', ctx = display.context;
  ctx.clearRect(0, 0, 1024, 576);
  ctx.fillStyle = 'rgba(7,6,3,.20)'; ctx.fillRect(0, 0, 1024, 576);
  ctx.fillStyle = 'rgba(0,15,8,.48)'; ctx.fillRect(0, 0, 1024, 69); ctx.fillRect(0, 529, 1024, 47);
  ctx.fillStyle = on ? '#d1dbc2' : '#566a52'; ctx.font = 'bold 28px monospace'; ctx.fillText(`SECURITY FEED ${feed} / ${feed === 'A' ? 'CLEARING' : feed === 'B' ? 'SERVICE PATH' : 'CONTAINMENT'}`, 25, 45);
  ctx.font = '19px monospace'; ctx.fillText('FICTIONAL FACILITY CAMERA   ·   LIMITED COVERAGE', 25, 559);
  // The supplied offline plate already contains its centered status label.
  if (state.status === 'won' && feed === 'C' && on) { ctx.fillStyle = '#ccd6ad'; ctx.font = '32px monospace'; ctx.fillText('CONTAINMENT SEALED', 313, 475); }
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
