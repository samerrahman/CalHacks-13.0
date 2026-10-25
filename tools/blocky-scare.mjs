// Generates public/assets/scares/breach-creature-blocky.svg: the breach jump-scare face as
// 96×64 blocks (16 px each, 1536×1024), matching the game's blocky look. Deterministic.
// Layout follows src/ui/jumpscare.css: the upper face sits above 56%, the jaw layer below 52%
// (the mouth opens at row 31), and the eye glints sit over the two socket centres.
import { writeFile } from 'node:fs/promises';

const W = 96, H = 64, S = 16, cells = new Map();
let seed = 1307;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const put = (x, y, color) => { if (x >= 0 && x < W && y >= 0 && y < H) cells.set(`${x},${y}`, color); };
const fill = (x0, y0, x1, y1, pick) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, typeof pick === 'function' ? pick(x, y) : pick); };
// Rotten skin: dark blocks with vertical streaks and a few raw red ones.
const skin = (x, y) => { const r = random(), streak = (x * 7) % 5 === 0 ? .2 : 0; return r < .16 + streak ? '#160e0b' : r < .5 ? '#2c1f18' : r < .8 ? '#3b2a20' : r < .94 ? '#4d3628' : '#6a1d12'; };

// Dark red haze behind the head.
fill(0, 0, W, H, (x, y) => { const d = Math.hypot((x - 48) / 48, (y - 30) / 36), r = random(); return d > .95 ? '#020101' : r < .5 - d * .4 ? '#1a0604' : r < .8 ? '#0d0303' : '#050202'; });
// Head silhouette: tapered skull, wide cheeks, narrow chin.
const width = y => y < 3 ? 18 : y < 7 ? 22 : y < 34 ? 26 : y < 50 ? 25 - (y - 34) * .2 : 21 - (y - 50) * .5;
for (let y = 0; y < H; y++) { const half = Math.round(width(y)); fill(48 - half, y, 48 + half, y + 1, skin); }
// Brow ridge, angled down toward the nose.
for (let x = 26; x < 70; x++) { const drop = Math.round(Math.abs(x - 48) < 6 ? 2 : (14 - Math.abs(x - 48) / 2) / 4); fill(x, 10 + drop, x + 1, 13 + drop, () => (random() < .5 ? '#22170f' : '#2b1d15')); }
// Angry sockets: deeper toward the nose. Small, hot eyes with a red glow.
for (const [cx, side] of [[35, 1], [61, -1]]) {
  for (let x = cx - 7; x < cx + 8; x++) { const t = (x - cx) * side; fill(x, 15 + Math.max(0, Math.round(t / 3)), x + 1, 24, () => (random() < .75 ? '#030201' : '#0b0604')); }
  fill(cx - 2, 18, cx + 4, 22, () => (random() < .5 ? '#4a0d06' : '#2e0804')); fill(cx - 1, 19, cx + 3, 21, '#b0301a'); fill(cx, 19, cx + 2, 21, '#ff7a32'); put(cx, 19, '#fff0d0');
}
// Nose slits and cracks.
fill(45, 25, 47, 29, '#0a0604'); fill(50, 25, 52, 29, '#0a0604');
for (const [x, y, len, dir] of [[30, 4, 8, 1], [63, 6, 7, -1], [27, 26, 6, 1], [68, 25, 6, -1], [40, 2, 5, 1]]) for (let i = 0; i < len; i++) put(x + Math.round(i * dir * .5), y + i, '#5e170c');
// Mouth: black maw, red throat, and splits running up from the corners.
fill(28, 31, 68, 56, (x, y) => { const r = random(), throat = Math.hypot((x - 48) / 11, (y - 45) / 7); return throat < 1 ? (r < .5 ? '#3a0905' : '#250504') : r < .85 ? '#040101' : '#120303'; });
for (let i = 0; i < 7; i++) { put(27 - Math.floor(i / 2), 31 - i, '#060202'); put(26 - Math.floor(i / 2), 31 - i, '#4a0d06'); put(68 + Math.floor(i / 2), 31 - i, '#060202'); put(69 + Math.floor(i / 2), 31 - i, '#4a0d06'); }
// Pointed fangs: two blocks wide, narrowing to a one-block tip; the canines are longest.
const tooth = (x, from, len, dir) => { for (let i = 0; i < len; i++) { const y = from + i * dir, tip = i >= len - 2; for (let dx = 0; dx < (tip ? 1 : 2); dx++) put(x + dx, y, i === 0 ? '#7d6f55' : random() < .25 ? '#9c8d6c' : random() < .15 ? '#5e170c' : '#d2c4a0'); } };
for (let x = 29; x < 66; x += 3) tooth(x, 31, Math.abs(x - 35) < 2 || Math.abs(x - 59) < 2 ? 9 : 3 + Math.floor(random() * 4), 1);
for (let x = 30; x < 66; x += 3) tooth(x, 55, Math.abs(x - 39) < 2 || Math.abs(x - 57) < 2 ? 8 : 3 + Math.floor(random() * 3), -1);
// Blood drips from the upper lip.
for (const x of [32, 38, 44, 51, 56, 63]) { const len = 4 + Math.floor(random() * 8); fill(x, 29, x + 1, 29 + len, (tx, ty) => (ty > 29 + len - 3 ? '#4a0906' : '#7a120a')); }
for (const [x, y] of [[24, 40], [70, 44], [30, 58], [64, 60]]) fill(x, y, x + 1, y + 4 + Math.floor(random() * 4), '#5a0d08');

let body = '';
for (const [key, color] of cells) { const [x, y] = key.split(',').map(Number); body += `<rect x="${x * S}" y="${y * S}" width="${S}" height="${S}" fill="${color}"/>`; }
await writeFile(new URL('../public/assets/scares/breach-creature-blocky.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" viewBox="0 0 ${W * S} ${H * S}" shape-rendering="crispEdges">${body}</svg>\n`);
