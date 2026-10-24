import * as THREE from 'three';

/** One shared palette so every prop reads as the same low-poly world. Keys are the only
 * colours props may use; add a key here (not a literal in a prop) if something is missing. */
export const PALETTE = {
  concrete: { color: 0x4a4d4a, roughness: 0.95 },
  concrete_dark: { color: 0x2c2e2c, roughness: 0.95 },
  concrete_stain: { color: 0x3a3a33, roughness: 1 },
  metal: { color: 0x5b6266, roughness: 0.6, metalness: 0.55 },
  metal_dark: { color: 0x262b2e, roughness: 0.7, metalness: 0.5 },
  rust: { color: 0x6b3a22, roughness: 0.9, metalness: 0.2 },
  lab_panel: { color: 0x8f9c9a, roughness: 0.7 },
  lab_floor: { color: 0x323a38, roughness: 0.85 },
  hazard_yellow: { color: 0xb8921f, roughness: 0.7 },
  hazard_black: { color: 0x161616, roughness: 0.8 },
  rubber: { color: 0x121314, roughness: 0.95 },
  cable: { color: 0x1c1e1f, roughness: 0.8 },
  glass: { color: 0x9fd6d0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.22 },
  screen_teal: { color: 0x0b2a27, emissive: 0x37e0c8, emissiveIntensity: 1.4, roughness: 0.4 },
  screen_amber: { color: 0x2a1a08, emissive: 0xffa53a, emissiveIntensity: 1.2, roughness: 0.4 },
  alarm_red: { color: 0x3a0806, emissive: 0xff2a1a, emissiveIntensity: 2.2, roughness: 0.5 },
  exit_green: { color: 0x07240f, emissive: 0x3dff6e, emissiveIntensity: 1.8, roughness: 0.5 },
  lamp_warm: { color: 0x3a2508, emissive: 0xffb35c, emissiveIntensity: 2.4, roughness: 0.4 },
  tank_fluid: { color: 0x0c3a34, emissive: 0x0f6b5e, emissiveIntensity: 0.6, roughness: 0.2, transparent: true, opacity: 0.55 },
  bark: { color: 0x33261c, roughness: 1 },
  pine: { color: 0x1d3628, roughness: 0.95 },
  pine_dark: { color: 0x13251c, roughness: 0.95 },
  moss: { color: 0x2c4429, roughness: 1 },
  dirt: { color: 0x372e25, roughness: 1 },
  mud: { color: 0x2a231c, roughness: 0.9 },
  rock: { color: 0x515456, roughness: 0.95 },
  // Shared with the game's shelter and creature GLBs, so the cutscene hands off seamlessly.
  deep_steel: { color: 0x294240, roughness: 0.6, metalness: 0.45 },
  steel_teal: { color: 0x577974, roughness: 0.6, metalness: 0.35 },
  wall_teal: { color: 0x65817c, roughness: 0.85 },
  cream: { color: 0xcac7b1, roughness: 0.8 },
  amber_glow: { color: 0x3a240c, emissive: 0xe29948, emissiveIntensity: 1.6, roughness: 0.5 },
  light_panel: { color: 0x2a3234, emissive: 0xdff4ff, emissiveIntensity: 1.6, roughness: 0.5 },
  paper: { color: 0xb9b8ad, roughness: 0.95 },
  water: { color: 0x0d1315, roughness: 0.05, metalness: 0.3 },
  void: { color: 0x000000, roughness: 1 }, // stays black under any light: openings into darkness
  creature_skin: { color: 0x16211f, roughness: 0.75 },
  claw_skin: { color: 0x5d6a62, roughness: 0.45 }, // pale and wet, so the hand reads against the dark
  talon: { color: 0x14110f, roughness: 0.35 },
  creature_flesh: { color: 0x5a3c3a, roughness: 0.7 },
  creature_eye: { color: 0x1c2224, emissive: 0xcfe8ff, emissiveIntensity: 0.9, roughness: 0.3 },
  labcoat: { color: 0xc9cec8, roughness: 0.9 },
  skin: { color: 0xb48a70, roughness: 0.8 },
  glove: { color: 0x2e3a40, roughness: 0.7 },
  flashlight_lens: { color: 0x4a4030, emissive: 0xfff1d0, emissiveIntensity: 2.5, roughness: 0.2 },
} as const satisfies Record<string, THREE.MeshStandardMaterialParameters>;
export type MaterialKey = keyof typeof PALETTE;

const cache = new Map<MaterialKey, THREE.MeshStandardMaterial>();
/** Shared material per key. Use clone() before animating one instance's colour. */
export function material(key: MaterialKey): THREE.MeshStandardMaterial {
  let m = cache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ ...PALETTE[key], flatShading: true }); m.name = key; cache.set(key, m); }
  return m;
}

/** Faceted look that survives GLB export (glTF has no flat-shading flag). */
export function facet(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.computeVertexNormals();
  return flat;
}

export function mesh(geometry: THREE.BufferGeometry, key: MaterialKey, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(facet(geometry), material(key));
  if (name) m.name = name;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function box(w: number, h: number, d: number, key: MaterialKey, at: [number, number, number] = [0, 0, 0], name?: string): THREE.Mesh {
  const m = mesh(new THREE.BoxGeometry(w, h, d), key, name);
  m.position.set(...at);
  return m;
}

export function group(name: string, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group(); g.name = name;
  for (const c of children) g.add(c);
  return g;
}

/** Deterministic PRNG (mulberry32). Never use Math.random in cutscene code. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nudge vertices for organic low-poly shapes (rocks, trunks, foliage). Shared vertices
 * move together, so the surface stays closed. */
export function jitter(geometry: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const random = rng(seed), pos = geometry.getAttribute('position'), moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let d = moved.get(key);
    if (!d) { d = [(random() - 0.5) * amount, (random() - 0.5) * amount, (random() - 0.5) * amount]; moved.set(key, d); }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  pos.needsUpdate = true;
  return geometry;
}
