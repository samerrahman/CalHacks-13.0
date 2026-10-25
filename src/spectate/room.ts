import * as THREE from 'three';
import { disposeObject, loadModels, type ModelName } from '../render/assets';
import { createWeathering } from '../render/weathering';
import type { PropView } from '../integrations/physics';
import type { TraceSnapshot } from '../integrations/client';
import { camLighting, newTracker, trackFeed, type DoorCue, type Signal } from './feedState';
import { SpringLook } from './look';
import type { PlayerView } from './player';
import { createResearcher } from './researcher';
import { BASEMENT_DOOR, buildBasementDoor } from '../cutscene/props/basementDoor';

type V3 = [number, number, number];
// Copied from createScene in src/render/scene.ts (model placements, signage, lamp, alarm, lights, the
// sonar scope, wall status unit and basement door); keep in step with it. As in the game the security
// monitor and wall radar stay loaded but hidden. The creature is never added: the room is windowless.
// The only figure inside is the player's researcher, placed from the public trace (player.ts); after
// a win they walk out through the basement door as it opens.
/** Just through the basement doorway, where the researcher walks after a win. */
const EXIT = { x: -2.0, z: -2.8 } as const;
const PLACEMENT: Record<Exclude<ModelName, 'creature_cctv'>, [V3, number]> = {
  shelter: [[0, 0, 0], 0], sealed_door: [[-1.75, 0, 2.39], Math.PI], workdesk: [[0, 0, -1.8], 0], terminal: [[-.62, .92, -1.8], 0], security_monitor: [[.72, .92, -1.8], 0], proximity_detector: [[1.85, 1.60, -2.35], 0], radio_speaker: [[-1.30, .92, -1.8], 0], machine_rack: [[2.67, 0, .05], -Math.PI / 2], emergency_switch: [[-.70, 1.35, 2.36], Math.PI],
};
const SIGNS: [string, V3, number, number][] = [['protocol_card', [-.8, 1.55, -2.32], .62, 0], ['camera_notice', [.75, 1.95, -2.32], .73, 0], ['sensor_notice', [1.9, 2.16, -2.32], .65, 0], ['door_label', [-1.75, 2.2, 2.255], .7, Math.PI], ['emergency_switch', [-.7, 1.93, 2.47], .56, Math.PI]];
/** Screens glow as plain light; they never show feed content, labels or countdowns. */
const SCREENS: [ModelName, string, number][] = [['terminal', 'terminal_screen', 0x6f9a72]];
const PROP_SHAPE: Record<string, { colour: number; radius: number; height: number; sides: number; lying?: boolean }> = {
  can: { colour: 0xa9b28a, radius: .033, height: .12, sides: 12 }, mug: { colour: 0xd1b98a, radius: .043, height: .095, sides: 12 }, bolt: { colour: 0x8d9188, radius: .012, height: .03, sides: 6 },
  bottle: { colour: 0x7f9f8f, radius: .038, height: .24, sides: 10 }, flashlight: { colour: 0xd49a5e, radius: .028, height: .2, sides: 10, lying: true },
};
/** High in the north-west corner looking south-east: the rack (left), the desk top (below) and the
 * sealed door (right) face the lens. A west-wall mount would only see the door edge-on. */
export const CAMERA = { position: [-2.45, 2.75, -2.15] as V3, target: [-.45, 1.2, -.3] as V3, fov: 80 };
const FRAME_MS = 50, MAX_WIDTH = 960;

const FRAGMENT = `
uniform sampler2D tScene; uniform vec2 uRes; uniform float uTime, uFrame, uGain, uNoise, uStatic, uAspect;
varying vec2 vUv;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  // Wide-angle barrel: the edges squeeze more of the room in, the corners fall off to black.
  vec2 c = vUv - .5, a = c * vec2(uAspect, 1.), uv = .5 + c * (1. + .35 * dot(a, a)) / (1. + .0875 * uAspect * uAspect);
  float cell = max(1., floor(uRes.y / 360.)); vec2 px = floor(gl_FragCoord.xy / cell);
  vec3 src = vec3(0.);
  if (uv.x >= 0. && uv.x <= 1. && uv.y >= 0. && uv.y <= 1.) src = texture2D(tScene, uv).rgb;
  float l = pow(1. - exp(-dot(src, vec3(.2126, .7152, .0722)) * 3.6 * uGain), .4545);
  // Monochrome sensor, except saturated red (the alarm lamp) keeps its hue.
  float red = pow(1. - exp(-max(0., src.r - 1.6 * src.g) * 5. * uGain), .4545);
  float shade = (.88 + .12 * step(.5, fract(gl_FragCoord.y / (2. * cell)))) * mix(.32, 1., smoothstep(.8, .22, length(c * vec2(1.15, 1.))));
  l = (l + (hash(px + uFrame * 31.7) - .5) * uNoise) * shade;
  vec3 col = clamp(l * vec3(.74, 1., .8) + red * shade * vec3(.55, -.12, -.12), 0., 1.);
  // Signal lost: mid-grey snow with a slow rolling band. Bounded well below white, no flashes.
  float s = .44 + (hash(px * 1.31 + uFrame * 7.3) - .5) * .32 - .07 * smoothstep(.75, 1., sin(vUv.y * 9.4 + uTime * 1.6));
  col = mix(col, vec3(s * .97, s, s * .98), uStatic);
  gl_FragColor = vec4(col, 1.);
}`;

export type ShelterCamInput = { trace: TraceSnapshot | null; props: () => readonly PropView[]; player?: () => PlayerView | null; nowMs: number; reducedMotion: boolean };
export interface ShelterCam {
  /** Resolves when the models are in; rejects if a required model failed to load. */
  ready: Promise<void>;
  /** Call every animation frame; renders at most 20 times a second. Returns the feed's signal. */
  frame(input: ShelterCamInput): Signal;
  dispose(): void;
  diagnostics: { frames: number; signal: Signal; loaded: boolean; error: string | null };
}

/** The spectator's fixed security camera inside the shelter, drawn locally from public state. */
export function createShelterCam(container: HTMLElement): ShelterCam {
  const diagnostics: ShelterCam['diagnostics'] = { frames: 0, signal: 'none', loaded: false, error: null };
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const canvas = renderer.domElement; canvas.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(canvas);
  const look = new SpringLook();
  let pointer: number | null = null, lastX = 0, lastY = 0;
  const releaseLook = () => { pointer = null; look.release(); container.classList.remove('dragging'); };
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || pointer !== null) return;
    event.preventDefault(); container.focus({ preventScroll: true });
    pointer = event.pointerId; lastX = event.clientX; lastY = event.clientY;
    look.begin(); canvas.setPointerCapture(pointer); container.classList.add('dragging');
  };
  const pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    look.drag((event.clientX - lastX) / Math.max(1, container.clientWidth) * Math.PI,
      (event.clientY - lastY) / Math.max(1, container.clientHeight) * Math.PI / 2);
    lastX = event.clientX; lastY = event.clientY;
  };
  const pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    releaseLook();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); look.begin();
    look.drag(event.key === 'ArrowLeft' ? -.08 : event.key === 'ArrowRight' ? .08 : 0,
      event.key === 'ArrowUp' ? -.06 : event.key === 'ArrowDown' ? .06 : 0);
  };
  const keyUp = (event: KeyboardEvent) => { if (event.key.startsWith('Arrow') || event.key === 'Escape') releaseLook(); };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('lostpointercapture', releaseLook);
  container.addEventListener('keydown', keyDown); container.addEventListener('keyup', keyUp); container.addEventListener('blur', releaseLook);
  window.addEventListener('blur', releaseLook);
  let disposed = false, lostContext = false, lastRender = -Infinity, frameNo = 0, gain = 1, noise = .06, shakeAt = -Infinity, shakeAmp = 0;
  let tracker = newTracker(), lastTrace: TraceSnapshot | null | undefined, wonAt: number | null = null, leaveFrom: { x: number; z: number } | null = null;
  let lockLamps: THREE.MeshStandardMaterial[] = [], beaconLens: THREE.MeshStandardMaterial | null = null, doorLeaf: THREE.Object3D | null = null;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020303); scene.fog = new THREE.FogExp2(0x040504, .025);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, .05, 20);
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true }); target.texture.colorSpace = THREE.SRGBColorSpace;
  const post = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: target.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uFrame: { value: 0 }, uGain: { value: 1 }, uNoise: { value: .06 }, uStatic: { value: 1 }, uAspect: { value: 16 / 9 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }', fragmentShader: FRAGMENT, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); quad.frustumCulled = false;
  const postScene = new THREE.Scene(), postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); postScene.add(quad);

  const hemisphere = new THREE.HemisphereLight(0x59644c, 0x070807, .21), fill = new THREE.AmbientLight(0x6b6952, .065);
  const overhead = new THREE.PointLight(0x836342, 1.15, 4.2, 2); overhead.position.set(.2, 2.65, -.65);
  const deskLamp = new THREE.PointLight(0xf09b56, 3.2, 2.5, 2); deskLamp.position.set(-1.28, 1.72, -1.54);
  const taskSpot = new THREE.SpotLight(0xffb976, 5.2, 3.2, .58, .8, 1.8); taskSpot.position.set(-1.3, 1.7, -1.62); taskSpot.target.position.set(-.6, .95, -1.65);
  const emergency = new THREE.PointLight(0xda6e36, .72, 2.3, 2); emergency.position.set(-.7, 1.57, 2.18);
  const screenGlow = new THREE.PointLight(0xadb178, .48, 1.6, 2); screenGlow.position.set(.05, 1.43, -1.14);
  const alarm = new THREE.PointLight(0xb7190b, .1, 5, 2); alarm.position.set(1.05, 2.3, -1.95);
  // The camera's own weak infrared illuminator: geometry stays faintly readable in a blackout.
  const infrared = new THREE.PointLight(0xffffff, 1.4, 9, 1.2); infrared.position.set(...CAMERA.position);
  scene.add(hemisphere, fill, overhead, deskLamp, taskSpot, taskSpot.target, emergency, screenGlow, alarm, infrared);
  const researcher = createResearcher(); researcher.root.visible = false; scene.add(researcher.root);
  const lampSurface = new THREE.MeshStandardMaterial({ color: 0x82745a, emissive: 0xe29049, emissiveIntensity: .22 });
  const alarmLens = new THREE.MeshStandardMaterial({ color: 0x330604, emissive: 0xc52b0d, emissiveIntensity: .16, roughness: .38 });
  const screens: { material: THREE.MeshBasicMaterial; colour: number }[] = [], orphans: THREE.Material[] = [], mixers: THREE.AnimationMixer[] = [];
  const props = new Map<number, THREE.Mesh>(), propGeometry = new Map<string, THREE.BufferGeometry>(), propMaterial = new Map<string, THREE.Material>();
  let weathering: ReturnType<typeof createWeathering> | null = null;
  let door: { mixer: THREE.AnimationMixer; impact: THREE.AnimationAction; dent: THREE.AnimationAction } | null = null, lever: { mixer: THREE.AnimationMixer; action: THREE.AnimationAction } | null = null;

  const ready = loadModels(() => undefined).then(assets => {
    if (disposed) { Object.values(assets).forEach(asset => disposeObject(asset.scene)); return; }
    disposeObject(assets.creature_cctv.scene);
    assets.security_monitor.scene.visible = false; assets.proximity_detector.scene.visible = false;
    // The weathering canvases are the costly part, so they wait until the room is actually needed.
    const w = weathering = createWeathering(), steel = w.material('steel'), rust = w.material('rust');
    for (const [name, [pos, rotation]] of Object.entries(PLACEMENT) as [keyof typeof PLACEMENT, [V3, number]][]) {
      const model = assets[name].scene; model.position.set(...pos); model.rotation.y = rotation; w.apply(model); scene.add(model);
    }
    for (const [model, node, colour] of SCREENS) {
      const mesh = assets[model].scene.getObjectByName(node);
      if (!(mesh instanceof THREE.Mesh)) continue;
      orphans.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
      const material = new THREE.MeshBasicMaterial({ color: colour }); mesh.material = material; screens.push({ material, colour });
    }
    const box = (size: V3, pos: V3, material: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...pos); scene.add(mesh); };
    box([.25, .035, .22], [-1.35, .945, -1.96], steel); box([.027, .77, .027], [-1.35, 1.32, -1.96], rust); box([.36, .08, .23], [-1.26, 1.72, -1.83], steel); box([.29, .015, .18], [-1.26, 1.672, -1.83], lampSurface);
    box([.22, .22, .12], [1.05, 2.3, -2.36], steel); for (const x of [1.01, 1.09]) box([.008, .19, .015], [x, 2.3, -2.17], steel);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), alarmLens); bulb.position.set(1.05, 2.3, -2.25); scene.add(bulb);
    // The round sonar scope on the desk and the wall status unit glow as plain light.
    const scope = new THREE.Group(); scope.position.set(.72, 1.34, -1.78); scene.add(scope);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(.37, .39, .16, 40), steel); drum.rotation.x = Math.PI / 2; scope.add(drum);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(.335, .028, 10, 48), rust); bezel.position.z = .085; scope.add(bezel);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(.16, .1, .14), steel); stand.position.set(0, -.37, 0); scope.add(stand);
    const sonarGlow = new THREE.MeshBasicMaterial({ color: 0x4f8a5c }), sonar = new THREE.Mesh(new THREE.CircleGeometry(.32, 48), sonarGlow); sonar.position.z = .082; scope.add(sonar);
    screens.push({ material: sonarGlow, colour: 0x4f8a5c });
    box([.52, .64, .05], [-.8, 2.05, -2.31], steel);
    const statusGlow = new THREE.MeshBasicMaterial({ color: 0x6b3a1c }), status = new THREE.Mesh(new THREE.PlaneGeometry(.46, .575), statusGlow); status.position.set(-.8, 2.05, -2.282); scene.add(status);
    screens.push({ material: statusGlow, colour: 0x6b3a1c });
    // The basement door: its lock lamps turn green as stages complete; after the win it slides open.
    const basement = buildBasementDoor(); basement.position.set(-2.0, 0, -2.5); w.apply(basement); scene.add(basement);
    lockLamps = [0, 1, 2, 3].map(i => { const mesh = basement.getObjectByName(`lock_lamp_${i}`) as THREE.Mesh, material = new THREE.MeshStandardMaterial({ color: 0x1c0605, emissive: 0xff2a1a, emissiveIntensity: .8 }); mesh.material = material; orphans.push(material); return material; });
    beaconLens = new THREE.MeshStandardMaterial({ color: 0x3a2508, emissive: 0xffa040, emissiveIntensity: .08 }); (basement.getObjectByName('beacon_lens') as THREE.Mesh).material = beaconLens; orphans.push(beaconLens);
    doorLeaf = basement.getObjectByName('door_leaf') ?? null;
    const loader = new THREE.TextureLoader();
    for (const [name, pos, width, rotation] of SIGNS) {
      const material = w.material('cream'); material.color.setHex(0xa29a7c);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 2), material); sign.position.set(...pos); sign.rotation.y = rotation; scene.add(sign);
      void loader.loadAsync(`/assets/decals/${name}.svg`).then(texture => { if (disposed) { texture.dispose(); return; } texture.colorSpace = THREE.SRGBColorSpace; material.map = texture; material.needsUpdate = true; }, () => undefined);
    }
    const clip = (name: ModelName, clipName: string) => assets[name].animations.find(c => c.name === clipName);
    const impactClip = clip('sealed_door', 'impact'), dentClip = clip('sealed_door', 'dent'), flipClip = clip('emergency_switch', 'flip_off');
    if (impactClip && dentClip) {
      const mixer = new THREE.AnimationMixer(assets.sealed_door.scene); mixers.push(mixer);
      const impact = mixer.clipAction(impactClip), dent = mixer.clipAction(dentClip);
      for (const action of [impact, dent]) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
      door = { mixer, impact, dent };
      if (tracker.dented) settleDent();
    }
    if (flipClip) { const mixer = new THREE.AnimationMixer(assets.emergency_switch.scene); mixers.push(mixer); const action = mixer.clipAction(flipClip); action.play(); action.paused = true; lever = { mixer, action }; }
    diagnostics.loaded = true;
  }).catch((error: unknown) => { diagnostics.error = error instanceof Error ? error.message : String(error); throw error; });

  function settleDent() { if (!door) return; door.impact.stop(); door.dent.reset().play(); door.mixer.update(door.dent.getClip().duration); }
  function cue(kind: DoorCue, reducedMotion: boolean, nowMs: number) {
    if (kind === 'dent') { if (reducedMotion) settleDent(); else { door?.impact.stop(); door?.dent.reset().play(); } }
    else if (!reducedMotion && !tracker.dented) door?.impact.reset().play();
    if (!reducedMotion) { shakeAt = nowMs; shakeAmp = kind === 'dent' ? .014 : .007; }
  }
  function syncProps(views: readonly PropView[]) {
    for (const view of views) {
      const shape = PROP_SHAPE[view.kind] ?? PROP_SHAPE.bolt!;
      let mesh = props.get(view.slot);
      if (!mesh) {
        const key = view.kind in PROP_SHAPE ? view.kind : 'bolt';
        if (!propGeometry.has(key)) { propGeometry.set(key, new THREE.CylinderGeometry(shape.radius, shape.radius, shape.height, shape.sides)); propMaterial.set(key, new THREE.MeshStandardMaterial({ color: shape.colour, roughness: .7, metalness: key === 'bolt' ? .6 : .2 })); }
        mesh = new THREE.Mesh(propGeometry.get(key), propMaterial.get(key)); if (shape.lying) mesh.rotation.z = Math.PI / 2;
        props.set(view.slot, mesh); scene.add(mesh);
      }
      // Bodies are spheres resting at y = radius; stand each shape on that contact point.
      mesh.position.set(view.x, shape.lying ? view.y : view.y - view.radius + shape.height / 2, view.z);
    }
  }
  function resize() {
    if (disposed) return;
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); post.uniforms.uAspect!.value = w / h;
    const width = Math.max(320, Math.min(MAX_WIDTH, Math.round(w))); target.setSize(width, Math.max(1, Math.round(width * h / w)));
    renderer.getDrawingBufferSize(post.uniforms.uRes!.value as THREE.Vector2); lastRender = -Infinity;
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  const onLost = (event: Event) => { event.preventDefault(); lostContext = true; diagnostics.error = 'WebGL context lost'; };
  canvas.addEventListener('webglcontextlost', onLost);

  return {
    ready, diagnostics,
    frame({ trace, props: propsAt, player, nowMs, reducedMotion }) {
      if (disposed) return tracker.signal;
      if (trace !== lastTrace) {
        lastTrace = trace;
        const { next, cues, restarted } = trackFeed(tracker, trace);
        if (restarted) { door?.impact.stop(); door?.dent.stop(); look.reset(); wonAt = leaveFrom = null; }
        // A win seen live walks the player out; joining after it, they are already gone.
        if (trace?.summary.status === 'won' && wonAt === null) wonAt = tracker.primed && !restarted ? nowMs : -1e9;
        if (trace?.summary.status === 'playing') wonAt = leaveFrom = null;
        const joinedDented = next.dented && !tracker.dented && !cues.includes('dent');
        tracker = next; diagnostics.signal = next.signal;
        if (joinedDented) settleDent();
        cues.forEach(kind => cue(kind, reducedMotion, nowMs));
      }
      if (lostContext || nowMs - lastRender < FRAME_MS) return tracker.signal;
      const dt = Number.isFinite(lastRender) ? Math.min(.25, (nowMs - lastRender) / 1000) : 0; lastRender = nowMs;
      look.step(dt, reducedMotion);
      frameNo++; diagnostics.frames++;
      const u = post.uniforms, live = tracker.signal === 'live' && diagnostics.loaded;
      u.uTime!.value = reducedMotion ? 0 : nowMs / 1000; u.uFrame!.value = reducedMotion ? Math.floor(nowMs / 500) % 1000 : frameNo % 1000;
      u.uStatic!.value = live ? 0 : 1;
      if (live) {
        const s = trace!.summary, light = camLighting(s.equipment, tracker.alarm, s.linePosition, nowMs / 1000, reducedMotion), k = reducedMotion ? 1 : 1 - Math.exp(-dt / .7);
        gain += (light.gain - gain) * k; noise += (light.noise - noise) * k; u.uGain!.value = gain; u.uNoise!.value = noise;
        hemisphere.intensity = .05 + .16 * light.level; fill.intensity = .015 + .05 * light.level; overhead.intensity = 1.15 * light.level; deskLamp.intensity = 3.2 * light.level; taskSpot.intensity = 5.2 * light.level;
        lampSurface.emissiveIntensity = .22 * light.level; screenGlow.intensity = light.screens ? .48 : 0; emergency.intensity = .72 * light.emergency;
        alarm.intensity = .1 + light.alarm * 4.2; alarmLens.emissiveIntensity = .16 + light.alarm * 1.1;
        for (const screen of screens) screen.material.color.setHex(light.screens ? screen.colour : 0x030504);
        if (lever) { lever.action.time = light.screens ? 0 : .34999; lever.mixer.update(0); }
        door?.mixer.update(dt); syncProps(propsAt());
        const won = s.status === 'won', locks = won ? 4 : Math.max(0, Math.min(4, s.stage - 1)), motor = won || (s.stage >= 5 && trace!.events.some(e => e.type === 'FINAL_BROADCAST'));
        lockLamps.forEach((lamp, i) => { const open = i < locks; lamp.color.setHex(open ? 0x061c09 : 0x1c0605); lamp.emissive.setHex(open ? 0x3dff6e : 0xff2a1a); lamp.emissiveIntensity = (open ? .9 : .8) * Math.max(.35, light.level); });
        if (beaconLens) beaconLens.emissiveIntensity = motor ? .6 + 1.6 * Math.max(0, Math.sin(nowMs / 1000 * Math.PI * 2.2)) : .08;
        const wonAge = won && wonAt !== null ? (nowMs - wonAt) / 1000 : null;
        if (doorLeaf) doorLeaf.position.x = -BASEMENT_DOOR.maxTravel * Math.min(1, Math.max(0, wonAge === null ? 0 : (wonAge - 1.6) / 1.6)) * (wonAge !== null && wonAge > 5.6 ? Math.max(0, 1 - (wonAge - 5.6) / .8) : 1);
        // After a win the researcher walks from where they stand out through the opening basement door, and is gone.
        let view = player?.() ?? null;
        if (view && wonAge !== null) {
          const from = leaveFrom ??= { x: view.x, z: view.z }, k = reducedMotion ? 1 : Math.min(1, Math.max(0, (wonAge - .8) / 2.6));
          view = wonAge > 4.2 ? null : { ...view, x: from.x + (EXIT.x - from.x) * k, z: from.z + (EXIT.z - from.z) * k, heading: Math.atan2(EXIT.x - from.x, EXIT.z - from.z), walking: k > 0 && k < 1, working: false, stride: (wonAge * .95) % 1 };
        }
        researcher.root.visible = !!view;
        if (view) researcher.update(view, dt, nowMs / 1000, reducedMotion);
        camera.position.set(...CAMERA.position); camera.lookAt(...CAMERA.target);
        camera.rotateY(look.yaw); camera.rotateX(look.pitch);
        const shake = reducedMotion ? 0 : shakeAmp * Math.max(0, 1 - (nowMs - shakeAt) / 600);
        if (shake > 0) { camera.rotateZ(Math.sin(nowMs * .05) * shake); camera.rotateX(Math.sin(nowMs * .071) * shake * .6); }
        renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.setRenderTarget(null);
      }
      renderer.render(postScene, postCamera);
      return tracker.signal;
    },
    dispose() {
      if (disposed) return; disposed = true; observer.disconnect(); canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('lostpointercapture', releaseLook);
      container.removeEventListener('keydown', keyDown); container.removeEventListener('keyup', keyUp); container.removeEventListener('blur', releaseLook);
      window.removeEventListener('blur', releaseLook);
      for (const mixer of mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
      disposeObject(scene); new Set([...orphans, lampSurface, alarmLens]).forEach(material => material.dispose()); weathering?.dispose();
      target.dispose(); quad.geometry.dispose(); post.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
