import * as THREE from 'three';
import { box, group } from '../style';

// Low-detail lab room the camera starts inside. Contract: PROPS.lab_room in ./index.ts.
// Interior x −5..5, z −4.5..4.5, floor y = 0, ceiling y = 3.2. Doorway 1.6 × 2.2 in the +Z
// wall at x −0.8..0.8. Tank pad at (0, 0, −2.5) is left empty (hazard square only).
// Console at z ≈ +0.4 faces +Z toward the player standing at z = +1.2.

const T = 0.2; // wall / slab thickness
const H = 3.2; // interior height

export function buildLabRoom(): THREE.Group {
  const shell = group('shell',
    box(10 + 2 * T, T, 9 + 2 * T, 'lab_floor', [0, -T / 2, 0], 'floor'),
    box(10 + 2 * T, T, 9 + 2 * T, 'concrete_dark', [0, H + T / 2, 0], 'ceiling'),
    box(T, H, 9, 'lab_panel', [-5 - T / 2, H / 2, 0], 'wall_west'),
    box(T, H, 9, 'lab_panel', [5 + T / 2, H / 2, 0], 'wall_east'),
    box(10 + 2 * T, H, T, 'lab_panel', [0, H / 2, -4.5 - T / 2], 'wall_north'),
    // +Z wall split around the doorway (x −0.8..0.8, y 0..2.2)
    box(4.2 + T, H, T, 'lab_panel', [-(0.8 + (4.2 + T) / 2), H / 2, 4.5 + T / 2], 'wall_south_l'),
    box(4.2 + T, H, T, 'lab_panel', [0.8 + (4.2 + T) / 2, H / 2, 4.5 + T / 2], 'wall_south_r'),
    box(1.6, H - 2.2, T, 'lab_panel', [0, 2.2 + (H - 2.2) / 2, 4.5 + T / 2], 'door_lintel'),
  );

  // Flat hazard square around the empty tank pad.
  const s = 3.4, w = 0.15, y = 0.005;
  const hazard = group('hazard_ring',
    box(s, 0.01, w, 'hazard_yellow', [0, y, -2.5 - s / 2 + w / 2]),
    box(s, 0.01, w, 'hazard_yellow', [0, y, -2.5 + s / 2 - w / 2]),
    box(w, 0.01, s - 2 * w, 'hazard_yellow', [-s / 2 + w / 2, y, -2.5]),
    box(w, 0.01, s - 2 * w, 'hazard_yellow', [s / 2 - w / 2, y, -2.5]),
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

  // Ceiling light panels (flickered by the scene).
  const lights = group('ceiling_lights',
    ...[[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2]].map(([x, z], i) =>
      box(1.2, 0.05, 0.4, 'light_panel', [x, H - 0.025, z], `ceiling_light_${i}`)),
  );

  // Alarm lights high on the walls.
  const alarms = group('alarm_lights',
    box(0.08, 0.2, 0.3, 'alarm_red', [-4.96, 2.85, -1], 'alarm_light_0'),
    box(0.08, 0.2, 0.3, 'alarm_red', [4.96, 2.85, -1], 'alarm_light_1'),
    box(0.3, 0.2, 0.08, 'alarm_red', [-2.5, 2.85, -4.46], 'alarm_light_2'),
    box(0.3, 0.2, 0.08, 'alarm_red', [0, 2.7, 4.46], 'alarm_light_3'),
  );

  // Plain cabinets against the side walls.
  const cabinets = group('cabinets',
    box(0.6, 2.0, 1.4, 'metal', [-4.7, 1.0, 2.0], 'cabinet_0'),
    box(0.6, 2.0, 1.4, 'metal', [4.7, 1.0, 2.0], 'cabinet_1'),
    box(0.6, 1.0, 2.0, 'metal', [4.7, 0.5, -2.5], 'cabinet_2'),
  );

  return group('lab_room', shell, hazard, console_, lights, alarms, cabinets);
}
