import { CanvasTexture, Mesh, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

type Surface = 'wall' | 'steel' | 'cream' | 'dark' | 'rust';
const COLORS: Record<Surface, [number, number, number]> = { wall: [65, 69, 61], steel: [72, 72, 61], cream: [140, 126, 93], dark: [30, 34, 31], rust: [102, 57, 32] };
function random(seed: number) { let value = seed >>> 0; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; }; }
function canvas(size: number) { const element = document.createElement('canvas'); element.width = element.height = size; return element; }

/** Original code-generated paint, corrosion and relief. No downloaded textures. */
export function createWeathering() {
  const textures = new Set<Texture>(), bundles = new Map<Surface, { map: CanvasTexture; bumpMap: CanvasTexture; roughnessMap: CanvasTexture }>();
  for (const [index, surface] of (['wall', 'steel', 'cream', 'dark', 'rust'] as Surface[]).entries()) {
    const size = surface === 'wall' ? 1024 : 512, paint = canvas(size), ctx = paint.getContext('2d')!, rng = random(104729 + index * 997), base = COLORS[surface];
    const pixels = ctx.createImageData(size, size);
    const coarse = Array.from({ length: 17 * 17 }, () => rng()), medium = Array.from({ length: 65 * 65 }, () => rng());
    function noise(x: number, y: number, data: number[], cells: number) {
      const gx = x / size * cells, gy = y / size * cells, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, stride = cells + 1;
      return (data[iy * stride + ix]! * (1 - fx) + data[iy * stride + ix + 1]! * fx) * (1 - fy) + (data[(iy + 1) * stride + ix]! * (1 - fx) + data[(iy + 1) * stride + ix + 1]! * fx) * fy;
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4, variation = (noise(x, y, coarse, 16) - .5) * 39 + (noise(x, y, medium, 64) - .5) * 19 + (rng() - .5) * 18;
      const pit = rng() < .022 ? .38 : 1;
      for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] = Math.max(0, (base[channel]! + variation) * pit);
      pixels.data[offset + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    // Soft irregular rust blooms, followed by long leaking seams and scratches.
    for (let patch = 0; patch < 54; patch++) {
      const x = rng() * size, y = rng() * size, radius = (8 + rng() * 72) * size / 512;
      const stain = ctx.createRadialGradient(x, y, 1, x, y, radius); stain.addColorStop(0, `rgba(73,32,13,${.16 + rng() * .35})`); stain.addColorStop(.5, 'rgba(49,27,14,.16)'); stain.addColorStop(1, 'rgba(28,23,15,0)');
      ctx.fillStyle = stain; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    for (let streak = 0; streak < (surface === 'wall' ? 140 : 40); streak++) {
      const x = rng() * size, y = rng() * size * .78, length = (20 + rng() * 290) * size / 512, width = (1 + rng() * 10) * size / 512;
      const stain = ctx.createLinearGradient(0, y, 0, y + length); stain.addColorStop(0, 'rgba(9,12,8,.55)'); stain.addColorStop(.65, 'rgba(28,19,10,.19)'); stain.addColorStop(1, 'rgba(23,17,9,0)');
      ctx.fillStyle = stain; ctx.fillRect(x, y, width, length); ctx.fillStyle = 'rgba(121,62,25,.17)'; ctx.fillRect(x + width, y, 1, length * .6);
    }
    for (let scratch = 0; scratch < 260; scratch++) {
      const x = rng() * size, y = rng() * size, length = 3 + rng() * 48;
      ctx.strokeStyle = scratch % 4 ? 'rgba(5,8,6,.42)' : 'rgba(173,155,114,.18)'; ctx.lineWidth = rng() < .8 ? .6 : 1.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length, y + (rng() - .5) * 8); ctx.stroke();
    }
    // Chipped paint accumulates at panel borders instead of clean uniform edges.
    for (let chip = 0; chip < 450; chip++) { const x = rng() * size, y = rng() < .5 ? rng() * 12 : size - rng() * 12; ctx.fillStyle = chip % 3 ? 'rgba(21,16,11,.62)' : 'rgba(130,68,27,.52)'; ctx.fillRect(x, y, 1 + rng() * 8, 1 + rng() * 3); }
    const height = canvas(size), heightCtx = height.getContext('2d')!, rough = canvas(size), roughCtx = rough.getContext('2d')!;
    const pigment = ctx.getImageData(0, 0, size, size), relief = heightCtx.createImageData(size, size), roughness = roughCtx.createImageData(size, size);
    for (let offset = 0; offset < pigment.data.length; offset += 4) {
      const value = pigment.data[offset]! * .25 + pigment.data[offset + 1]! * .6 + pigment.data[offset + 2]! * .15;
      const bump = Math.min(230, 83 + value * .8), matte = Math.max(145, Math.min(250, 251 - value * .35));
      for (let channel = 0; channel < 3; channel++) { relief.data[offset + channel] = bump; roughness.data[offset + channel] = matte; }
      relief.data[offset + 3] = roughness.data[offset + 3] = 255;
    }
    heightCtx.putImageData(relief, 0, 0); roughCtx.putImageData(roughness, 0, 0);
    const map = new CanvasTexture(paint), bumpMap = new CanvasTexture(height), roughnessMap = new CanvasTexture(rough); map.colorSpace = SRGBColorSpace;
    for (const texture of [map, bumpMap, roughnessMap]) { texture.wrapS = texture.wrapT = RepeatWrapping; texture.anisotropy = 4; textures.add(texture); }
    bundles.set(surface, { map, bumpMap, roughnessMap });
  }
  const applied = new WeakSet<MeshStandardMaterial>();
  function weather(material: MeshStandardMaterial, surface: Surface) {
    if (applied.has(material)) return; applied.add(material);
    Object.assign(material, bundles.get(surface)); material.color.setHex(0xffffff); material.roughness = surface === 'wall' ? .98 : .86;
    material.metalness = surface === 'cream' ? .18 : surface === 'wall' ? .24 : .48; material.bumpScale = surface === 'wall' ? .024 : .009;
    material.needsUpdate = true;
  }
  return {
    apply(root: Object3D) { root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        const name = material.name;
        if (name === 'emergency_glow') { material.emissive.setHex(0x8e250b); material.emissiveIntensity = .8; continue; }
        if (name === 'phosphor' || name === 'screen' || name === 'amber' || name === 'status_dim') continue;
        weather(material, name === 'wall_teal' ? 'wall' : name === 'cream' ? 'cream' : name === 'rust' ? 'rust' : name === 'deep_steel' || name === 'black' ? 'dark' : 'steel');
      }
    }); },
    material(surface: Surface) { const material = new MeshStandardMaterial(); weather(material, surface); return material; },
    dispose() { textures.forEach(texture => texture.dispose()); textures.clear(); },
  };
}
