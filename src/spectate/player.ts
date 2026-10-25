import * as THREE from 'three';

/** The player as the spectator's shelter camera sees them: a low-poly figure in headphones on a chair at
 * the desk, facing the terminal (−Z). Driven only by public state: typing while the equipment runs,
 * hunched and still while it is off, looking over their shoulder at the sealed door when it is close,
 * flinching at a scare, and after a win standing up and slipping out through the basement door. */
export type PlayerInput = {
  /** Wall-clock seconds on this device (idle motion only; never game time). */
  seconds: number;
  equipment: string | undefined;
  playing: boolean;
  /** The creature is close (same latch as the room's alarm lamp). */
  alarm: boolean;
  /** Seconds since a scare or a committed attack was seen, or null. */
  scareAge: number | null;
  /** Seconds since the win was seen, or null. */
  wonAge: number | null;
  reducedMotion: boolean;
};
type V3 = [number, number, number];
export type PlayerPose = {
  /** Body root on the floor (x, z) and its yaw; `rise` 0 seated … 1 standing. */
  x: number; z: number; yaw: number; rise: number; visible: boolean;
  lean: number; twist: number; headYaw: number; headPitch: number;
  /** Per side [left, right], radians about X: shoulder (+ swings the arm forward), elbow (+ bends the
   * forearm forward), hip (+ lifts the thigh forward) and knee (− bends the shin back). */
  shoulder: [number, number]; elbow: [number, number]; hip: [number, number]; knee: [number, number];
  breath: number;
};

/** Seat at the desk, between the terminal and the sonar scope. */
export const SEAT = { x: 0.02, z: -0.95 } as const;
/** Just inside the basement doorway (src/render/scene.ts places the door at x −2.0 on the front wall). */
const BASEMENT: [number, number] = [-2.0, -2.35];
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function playerPose(input: PlayerInput): PlayerPose {
  const { seconds: s, reducedMotion: still } = input;
  const powered = input.equipment === 'on' || input.equipment === undefined, working = input.playing && powered;
  const wiggle = (hz: number, phase = 0) => still ? 0 : Math.sin(s * hz + phase);
  const pose: PlayerPose = {
    x: SEAT.x, z: SEAT.z, yaw: 0, rise: 0, visible: true,
    lean: -0.18, twist: 0, headYaw: 0, headPitch: -0.12,
    shoulder: [0.75, 0.75], elbow: [0.95, 0.95], hip: [1.5, 1.5], knee: [-1.5, -1.5],
    breath: 0.012 * wiggle(1.7),
  };
  if (working) {
    // Typing: small alternating forearm taps; now and then a glance right at the sonar scope.
    pose.elbow = [0.95 + 0.06 * wiggle(13), 0.95 + 0.06 * wiggle(13, 1.9)];
    const glance = smooth((Math.sin(s * 0.55) - 0.75) * 4);
    pose.headYaw = -0.55 * glance; pose.headPitch = -0.12 + 0.08 * glance;
  } else {
    // Equipment off: hands pulled into the lap, hunched over, very still, a slight tremble.
    pose.shoulder = [0.25, 0.25]; pose.elbow = [1.15, 1.15];
    pose.lean = -0.38; pose.headPitch = -0.38 + 0.015 * wiggle(23);
  }
  if (input.alarm && input.playing) {
    // It is close: twist round toward the sealed door behind them (over the left shoulder).
    pose.twist = 0.45; pose.headYaw = 1.15 + 0.05 * wiggle(0.9); pose.headPitch = -0.05;
    if (powered) pose.elbow = [0.95, 0.95];
  }
  if (input.scareAge !== null && input.scareAge < 1.2) {
    // A flinch: thrown back, arms up, decaying.
    const k = still ? 0.5 : Math.exp(-input.scareAge * 4) * (1 - Math.exp(-input.scareAge * 40));
    pose.lean += 0.55 * k; pose.shoulder = [pose.shoulder[0] + 1.1 * k, pose.shoulder[1] + 1.1 * k]; pose.elbow = [pose.elbow[0] + 0.6 * k, pose.elbow[1] + 0.6 * k];
    pose.headPitch += 0.25 * k;
  }
  if (input.wonAge !== null) {
    // Stand, turn toward the basement door, walk to it and through.
    const up = smooth(input.wonAge / 0.9), walk = smooth((input.wonAge - 0.9) / 2.8);
    pose.rise = up; pose.lean = mix(pose.lean, -0.05, up); pose.twist = 0; pose.headYaw = 0; pose.headPitch = mix(pose.headPitch, -0.05, up);
    pose.hip = [mix(1.5, 0, up), mix(1.5, 0, up)]; pose.knee = [mix(-1.5, 0, up), mix(-1.5, 0, up)];
    pose.shoulder = [mix(pose.shoulder[0], 0.05, up), mix(pose.shoulder[1], 0.05, up)]; pose.elbow = [mix(pose.elbow[0], 0.2, up), mix(pose.elbow[1], 0.2, up)];
    pose.yaw = Math.atan2(-(BASEMENT[0] - SEAT.x), -(BASEMENT[1] - SEAT.z)) * smooth((input.wonAge - 0.5) / 0.6);
    pose.x = mix(SEAT.x, BASEMENT[0], walk); pose.z = mix(SEAT.z, BASEMENT[1], walk);
    if (walk > 0 && walk < 1 && !still) {
      const stride = Math.sin(input.wonAge * 7.5) * 0.45;
      pose.hip = [stride, -stride]; pose.knee = [-Math.max(0, -stride) * 0.8, -Math.max(0, stride) * 0.8]; pose.shoulder = [-stride * 0.6, stride * 0.6];
    }
    pose.visible = input.wonAge < 4.2;
  }
  return pose;
}

type Limb = { upper: THREE.Group; lower: THREE.Group };
export type PlayerModel = { root: THREE.Group; chair: THREE.Group; apply(pose: PlayerPose): void; dispose(): void };

/** Builds the figure and its chair (both in room coordinates) with shared, disposable materials. */
export function createPlayerModel(steel: THREE.Material): PlayerModel {
  const materials = {
    jacket: new THREE.MeshStandardMaterial({ color: 0x3b4237, roughness: 0.9, flatShading: true }),
    trousers: new THREE.MeshStandardMaterial({ color: 0x24261f, roughness: 0.95, flatShading: true }),
    skin: new THREE.MeshStandardMaterial({ color: 0x9b7a62, roughness: 0.8, flatShading: true }),
    hair: new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 1, flatShading: true }),
    phones: new THREE.MeshStandardMaterial({ color: 0x111211, roughness: 0.5, metalness: 0.3, flatShading: true }),
  };
  const geometries: THREE.BufferGeometry[] = [];
  const box = (size: V3, at: V3, material: THREE.Material, parent: THREE.Object3D) => {
    const geometry = new THREE.BoxGeometry(...size); geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(...at); parent.add(mesh); return mesh;
  };
  const pivot = (at: V3, parent: THREE.Object3D) => { const g = new THREE.Group(); g.position.set(...at); parent.add(g); return g; };

  const chair = new THREE.Group(); chair.position.set(SEAT.x, 0, SEAT.z);
  box([0.46, 0.05, 0.44], [0, 0.46, 0], steel, chair); box([0.44, 0.48, 0.04], [0, 0.74, 0.22], steel, chair);
  for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) box([0.03, 0.44, 0.03], [x, 0.22, z], steel, chair);

  // Root on the floor at the seat; the hips sit at seat height and rise to standing height.
  const root = new THREE.Group(), hips = pivot([0, 0.5, 0.02], root);
  box([0.34, 0.14, 0.24], [0, 0, 0], materials.trousers, hips);
  const waist = pivot([0, 0.06, 0], hips);
  const torso = pivot([0, 0, 0], waist);
  box([0.36, 0.5, 0.22], [0, 0.27, 0], materials.jacket, torso);
  box([0.38, 0.1, 0.24], [0, 0.48, 0], materials.jacket, torso); // shoulders
  const neck = pivot([0, 0.55, 0], torso);
  box([0.08, 0.08, 0.08], [0, 0.03, 0], materials.skin, neck);
  const head = pivot([0, 0.07, 0], neck);
  box([0.19, 0.23, 0.21], [0, 0.12, -0.01], materials.skin, head);
  box([0.2, 0.08, 0.22], [0, 0.23, 0.005], materials.hair, head);
  box([0.2, 0.14, 0.06], [0, 0.15, 0.09], materials.hair, head);
  // Headphones: a band over the top and a cup on each ear.
  box([0.23, 0.025, 0.04], [0, 0.285, 0.01], materials.phones, head);
  for (const x of [-0.115, 0.115]) { box([0.025, 0.09, 0.04], [x, 0.23, 0.01], materials.phones, head); box([0.04, 0.09, 0.08], [x, 0.13, 0.0], materials.phones, head); }
  const arm = (side: number): Limb => {
    const upper = pivot([side * 0.215, 0.46, 0], torso);
    box([0.09, 0.28, 0.09], [0, -0.14, 0], materials.jacket, upper);
    const lower = pivot([0, -0.28, 0], upper);
    box([0.08, 0.26, 0.08], [0, -0.13, 0], materials.jacket, lower);
    box([0.07, 0.08, 0.1], [0, -0.3, 0], materials.skin, lower);
    return { upper, lower };
  };
  const leg = (side: number): Limb => {
    const upper = pivot([side * 0.09, -0.02, 0], hips);
    box([0.13, 0.42, 0.14], [0, -0.21, 0], materials.trousers, upper);
    const lower = pivot([0, -0.42, 0], upper);
    box([0.11, 0.42, 0.12], [0, -0.21, 0], materials.trousers, lower);
    box([0.11, 0.06, 0.24], [0, -0.44, -0.06], materials.phones, lower);
    return { upper, lower };
  };
  const arms = [arm(-1), arm(1)], legs = [leg(-1), leg(1)];
  for (const mesh of [chair, root]) mesh.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    root, chair,
    apply(pose) {
      root.visible = pose.visible;
      root.position.set(pose.x, 0, pose.z); root.rotation.y = pose.yaw;
      hips.position.y = mix(0.5, 0.92, pose.rise);
      waist.rotation.x = pose.lean; waist.scale.y = 1 + pose.breath;
      torso.rotation.y = pose.twist;
      head.rotation.set(pose.headPitch, pose.headYaw, 0, 'YXZ');
      arms.forEach((limb, i) => { limb.upper.rotation.x = pose.shoulder[i]!; limb.lower.rotation.x = pose.elbow[i]!; });
      legs.forEach((limb, i) => { limb.upper.rotation.x = pose.hip[i]!; limb.lower.rotation.x = pose.knee[i]!; });
    },
    dispose() { geometries.forEach(g => g.dispose()); Object.values(materials).forEach(m => m.dispose()); },
  };
}
