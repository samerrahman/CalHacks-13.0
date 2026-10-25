import * as THREE from 'three';
import type { MaterialKey } from './style';

/** How the film is shaded.
 * - `ironlung` (default): grimy CC0 photo textures shrunk to 128 px and point-sampled, the scene
 *   rendered at 640×360, then graded toward rust and sepia with grain, ordered dither and a
 *   vignette. In the spirit of Iron Lung.
 * - `flat`: the original flat palette colours at full resolution. */
export type Look = 'ironlung' | 'flat';
export const LOOKS: readonly Look[] = ['ironlung', 'flat'];

type Surface = { tex: string; tile: number; tint?: number; glow?: boolean };
/** Per palette key: a texture from cutscene/textures (CC0, see SOURCES.md), metres per repeat,
 * and an optional tint. Brightness is normalised to the palette colour, so lighting still reads
 * as tuned. `glow` also grimes the emissive (screens). Keys left out (lights, glass, rubber, the
 * void) stay flat. */
const SURFACES: Partial<Record<MaterialKey, Surface>> = {
  metal: { tex: 'rusty_metal_04', tile: 1.4 },
  metal_dark: { tex: 'rusty_metal_04', tile: 1.0 },
  rust: { tex: 'rusty_metal_02', tile: 1.0 },
  lab_panel: { tex: 'rusty_metal_02', tile: 1.5 },
  lab_floor: { tex: 'metal_plate', tile: 1.2 },
  deep_steel: { tex: 'rusty_metal_04', tile: 1.2, tint: 0x8aa09c },
  steel_teal: { tex: 'rusty_metal_02', tile: 1.2, tint: 0x9fb8b2 },
  wall_teal: { tex: 'peeling_painted_wall', tile: 1.6, tint: 0x9fc0b8 },
  cream: { tex: 'peeling_painted_wall', tile: 1.2, tint: 0xf0e8d0 },
  hazard_yellow: { tex: 'rusty_painted_metal', tile: 0.8, tint: 0xffe08a },
  concrete: { tex: 'chipped_concrete', tile: 2.0 },
  concrete_dark: { tex: 'chipped_concrete', tile: 2.0 },
  concrete_stain: { tex: 'chipped_concrete', tile: 1.6 },
  bark: { tex: 'bark_brown_02', tile: 1.2 },
  pine: { tex: 'forest_leaves_03', tile: 0.8, tint: 0x6a8a5a },
  pine_dark: { tex: 'forest_leaves_03', tile: 0.8, tint: 0x5a7a50 },
  moss: { tex: 'forest_ground_04', tile: 3.0 },
  dirt: { tex: 'brown_mud_leaves_01', tile: 2.0 },
  mud: { tex: 'brown_mud_02', tile: 2.0 },
  rock: { tex: 'dark_rock', tile: 1.2 },
  claw_skin: { tex: 'rock_pitted_mossy', tile: 0.35, tint: 0xb0b8b0 },
  creature_skin: { tex: 'rock_pitted_mossy', tile: 0.35, tint: 0xb0b8b0 },
  glove: { tex: 'anti_slip_concrete', tile: 0.4 },
  labcoat: { tex: 'chipped_concrete', tile: 0.8 },
  screen_teal: { tex: 'rusty_metal_04', tile: 0.6, glow: true },
  screen_amber: { tex: 'rusty_metal_04', tile: 0.6, glow: true },
};

/** The lab interior (room, tank, corridor, exit) is a maintained facility, not a ruin: clean
 * brushed concrete, washed-out steel and diamond plate. Keys not listed fall back to SURFACES. */
const CLEAN: Partial<Record<MaterialKey, Surface>> = {
  lab_panel: { tex: 'brushed_concrete', tile: 2.0 },
  lab_floor: { tex: 'metal_plate_clean', tile: 1.2 },
  concrete_dark: { tex: 'brushed_concrete', tile: 2.0 },
  metal: { tex: 'rusty_metal_02_clean', tile: 1.4 },
  metal_dark: { tex: 'rusty_metal_02_clean', tile: 1.0 },
  deep_steel: { tex: 'rusty_metal_02_clean', tile: 1.2, tint: 0x8aa09c },
  steel_teal: { tex: 'rusty_metal_02_clean', tile: 1.2, tint: 0x9fb8b2 },
  wall_teal: { tex: 'brushed_concrete', tile: 1.6, tint: 0x9fc0b8 },
  cream: { tex: 'brushed_concrete', tile: 1.2, tint: 0xf0e8d0 },
  hazard_yellow: { tex: 'brushed_concrete', tile: 0.8, tint: 0xffe08a },
};

const loader = new THREE.TextureLoader();
const textures = new Map<string, Promise<{ map: THREE.Texture; mean: number }>>();
/** A point-sampled, repeating texture and its mean linear luminance. */
function texture(id: string): Promise<{ map: THREE.Texture; mean: number }> {
  let pending = textures.get(id);
  if (!pending) {
    pending = loader.loadAsync(`/cutscene/textures/${id}.png`).then(map => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestMipmapNearestFilter;
      const image = map.image as HTMLImageElement, canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0, 16, 16);
      const px = ctx.getImageData(0, 0, 16, 16).data, c = new THREE.Color();
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) { c.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace); sum += luma(c); }
      return { map, mean: sum / (px.length / 4) };
    });
    textures.set(id, pending);
  }
  return pending;
}
const luma = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Box-projected UVs (metres / tile), chosen per triangle by its dominant axis. Props are
 * non-indexed and flat-shaded, so no vertex is shared between faces that project differently. */
function projectUVs(geometry: THREE.BufferGeometry, tile: number): void {
  const pos = geometry.getAttribute('position'), uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = [a, b, c][k];
      const [u, v] = ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y];
      uv[(i + k) * 2] = u / tile; uv[(i + k) * 2 + 1] = v / tile;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Textures every mesh whose material is a palette key listed in SURFACES; meshes under any of
 * `clean` use CLEAN first. Materials must not be shared between a clean and a grimy prop. */
export async function applyLook(root: THREE.Object3D, look: Look, clean: THREE.Object3D[] = []): Promise<void> {
  if (look === 'flat') return;
  const meshes: { mesh: THREE.Mesh; tidy: boolean }[] = [], tidy = new Set<THREE.Object3D>();
  for (const c of clean) c.traverse(o => tidy.add(o));
  root.traverse(o => { if (o instanceof THREE.Mesh && o.geometry.index === null) meshes.push({ mesh: o, tidy: tidy.has(o) }); });
  const projected = new Set<THREE.BufferGeometry>(), styled = new Set<THREE.Material>();
  for (const { mesh, tidy: isTidy } of meshes) {
    const m = mesh.material;
    if (!(m instanceof THREE.MeshStandardMaterial)) continue;
    const key = m.name as MaterialKey, surface = (isTidy ? CLEAN[key] : undefined) ?? SURFACES[key];
    if (!surface) continue;
    if (!projected.has(mesh.geometry)) { projectUVs(mesh.geometry, surface.tile); projected.add(mesh.geometry); }
    if (styled.has(m)) continue;
    styled.add(m);
    const { map, mean } = await texture(surface.tex), tint = new THREE.Color(surface.tint ?? 0xffffff);
    const target = luma(m.color); // keep the palette colour's brightness under the texture
    m.color.copy(tint).multiplyScalar(Math.min(3, target / Math.max(1e-4, luma(tint) * mean)));
    m.map = map;
    if (surface.glow) m.emissiveMap = map;
    m.metalness = Math.min(m.metalness, 0.25); // there is no environment map: metal would go black
    m.roughness = Math.max(m.roughness, 0.6);
    m.needsUpdate = true;
  }
}

export type Post = { render(scene: THREE.Scene, camera: THREE.Camera, time: number): void; dispose(): void };

/** Final image pass. `flat` renders straight to the canvas; `ironlung` renders the scene at
 * 640×360 (whatever the output size) and draws it point-sampled through the grade below. Grain
 * is seeded by `time` (12 steps a second), so frames stay a pure function of time. */
export function createPost(renderer: THREE.WebGLRenderer, look: Look): Post {
  if (look === 'flat') return { render: (scene, camera) => renderer.render(scene, camera), dispose() {} };
  const out = renderer.getSize(new THREE.Vector2()), res = new THREE.Vector2(Math.round(360 * out.x / out.y), 360);
  const target = new THREE.WebGLRenderTarget(res.x, res.y, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const material = new THREE.ShaderMaterial({
    uniforms: { frame: { value: target.texture }, res: { value: res }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D frame; uniform vec2 res; uniform float time;
      varying vec2 vUv;
      float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      void main() {
        vec2 px = floor(vUv * res);
        gl_FragColor = vec4(texture2D(frame, (px + 0.5) / res).rgb * 1.7, 1.0); // grime eats light: expose up
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 c = gl_FragColor.rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, l * vec3(1.1, 0.86, 0.64), 0.5);                       // drain colour toward rust
        c = clamp((c - 0.015) * 1.08, 0.0, 1.0);                          // crush the blacks a touch
        vec2 v = vUv - 0.5;
        c *= 1.0 - 0.6 * pow(clamp(length(v * vec2(1.25, 1.0)) * 1.3, 0.0, 1.0), 2.4); // vignette
        c += (hash(px + fract(floor(time * 12.0) * 0.1373) * 97.0) - 0.5) * 0.05; // grain at 12 Hz: film flicker, and it compresses
        c = floor(c * 31.0 + 0.5 + (bayer4(px) - 0.5)) / 31.0;            // 5-bit ordered dither
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return {
    render(world, eye, time) {
      renderer.setRenderTarget(target); renderer.render(world, eye);
      renderer.setRenderTarget(null); material.uniforms.time.value = time; renderer.render(scene, camera);
    },
    dispose() { target.dispose(); material.dispose(); },
  };
}
