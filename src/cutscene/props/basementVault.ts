import * as THREE from 'three';
import { box, group } from '../style';
import { buildContainmentTank } from './containmentTank';

// The basement the four locks were holding shut (ending film only). Contract: PROPS.basement_vault
// in ./index.ts. Origin: floor centre of its entrance, where the stairwell's bottom landing ends;
// the vault lies toward −Z. A low concrete room with two containment tanks along its left side:
// the near one burst open from inside, the far one still sealed. Debris and claw gouges (fresh,
// pale scratches) on the floor, a stencilled warning on the left wall, one dim red lamp on
// the back wall.

export const VAULT = {
  halfWidth: 3, depth: 7.4, height: 3, doorway: { halfWidth: 0.65, height: 2.45 },
  /** Tanks at three-quarter size so their pipes meet this ceiling: [x, z, yaw]. */
  tankScale: 0.75, breached: [-1.7, -2.9, 0.5], sealed: [-1.5, -6.0, 0.3],
  /** The warning sign on the left wall: centre and size (m). */
  sign: { at: [-2.99, 1.7, -0.85], width: 1.6, height: 0.8 },
} as const;

function tank(name: string, [x, z, yaw]: readonly [number, number, number]): THREE.Group {
  const t = group(name, buildContainmentTank());
  t.position.set(x, 0, z); t.rotation.y = yaw; t.scale.setScalar(VAULT.tankScale);
  return t;
}

function cagedLamp(name: string, at: [number, number, number]): THREE.Group {
  const lamp = group(name, box(0.16, 0.12, 0.03, 'metal_dark', [0, 0, 0]), box(0.1, 0.08, 0.08, 'alarm_red', [0, 0, 0.05], `${name}_bulb`));
  for (const dx of [-0.045, 0.045]) lamp.add(box(0.012, 0.1, 0.1, 'metal_dark', [dx, 0, 0.05]));
  lamp.position.set(...at);
  return lamp;
}

export function buildBasementVault(): THREE.Group {
  const { halfWidth: W, depth: D, height: H, doorway } = VAULT, dw = doorway.halfWidth, side = W + 0.14 - dw;
  const parts: THREE.Object3D[] = [
    box(2 * W, 0.06, D, 'concrete_stain', [0, -0.03, -D / 2]),
    box(2 * W + 0.28, 0.12, D + 0.14, 'concrete', [0, H + 0.06, -D / 2]),
    box(0.14, H, D, 'concrete_dark', [-W - 0.07, H / 2, -D / 2]),
    box(0.14, H, D, 'concrete_dark', [W + 0.07, H / 2, -D / 2]),
    box(2 * W + 0.28, H, 0.14, 'concrete_dark', [0, H / 2, -D - 0.07]),
    // The entrance wall, on the stairwell side of z = 0, with the stairwell's opening through it.
    box(side, H, 0.14, 'concrete_dark', [-dw - side / 2, H / 2, 0.07]),
    box(side, H, 0.14, 'concrete_dark', [dw + side / 2, H / 2, 0.07]),
    box(2 * dw, H - doorway.height, 0.14, 'concrete_dark', [0, (H + doorway.height) / 2, 0.07]),
    // Pipes and a cable tray along the ceiling, a rack against the right wall.
    box(0.09, 0.09, D, 'metal_dark', [-0.4, H - 0.12, -D / 2]), box(0.06, 0.06, D, 'rust', [-0.22, H - 0.1, -D / 2]),
    box(0.4, 0.05, D, 'metal_dark', [1.4, H - 0.2, -D / 2]),
    box(0.5, 1.9, 1.1, 'metal_dark', [W - 0.27, 0.95, -1.5]),
    ...[0.5, 1.1, 1.65].map(y => box(0.48, 0.03, 1.08, 'metal', [W - 0.27, y, -1.5])),
  ];
  const breached = tank('tank_breached', VAULT.breached), sealed = tank('tank_sealed', VAULT.sealed);
  // Forced from inside: the hatch hangs off its hinge, bulged outward.
  const hatch = breached.getObjectByName('hatch_door');
  if (hatch) { hatch.rotation.y = -1.9; hatch.rotation.z = 0.22; }
  const bulge = breached.getObjectByName('hatch_bulge');
  if (bulge) { bulge.visible = true; bulge.scale.z = 1.6; }
  parts.push(breached, sealed);
  // Sheared bolts and a bent strip of the hatch frame thrown toward the entrance, and three gouges dragged from the breached tank toward the far right corner.
  const [bx, bz] = VAULT.breached;
  [[0.7, 0.9, 0.3], [1.05, 1.3, 1.1], [0.4, 1.55, 2.0], [1.3, 0.75, 0.6], [0.85, 1.75, 1.4]].forEach(([dx, dz, a]) => {
    const bolt = box(0.07, 0.05, 0.05, 'metal_dark', [bx + dx, 0.025, bz + dz]); bolt.rotation.y = a; parts.push(bolt);
  });
  const strip = box(0.62, 0.025, 0.07, 'metal', [bx + 1.2, 0.02, bz + 1.15]); strip.rotation.set(0.08, 0.7, 0.05); parts.push(strip);
  for (let i = 0; i < 3; i++) {
    const from = new THREE.Vector2(bx + 0.9 + i * 0.09, bz + 0.25 + i * 0.05), to = new THREE.Vector2(1.6 + i * 0.09, -4.6 + i * 0.05), dir = to.clone().sub(from);
    const gouge = box(0.03, 0.006, dir.length(), 'paper', [(from.x + to.x) / 2, 0.004, (from.y + to.y) / 2]);
    gouge.rotation.y = Math.atan2(dir.x, dir.y); parts.push(gouge);
  }
  const { at, width, height } = VAULT.sign;
  const sign = box(0.012, height, width, 'cream', [at[0], at[1], at[2]], 'vault_sign');
  parts.push(sign, box(0.02, height + 0.08, width + 0.08, 'metal_dark', [at[0] - 0.006, at[1], at[2]]));
  parts.push(cagedLamp('vault_lamp', [2.3, 2.35, -D + 0.02]));
  return group('basement_vault', ...parts);
}
