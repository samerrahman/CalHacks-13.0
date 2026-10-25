import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { box, group, jitter, mesh, type MaterialKey } from '../style';

// Half-buried concrete shelter in the woods. Contract: PROPS.shelter_exterior in ./index.ts.
// Deliberately low detail (blocky placeholder): concrete body, a dark vestibule behind the
// doorway, a steel hatch, a lamp and a sign, plus a few earth berms piled on top and sides.
//
// Local frame: origin on the floor at the centre of the door threshold; the front face is the
// plane z = 0 and faces −Z; the body fills x −3.5..3.5, y 0..3.8, z 0..6.

const W = 7, H = 3.8, D = 6;
const DOOR_W = 1.5, DOOR_H = 2.7, VEST = 1.5;
const SINK = 0.2; // walls run a little below the threshold so uneven ground never shows a gap

type V3 = [number, number, number];

/** Low-poly earth lump: convex hull of a few points, nudged for an organic outline. */
function berm(points: V3[], key: MaterialKey, seed: number): THREE.Mesh {
  const g = new ConvexGeometry(points.map(p => new THREE.Vector3(...p)));
  return mesh(jitter(g, 0.25, seed), key);
}

export function buildShelterExterior(): THREE.Group {
  const hx = DOOR_W / 2, sideW = W / 2 - hx, wallH = H + SINK;

  // Concrete body: rear block plus three blocks framing the doorway.
  const body = group('body',
    box(W, wallH, D - VEST, 'concrete', [0, H - wallH / 2, VEST + (D - VEST) / 2]),
    box(sideW, wallH, VEST, 'concrete', [-(hx + sideW / 2), H - wallH / 2, VEST / 2]),
    box(sideW, wallH, VEST, 'concrete', [hx + sideW / 2, H - wallH / 2, VEST / 2]),
    box(DOOR_W, H - DOOR_H, VEST, 'concrete', [0, (H + DOOR_H) / 2, VEST / 2]),
  );

  // Vestibule lining in pure black: from outside the shed is a black hole (closed at the back).
  const t = 0.04;
  const vestibule = group('vestibule',
    box(DOOR_W, DOOR_H, t, 'void', [0, DOOR_H / 2, VEST - t / 2]),
    box(t, DOOR_H, VEST, 'void', [-hx + t / 2, DOOR_H / 2, VEST / 2]),
    box(t, DOOR_H, VEST, 'void', [hx - t / 2, DOOR_H / 2, VEST / 2]),
    box(DOOR_W, t, VEST, 'void', [0, DOOR_H - t / 2, VEST / 2]),
    box(DOOR_W, t, VEST, 'void', [0, t / 2, VEST / 2]),
  );

  // Hatch: pivot on the hinge line at x = +0.75, slab offset toward −X just in front of the face.
  // hatch_dent is the crumpled bulge the final impact punches into the inside face (+Z);
  // the scene reveals it by growing scale.z from 0 to 1.
  const dentShape = new THREE.SphereGeometry(0.3, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1.15, 0.28);
  const dent = group('hatch_dent', mesh(jitter(dentShape, 0.03, 21), 'steel_teal'));
  dent.position.set(-DOOR_W / 2 + 0.05, 1.45, -0.01);
  dent.visible = false;
  const hatch = group('hatch_door',
    box(DOOR_W, DOOR_H, 0.1, 'steel_teal', [-DOOR_W / 2, DOOR_H / 2, -0.06], 'hatch_slab'),
    box(0.07, 0.34, 0.07, 'metal_dark', [-DOOR_W + 0.2, 1.15, -0.145], 'hatch_handle'),
    dent,
  );
  hatch.position.set(hx, 0, 0);

  const sign = box(1.1, 0.34, 0.03, 'cream', [0, 3.0, -0.015], 'sign');
  const lamp = box(0.3, 0.14, 0.16, 'lamp_warm', [0, 3.5, -0.08], 'lamp_bulb');

  // Earth berm: sides slope to the ground, a mossy cap on the roof, a ramp behind.
  const side = (s: number): V3[] => [
    [s * 3.45, -0.1, -0.5], [s * 6.4, -0.1, 0.9], [s * 6.6, -0.1, 6.2], [s * 3.45, -0.1, 7.6],
    [s * 3.3, 2.6, 0.15], [s * 3.3, 3.2, 3.0], [s * 3.3, 3.1, 6.1], [s * 4.7, 1.6, 3.2],
  ];
  const earth = group('earth',
    berm(side(-1), 'dirt', 11),
    berm(side(1), 'dirt', 12),
    berm([
      [-3.8, 3.5, 0.6], [3.8, 3.5, 0.6], [4.0, 3.5, 6.4], [-4.0, 3.5, 6.4],
      [-2.4, 4.4, 1.7], [2.4, 4.4, 1.7], [2.2, 4.6, 5.0], [-2.2, 4.6, 5.0],
    ], 'moss', 13),
    berm([
      [-3.6, -0.1, 5.8], [3.6, -0.1, 5.8], [-3.6, 3.4, 5.8], [3.6, 3.4, 5.8],
      [-5.4, -0.1, 8.6], [5.4, -0.1, 8.6], [0, -0.1, 9.8], [0, 2.2, 7.6],
    ], 'moss', 14),
  );

  return group('shelter_exterior', body, vestibule, hatch, sign, lamp, earth);
}
