import * as THREE from 'three';
import { cloneModel, disposeObject, loadModels } from './assets';
import { STATION_TARGETS, type Station } from './stations';

export interface RenderState {
  time: number;
  paused?: boolean;
  doors: { left: boolean; right: boolean }; // true means open, matching game authority.
  creature?: { side: 'left' | 'right' | null; phase: string; phaseStarted?: number; progress?: number };
  safeUntil?: { left: number; right: number };
  task?: number;
  power?: number;
  challenge?: { prompt: string; response: string };
  orderId?: string;
}

export interface SceneView {
  ready: Promise<void>;
  update(state: RenderState, dt: number): void;
  setStation(station: Station, reducedMotion?: boolean): void;
  dispose(): void;
  diagnostics: { loadedAssets: string[]; animationClips: string[]; error: string | null };
}

function textTexture(title: string, lines: string[], paper = false, template?: CanvasImageSource): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = paper ? '#c2bba0' : '#0c2523';
  if (template) {
    ctx.drawImage(template, 0, 0, 1024, 512);
    // Supplied cards are reference art: mask every example ID and secret before display.
    ctx.fillRect(39, 39, 946, 420);
  } else {
    ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = paper ? '#6c6a53' : '#316c59'; ctx.lineWidth = 3; ctx.strokeRect(25, 25, 974, 462);
  }
  ctx.fillStyle = paper ? '#183a37' : '#88c6a1';
  ctx.font = 'bold 52px monospace'; ctx.fillText(title, 56, 103);
  ctx.fillStyle = paper ? '#344d44' : '#6caa89'; ctx.font = '31px monospace';
  lines.forEach((line, i) => ctx.fillText(line, 57, 180 + i * 59));
  if (!paper) {
    ctx.fillStyle = 'rgba(0, 0, 0, .14)';
    for (let y = 0; y < 512; y += 5) ctx.fillRect(0, y, 1024, 2);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createScene(container: HTMLElement): SceneView {
  const diagnostics: SceneView['diagnostics'] = { loadedAssets: [], animationClips: [], error: null };
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x081414);
  scene.fog = new THREE.FogExp2(0x081414, .047);
  const camera = new THREE.PerspectiveCamera(59, 1, .04, 35);
  camera.position.set(0, 1.65, 1.4); camera.lookAt(STATION_TARGETS.console);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label', '3D relay booth. Drag to look around; use station buttons or A and D to turn.');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  container.appendChild(renderer.domElement);
  let disposed = false, reducedMotion = false, desiredStation: Station = 'console';
  let yawOffset = 0, pitchOffset = 0, dragging = false, previousX = 0, previousY = 0;
  const targetQuaternion = camera.quaternion.clone();
  const targetCamera = camera.clone();
  const mixers: THREE.AnimationMixer[] = [];
  const shutters: Partial<Record<'left' | 'right', { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; progress: number }>> = {};
  const floodlights: Partial<Record<'left' | 'right', THREE.SpotLight>> = {};
  const corridorLamps: Record<'left' | 'right', THREE.PointLight> = {
    left: new THREE.PointLight(0xffbc76, 12, 8, 2),
    right: new THREE.PointLight(0x77d4c0, 12, 8, 2),
  };
  let mimic: THREE.Object3D | null = null, mimicMixer: THREE.AnimationMixer | null = null;
  const mimicActions: Record<string, THREE.AnimationAction> = {};
  let mimicClip = 'idle';
  let lastCard = '', lastScreen = '';
  const cardTemplates: Partial<Record<'work_order' | 'challenge_card', CanvasImageSource>> = {};
  const material = (color: number, emissive = 0, intensity = 0) => new THREE.MeshStandardMaterial({ color, roughness: .82, metalness: .26, emissive, emissiveIntensity: intensity });
  const darkSteel = material(0x112b2b), steel = material(0x284844), brass = material(0x786e49);
  const cream = material(0xc4c2a2), orangeGlow = material(0xe2a86c, 0xe59a4b, .7), greenGlow = material(0x83d7b2, 0x67cba0, .8);
  function box(size: [number, number, number], position: [number, number, number], mat: THREE.Material, parent: THREE.Object3D = scene): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); mesh.position.set(...position);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function label(title: string, lines: string[], position: [number, number, number], width: number, rotationY = 0, paper = false): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 2), new THREE.MeshStandardMaterial({
      map: textTexture(title, lines, paper), roughness: .96, metalness: 0,
      emissive: paper ? 0x000000 : 0x406851, emissiveIntensity: paper ? 0 : .45,
    })); mesh.position.set(...position); mesh.rotation.y = rotationY; scene.add(mesh); return mesh;
  }
  // Readable soft fill, warm desk pool, cooler upper room and a narrow corridor rim.
  scene.add(new THREE.HemisphereLight(0x93c8b8, 0x172a26, 1.0));
  scene.add(new THREE.AmbientLight(0x75968a, .35));
  const ceilingLight = new THREE.PointLight(0xa8d4ba, 18, 8, 2); ceilingLight.position.set(0, 2.65, -1.3); scene.add(ceilingLight);
  const deskLight = new THREE.PointLight(0xffb75c, 17, 4.7, 2); deskLight.position.set(-1.22, 1.87, -1.4); scene.add(deskLight);
  const lampCone = new THREE.SpotLight(0xffc781, 16, 6, .7, .8, 1.5); lampCone.position.set(-1.2, 1.95, -1.4); lampCone.target.position.set(-.8, .9, -1.6); lampCone.castShadow = true; lampCone.shadow.mapSize.set(512, 512); scene.add(lampCone, lampCone.target);
  const wallLight = new THREE.PointLight(0x538577, 10, 6, 2); wallLight.position.set(1.5, 2.25, -.9); scene.add(wallLight);
  // Structural details remain geometry, with no external texture dependency.
  box([8, .15, 6], [0, 3.12, 0], darkSteel);
  for (const x of [-3.5, -2.25, 0, 2.25, 3.5]) {
    box([.07, 3, .12], [x, 1.5, -2.87], darkSteel);
    box([.09, .1, 6], [x, 3, 0], steel);
  }
  box([8, .08, .1], [0, .45, -2.87], steel);
  box([8, .09, .12], [0, 2.68, -2.85], steel);
  for (let i = -4; i <= 4; i++) box([.018, .01, 6], [i, .004, 0], steel);
  for (let i = -2; i <= 2; i++) box([8, .01, .018], [0, .005, i], steel);
  // Deep, shuttered observation window behind the desk.
  box([3.25, 1.13, .12], [.35, 1.94, -2.85], darkSteel);
  box([3.04, .94, .03], [.35, 1.94, -2.77], material(0x081c1d, 0x1e4039, .15));
  for (let i = 0; i < 8; i++) box([3.04, .026, .025], [.35, 1.53 + i * .115, -2.73], steel);
  box([.055, .94, .035], [.35, 1.94, -2.7], steel);
  label('RELAY / 04', ['REMOTE FIELD OPERATIONS', 'WEST RIDGE   ·   EST. 1986'], [.32, 2.65, -2.76], 1.4);
  const rulesDecal = label('NOTICE', ['VOICE ALONE IS NOT IDENTITY', 'VERIFY ALL SERVICE ORDERS'], [-2.65, 1.96, -2.77], 1.1, 0, true);
  const warningDecal = label('ISOLATION', ['CLOSED SHUTTERS DRAIN POWER', 'ONE OPEN KEEPS THE LINK'], [2.87, 1.98, -2.77], 1.02, 0, true);
  // A chunky monitor, warm desk lamp, receiver and tactile status keys.
  box([.99, .64, .39], [.18, 1.4, -1.89], darkSteel);
  box([.85, .49, .035], [.18, 1.43, -1.675], material(0x060f0d));
  const screen = label('CARRIER 04', ['AWAITING OPERATOR', 'LINK / STANDBY', 'KEEP ONE SHUTTER OPEN'], [.18, 1.43, -1.648], .79);
  box([.19, .17, .18], [.18, 1.04, -1.85], steel);
  box([.49, .035, .3], [.18, .947, -1.83], steel);
  box([.31, .03, .28], [-1.19, .936, -1.73], darkSteel);
  box([.035, .86, .035], [-1.25, 1.36, -1.88], brass);
  box([.4, .07, .27], [-1.17, 1.83, -1.76], darkSteel);
  box([.34, .018, .23], [-1.17, 1.788, -1.76], orangeGlow);
  const paper = label('SERVICE ORDER', ['CURRENT ORDER ON CONSOLE', 'VERIFY BEFORE COMPLYING', 'PRIVATE CHANNEL KEY'], [.96, .93, -1.39], .5, 0, true);
  paper.rotation.x = -Math.PI / 2;
  const challengePaper = label('PRIVATE KEY', ['AWAITING RADIO CALL', 'VERIFY BEFORE COMPLYING'], [-.45, .932, -1.28], .42, 0, true);
  challengePaper.rotation.x = -Math.PI / 2; challengePaper.rotation.z = -.12;
  box([.21, .22, .21], [1.22, 1.025, -1.93], cream);
  box([.23, .015, .23], [1.22, 1.143, -1.93], darkSteel);
  for (let i = 0; i < 4; i++) box([.035, .022, .035], [.65 + i * .065, .96, -1.77], i === 1 ? orangeGlow : greenGlow);
  // Corridors, warning chevrons, service hatches and fixtures.
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    corridorLamps[side].position.set(sign * 7.4, 2.3, 0); scene.add(corridorLamps[side]);
    box([4, .08, 2.4], [sign * 6, 3.04, 0], darkSteel);
    box([.15, 3, 2.3], [sign * 8, 1.5, 0], darkSteel);
    for (let x = 4.7; x < 8; x += 1.25) {
      for (const z of [-1.01, 1.01]) {
        box([.08, 2.8, .08], [sign * x, 1.4, z], brass);
        box([.6, .045, .04], [sign * x, .14, z * .95], side === 'left' ? orangeGlow : greenGlow);
      }
    }
    for (let i = 0; i < 5; i++) {
      const strip = box([.018, .18, .17], [sign * 3.87, .17 + i * .37, .91], orangeGlow);
      strip.rotation.x = -.35;
    }
    label(side === 'left' ? '01 / SERVICE' : '02 / UPLINK', [side === 'left' ? 'CARTRIDGE RECEIVING HATCH' : 'FIELD COUPLER ACCESS', 'SWEEP BEFORE OPENING'], [sign * 3.86, 2.62, 0], 1.52, sign === -1 ? Math.PI / 2 : -Math.PI / 2);
    box([.16, .64, .5], [sign * 3.85, 1.15, -1.52], steel);
    label('CONTROL', ['SHUTTER / FIELD', 'REMOTE ACTUATION'], [sign * 3.75, 1.2, -1.51], .43, sign === -1 ? Math.PI / 2 : -Math.PI / 2);
    const flood = new THREE.SpotLight(0xf6e2ae, 0, 12, .43, .65, 1.3);
    flood.position.set(sign * 3.1, 1.65, .6); flood.target.position.set(sign * 7.8, 1.2, 0); scene.add(flood, flood.target); floodlights[side] = flood;
  }
  label('RELAY / AUXILIARY', ['CARTRIDGE SLOT 02', 'INSERT → CONFIRM'], [0, 2.31, 2.84], 1.5, Math.PI);
  const titleDecal = label('NIGHT RELAY', ['FIELD OPERATIONS', 'KEEP THE CHANNEL OPEN'], [-2.34, 1.9, 2.84], 1.2, Math.PI, true);
  for (const x of [-2.4, 2.4]) {
    box([.11, 2.3, .13], [x, 1.5, 2.8], steel);
    box([.07, 2.2, .07], [x + .15, 1.5, 2.8], brass);
  }
  // Dust is static and subtle: no strobes or camera shake.
  const dustGeometry = new THREE.BufferGeometry(); const positions = new Float32Array(135);
  for (let i = 0; i < 45; i++) {
    positions[i * 3] = Math.sin(i * 91.15) * 3.7;
    positions[i * 3 + 1] = .3 + (Math.sin(i * 5.26) + 1) * 1.3;
    positions[i * 3 + 2] = Math.cos(i * 73.24) * 2.5;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dustMaterial = new THREE.PointsMaterial({ color: 0xd3c9a4, size: .009, transparent: true, opacity: .22, depthWrite: false });
  scene.add(new THREE.Points(dustGeometry, dustMaterial));

  const textureLoader = new THREE.TextureLoader();
  const decalReady = Promise.all([
    ...([['rules_card', rulesDecal], ['warning', warningDecal], ['title', titleDecal]] as const).map(async ([name, mesh]) => {
      const texture = await textureLoader.loadAsync(`/assets/decals/${name}.svg`);
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace; mesh.material.map?.dispose(); mesh.material.map = texture;
    }),
    ...(['work_order', 'challenge_card'] as const).map(async name => {
      const texture = await textureLoader.loadAsync(`/assets/decals/${name}.svg`);
      if (!disposed) { cardTemplates[name] = texture.image as CanvasImageSource; lastCard = ''; }
      texture.dispose();
    }),
  ]).catch((error: unknown) => {
    diagnostics.error = error instanceof Error ? error.message : String(error);
    throw error;
  });
  const modelsReady = loadModels(name => diagnostics.loadedAssets.push(name)).then(models => {
    if (disposed) { for (const model of Object.values(models)) disposeObject(model.scene); return; }
    scene.add(models.booth.scene);
    models.console.scene.position.set(.1, .92, -1.37); scene.add(models.console.scene);
    models.radio.scene.position.set(-.83, .92, -1.6); scene.add(models.radio.scene);
    models.relay.scene.position.set(0, .96, 2.6); models.relay.scene.rotation.y = Math.PI; scene.add(models.relay.scene);
    models.fuse.scene.position.set(-3.63, .9, -.52); scene.add(models.fuse.scene);
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      const shutter = side === 'left' ? models.shutter.scene : cloneModel(models.shutter.scene);
      shutter.position.set(sign * 4, 0, 0);
      // The authored ribs/stripe sit on -X; face them inward on each side.
      shutter.rotation.y = sign === -1 ? Math.PI : 0; scene.add(shutter);
      const mixer = new THREE.AnimationMixer(shutter); mixers.push(mixer);
      const clip = models.shutter.animations.find(candidate => candidate.name === 'open');
      if (!clip) throw new Error('Shutter GLB is missing its open clip');
      const action = mixer.clipAction(clip); action.play(); action.paused = true;
      shutters[side] = { mixer, action, progress: 1 };
      const light = side === 'left' ? models.floodlight.scene : cloneModel(models.floodlight.scene);
      light.position.set(sign * 3.45, 0, .69); light.rotation.y = sign * Math.PI / 2; scene.add(light);
      diagnostics.animationClips.push(`shutter.${side}.open`);
    }
    mimic = new THREE.Group(); mimic.add(models.mimic.scene); scene.add(mimic); mimic.visible = false;
    mimicMixer = new THREE.AnimationMixer(models.mimic.scene); mixers.push(mimicMixer);
    for (const clip of models.mimic.animations) {
      mimicActions[clip.name] = mimicMixer.clipAction(clip);
      diagnostics.animationClips.push(`mimic.${clip.name}`);
    }
    mimicActions.idle?.play();
  }).catch((error: unknown) => {
    diagnostics.error = error instanceof Error ? error.message : String(error);
    throw error;
  });
  const ready = Promise.all([modelsReady, decalReady]).then(() => undefined);

  function resize(): void {
    if (disposed) return;
    const width = Math.max(container.clientWidth, 1), height = Math.max(container.clientHeight, 1);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
  }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return; dragging = true; previousX = event.clientX; previousY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = 'grabbing';
  }
  function pointerMove(event: PointerEvent): void {
    if (!dragging) return;
    yawOffset = THREE.MathUtils.clamp(yawOffset - (event.clientX - previousX) * .003, -.8, .8);
    pitchOffset = THREE.MathUtils.clamp(pitchOffset - (event.clientY - previousY) * .0024, -.48, .48);
    previousX = event.clientX; previousY = event.clientY;
  }
  function pointerUp(): void { dragging = false; renderer.domElement.style.cursor = 'grab'; }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerUp);
  renderer.domElement.addEventListener('lostpointercapture', pointerUp);

  return {
    ready, diagnostics,
    setStation(station, motion = false) {
      reducedMotion = motion;
      if (station === desiredStation) return;
      desiredStation = station; yawOffset = 0; pitchOffset = 0;
    },
    update(state, delta) {
      if (disposed) return;
      const dt = state.paused ? 0 : Math.min(.1, Math.max(0, delta));
      targetCamera.position.copy(camera.position); targetCamera.lookAt(STATION_TARGETS[desiredStation]);
      const rotation = new THREE.Euler().setFromQuaternion(targetCamera.quaternion, 'YXZ');
      rotation.y += yawOffset; rotation.x += pitchOffset; targetQuaternion.setFromEuler(rotation);
      camera.quaternion.slerp(targetQuaternion, reducedMotion ? 1 : 1 - Math.exp(-delta * 9));
      for (const side of ['left', 'right'] as const) {
        const shutter = shutters[side];
        if (shutter) {
          const open = state.doors[side] ? 1 : 0;
          shutter.progress += THREE.MathUtils.clamp(open - shutter.progress, -dt * 1.3, dt * 1.3);
          // Only the supplied clip translates shutter_leaf. No second leaf/root offset.
          shutter.action.time = Math.min(.79999, shutter.progress * .8); shutter.mixer.update(0);
        }
        const safe = Math.max(0, (state.safeUntil?.[side] ?? 0) - state.time);
        const flood = floodlights[side]; if (flood) flood.intensity = safe > 0 ? 38 * Math.min(1, safe / 2) : 0;
        const threat = state.creature?.side === side && state.creature.phase === 'threshold';
        corridorLamps[side].color.setHex(threat ? 0xe69a55 : side === 'left' ? 0xffbc76 : 0x77d4c0);
      }
      if (mimic && state.creature) {
        const creature = state.creature, sign = creature.side === 'left' ? -1 : 1;
        const age = Math.max(0, state.time - (creature.phaseStarted ?? state.time));
        mimic.visible = !!creature.side && ['approach', 'threshold', 'retreat'].includes(creature.phase);
        let distance = 7.7;
        if (creature.phase === 'approach') distance -= 3.2 * THREE.MathUtils.clamp(creature.progress ?? age / 8, 0, 1);
        if (creature.phase === 'threshold') distance = 4.5;
        if (creature.phase === 'retreat') distance = 4.5 + 3.2 * Math.min(1, age / 4);
        mimic.position.set(sign * distance, 0, 0); mimic.rotation.y = sign === -1 ? Math.PI / 2 : -Math.PI / 2;
        const clip = creature.phase === 'threshold' ? 'reach' : creature.phase === 'approach' && age < 3 ? 'listen' : 'idle';
        if (clip !== mimicClip) { mimicActions[mimicClip]?.fadeOut(.4); mimicActions[clip]?.reset().fadeIn(.4).play(); mimicClip = clip; }
      }
      mimicMixer?.update(dt);
      const cardKey = `${state.task}|${state.orderId}|${state.challenge?.prompt}|${state.challenge?.response}`;
      if (cardKey !== lastCard) {
        lastCard = cardKey; paper.material.map?.dispose();
        paper.material.map = textTexture(state.orderId ?? 'SERVICE ORDER', [`OPERATION 0${state.task ?? 1} / ACTIVE`, 'CONSOLE IS SOURCE OF TRUTH', 'VERIFY BEFORE COMPLYING'], true, cardTemplates.work_order);
        challengePaper.material.map?.dispose();
        challengePaper.material.map = textTexture('PRIVATE KEY', state.challenge ? [`CHALLENGE: ${state.challenge.prompt}`, `RESPONSE: ${state.challenge.response}`, 'ROTATES EVERY CALL'] : ['AWAITING RADIO CALL'], true, cardTemplates.challenge_card);
      }
      const screenKey = `${state.task}|${Math.floor((state.power ?? 100) / 5)}|${state.doors.left}|${state.doors.right}`;
      if (screenKey !== lastScreen) {
        lastScreen = screenKey; screen.material.map?.dispose();
        screen.material.map = textTexture('CARRIER / 04', [`OPERATION 0${state.task ?? 1}  /  ACTIVE`, state.doors.left || state.doors.right ? 'FIELD LINK  [ AVAILABLE ]' : 'FIELD LINK  [ ISOLATED ]', `RESERVE      ${Math.round(state.power ?? 100)}%`]);
      }
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return; disposed = true; observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      renderer.domElement.removeEventListener('lostpointercapture', pointerUp);
      for (const mixer of mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
      dustGeometry.dispose(); dustMaterial.dispose(); lampCone.shadow.dispose(); disposeObject(scene);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
