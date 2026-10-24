import { AnimationClip, Group, Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_NAMES = ['booth', 'console', 'radio', 'relay', 'fuse', 'floodlight', 'shutter', 'mimic'] as const;
export type ModelName = typeof MODEL_NAMES[number];
export interface ModelAsset { scene: Group; animations: AnimationClip[] }

export async function loadModels(onLoaded: (name: string) => void): Promise<Record<ModelName, ModelAsset>> {
  const loader = new GLTFLoader();
  const results = await Promise.allSettled(MODEL_NAMES.map(async name => {
    const gltf = await loader.loadAsync(`/assets/models/${name}.glb`);
    gltf.scene.traverse(object => {
      if (object instanceof Mesh) {
        object.castShadow = name !== 'booth';
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof MeshStandardMaterial) {
            material.roughness = .84;
            if (name === 'booth' && material.name === 'wall') {
              // The kit's neutral wall is intentionally recolored for the teal booth.
              material.color.setHex(0x44655d);
            }
            if (material.name === 'green') {
              material.emissive.setHex(0x43bd8a);
              material.emissiveIntensity = .48;
            }
          }
        }
      }
    });
    onLoaded(name);
    return [name, { scene: gltf.scene, animations: gltf.animations }] as const;
  }));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    // Successful siblings still own GPU resources when another file failed to load.
    for (const result of results) if (result.status === 'fulfilled') disposeObject(result.value[1].scene);
    throw failure.reason;
  }
  const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  return Object.fromEntries(loaded) as Record<ModelName, ModelAsset>;
}

export function cloneModel(model: Object3D): Object3D {
  const result = model.clone(true);
  result.traverse(object => {
    if (object instanceof Mesh) object.material = Array.isArray(object.material)
      ? object.material.map(material => material.clone()) : object.material.clone();
  });
  return result;
}

export function disposeObject(root: Object3D): void {
  const textures = new Set<Texture>();
  const geometries = new Set<Mesh['geometry']>();
  const materialsToDispose = new Set<Exclude<Mesh['material'], unknown[]>>();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      materialsToDispose.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materialsToDispose) material.dispose();
  for (const texture of textures) texture.dispose();
}
