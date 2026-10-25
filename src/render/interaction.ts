import type { Object3D, Raycaster } from 'three';
import type { Station } from './stations';

function visible(object: Object3D): boolean { for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false; return true; }
/** The first visible surface owns the click; equipment cannot be clicked through a wall. */
export function hitStation(raycaster: Raycaster, scene: Object3D): Station | null {
  const hit = raycaster.intersectObjects(scene.children, true).find(candidate => visible(candidate.object));
  if (!hit) return null;
  for (let node: Object3D | null = hit.object; node; node = node.parent) {
    const station = node.userData.lockInStation;
    if (station === 'terminal' || station === 'cameras' || station === 'equipment') return station;
  }
  return null;
}
