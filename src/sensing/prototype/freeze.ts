import { GRID_HEIGHT, GRID_WIDTH, MotionMeter, lumaFromRgba } from '../motion';

const FREEZE_MS = 6000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video'), fill = $('fill'), state = $('state'), detail = $('detail'), verdict = $('verdict');
const start = $<HTMLButtonElement>('start'), wall = $<HTMLButtonElement>('wall'), stop = $<HTMLButtonElement>('stop');
const grid = document.createElement('canvas'); grid.width = GRID_WIDTH; grid.height = GRID_HEIGHT;
const ctx = grid.getContext('2d', { willReadFrequently: true })!;
const meter = new MotionMeter();
let stream: MediaStream | null = null, timer: ReturnType<typeof setInterval> | null = null, freezeUntil = 0, heard = false;

start.onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
    video.srcObject = stream; await video.play();
    meter.reset(); timer = setInterval(sample, 100);
    start.disabled = true; wall.disabled = false; stop.disabled = false; verdict.textContent = '';
  } catch { state.textContent = 'Camera unavailable or declined'; }
};
stop.onclick = () => {
  if (timer) clearInterval(timer); timer = null;
  stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
  start.disabled = false; wall.disabled = true; stop.disabled = true; freezeUntil = 0;
  state.textContent = 'Camera off'; detail.textContent = 'motion energy —'; fill.style.width = '0';
};
wall.onclick = () => { freezeUntil = performance.now() + FREEZE_MS; heard = false; verdict.className = 'verdict'; verdict.textContent = 'Footsteps stop outside the wall. Hold still…'; };

function sample(): void {
  if (video.readyState < 2) return;
  ctx.drawImage(video, 0, 0, GRID_WIDTH, GRID_HEIGHT);
  const now = performance.now();
  const reading = meter.push(lumaFromRgba(ctx.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT).data), now);
  if (!reading.ready) return;
  fill.style.width = `${Math.round(reading.energy * 100)}%`;
  fill.style.background = reading.still ? 'var(--ok)' : 'var(--red)';
  state.textContent = reading.still ? `STILL · ${(reading.stillForMs / 1000).toFixed(1)} s` : 'MOVING';
  detail.textContent = `motion energy ${reading.energy.toFixed(3)}`;
  if (!freezeUntil) return;
  if (!reading.still && !heard) { heard = true; verdict.className = 'verdict heard'; verdict.textContent = 'It heard you move. The wall shudders.'; }
  if (now >= freezeUntil) { freezeUntil = 0; if (!heard) { verdict.className = 'verdict safe'; verdict.textContent = 'The footsteps drift away. You held still.'; } }
}
