// Offline opening-cutscene tool. Renders deterministically (fixed timestep, no clocks or
// Math.random) in headless Chrome, so the shipped MP4 is identical on every playback.
//
//   node tools/cutscene.mjs prop <name> [out.png]        contact sheet of a procedural prop
//   node tools/cutscene.mjs nodes <name>                 node tree (names, pivots) of a procedural prop
//   node tools/cutscene.mjs models [--force] [names…]    export procedural props to cutscene/models/*.glb
//   node tools/cutscene.mjs stills <t…> [--procedural]   PNG keyframes into cutscene/.previews/
//   node tools/cutscene.mjs render [--procedural] [--scale=0.5] [--seconds=n] [--out=path]
//   (stills and render take --look=flat for the original flat colours; the default is ironlung)
//   node tools/cutscene.mjs audio [--out=path]           soundtrack only → cutscene/.previews/soundtrack.wav
//
// `render` writes public/assets/video/opening.mp4 and refreshes its manifest entry.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const previews = path.join(root, 'cutscene/.previews');
const [command, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const args = rest.filter(a => !a.startsWith('--'));

async function withPage(fn) {
  const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 5199, strictPort: false } });
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${server.resolvedUrls.local[0]}cutscene/index.html`);
    await page.waitForFunction(() => window.__cutscene, null, { timeout: 30_000 });
    const result = await fn(page);
    if (errors.length) console.warn(`page errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
    return result;
  } finally { await browser.close(); await server.close(); }
}
const decode = dataUrl => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

async function propCommand() {
  const [name, out = path.join(previews, `${name}.png`)] = args;
  if (!name) throw new Error('usage: prop <name> [out.png]');
  await mkdir(path.dirname(out), { recursive: true });
  await withPage(async page => writeFile(out, decode(await page.evaluate(n => window.__cutscene.propSheet(n, true), name))));
  console.log(out);
}

async function nodesCommand() {
  const [name] = args;
  if (!name) throw new Error('usage: nodes <name>');
  console.log(await withPage(page => page.evaluate(n => window.__cutscene.propNodes(n), name)));
}

async function modelsCommand() {
  const dir = path.join(root, 'cutscene/models');
  await mkdir(dir, { recursive: true });
  await withPage(async page => {
    const names = args.length ? args : await page.evaluate(() => window.__cutscene.names);
    for (const name of names) {
      const file = path.join(dir, `${name}.glb`);
      if (existsSync(file) && !flags.force) { console.log(`keep ${path.relative(root, file)} (replaced or already exported; --force to regenerate)`); continue; }
      await writeFile(file, Buffer.from(await page.evaluate(n => window.__cutscene.exportGlb(n), name), 'base64'));
      console.log(`wrote ${path.relative(root, file)} (${(await stat(file)).size} bytes)`);
    }
  });
}

async function stillsCommand() {
  const times = args.map(Number).filter(Number.isFinite);
  const out = flags.out ?? previews;
  await mkdir(out, { recursive: true });
  await withPage(async page => {
    const info = await page.evaluate(o => window.__cutscene.init(o), { procedural: !!flags.procedural, scale: Number(flags.scale ?? 0.5), look: flags.look });
    console.log(`gpu: ${info.gpu}`);
    for (const t of times) {
      const file = path.join(out, `still-${t.toFixed(2).padStart(5, '0')}s.png`);
      await writeFile(file, decode(await page.evaluate(x => window.__cutscene.still(x), t)));
      console.log(file);
    }
  });
}

/** Piecewise-linear envelope [[t, v], …] as an ffmpeg expression in t (absolute seconds). */
function envelope(keys) {
  let expr = String(keys[keys.length - 1][1]);
  for (let i = keys.length - 1; i > 0; i--) {
    const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
    expr = `if(lt(t,${t1}),${v0}+(${v1 - v0})*(t-${t0})/${t1 - t0},${expr})`;
  }
  return `if(lt(t,${keys[0][0]}),${keys[0][1]},${expr})`;
}

/** Generated layers (timeline SYNTH) as lavfi sources + filter chains. Deterministic: seeded
 * noise (anoisesrc seeds, aevalsrc random()), and footsteps on the same t = k / STEP_RATE grid
 * as the camera's footfalls. Every source is mono; audioMix makes it stereo. Nothing here is a
 * gliding pure tone: creaks, scrapes and the growl are irregular pulse trains and noise through
 * resonances. aevalsrc keeps st()/ld() variables between samples, which the stateful pieces use. */
function synthSources(layers, duration, stepRate) {
  const D = duration, P = 1 / stepRate, SR = 48000, out = [];
  const src = (lavfi, chain) => out.push({ lavfi, chain });
  const ev = expr => `aevalsrc=exprs='${expr}':s=${SR}:d=${D}`;
  const noise = (color, seed, amp = 0.6) => `anoisesrc=d=${D}:c=${color}:r=${SR}:a=${amp}:s=${seed}`;
  // Resonant body (metal, wood): boosts at the given mode frequencies, of width q.
  const modes = (fs, q, g) => fs.map((f, i) => `equalizer=f=${f}:t=q:w=${q}:g=${g - i * 2}`).join(',');
  // Irregular stick-slip pulse train at `rate` Hz (each period re-randomised ±50%); returns a
  // short noise grain per tick. Uses variables 0 (phase), 2 (time since tick), 4/5 (seeds), 6 (jitter).
  const ticks = (rate, grain) => `st(0,ld(0)+(${rate})*(0.5+ld(6))/${SR});st(2,ld(2)+1/${SR});if(gte(ld(0),1),st(0,ld(0)-1)+st(2,0)+st(6,random(4)));exp(-ld(2)*${grain})*(2*random(5)-1)`;
  // Event window [a, a + d] with a soft rise and fall. Fractional powers only ever see max(0, …):
  // rounding can push a base just below zero, and one NaN sample poisons every later filter.
  const win = (a, d, rise = 0.05, fall = 0.25) => `min(1,(t-${a})/${rise})*max(0,min(1,(${a + d}-t)/${fall}))`;
  const during = (a, d, body) => `if(between(t,${a},${a + d}),${body},0)`;
  let seed = 100;
  for (const layer of layers) {
    const gain = layer.gain ? envelope(layer.gain) : null, vol = `volume='${gain}':eval=frame`;
    const a = layer.at, d = layer.dur, tau = `(t-${a})`;
    switch (layer.kind) {
      case 'steps':
        if (layer.surface === 'hard') src(ev(`exp(-mod(t,${P})*26)*(0.9*sin(2*PI*62*t)+0.35*sin(2*PI*131*t))+0.35*exp(-mod(t,${P})*90)*(2*random(0)-1)`), `highpass=f=40,${vol}`);
        else src(ev(`exp(-mod(t,${P})*22)*0.8*sin(2*PI*48*t)+0.45*exp(-mod(t,${P})*35)*(2*random(0)-1)`), `lowpass=f=1800,${vol}`);
        break;
      case 'gallop': // something heavy running at you: fast, uneven, wet thumps
        src(ev(`exp(-mod(t,0.23)*18)*sin(2*PI*38*t)+0.6*exp(-mod(t+0.09,0.23)*22)*sin(2*PI*52*t)`), `lowpass=f=300,${vol}`);
        src(ev(`(exp(-mod(t,0.23)*30)+0.7*exp(-mod(t+0.09,0.23)*34))*(2*random(0)-1)`), `bandpass=f=420:width_type=h:w=500,volume='0.8*(${gain})':eval=frame`);
        break;
      case 'breath':
        src(noise('pink', 7), `bandpass=f=1300:width_type=h:w=1400,volume='(${gain})*pow(max(0,0.5-0.5*cos(2*PI*${layer.rate}*t)),1.6)':eval=frame`);
        break;
      case 'heartbeat': { // lub-dub, saturated so its harmonics carry on small speakers
        const rate = envelope(layer.rate);
        src(ev(`st(3,${rate});st(0,ld(0)+ld(3)/${SR});if(gte(ld(0),1),st(0,ld(0)-1));st(1,ld(0)/ld(3));st(7,ld(1)-min(0.3,0.42/ld(3)));`
          + `tanh(2.4*(exp(-ld(1)*12)*sin(2*PI*48*ld(1))+0.4*exp(-ld(1)*45)*sin(2*PI*96*ld(1))+gte(ld(7),0)*(0.8*exp(-ld(7)*15)*sin(2*PI*58*ld(7))+0.3*exp(-ld(7)*50)*sin(2*PI*112*ld(7)))))`),
          `highpass=f=25,equalizer=f=120:t=q:w=1.2:g=5,lowpass=f=700,${vol}`);
        break;
      }
      case 'drone':
        src(ev('0.5*sin(2*PI*41*t)+0.35*sin(2*PI*55.2*t+2*sin(2*PI*0.11*t))+0.2*sin(2*PI*82.7*t)'), vol);
        src(noise('brown', 11, 0.8), `lowpass=f=160,volume='0.7*(${gain})':eval=frame`);
        break;
      case 'hum': // mains hum and a faint fluorescent fizz
        src(ev('0.3*sin(2*PI*50*t)+0.18*sin(2*PI*100*t)+0.1*sin(2*PI*150*t)+0.05*sin(2*PI*200*t)'), vol);
        src(noise('white', 12, 0.3), `bandpass=f=3000:width_type=h:w=1500,volume='0.08*(${gain})':eval=frame`);
        break;
      case 'alarm': // a low, distorted industrial horn: two detuned saws an octave over a sub, pulsing
        src(ev(`st(0,mod(t,1.7));clip(ld(0)/0.12,0,1)*clip((1.25-ld(0))/0.2,0,1)*0.3*tanh(2*((2*mod(98*t,1)-1)+0.8*(2*mod(103.8*t,1)-1)+0.6*(2*mod(49*t,1)-1)))`),
          `lowpass=f=1000,aecho=0.6:0.45:90|170:0.35|0.2,${vol}`);
        break;
      case 'buzz': // a failing light: flickering 120 Hz buzz
        src(ev('0.3*sgn(sin(2*PI*120*t))*gt(sin(2*PI*17*t)*sin(2*PI*7.3*t),0)'), `lowpass=f=3000,${vol}`);
        break;
      case 'rain': src(noise('white', 13, 0.5), `highpass=f=2500,lowpass=f=9000,${vol}`); break;
      case 'rain_muffled': src(noise('white', 14), `lowpass=f=500,${vol}`); break;
      case 'wind': src(noise('brown', 17, 0.7), `bandpass=f=420:width_type=h:w=500,volume='(${gain})*(0.65+0.35*sin(2*PI*0.21*t))':eval=frame`); break;
      case 'riser': // dread swell: a beating low cluster and rumble, no pitch glide
        src(ev('tanh(1.8*(0.3*sin(2*PI*41*t)+0.3*sin(2*PI*43.6*t)+0.22*sin(2*PI*61.8*t)+0.15*sin(2*PI*92.5*t+3*sin(2*PI*0.7*t))))*(0.75+0.25*sin(2*PI*5.5*t))'), vol);
        src(noise('brown', 19, 0.8), `lowpass=f=220,volume='0.8*(${gain})':eval=frame`);
        break;
      case 'hit': { // sub-bass drop + metallic ring + crack
        const ring = layer.ring.map((f, i) => `${(0.5 / (i + 1)).toFixed(3)}*sin(2*PI*${f}*${tau})`).join('+');
        src(ev(`if(gte(t,${a}),exp(-${tau}*2.8)*sin(2*PI*(34*${tau}+5*(1-exp(-${tau}*9))))+exp(-${tau}*${layer.decay})*(${ring})+${layer.crack}*exp(-${tau}*28)*(2*random(0)-1),0)`), `volume=${layer.level}`);
        break;
      }
      case 'creak': { // stick-slip groan of a hinge or stressed metal: irregular ticks through resonances
        const [r0, r1] = layer.rate;
        src(ev(during(a, d, `${win(a, d, 0.04, d / 3)}*(${ticks(`(${r0}+${r1 - r0}*${tau}/${d})`, 700)})`)), `highpass=f=60,${modes(layer.modes, 9, 16)},lowpass=f=6000,volume=${layer.level * 3}`);
        break;
      }
      case 'scrape': // claws dragged on metal: chattering grit plus hiss through bright resonances
        src(ev(during(a, d, `${win(a, d, 0.03, d / 3)}*((${ticks(layer.chatter, 150)})+0.25*(2*random(7)-1))`)), `highpass=f=900,${modes(layer.modes, 3, 7)},lowpass=f=6000,volume=${layer.level * 2}`) // broad modes: grit, never a whistle);
        break;
      case 'growl': // throat: a jittery ~50 Hz glottal pulse, rasp riding on it, flutter, saturation
        src(ev(during(a, d, `st(0,ld(0)+${layer.pitch}*(0.85+0.3*ld(6))/${SR});st(2,ld(2)+1/${SR});if(gte(ld(0),1),st(0,ld(0)-1)+st(2,0)+st(6,random(4)));st(3,exp(-ld(2)*350));`
          + `${win(a, d, 0.15, 0.5)}*tanh(2.6*(ld(3)+(2*random(5)-1)*(0.18+0.55*ld(3)))*(0.55+0.45*sin(2*PI*7.5*t)*sin(2*PI*2.3*t+1)))`)),
          `highpass=f=40,lowpass=f=1600,equalizer=f=160:t=q:w=1.5:g=6,equalizer=f=480:t=q:w=2.5:g=9,equalizer=f=1000:t=q:w=3:g=5,volume=${layer.level}`);
        break;
      case 'crunch': // metal buckling: a dense crackle that thins out
        src(ev(during(a, d, `exp(-${tau}*5)*(3*if(gt(random(4),0.985-0.01*exp(-${tau}*8)),2*random(5)-1,0)+0.3*exp(-${tau}*12)*(2*random(7)-1))`)), `highpass=f=200,equalizer=f=400:t=q:w=1:g=6,lowpass=f=5000,volume=${layer.level}`);
        break;
      case 'hiss': // steam
        src(noise('white', seed++), `highpass=f=2000,lowpass=f=8000,volume='if(between(t,${a},${a + d}),${layer.level}*min(1,${tau}/0.05)*exp(-${tau}*${(2.2 / d).toFixed(3)}),0)':eval=frame`);
        break;
      case 'click': // a mechanical latch or switch: two quick transients, no tone
        src(ev(`if(between(t,${a},${a + 0.03}),(2*random(0)-1)*(exp(-${tau}*400)+0.7*gte(${tau},0.011)*exp(-(${tau}-0.011)*400)),0)`), `highpass=f=300,lowpass=f=7000,volume=${layer.level}`);
        break;
      default: throw new Error(`unknown synth layer ${layer.kind}`);
    }
  }
  return out;
}

function audioMix(cues, layers, duration, stepRate, firstInput = 1) {
  const inputs = [], filters = [], labels = [];
  let n = firstInput; // in a render, input 0 is the video pipe
  cues.forEach(cue => {
    const length = cue.until ? cue.until - cue.at : null;
    if (length && !cue.loop) inputs.push('-stream_loop', '-1');
    inputs.push('-i', path.join(root, 'public/assets/audio', `${cue.file}.wav`));
    const chain = [`aformat=sample_rates=48000:channel_layouts=stereo`];
    if (cue.rate) chain.push(`asetrate=${Math.round(48000 * cue.rate)}`, 'aresample=48000');
    // Files that aren't clean loops repeat a trimmed section, so seams don't drop a beat.
    if (length && cue.loop) chain.push(`atrim=0:${cue.loop}`, 'asetpts=PTS-STARTPTS', `aloop=loop=-1:size=${Math.round(cue.loop * 48000)}`);
    if (length) chain.push(`atrim=0:${length}`, 'asetpts=PTS-STARTPTS');
    chain.push(`volume=${cue.gain}`);
    if (length && cue.fadeOut) chain.push(`afade=t=out:st=${Math.max(0, length - cue.fadeOut)}:d=${cue.fadeOut}`);
    const ms = Math.round(cue.at * 1000);
    chain.push(`adelay=${ms}|${ms}`);
    filters.push(`[${n}:a]${chain.join(',')}[a${n}]`); labels.push(`[a${n}]`); n++;
  });
  for (const s of synthSources(layers, duration, stepRate)) {
    inputs.push('-f', 'lavfi', '-i', s.lavfi);
    filters.push(`[${n}:a]${s.chain},aformat=sample_rates=48000:channel_layouts=stereo[a${n}]`); labels.push(`[a${n}]`); n++;
  }
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,acompressor=threshold=0.3:ratio=3:attack=5:release=150:makeup=1,alimiter=limit=0.9,apad,atrim=0:${duration}[aout]`);
  return { inputs, filter: filters.join(';') };
}

async function renderCommand() {
  const { CUTSCENE, SOUND_CUES, SYNTH, STEP_RATE } = await loadTimeline();
  // Frames are rendered at renderFps and blended in pairs down to fps: a 180° shutter of motion blur.
  const seconds = Number(flags.seconds ?? CUTSCENE.duration), fps = CUTSCENE.fps, renderFps = CUTSCENE.renderFps, frames = Math.round(seconds * renderFps);
  // The ironlung look is 640×360 by design, so it is encoded at that size (the game scales it up
  // with crisp pixels). Encoding its 3×3 blocks at 1080p would cost ~5× the bytes for nothing.
  const look = flags.look ?? 'ironlung', scale = Number(flags.scale ?? (look === 'ironlung' ? 1 / 3 : 1)), crf = flags.crf ?? (look === 'ironlung' ? 23 : 26);
  const out = path.resolve(root, flags.out ?? `public/${CUTSCENE.video}`), partial = out.replace(/\.mp4$/, '.partial.mp4');
  await mkdir(path.dirname(out), { recursive: true });
  const mix = audioMix(SOUND_CUES.filter(c => c.at < seconds), SYNTH.filter(l => (l.at ?? l.gain[0][0]) < seconds), seconds, STEP_RATE);
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(renderFps), '-c:v', 'mjpeg', '-i', '-', ...mix.inputs,
    '-filter_complex', `[0:v]tmix=frames=${renderFps / fps},fps=${fps}[vout];${mix.filter}`, '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '160k', '-t', String(seconds), partial], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ffmpeg.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  const started = Date.now();
  // Encode to a temporary file and only replace the real one once ffmpeg succeeds.
  try {
    await withPage(async page => {
      const info = await page.evaluate(o => window.__cutscene.init(o), { procedural: !!flags.procedural, scale, look });
      console.log(`gpu: ${info.gpu} · ${frames} frames @ ${renderFps} fps → ${fps} fps`);
      for (let i = 0; i < frames; i++) {
        const jpeg = decode(await page.evaluate(n => window.__cutscene.frame(n), i));
        if (!ffmpeg.stdin.write(jpeg)) await new Promise(r => ffmpeg.stdin.once('drain', r));
        if (i % 120 === 0) process.stdout.write(`\r  frame ${i}/${frames} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
      }
    });
    ffmpeg.stdin.end();
    await done;
  } catch (error) {
    ffmpeg.stdin.destroy(); ffmpeg.kill('SIGKILL');
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, out);
  console.log(`\nwrote ${path.relative(root, out)} (${((await stat(out)).size / 1e6).toFixed(2)} MB)`);
  if (path.relative(root, out) === `public/${CUTSCENE.video}`) await updateManifest(out);
}

async function audioCommand() {
  const { CUTSCENE, SOUND_CUES, SYNTH, STEP_RATE } = await loadTimeline();
  const out = path.resolve(root, flags.out ?? path.join(previews, 'soundtrack.wav')), mix = audioMix(SOUND_CUES, SYNTH, CUTSCENE.duration, STEP_RATE, 0);
  await mkdir(path.dirname(out), { recursive: true });
  await new Promise((resolve, reject) => spawn('ffmpeg', ['-y', '-loglevel', 'error', ...mix.inputs, '-filter_complex', mix.filter, '-map', '[aout]', out], { stdio: 'inherit' })
    .on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  console.log(path.relative(root, out));
}

// Node can't import .ts; read the timeline through Vite's SSR loader instead.
async function loadTimeline() {
  const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
  try { return await server.ssrLoadModule('/src/cutscene/timeline.ts'); } finally { await server.close(); }
}

async function updateManifest(file) {
  const manifestPath = path.join(root, 'public/assets/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const bytes = await readFile(file), rel = path.relative(root, file);
  const entry = { path: rel, url: `/${path.relative(path.join(root, 'public'), file)}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mediaType: 'video/mp4', source: 'cutscene/ + src/cutscene/ (rendered by tools/cutscene.mjs render)', license: 'Generated for this project; see docs/ASSETS.md' };
  const at = manifest.assets.findIndex(a => a.path === rel);
  if (at >= 0) manifest.assets[at] = entry; else manifest.assets.push(entry);
  manifest.counts = { ...manifest.counts, openingVideo: 1 };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`updated public/assets/manifest.json (${entry.sha256.slice(0, 12)}…)`);
}

const commands = { prop: propCommand, nodes: nodesCommand, models: modelsCommand, stills: stillsCommand, render: renderCommand, audio: audioCommand };
if (!commands[command]) { console.error(`usage: node tools/cutscene.mjs <${Object.keys(commands).join('|')}> …`); process.exit(1); }
await commands[command]();
