import * as THREE from 'three';
import { box, group, mesh } from '../style';

// Basement door: a motor-driven steel door in the shelter's front wall, left of the desk, opening
// onto the stairs down. Contract: PROPS.basement_door in ./index.ts. The game shows it closed
// (its four lock lamps track the research stages); the ending film opens it.
//
// Local frame: origin on the floor at the centre of the 0.95 × 2.0 doorway, in the room-side face
// of the wall; the room is +Z, the stairs −Z. The leaf hangs from a track on the room side and
// slides toward −X (door_leaf.position.x = −travel). The latch jamb (+X) carries four lock bolts.

/** Doorway and travel in metres. The side wall stops the leaf at about 0.47 m open. */
export const BASEMENT_DOOR = { width: 0.95, height: 2.0, maxTravel: 0.47, lockHeights: [0.4, 0.85, 1.3, 1.75], lockTravel: 0.09 } as const;

export function buildBasementDoor(): THREE.Group {
  const W = BASEMENT_DOOR.width / 2, H = BASEMENT_DOOR.height;
  // Frame proud of the wall: a narrow hinge-side jamb, a wide latch jamb for the lock housings.
  const frame = group('door_frame',
    box(0.09, H + 0.1, 0.1, 'deep_steel', [-W - 0.045, (H + 0.1) / 2, 0.05]),
    box(0.17, H + 0.1, 0.1, 'deep_steel', [W + 0.085, (H + 0.1) / 2, 0.05]),
    box(2 * W + 0.26, 0.1, 0.1, 'deep_steel', [0.04, H + 0.05, 0.05]),
    box(2 * W, 0.03, 0.14, 'rust', [0, 0.015, 0.07]),
  );
  for (let i = 0; i < 9; i++) frame.add(box(0.172, 0.09, 0.004, i % 2 ? 'hazard_black' : 'hazard_yellow', [W + 0.085, 0.12 + i * 0.22, 0.102]));

  // The leaf: a thick plate with stiffeners, a hazard band and a pull handle. leaf_dent bulges its
  // stairwell-side face when something pounds on it from the room.
  const leaf = group('door_leaf',
    box(1.06, 2.02, 0.09, 'steel_teal', [0, 1.03, 0.145]),
    ...[-0.32, 0, 0.32].map(x => box(0.06, 1.88, 0.03, 'deep_steel', [x, 1.03, 0.205])),
    ...[0.48, 1.58].map(y => box(1.0, 0.07, 0.03, 'deep_steel', [0, y, 0.205])),
    box(0.04, 0.42, 0.06, 'metal', [0.28, 1.08, 0.23]),
    ...[-0.36, 0.36].map(x => box(0.09, 0.07, 0.07, 'metal_dark', [x, 2.07, 0.15])),
  );
  for (let i = 0; i < 8; i++) leaf.add(box(0.13, 0.16, 0.006, i % 2 ? 'hazard_black' : 'hazard_yellow', [-0.455 + i * 0.13, 0.2, 0.193]));
  const dent = mesh(new THREE.ConeGeometry(0.34, 0.14, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, -0.07), 'steel_teal');
  const dentGroup = group('leaf_dent', dent); dentGroup.position.set(0.04, 1.25, 0.1); dentGroup.visible = false;
  leaf.add(dentGroup);

  // Track and motor above the doorway; the beacon sits on the motor housing.
  const track = group('door_track', box(1.65, 0.08, 0.11, 'deep_steel', [-0.22, H + 0.16, 0.17]), box(1.65, 0.03, 0.04, 'metal', [-0.22, H + 0.11, 0.21]));
  const motor = group('door_motor', box(0.34, 0.3, 0.22, 'metal_dark', [0.66, H + 0.3, 0.15]), mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8).rotateX(Math.PI / 2).translate(0.58, H + 0.3, 0.29), 'metal'));
  const lens = mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.11, 8), 'lamp_warm', 'beacon_lens'); lens.position.y = 0.09;
  const beacon = group('beacon', mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.04, 8), 'metal_dark'), lens);
  beacon.position.set(0.66, H + 0.47, 0.15);

  // The label plate above the track (the scene draws BASEMENT on it), and above that a row of four
  // lock lamps where they can be seen from the desk; the scene turns a released lock green.
  const label = box(0.62, 0.15, 0.01, 'cream', [-0.15, H + 0.42, 0.02], 'door_label');
  const lamps = group('lock_lamps', box(0.62, 0.09, 0.02, 'metal_dark', [-0.15, H + 0.58, 0.012]), ...[0, 1, 2, 3].map(i => box(0.05, 0.05, 0.02, 'alarm_red', [-0.36 + i * 0.14, H + 0.58, 0.03], `lock_lamp_${i}`)));

  // Four barrel locks on the latch jamb. Each bolt crosses the leaf face while locked and slides
  // into its housing (lock_bolt_i.position.x += lockTravel) once released.
  const locks = BASEMENT_DOOR.lockHeights.flatMap((y, i) => {
    const bolt = group(`lock_bolt_${i}`, box(0.17, 0.05, 0.04, 'metal', [-0.085, 0, 0]));
    bolt.position.set(W + 0.15, y, 0.225);
    return [box(0.19, 0.12, 0.07, 'metal_dark', [W + 0.155, y, 0.225]), bolt];
  });

  return group('basement_door', frame, leaf, track, motor, beacon, label, lamps, ...locks);
}
