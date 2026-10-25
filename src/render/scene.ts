import * as THREE from 'three';
import { disposeObject, loadModels, type ModelName } from './assets';
import { STATION_TARGETS, type Station } from './stations';
import { projectCreature, type CameraFeed, type WorldPosition } from './cctv';
import { createDisplay, drawTerminal, drawProximity, drawCameraOverlay, plateTexture } from './displays';
import type { RenderState } from './state';
import { createWeathering } from './weathering';
import { alarmIntensity, scareStrength } from './presentation';
import { hitStation } from './interaction';
import { BASEMENT_DOOR, buildBasementDoor } from '../cutscene/props/basementDoor';
export type { RenderState } from './state';

export interface SceneView {
  ready: Promise<void>;
  update(state: RenderState, dt: number): void;
  setStation(station: Station, reducedMotion?: boolean): void;
  onInteract(callback: (station: Station) => void): () => void;
  dispose(): void;
  diagnostics: { loadedAssets: string[]; animationClips: string[]; error: string | null; cameraFeed: CameraFeed; silhouetteVisible: boolean; listenerYaw: number; listenerPosition: WorldPosition; hoveredStation: Station | null };
}
export function createScene(container: HTMLElement): SceneView {
  const diagnostics: SceneView['diagnostics'] = { loadedAssets: [], animationClips: [], error: null, cameraFeed: 'A', silhouetteVisible: false, listenerYaw: 0, listenerPosition: [.05, 1.62, .60], hoveredStation: null };
  let disposed = false, reducedMotion = false, station: Station = 'terminal';
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020303); scene.fog = new THREE.FogExp2(0x040504, .065);
  const camera = new THREE.PerspectiveCamera(63, 1, .04, 25); camera.position.set(.05, 1.62, .60); camera.lookAt(STATION_TARGETS.terminal);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .79;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  renderer.domElement.setAttribute('aria-label', 'Sealed HUSH shelter. Click equipment to inspect it. Drag to look; keyboard controls also select each station.');
  container.appendChild(renderer.domElement);
  const hemisphere = new THREE.HemisphereLight(0x59644c, 0x070807, .21); scene.add(hemisphere);
  const fill = new THREE.AmbientLight(0x6b6952, .065); scene.add(fill);
  const overhead = new THREE.PointLight(0x836342, 1.15, 4.2, 2); overhead.position.set(.2, 2.65, -.65); scene.add(overhead);
  const deskLamp = new THREE.PointLight(0xf09b56, 3.2, 2.5, 2); deskLamp.position.set(-1.28, 1.72, -1.54); scene.add(deskLamp);
  const taskSpot = new THREE.SpotLight(0xffb976, 5.2, 3.2, .58, .8, 1.8); taskSpot.position.set(-1.3, 1.70, -1.62); taskSpot.target.position.set(-.6, .95, -1.65);
  taskSpot.castShadow = true; taskSpot.shadow.mapSize.set(512, 512); scene.add(taskSpot, taskSpot.target);
  const emergency = new THREE.PointLight(0xda6e36, .72, 2.3, 2); emergency.position.set(-.7, 1.57, 2.18); scene.add(emergency);
  const frontGlow = new THREE.PointLight(0xadb178, .48, 1.6, 2); frontGlow.position.set(.05, 1.43, -1.14); scene.add(frontGlow);
  const alarm = new THREE.PointLight(0xb7190b, .12, 5, 2); alarm.position.set(1.05, 2.3, -1.95); scene.add(alarm);
  const weathering = createWeathering(), steel = weathering.material('steel'), brass = weathering.material('rust');
  function box(size: [number, number, number], pos: WorldPosition, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  }
  function plate(title: string, lines: string[], pos: WorldPosition, width: number, rotation = 0) {
    const material = weathering.material('cream'); material.map = plateTexture(title, lines); material.color.setHex(0xa29a7c);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 2), material);
    mesh.position.set(...pos); mesh.rotation.y = rotation; scene.add(mesh); return mesh;
  }
  box([.25, .035, .22], [-1.35, .945, -1.96], steel); box([.027, .77, .027], [-1.35, 1.32, -1.96], brass); box([.36, .08, .23], [-1.26, 1.72, -1.83], steel);
  const lampSurface = new THREE.MeshStandardMaterial({ color: 0x82745a, emissive: 0xe29049, emissiveIntensity: .22 }); box([.29, .015, .18], [-1.26, 1.672, -1.83], lampSurface);
  box([.22, .22, .12], [1.05, 2.3, -2.36], steel);
  const alarmLens = new THREE.MeshStandardMaterial({ color: 0x330604, emissive: 0xc52b0d, emissiveIntensity: .16, roughness: .38 });
  const alarmBulb = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 8), alarmLens); alarmBulb.position.set(1.05, 2.3, -2.25); scene.add(alarmBulb);
  for (const x of [1.01, 1.09]) box([.008, .19, .015], [x, 2.3, -2.17], steel);
  // Exposed cable runs and a corroded cable tray break up the clean kit surfaces.
  const rubber = weathering.material('dark');
  for (let i = 0; i < 4; i++) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-2.9 + i * .03, 2.95, -2.33), new THREE.Vector3(-2.88 + i * .03, 2.20, -2.34), new THREE.Vector3(-2.84 + i * .03, .74, -2.33), new THREE.Vector3(-2.8 + i * .03, .25, -2.3)]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .014, 6, false), rubber); cable.castShadow = true; scene.add(cable);
  }
  box([2.1, .075, .12], [-.22, .60, -2.33], brass);
  // Wall ribs project into the shelter; mount signage in front of their faces.
  const titlePlate = plate('HUSH / 04', ['EMERGENCY OBSERVATION', 'FOREST RESEARCH DIVISION'], [.1, 2.38, -2.32], 1.15);
  const protocolPlate = plate('BASEMENT ACCESS', ['FOUR STAGES / FOUR LOCKS', 'REPAIR / REDIRECT', 'DECOY, THEN THE MOTOR'], [-.8, 1.66, -2.32], .62);
  // The basement door left of the desk: each research stage releases one of its four locks, and
  // after the last decoy its beacon turns while the motor spins up. The ending film opens it.
  const basement = buildBasementDoor(); basement.position.set(-2.0, 0, -2.5); weathering.apply(basement); scene.add(basement);
  basement.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = object.receiveShadow = true; const material = object.material as THREE.MeshStandardMaterial; if (material.name === 'hazard_yellow') material.color.setHex(0xc9a33a); if (material.name === 'hazard_black') material.color.setHex(0x2c2c2a); } });
  const lockLamps = [0, 1, 2, 3].map(i => { const mesh = basement.getObjectByName(`lock_lamp_${i}`) as THREE.Mesh, material = new THREE.MeshStandardMaterial({ color: 0x1c0605, emissive: 0xff2a1a, emissiveIntensity: .8 }); mesh.material = material; return material; });
  const lockBolts = [0, 1, 2, 3].map(i => basement.getObjectByName(`lock_bolt_${i}`)!), boltRest = lockBolts.map(bolt => bolt.position.x);
  const beaconMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2508, emissive: 0xffa040, emissiveIntensity: .08 }); (basement.getObjectByName('beacon_lens') as THREE.Mesh).material = beaconMaterial;
  const beacon = new THREE.PointLight(0xff9530, 0, 3.2, 2); beacon.position.set(-1.34, 2.45, -2.15); scene.add(beacon);
  const doorLamp = new THREE.PointLight(0xd8a060, 1.4, 2.4, 2); doorLamp.position.set(-1.85, 2.25, -1.95); scene.add(doorLamp);
  { const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 62 }), ctx = canvas.getContext('2d')!; ctx.fillStyle = '#a49d84'; ctx.fillRect(0, 0, 256, 62); ctx.fillStyle = '#191a16'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center'; ctx.fillText('BASEMENT', 128, 46);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; (basement.getObjectByName('door_label') as THREE.Mesh).material = new THREE.MeshStandardMaterial({ map, roughness: .9 }); }
  const cameraPlate = plate('SECURITY FEEDS', ['REMOTE FACILITY CAMERAS', 'LIMITED COVERAGE'], [.75, 1.95, -2.32], .73);
  const sensorPlate = plate('CAMERA INPUT', ['OPTIONAL PERSONAL SENSOR', 'NOT A SECURITY FEED'], [1.9, 2.16, -2.32], .65);
  const doorPlate = plate('SEALED SHELTER', ['DO NOT ATTEMPT TO OPEN', 'USE EMERGENCY QUIET'], [-1.75, 2.2, 2.255], .70, Math.PI);
  const switchPlate = plate('EMERGENCY', ['Q / QUIET', 'HOLD F / RESTORE'], [-.7, 1.93, 2.47], .56, Math.PI);
  const terminalDisplay = createDisplay(), proximityDisplay = createDisplay(512, 384), cctvCaption = createDisplay(1024, 576, false);
  const models = new Map<ModelName, THREE.Object3D>(), mixers: THREE.AnimationMixer[] = [], orphanMaterials: THREE.Material[] = [];
  const faultActions: THREE.AnimationAction[] = [], faultLamps: THREE.MeshStandardMaterial[] = [];
  let machineMixer: THREE.AnimationMixer | null = null, doorMixer: THREE.AnimationMixer | null = null, switchMixer: THREE.AnimationMixer | null = null, creatureMixer: THREE.AnimationMixer | null = null;
  let doorImpact: THREE.AnimationAction | null = null, doorDent: THREE.AnimationAction | null = null, switchAction: THREE.AnimationAction | null = null;
  let previousFaults = '', previousPower: RenderState['power'] | null = null, lostAt: number | null = null, lastScareId: string | number | null = null, lastStateTime = 0, wasInspecting = false;
  let yaw = 0, pitch = 0, dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;
  const interactions = new Set<(station: Station) => void>(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const seatedPosition = new THREE.Vector3(.05, 1.62, .60), desiredPosition = new THREE.Vector3(), desiredTarget = new THREE.Vector3();
  const aim = camera.clone();
  // This scene never shares its creature with the shelter scene.
  const cctvScene = new THREE.Scene(), cctvCamera = new THREE.OrthographicCamera(0, 1, 1, 0, .01, 20);
  cctvCamera.position.set(0, 0, 5); cctvCamera.lookAt(0, 0, 0);
  const cctvTarget = new THREE.WebGLRenderTarget(1024, 576, { depthBuffer: true }); cctvTarget.texture.colorSpace = THREE.SRGBColorSpace;
  const feedImages: Partial<Record<CameraFeed | 'SEALED' | 'OFFLINE', THREE.Texture>> = {};
  let cctvCreature: THREE.Object3D | null = null, lastDisplay = -Infinity, lastFeed: CameraFeed | null = null;
  const overlayMaterial = new THREE.MeshBasicMaterial({ map: cctvCaption.texture, transparent: true, depthTest: false, toneMapped: false });
  const cctvOverlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overlayMaterial); cctvOverlay.position.set(.5, .5, 2); cctvOverlay.renderOrder = 100; cctvScene.add(cctvOverlay);
  const decals = [['title', titlePlate], ['protocol_card', protocolPlate], ['camera_notice', cameraPlate], ['sensor_notice', sensorPlate], ['door_label', doorPlate], ['emergency_switch', switchPlate]] as const;
  const extraTextures: THREE.Texture[] = [], loader = new THREE.TextureLoader();
  const visualsReady = Promise.all([
    ...decals.map(async ([name, mesh]) => { const texture = await loader.loadAsync(`/assets/decals/${name}.svg`); if (disposed) { texture.dispose(); return; } texture.colorSpace = THREE.SRGBColorSpace; mesh.material.map?.dispose(); mesh.material.map = texture; }),
    ...([['A', 'cam_a_clearing'], ['B', 'cam_b_path'], ['C', 'cam_c_containment'], ['SEALED', 'cam_c_sealed']] as const).map(async ([feed, name]) => { const texture = await loader.loadAsync(`/assets/cameras/${name}.png`); if (disposed) { texture.dispose(); return; } texture.colorSpace = THREE.SRGBColorSpace; feedImages[feed] = texture; extraTextures.push(texture); }),
    loader.loadAsync('/assets/decals/feed_offline.svg').then(texture => { if (disposed) texture.dispose(); else { texture.colorSpace = THREE.SRGBColorSpace; feedImages.OFFLINE = texture; extraTextures.push(texture); } }),
  ]);
  const modelsReady = loadModels(name => diagnostics.loadedAssets.push(name)).then(assets => {
    if (disposed) { Object.values(assets).forEach(asset => disposeObject(asset.scene)); return; }
    const placement: Record<Exclude<ModelName, 'creature_cctv'>, [WorldPosition, number]> = {
      shelter: [[0, 0, 0], 0], sealed_door: [[-1.75, 0, 2.39], Math.PI], workdesk: [[0, 0, -1.8], 0], terminal: [[-.62, .92, -1.8], 0], security_monitor: [[.72, .92, -1.8], 0], proximity_detector: [[1.85, 1.60, -2.35], 0], radio_speaker: [[-1.30, .92, -1.8], 0], machine_rack: [[2.67, 0, .05], -Math.PI / 2], emergency_switch: [[-.70, 1.35, 2.36], Math.PI],
    };
    for (const [name, asset] of Object.entries(assets) as [ModelName, typeof assets.shelter][]) {
      models.set(name, asset.scene);
      if (name !== 'creature_cctv') { const [pos, rotation] = placement[name]; asset.scene.position.set(...pos); asset.scene.rotation.y = rotation; weathering.apply(asset.scene); scene.add(asset.scene); }
      if (name === 'terminal') asset.scene.userData.lockInStation = 'terminal';
      if (name === 'security_monitor') asset.scene.userData.lockInStation = 'cameras';
      if (name === 'machine_rack' || name === 'emergency_switch' || name === 'proximity_detector') asset.scene.userData.lockInStation = 'equipment';
      asset.animations.forEach(clip => diagnostics.animationClips.push(`${name}.${clip.name}`));
    }
    function replaceMaterial(mesh: THREE.Mesh, next: THREE.Material) { orphanMaterials.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material])); mesh.material = next; }
    function assign(model: ModelName, node: string, texture: THREE.Texture) { const mesh = models.get(model)!.getObjectByName(node) as THREE.Mesh; if (!mesh?.isMesh) throw new Error(`Missing display ${model}/${node}`); replaceMaterial(mesh, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })); }
    assign('terminal', 'terminal_screen', terminalDisplay.texture); assign('proximity_detector', 'proximity_screen', proximityDisplay.texture);
    cctvTarget.texture.flipY = false; assign('security_monitor', 'security_screen', cctvTarget.texture);
    machineMixer = new THREE.AnimationMixer(assets.machine_rack.scene); mixers.push(machineMixer);
    for (let i = 0; i < 4; i++) {
      const action = machineMixer.clipAction(assets.machine_rack.animations.find(value => value.name === `fault_0${i + 1}`)!); action.play(); action.paused = true; faultActions.push(action);
      const lamp = assets.machine_rack.scene.getObjectByName(`unit_0${i + 1}_fault_lamp`) as THREE.Mesh;
      const material = (lamp.material as THREE.MeshStandardMaterial).clone(); replaceMaterial(lamp, material); faultLamps.push(material);
    }
    doorMixer = new THREE.AnimationMixer(assets.sealed_door.scene); mixers.push(doorMixer);
    doorImpact = doorMixer.clipAction(assets.sealed_door.animations.find(value => value.name === 'impact')!); doorImpact.setLoop(THREE.LoopOnce, 1); doorImpact.clampWhenFinished = true;
    doorDent = doorMixer.clipAction(assets.sealed_door.animations.find(value => value.name === 'dent')!); doorDent.setLoop(THREE.LoopOnce, 1); doorDent.clampWhenFinished = true;
    switchMixer = new THREE.AnimationMixer(assets.emergency_switch.scene); mixers.push(switchMixer);
    switchAction = switchMixer.clipAction(assets.emergency_switch.animations.find(value => value.name === 'flip_off')!); switchAction.play(); switchAction.paused = true;
    cctvCreature = new THREE.Group(); cctvCreature.add(assets.creature_cctv.scene); cctvScene.add(cctvCreature); cctvCreature.visible = false;
    assets.creature_cctv.scene.traverse(object => { if (object instanceof THREE.Mesh) replaceMaterial(object, new THREE.MeshBasicMaterial({ color: 0x07110c })); });
    creatureMixer = new THREE.AnimationMixer(assets.creature_cctv.scene); mixers.push(creatureMixer); creatureMixer.clipAction(assets.creature_cctv.animations.find(value => value.name === 'idle')!).play();
    previousFaults = '';
  });
  const ready = Promise.all([modelsReady, visualsReady]).then(() => undefined).catch((error: unknown) => { diagnostics.error = error instanceof Error ? error.message : String(error); throw error; });
  function drawCctv(state: RenderState) {
    const feed = state.cameraFeed ?? 'A', powered = state.power === 'on', sealed = state.status === 'won'; diagnostics.cameraFeed = feed;
    cctvScene.background = powered ? (feedImages[feed === 'C' && sealed ? 'SEALED' : feed] ?? new THREE.Color(0x09110c)) : (feedImages.OFFLINE ?? new THREE.Color(0x020705));
    const corruption = scareStrength(state.time, state.scare, reducedMotion, state.softScares);
    const projection = powered && corruption < .3 ? projectCreature(feed, state.creature.position, sealed) : null; diagnostics.silhouetteVisible = !!projection;
    if (cctvCreature) { cctvCreature.visible = !!projection; if (projection) { cctvCreature.position.set(projection.x, 1 - projection.y, 0); cctvCreature.scale.setScalar(projection.scale); } }
    drawCameraOverlay(cctvCaption, state, corruption, reducedMotion);
    renderer.setRenderTarget(cctvTarget); renderer.render(cctvScene, cctvCamera); renderer.setRenderTarget(null);
  }
  function resize() { if (disposed) return; const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  function stationAt(x: number, y: number): Station | null {
    const bounds = renderer.domElement.getBoundingClientRect(); pointer.set((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera); return hitStation(raycaster, scene);
  }
  function down(event: PointerEvent) { if (event.button !== 0) return; dragging = true; moved = false; downX = lastX = event.clientX; downY = lastY = event.clientY; renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = 'grabbing'; }
  function move(event: PointerEvent) {
    if (!dragging) { diagnostics.hoveredStation = stationAt(event.clientX, event.clientY); renderer.domElement.style.cursor = diagnostics.hoveredStation ? 'pointer' : 'grab'; return; }
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) moved = true;
    if (moved) { yaw = THREE.MathUtils.clamp(yaw - (event.clientX - lastX) * .003, -.75, .75); pitch = THREE.MathUtils.clamp(pitch - (event.clientY - lastY) * .0025, -.48, .45); }
    lastX = event.clientX; lastY = event.clientY;
  }
  function up(event: PointerEvent) {
    const clicked = dragging && !moved && event.type === 'pointerup' && Math.hypot(event.clientX - downX, event.clientY - downY) <= 6;
    dragging = false; renderer.domElement.style.cursor = 'grab';
    if (clicked) { const selected = stationAt(event.clientX, event.clientY); if (selected) interactions.forEach(callback => callback(selected)); }
  }
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up); renderer.domElement.addEventListener('lostpointercapture', up);
  return {
    ready, diagnostics,
    setStation(next, reduced = false) { reducedMotion = reduced; if (next !== station) { station = next; yaw = 0; pitch = 0; } },
    onInteract(callback) { interactions.add(callback); return () => { interactions.delete(callback); }; },
    update(state, delta) {
      if (disposed) return; const dt = state.paused ? 0 : Math.max(0, Math.min(delta, .1));
      const inspection = state.inspection && (station === 'terminal' || station === 'cameras');
      if (!!inspection !== wasInspecting) { yaw = 0; pitch = 0; wasInspecting = !!inspection; }
      desiredPosition.copy(seatedPosition); desiredTarget.copy(STATION_TARGETS[station]);
      // On squarer landscape screens the monitor view slides right so the CCTV feed clears the docked panel.
      if (inspection) { const x = station === 'terminal' ? -.62 : .72 + (camera.aspect >= 1.2 && camera.aspect < 1.5 ? .1 : 0); desiredPosition.set(x, 1.47, -.32); desiredTarget.set(x, 1.33, -1.66); }
      camera.position.lerp(desiredPosition, reducedMotion ? 1 : 1 - Math.exp(-delta * 5));
      aim.position.copy(camera.position); aim.lookAt(desiredTarget); const angles = new THREE.Euler().setFromQuaternion(aim.quaternion, 'YXZ'); angles.y += yaw; angles.x += pitch;
      const scare = scareStrength(state.time, state.scare, reducedMotion, state.softScares);
      if (!reducedMotion && state.scare?.kind !== 'monitor') angles.z += Math.sin(Math.max(0, state.time - (state.scare?.at ?? 0)) * 32) * scare * .024;
      camera.quaternion.slerp(new THREE.Quaternion().setFromEuler(angles), reducedMotion ? 1 : 1 - Math.exp(-delta * 9));
      diagnostics.listenerYaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
      diagnostics.listenerPosition = camera.position.toArray() as WorldPosition;
      const targetFov = inspection ? 43 : station === 'cameras' ? 48 : station === 'equipment' ? 67 : 63; camera.fov += (targetFov - camera.fov) * (reducedMotion ? 1 : 1 - Math.exp(-delta * 8)); camera.updateProjectionMatrix();
      const powered = state.power === 'on', light = powered ? 1 : state.power === 'quiet' ? .045 : .012;
      const red = alarmIntensity(state.time, state.alarm, reducedMotion) * (state.softScares ? .7 : 1);
      hemisphere.intensity = powered ? .21 : .055; fill.intensity = powered ? .065 : .018; overhead.intensity = 1.15 * light; deskLamp.intensity = 3.2 * light; taskSpot.intensity = 5.2 * light; frontGlow.intensity = powered ? .48 : 0; lampSurface.emissiveIntensity = powered ? .22 : 0;
      alarm.intensity = .10 + red * 4.2; alarmLens.emissiveIntensity = .16 + red * 1.1;
      if (switchAction && switchMixer) { switchAction.time = powered ? 0 : .34999; switchMixer.update(0); }
      const active = powered ? state.faults : [], faultKey = `${active.join(',')}|${reducedMotion}`;
      if (faultKey !== previousFaults) { previousFaults = faultKey; for (let i = 0; i < 4; i++) {
        const action = faultActions[i]; if (action) { action.paused = !active.includes(i) || reducedMotion; if (action.paused) action.time = 0; }
        const lamp = faultLamps[i]; if (lamp) { lamp.color.setHex(active.includes(i) ? 0xbb8241 : 0x233528); lamp.emissive.setHex(active.includes(i) ? 0xdf8531 : 0); lamp.emissiveIntensity = active.includes(i) ? .75 : 0; }
      } }
      machineMixer?.update(dt);
      const locks = Math.max(0, Math.min(4, state.locks ?? 0)), motor = !!state.doorMotor && powered;
      lockLamps.forEach((lamp, i) => { const open = i < locks; lamp.emissive.setHex(open ? 0x3dff6e : 0xff2a1a); lamp.emissiveIntensity = (open ? 1.1 : .8) * (powered ? 1 : .25); });
      lockBolts.forEach((bolt, i) => { bolt.position.x = boltRest[i]! + (i < locks ? BASEMENT_DOOR.lockTravel : 0); });
      const sweep = motor && !reducedMotion ? .5 + .5 * Math.sin(state.time * Math.PI * 2 * 1.1) : motor ? .6 : 0;
      doorLamp.intensity = 1.4 * light; beacon.intensity = motor ? .6 + 2.4 * sweep : 0; beaconMaterial.emissiveIntensity = motor ? .6 + 1.8 * sweep : .08;
      if (state.status === 'lost' && lostAt === null) { lostAt = state.time; doorImpact?.stop(); doorDent?.reset().play(); }
      if (state.status !== 'lost' && lostAt !== null) { lostAt = null; doorDent?.stop(); doorImpact?.stop(); }
      if (state.time < lastStateTime) lastScareId = null; lastStateTime = state.time;
      if (state.scare && state.scare.id !== lastScareId) {
        lastScareId = state.scare.id;
        if (scare > 0 && state.scare.kind === 'impact' && !reducedMotion && state.status !== 'lost') { doorImpact?.reset().setEffectiveWeight(state.softScares ? .35 : 1).play(); }
      }
      // A committed loss freezes simulation; its cosmetic dent can still settle.
      doorMixer?.update(state.status === 'lost' ? Math.max(0, Math.min(delta, .1)) : dt); if (!reducedMotion) creatureMixer?.update(dt);
      if (state.time < lastDisplay || state.time - lastDisplay >= .08 || state.paused || previousPower !== state.power || lastFeed !== state.cameraFeed) { drawTerminal(terminalDisplay, state); drawProximity(proximityDisplay, state); drawCctv(state); lastDisplay = state.time; lastFeed = state.cameraFeed ?? 'A'; }
      previousPower = state.power; renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return; disposed = true; observer.disconnect(); interactions.clear();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('pointerup', up); renderer.domElement.removeEventListener('pointercancel', up); renderer.domElement.removeEventListener('lostpointercapture', up);
      for (const mixer of mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
      disposeObject(scene); disposeObject(cctvScene); new Set(orphanMaterials).forEach(material => material.dispose()); extraTextures.forEach(texture => texture.dispose());
      terminalDisplay.texture.dispose(); proximityDisplay.texture.dispose(); cctvCaption.texture.dispose(); cctvTarget.dispose(); weathering.dispose(); taskSpot.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
