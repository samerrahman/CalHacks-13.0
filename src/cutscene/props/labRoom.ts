import * as THREE from 'three';
import { box, group } from '../style';

// Low-detail lab room the camera starts inside. Contract: PROPS.lab_room in ./index.ts.
// A 14 × 14 hall centred on the containment tube: interior x −7..7, z −9.5..4.5, floor y = 0,
// ceiling y = 4. Tank pad at (0, 0, −2.5), the room's centre, is left empty (hazard square only).
// Doorway 1.6 × 2.2 in the +Z wall at x −0.8..0.8. Console at z ≈ +0.4 faces +Z toward the
// player standing at z = +1.1. Four equipment racks stand around the tube.

const T = 0.2; // wall / slab thickness
const H = 4.0; // interior height
const X = 7, Z0 = -9.5, Z1 = 4.5, CZ = (Z0 + Z1) / 2, D = Z1 - Z0; // CZ = −2.5, the tank

export function buildLabRoom(): THREE.Group {
  const shell = group('shell',
    box(2 * X + 2 * T, T, D + 2 * T, 'lab_floor', [0, -T / 2, CZ], 'floor'),
    box(2 * X + 2 * T, T, D + 2 * T, 'concrete_dark', [0, H + T / 2, CZ], 'ceiling'),
    box(T, H, D, 'lab_panel', [-X - T / 2, H / 2, CZ], 'wall_west'),
    box(T, H, D, 'lab_panel', [X + T / 2, H / 2, CZ], 'wall_east'),
    box(2 * X + 2 * T, H, T, 'lab_panel', [0, H / 2, Z0 - T / 2], 'wall_north'),
    // +Z wall split around the doorway (x −0.8..0.8, y 0..2.2)
    box(X - 0.8 + T, H, T, 'lab_panel', [-(0.8 + (X - 0.8 + T) / 2), H / 2, Z1 + T / 2], 'wall_south_l'),
    box(X - 0.8 + T, H, T, 'lab_panel', [0.8 + (X - 0.8 + T) / 2, H / 2, Z1 + T / 2], 'wall_south_r'),
    box(1.6, H - 2.2, T, 'lab_panel', [0, 2.2 + (H - 2.2) / 2, Z1 + T / 2], 'door_lintel'),
  );

  // Flat hazard square around the empty tank pad.
  const s = 3.4, w = 0.15, y = 0.005;
  const hazard = group('hazard_ring',
    box(s, 0.01, w, 'hazard_yellow', [0, y, CZ - s / 2 + w / 2]),
    box(s, 0.01, w, 'hazard_yellow', [0, y, CZ + s / 2 - w / 2]),
    box(w, 0.01, s - 2 * w, 'hazard_yellow', [-s / 2 + w / 2, y, CZ]),
    box(w, 0.01, s - 2 * w, 'hazard_yellow', [s / 2 - w / 2, y, CZ]),
  );

  // Console: desk, tilted control panel, three screens facing +Z.
  const panel = box(2.2, 0.06, 0.45, 'metal', [0, 0.88, 0.45], 'console_panel');
  panel.rotation.x = 0.35;
  const screenY = 1.06, screenZ = 0.16;
  const console_ = group('console',
    box(2.4, 0.8, 0.7, 'metal_dark', [0, 0.4, 0.4], 'console_desk'),
    panel,
    box(0.55, 0.3, 0.05, 'screen_teal', [-0.7, screenY, screenZ], 'console_screen_0'),
    box(0.55, 0.3, 0.05, 'screen_amber', [0, screenY, screenZ], 'console_screen_1'),
    box(0.55, 0.3, 0.05, 'screen_teal', [0.7, screenY, screenZ], 'console_screen_2'),
    box(1.9, 0.34, 0.06, 'metal_dark', [0, screenY, screenZ - 0.055], 'screen_backing'),
  );

  // Equipment racks on the diagonals around the tube, each facing it, with a small lit panel.
  const racks = group('racks',
    ...[[-4.4, CZ - 3.4], [4.4, CZ - 3.4], [-4.4, CZ + 2.6], [4.6, CZ + 2.9]].map(([x, z], i) => {
      const rack = group(`rack_${i}`,
        box(0.9, 2.1, 0.6, 'metal_dark', [0, 1.05, 0]),
        box(0.5, 0.3, 0.03, 'screen_teal', [0, 1.5, 0.31]));
      rack.position.set(x, 0, z);
      rack.rotation.y = Math.atan2(-x, CZ - z);
      return rack;
    }),
  );

  // Ceiling light panels (flickered by the scene).
  const lights = group('ceiling_lights',
    ...[[-3.5, CZ - 3.5], [3.5, CZ - 3.5], [-3.5, CZ + 3.5], [3.5, CZ + 3.5]].map(([x, z], i) =>
      box(1.6, 0.05, 0.45, 'light_panel', [x, H - 0.025, z], `ceiling_light_${i}`)),
  );

  // Alarm lights high on the walls.
  const alarms = group('alarm_lights',
    box(0.08, 0.2, 0.3, 'alarm_red', [-X + 0.04, 3.2, CZ], 'alarm_light_0'),
    box(0.08, 0.2, 0.3, 'alarm_red', [X - 0.04, 3.2, CZ], 'alarm_light_1'),
    box(0.3, 0.2, 0.08, 'alarm_red', [0, 3.2, Z0 + 0.04], 'alarm_light_2'),
    box(0.3, 0.2, 0.08, 'alarm_red', [0, 2.7, Z1 - 0.04], 'alarm_light_3'),
  );

  // Plain cabinets against the side walls.
  const cabinets = group('cabinets',
    box(0.6, 2.0, 1.4, 'metal', [-X + 0.3, 1.0, 2.6], 'cabinet_0'),
    box(0.6, 2.0, 1.4, 'metal', [X - 0.3, 1.0, 2.6], 'cabinet_1'),
    box(0.6, 1.0, 2.0, 'metal', [X - 0.3, 0.5, CZ - 4.5], 'cabinet_2'),
    box(0.6, 2.0, 1.4, 'metal', [-X + 0.3, 1.0, CZ - 5], 'cabinet_3'),
  );

  return group('lab_room', shell, hazard, console_, racks, lights, alarms, cabinets);
}
