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
/** True when the first visible surface under the pointer is the wall status unit. */
export function hitStatus(raycaster: Raycaster, scene: Object3D): boolean {
  const hit = raycaster.intersectObjects(scene.children, true).find(candidate => visible(candidate.object));
  return !!hit && hit.object.userData.lockInStatus === true;
}
/** The part of the hand-held remote under the pointer, if it is the first visible surface. */
export function hitRemote(raycaster: Raycaster, scene: Object3D): 'remote' | 'quiet' | 'restore' | null {
  const hit = raycaster.intersectObjects(scene.children, true).find(candidate => visible(candidate.object));
  const target = hit?.object.userData.lockInRemote;
  return target === 'remote' || target === 'quiet' || target === 'restore' ? target : null;
}
/** True when the first visible surface under the pointer belongs to the emergency lever. */
export function hitLever(raycaster: Raycaster, scene: Object3D): boolean {
  const hit = raycaster.intersectObjects(scene.children, true).find(candidate => visible(candidate.object));
  for (let node: Object3D | null = hit?.object ?? null; node; node = node.parent) if (node.userData.lockInLever) return true;
  return false;
}
