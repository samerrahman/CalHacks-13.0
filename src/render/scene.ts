import * as THREE from 'three';
import { disposeObject, loadModels, type ModelName } from './assets';
import { STATION_TARGETS, type Station } from './stations';
import { projectCreature, type CameraFeed, type WorldPosition } from './cctv';
import { createDisplay, drawTerminal, drawProximity, drawCameraOverlay, drawSonar, drawStatus, plateTexture } from './displays';
import type { RenderState } from './state';
import { createWeathering } from './weathering';
import { alarmIntensity, scareStrength } from './presentation';
import { hitRemote, hitStation, hitStatus } from './interaction';
import { createRemote, type RemoteTarget } from './remote';
export type { RenderState } from './state';

export interface SceneView {
  ready: Promise<void>;
  update(state: RenderState, dt: number): void;
  setStation(station: Station, reducedMotion?: boolean): void;
  onInteract(callback: (station: Station) => void): () => void;
  /** Clicks on the wall status unit (clock, cells, exposure gauge). */
  onStatus(callback: () => void): () => void;
  /** Hand-held remote: 'remote' with true when the lowered hand is clicked (raise it) and false for a click anywhere else while raised (lower it), 'quiet' on a click of its QUIET button, 'restore' on press (true) and release (false). */
  onRemote(callback: (target: RemoteTarget, pressed: boolean) => void): () => void;
  dispose(): void;
  diagnostics: { loadedAssets: string[]; animationClips: string[]; error: string | null; cameraFeed: CameraFeed; silhouetteVisible: boolean; listenerYaw: number; listenerPosition: WorldPosition; hoveredStation: Station | null; anchors: Record<'terminal' | 'quiet' | 'restore', { x: number; y: number } | null> };
}
export function createScene(container: HTMLElement): SceneView {
  const diagnostics: SceneView['diagnostics'] = { loadedAssets: [], animationClips: [], error: null, cameraFeed: 'A', silhouetteVisible: false, listenerYaw: 0, listenerPosition: [.05, 1.62, .60], hoveredStation: null, anchors: { terminal: null, quiet: null, restore: null } };
  let disposed = false, reducedMotion = false, station: Station = 'terminal';
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x020303); scene.fog = new THREE.FogExp2(0x040504, .065);
  const camera = new THREE.PerspectiveCamera(63, 1, .04, 25); camera.position.set(.05, 1.62, .60); camera.lookAt(STATION_TARGETS.terminal);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .79;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  renderer.domElement.setAttribute('aria-label', 'Sealed HUSH shelter. Click equipment to inspect it. Drag or use the arrow keys to look; keyboard controls also select each station.');
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
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-2.58 + i * .045, 2.95, -2.31), new THREE.Vector3(-2.55 + i * .045, 2.20, -2.32), new THREE.Vector3(-2.45 + i * .05, .74, -2.21), new THREE.Vector3(-1.83 + i * .05, .35, -2.18)]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .014, 6, false), rubber); cable.castShadow = true; scene.add(cable);
  }
  box([2.35, .075, .12], [-.35, .60, -2.33], brass);
  // Wall ribs project into the shelter; mount signage in front of their faces.
  const titlePlate = plate('HUSH / 04', ['EMERGENCY OBSERVATION', 'FOREST RESEARCH DIVISION'], [.1, 2.38, -2.32], 1.15);
  const protocolPlate = plate('CONTAINMENT PROTOCOL', ['SILENCE / CALIBRATE', 'REPAIR / REDIRECT', 'COMPLETE THE BROADCAST'], [-1.85, 1.66, -2.32], .8);
  const cameraPlate = plate('SECURITY FEEDS', ['REMOTE FACILITY CAMERAS', 'LIMITED COVERAGE'], [.75, 1.95, -2.32], .73);
  const sensorPlate = plate('CAMERA INPUT', ['OPTIONAL PERSONAL SENSOR', 'NOT A SECURITY FEED'], [1.9, 2.16, -2.32], .65);
  const doorPlate = plate('SEALED SHELTER', ['DO NOT ATTEMPT TO OPEN', 'USE EMERGENCY QUIET'], [-1.75, 2.2, 2.255], .70, Math.PI);
  const switchPlate = plate('EMERGENCY', ['Q / QUIET', 'HOLD F / RESTORE'], [-.7, 1.93, 2.47], .56, Math.PI);
  // The player's right hand holds the isolation remote; it rides on the camera.
  const remote = createRemote(); camera.add(remote.group); scene.add(camera);
  const terminalAnchor = new THREE.Vector3(-.62, 1.18, -1.72), projected = new THREE.Vector3();
  const terminalDisplay = createDisplay(), proximityDisplay = createDisplay(512, 384), cctvCaption = createDisplay(1024, 576, false), statusDisplay = createDisplay(640, 800, false), sonarDisplay = createDisplay(768, 768);
  // Round sonar scope on the desk where the security monitor stood: a steel drum, a bezel ring and a
  // circular screen. It is the 'cameras' station, so picking and inspection work as before.
  const scope = new THREE.Group(); scope.position.set(.72, 1.34, -1.78); scope.userData.lockInStation = 'cameras'; scene.add(scope);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(.37, .39, .16, 40), steel); drum.rotation.x = Math.PI / 2; drum.castShadow = true; drum.receiveShadow = true; scope.add(drum);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(.335, .028, 10, 48), brass); bezel.position.z = .085; scope.add(bezel);
  const sonarScreen = new THREE.Mesh(new THREE.CircleGeometry(.32, 64), new THREE.MeshBasicMaterial({ map: sonarDisplay.texture, toneMapped: false })); sonarScreen.position.z = .082; scope.add(sonarScreen);
  for (const x of [-.22, .22]) { const bolt = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .02, 10), brass); bolt.rotation.x = Math.PI / 2; bolt.position.set(x, -.27, .085); scope.add(bolt); }
  const stand = new THREE.Mesh(new THREE.BoxGeometry(.16, .1, .14), steel); stand.position.set(0, -.37, 0); scope.add(stand);
  // Wall status unit left of the title sign, above the terminal: deadline clock, isolation cells, exposure gauge.
  const statusHousing = box([.52, .64, .05], [-.80, 2.05, -2.31], steel); statusHousing.userData.lockInStatus = true;
  const statusScreen = new THREE.Mesh(new THREE.PlaneGeometry(.46, .575), new THREE.MeshBasicMaterial({ map: statusDisplay.texture, toneMapped: false }));
  statusScreen.position.set(-.80, 2.05, -2.282); statusScreen.userData.lockInStatus = true; scene.add(statusScreen);
  const models = new Map<ModelName, THREE.Object3D>(), mixers: THREE.AnimationMixer[] = [], orphanMaterials: THREE.Material[] = [];
  const faultActions: THREE.AnimationAction[] = [], faultLamps: THREE.MeshStandardMaterial[] = [];
  let machineMixer: THREE.AnimationMixer | null = null, doorMixer: THREE.AnimationMixer | null = null, switchMixer: THREE.AnimationMixer | null = null, creatureMixer: THREE.AnimationMixer | null = null;
  let doorImpact: THREE.AnimationAction | null = null, doorDent: THREE.AnimationAction | null = null, switchAction: THREE.AnimationAction | null = null;
  let previousFaults = '', previousPower: RenderState['power'] | null = null, lostAt: number | null = null, lastScareId: string | number | null = null, lastStateTime = 0, wasInspecting = false;
  let remoteOpen = false, holdingRestore = false, yaw = 0, pitch = 0, dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, moved = false;
  const interactions = new Set<(station: Station) => void>(), statusClicks = new Set<() => void>(), remoteCallbacks = new Set<(target: RemoteTarget, pressed: boolean) => void>(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
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
    // The sonar scope replaces the security monitor and the small wall radar; their models stay loaded but hidden.
    assets.security_monitor.scene.visible = false; assets.proximity_detector.scene.visible = false;
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
  function remoteAt(x: number, y: number): RemoteTarget | null {
    const bounds = renderer.domElement.getBoundingClientRect(); pointer.set((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera); return hitRemote(raycaster, scene);
  }
  function statusAt(x: number, y: number): boolean {
    const bounds = renderer.domElement.getBoundingClientRect(); pointer.set((x - bounds.left) / bounds.width * 2 - 1, -(y - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera); return hitStatus(raycaster, scene);
  }
  function down(event: PointerEvent) { if (event.button !== 0) return; if (remoteOpen && remoteAt(event.clientX, event.clientY) === 'restore') { holdingRestore = true; remoteCallbacks.forEach(callback => callback('restore', true)); try { renderer.domElement.setPointerCapture(event.pointerId); } catch { /* release still arrives via pointerup */ } return; } dragging = true; moved = false; downX = lastX = event.clientX; downY = lastY = event.clientY; renderer.domElement.setPointerCapture(event.pointerId); renderer.domElement.style.cursor = 'grabbing'; }
  function move(event: PointerEvent) {
    if (!dragging) { diagnostics.hoveredStation = stationAt(event.clientX, event.clientY); renderer.domElement.style.cursor = diagnostics.hoveredStation || statusAt(event.clientX, event.clientY) || remoteAt(event.clientX, event.clientY) ? 'pointer' : 'grab'; return; }
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) moved = true;
    if (moved) { yaw = THREE.MathUtils.clamp(yaw - (event.clientX - lastX) * .003, -.75, .75); pitch = THREE.MathUtils.clamp(pitch - (event.clientY - lastY) * .0025, -.48, .45); }
    lastX = event.clientX; lastY = event.clientY;
  }
  function up(event: PointerEvent) {
    if (holdingRestore) { holdingRestore = false; remoteCallbacks.forEach(callback => callback('restore', false)); return; }
    const clicked = dragging && !moved && event.type === 'pointerup' && Math.hypot(event.clientX - downX, event.clientY - downY) <= 6;
    dragging = false; renderer.domElement.style.cursor = 'grab';
    if (clicked) { const part = remoteAt(event.clientX, event.clientY); if (part) { if (!remoteOpen) remoteCallbacks.forEach(callback => callback('remote', true)); else if (part === 'quiet') remoteCallbacks.forEach(callback => callback('quiet', true)); return; } if (remoteOpen) { remoteCallbacks.forEach(callback => callback('remote', false)); return; } if (statusAt(event.clientX, event.clientY)) { statusClicks.forEach(callback => callback()); return; } const selected = stationAt(event.clientX, event.clientY); if (selected) interactions.forEach(callback => callback(selected)); }
  }
  // Arrow keys look around like dragging, at a steady rate while held.
  const arrows = new Set<string>(), ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  function arrowDown(event: KeyboardEvent) { const tag = (event.target as HTMLElement | null)?.tagName; if (!ARROWS.includes(event.key) || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; event.preventDefault(); arrows.add(event.key); }
  function arrowUp(event: KeyboardEvent) { arrows.delete(event.key); }
  function arrowsReleased() { arrows.clear(); }
  window.addEventListener('keydown', arrowDown); window.addEventListener('keyup', arrowUp); window.addEventListener('blur', arrowsReleased);
  renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up); renderer.domElement.addEventListener('pointercancel', up); renderer.domElement.addEventListener('lostpointercapture', up);
  return {
    ready, diagnostics,
    setStation(next, reduced = false) { reducedMotion = reduced; if (next !== station) { station = next; yaw = 0; pitch = 0; } },
    onInteract(callback) { interactions.add(callback); return () => { interactions.delete(callback); }; },
    onStatus(callback) { statusClicks.add(callback); return () => { statusClicks.delete(callback); }; },
    onRemote(callback) { remoteCallbacks.add(callback); return () => { remoteCallbacks.delete(callback); }; },
    update(state, delta) {
      if (disposed) return; const dt = state.paused ? 0 : Math.max(0, Math.min(delta, .1));
      const inspection = state.inspection && (station === 'terminal' || station === 'cameras');
      if (!!inspection !== wasInspecting) { yaw = 0; pitch = 0; wasInspecting = !!inspection; }
      if (arrows.size && !state.paused) {
        const step = Math.min(delta, .1), across = (arrows.has('ArrowLeft') ? 1 : 0) - (arrows.has('ArrowRight') ? 1 : 0), upward = (arrows.has('ArrowUp') ? 1 : 0) - (arrows.has('ArrowDown') ? 1 : 0);
        yaw = THREE.MathUtils.clamp(yaw + across * 1.4 * step, -.75, .75); pitch = THREE.MathUtils.clamp(pitch + upward * 1.1 * step, -.48, .45);
      }
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
      remoteOpen = !!state.remote?.open; remote.update(state, delta, reducedMotion, !!inspection);
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
      if (state.status === 'lost' && lostAt === null) { lostAt = state.time; doorImpact?.stop(); doorDent?.reset().play(); }
      if (state.status !== 'lost' && lostAt !== null) { lostAt = null; doorDent?.stop(); doorImpact?.stop(); }
      if (state.time < lastStateTime) lastScareId = null; lastStateTime = state.time;
      if (state.scare && state.scare.id !== lastScareId) {
        lastScareId = state.scare.id;
        if (scare > 0 && state.scare.kind === 'impact' && !reducedMotion && state.status !== 'lost') { doorImpact?.reset().setEffectiveWeight(state.softScares ? .35 : 1).play(); }
      }
      // A committed loss freezes simulation; its cosmetic dent can still settle.
      doorMixer?.update(state.status === 'lost' ? Math.max(0, Math.min(delta, .1)) : dt); if (!reducedMotion) creatureMixer?.update(dt);
      if (state.time < lastDisplay || state.time - lastDisplay >= .08 || state.paused || previousPower !== state.power || lastFeed !== state.cameraFeed) { drawTerminal(terminalDisplay, state); drawStatus(statusDisplay, state); remote.draw(state); drawSonar(sonarDisplay, state); lastDisplay = state.time; lastFeed = state.cameraFeed ?? 'A'; }
      previousPower = state.power; renderer.render(scene, camera);
      // Screen position of the terminal, so the tutorial arrow can point at it now there is no Use terminal prompt.
      const bounds = renderer.domElement.getBoundingClientRect(); projected.copy(terminalAnchor).project(camera);
      const toScreen = () => projected.z < 1 ? { x: bounds.left + (projected.x + 1) / 2 * bounds.width, y: bounds.top + (1 - projected.y) / 2 * bounds.height } : null;
      diagnostics.anchors.terminal = toScreen();
      for (const key of ['quiet', 'restore'] as const) { remote.anchors(projected, key).project(camera); diagnostics.anchors[key] = inspection ? null : toScreen(); }
    },
    dispose() {
      if (disposed) return; disposed = true; observer.disconnect(); window.removeEventListener('keydown', arrowDown); window.removeEventListener('keyup', arrowUp); window.removeEventListener('blur', arrowsReleased); interactions.clear(); statusClicks.clear(); remoteCallbacks.clear();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('pointerup', up); renderer.domElement.removeEventListener('pointercancel', up); renderer.domElement.removeEventListener('lostpointercapture', up);
      for (const mixer of mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
      disposeObject(scene); disposeObject(cctvScene); new Set(orphanMaterials).forEach(material => material.dispose()); extraTextures.forEach(texture => texture.dispose());
      terminalDisplay.texture.dispose(); proximityDisplay.texture.dispose(); cctvCaption.texture.dispose(); statusDisplay.texture.dispose(); sonarDisplay.texture.dispose(); remote.dispose(); cctvTarget.dispose(); weathering.dispose(); taskSpot.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
