import * as THREE from 'three';
import { buildPineTree, buildRock, buildFern } from '../cutscene/props/forest';
import { buildShadowFigure } from '../cutscene/props/shadowFigure';
import { creatureBearing, huntWindow } from '../game/creature';
import type { GameState } from '../game/state';
import type { TraceSnapshot } from '../integrations/client';
import { METRES_PER_UNIT } from './distance';

/** The spectator's outside camera: an infrared pan-tilt camera on the shelter roof that tracks the
 * creature through the trees. The player has no cameras at all now; only spectators see it coming.
 * Drawn on this device from the public trace: the creature stands at its public bearing
 * (`creatureBearing` from the seed and run time) and its distance (5 m per line unit, eased so its
 * steps read as walking). Uses the cutscene's procedural pines and shadow figure. */
export type ExteriorView = { metres: number; bearing: number; visible: boolean; moving: boolean };
export interface ExteriorCam {
  frame(input: { trace: TraceSnapshot | null; seconds: number; nowMs: number; reducedMotion: boolean }): ExteriorView;
  dispose(): void;
}

/** Beyond this the infrared and the fog lose it. */
export const IR_RANGE_M = 48;
const ROOF = 3.3, WALL = 3.2, FRAME_MS = 50, MAX_WIDTH = 760;

const FRAGMENT = `
uniform sampler2D tScene; uniform vec2 uRes; uniform float uFrame, uStatic, uAspect;
varying vec2 vUv;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec2 c = vUv - .5, a = c * vec2(uAspect, 1.);
  vec2 uv = .5 + c * (1. + .22 * dot(a, a)) / (1. + .055 * uAspect * uAspect);
  float cell = max(1., floor(uRes.y / 300.)); vec2 px = floor(gl_FragCoord.xy / cell);
  vec3 src = vec3(0.);
  if (uv.x >= 0. && uv.x <= 1. && uv.y >= 0. && uv.y <= 1.) src = texture2D(tScene, uv).rgb;
  float l = pow(1. - exp(-dot(src, vec3(.3, .55, .15)) * 5.), .5);
  l += (hash(px + uFrame * 17.3) - .5) * .16;
  l *= (.86 + .14 * step(.5, fract(gl_FragCoord.y / (2. * cell)))) * mix(.25, 1., smoothstep(.85, .2, length(c * vec2(1.1, 1.))));
  vec3 col = clamp(l * vec3(.62, 1., .66), 0., 1.);
  float s = .4 + (hash(px * 1.7 + uFrame * 5.1) - .5) * .3;
  gl_FragColor = vec4(mix(col, vec3(s * .95, s, s * .96), uStatic), 1.);
}`;

function seeded(seed: number): () => number { let v = seed >>> 0 || 1; return () => (v = (Math.imul(v, 1664525) + 1013904223) >>> 0) / 4294967296; }

export function createExteriorCam(container: HTMLElement): ExteriorCam {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const canvas = renderer.domElement; canvas.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(canvas);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x010201); scene.fog = new THREE.FogExp2(0x020302, 0.042);
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 140); camera.rotation.order = 'YXZ';
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true }); target.texture.colorSpace = THREE.SRGBColorSpace;
  const post = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: target.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uFrame: { value: 0 }, uStatic: { value: 1 }, uAspect: { value: 16 / 9 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: FRAGMENT, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); quad.frustumCulled = false;
  const postScene = new THREE.Scene(), postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); postScene.add(quad);

  // Ground, a ring of pines with rocks and ferns between, the shelter's own lit doorstep below.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 48), new THREE.MeshStandardMaterial({ color: 0x2a2a22, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const pines = [11, 23, 37].map(buildPineTree), rock = buildRock(), fern = buildFern(), r = seeded(4099);
  for (let i = 0; i < 150; i++) {
    const angle = r() * Math.PI * 2, distance = 7 + Math.pow(r(), 0.8) * 62;
    const tree = pines[i % 3]!.clone(); tree.position.set(Math.sin(angle) * distance, 0, -Math.cos(angle) * distance); tree.rotation.y = r() * 6.28; tree.scale.setScalar(0.8 + r() * 0.5); scene.add(tree);
  }
  for (let i = 0; i < 90; i++) {
    const angle = r() * Math.PI * 2, distance = 4.5 + r() * 40, piece = (i % 3 ? fern : rock).clone();
    piece.position.set(Math.sin(angle) * distance, 0, -Math.cos(angle) * distance); piece.rotation.y = r() * 6.28; piece.scale.setScalar(0.7 + r() * 0.8); scene.add(piece);
  }
  // The shelter roof edge under the lens: always at the bottom of the frame.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.9), new THREE.MeshStandardMaterial({ color: 0x1c201c, roughness: 0.9 })); roof.position.set(0, -0.62, -0.95); camera.add(roof); scene.add(camera);
  const doorstep = new THREE.PointLight(0xffc27a, 6, 9, 1.6), infrared = new THREE.SpotLight(0xffffff, 26, 70, 0.62, 0.7, 1.15);
  infrared.position.set(0, 0, 0); infrared.target.position.set(0, -0.25, -1); camera.add(infrared, infrared.target);
  scene.add(doorstep, new THREE.HemisphereLight(0x324032, 0x050605, 0.35));
  const creature = buildShadowFigure(); scene.add(creature);
  const ink = new THREE.MeshStandardMaterial({ color: 0x7e8a80, roughness: 0.7 });
  creature.traverse(o => { if (o instanceof THREE.Mesh) { o.material = ink; } });
  // Two eye glints: infrared shows them as bright points, like a real night camera.
  const eyes = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const x of [-0.05, 0.05]) { const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.02), eyes); eye.position.set(x, 2.1, 1.13); eye.rotation.x = 0.5; creature.add(eye); }

  let disposed = false, lastRender = -Infinity, frameNo = 0, shown: { metres: number; bearing: number } | null = null, panYaw: number | null = null, lastSeconds = 0;
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); post.uniforms.uAspect!.value = w / h;
    const width = Math.max(320, Math.min(MAX_WIDTH, Math.round(w))); target.setSize(width, Math.max(1, Math.round(width * h / w)));
    renderer.getDrawingBufferSize(post.uniforms.uRes!.value as THREE.Vector2); lastRender = -Infinity;
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();

  return {
    frame({ trace, seconds, nowMs, reducedMotion }) {
      const s = trace?.summary;
      const goal = s ? WALL + s.linePosition * METRES_PER_UNIT : 90, bearing = trace ? creatureBearing(trace.seed, seconds) : 0;
      const dt = Number.isFinite(lastRender) ? Math.min(0.25, (nowMs - lastRender) / 1000) : 0;
      if (disposed || nowMs - lastRender < FRAME_MS) return { metres: shown?.metres ?? goal, bearing, visible: !!s && (shown?.metres ?? goal) <= IR_RANGE_M, moving: !!shown && Math.abs(goal - shown.metres) > 0.3 };
      lastRender = nowMs; frameNo++;
      const lost = !s || s.status === 'lost', hunting = !!trace && !!s && s.status === 'playing' && !!huntWindow({ mode: trace.mode, time: seconds, seed: trace.seed } as GameState);
      // Its steps are 5 m jumps on the line; ease each into a stride (quicker during a hunt). It starts where it is.
      if (!shown || seconds < lastSeconds - 2) shown = { metres: goal, bearing };
      lastSeconds = seconds;
      const gap = goal - shown.metres;
      shown.metres = reducedMotion ? goal : shown.metres + gap * (1 - Math.exp(-dt / (hunting || s?.creaturePhase === 'breach' ? .35 : .8)));
      shown.bearing = bearing;
      const moving = Math.abs(gap) > 0.3, away = gap > 0.3 || s?.creaturePhase === 'retreat' || s?.creaturePhase === 'lured';
      creature.position.set(Math.sin(bearing) * shown.metres, 0, -Math.cos(bearing) * shown.metres);
      creature.rotation.y = -bearing + (away ? Math.PI : 0); // faces the shelter, or away while it leaves
      const stride = moving && !reducedMotion ? Math.sin(nowMs / 1000 * Math.PI * 2 * (hunting ? 2.4 : 1.3)) : 0;
      creature.position.y = Math.abs(stride) * 0.08; creature.rotation.x = moving ? 0.25 : 0.05; creature.rotation.z = stride * 0.05;
      creature.scale.set(stride < 0 ? -1 : 1, 1, 1);
      creature.visible = !!s && s.status !== 'won';
      // The mount pans after it with a lag, tilting down as it nears the wall.
      panYaw = panYaw === null || reducedMotion ? bearing : panYaw + (bearing - panYaw) * (1 - Math.exp(-dt / 0.9));
      camera.position.set(0, ROOF, 0);
      camera.rotation.set(-THREE.MathUtils.degToRad(6 + 30 * Math.max(0, 1 - (shown.metres - WALL) / 22)), -panYaw, 0);
      if (!reducedMotion) camera.rotation.z = Math.sin(nowMs / 1700) * 0.004;
      doorstep.position.set(Math.sin(bearing) * 1.8, 2.4, -Math.cos(bearing) * 1.8);
      post.uniforms.uFrame!.value = reducedMotion ? 0 : frameNo % 1000; post.uniforms.uStatic!.value = lost ? 1 : 0;
      if (!lost) { renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.setRenderTarget(null); }
      renderer.render(postScene, postCamera);
      return { metres: shown.metres, bearing, visible: !!s && shown.metres <= IR_RANGE_M && s.status !== 'won', moving };
    },
    dispose() {
      if (disposed) return; disposed = true; observer.disconnect();
      scene.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      [ground.material, roof.material, ink, eyes].forEach(m => (m as THREE.Material).dispose());
      target.dispose(); quad.geometry.dispose(); post.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
