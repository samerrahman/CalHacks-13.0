import type * as THREE from 'three';
import { buildLabRoom } from './labRoom';
import { buildContainmentTank } from './containmentTank';
import { buildClaws } from './claws';
import { buildShadowFigure } from './shadowFigure';
import { buildLabCorridor } from './labCorridor';
import { buildExitDoor } from './exitDoor';
import { buildPineTree, buildRock, buildFern, buildFallenLog, buildForestGround } from './forest';
import { buildShelterExterior } from './shelterExterior';
import { buildFpArms } from './fpArms';
import { buildResearcher } from './researcher';

/** Contract for every cutscene prop. Units are metres, +Y up. A replacement GLB in
 * cutscene/models/<name>.glb must keep the same origin, facing, scale and node names,
 * because the scene animates those nodes by name. */
export type PropSpec = { build: () => THREE.Object3D; size: string; origin: string; facing: string; nodes: string[] };

export const PROPS = {
  lab_room: { build: buildLabRoom, size: 'interior 14 (x) × 4 (y) × 14 (z)', origin: 'world origin on the floor; interior spans x −7..7, z −9.5..4.5, centred on the tank pad', facing: 'doorway 1.6 × 2.2 in the +Z wall at x −0.8..0.8; tank pad at (0, 0, −2.5), the room centre, left empty; observation console at z ≈ +0.4 facing +Z; equipment racks around the tube',
    nodes: ['alarm_light_0..3 (emissive alarm_red meshes on walls/ceiling)', 'ceiling_light_0..3 (white panel meshes the scene flickers)', 'console_screen_0..2 (emissive screens on the console)'] },
  containment_tank: { build: buildContainmentTank, size: 'opaque steel vessel about 2.4 across × 3.0 tall on a 0.3 plinth', origin: 'floor centre', facing: 'front hatch faces +Z',
    nodes: ['hatch_door (group pivoting on the hatch hinge at its −X edge; rotation.y = −1.9 swings it open toward +Z)', 'hatch_panel (flat steel plate, child of hatch_door)', 'hatch_bulge (the plate bulged toward +Z, child of hatch_door; hidden at rest, scale.z grows it)', 'hatch_hole (pure black opening behind the door)', 'claw_mount (empty group on the inner frame edge at the non-hinge +X side, rotated so mounted claws hook around the frame)', 'status_light_0..1 (emissive)'] },
  claws: { build: buildClaws, size: 'forearm (about 0.95 long, into the dark) plus a four-fingered clawed hand', origin: 'the wrist', facing: '+Z is out through the hole toward the camera; the forearm stub extends toward −Z',
    nodes: ['talon_0..3 (fingers: groups pivoting at the knuckles; positive rotation.x curls the whole finger)', 'forearm (group pivoting at the wrist; scale.z stretches the arm back toward −Z)'] },
  researcher: { build: buildResearcher, size: 'about 1.75 tall', origin: 'ground between the feet', facing: '+Z',
    nodes: ['body (hips pivot)', 'torso (waist pivot; +rotation.x leans forward)', 'head (neck pivot)', 'arm_l, arm_r (shoulder pivots; +rotation.x swings forward)', 'leg_l, leg_r (hip pivots; +rotation.x swings forward)', 'clipboard (in the right hand; the scene may hide it)'] },
  shadow_figure: { build: buildShadowFigure, size: 'about 2.5 tall', origin: 'ground between the feet', facing: '+Z (it runs toward +Z)', nodes: ['figure'] },
  lab_corridor: { build: buildLabCorridor, size: '2.4 wide × 2.6 tall × 12 long', origin: 'floor centre of the start (z = 0)', facing: 'runs from z = 0 to z = +12, open at both ends',
    nodes: ['alarm_light_0..5 (emissive alarm_red, spaced along the ceiling)', 'pipe_*', 'steam_vent_0..1 (empty groups marking where steam emits)'] },
  exit_door: { build: buildExitDoor, size: 'doorway 1.1 × 2.1 in a 3 × 2.8 wall section', origin: 'floor centre of the doorway', facing: 'door in the XY plane, hinge on −X, opens outward toward +Z',
    nodes: ['door_leaf (group whose origin is on the hinge line at x = −0.55; rotation.y = 0 is closed, rotation.y = −1.4 swings it open toward +Z)', 'push_bar', 'exit_sign (emissive exit_green above the frame)'] },
  pine_tree_a: { build: () => buildPineTree(11), size: '9–14 tall', origin: 'trunk base', facing: 'any', nodes: ['trunk', 'foliage'] },
  pine_tree_b: { build: () => buildPineTree(23), size: '9–14 tall', origin: 'trunk base', facing: 'any', nodes: ['trunk', 'foliage'] },
  pine_tree_c: { build: () => buildPineTree(37), size: '9–14 tall', origin: 'trunk base', facing: 'any', nodes: ['trunk', 'foliage'] },
  rock: { build: buildRock, size: 'about 1.2', origin: 'ground contact', facing: 'any', nodes: [] },
  fern: { build: buildFern, size: 'about 0.8', origin: 'ground contact', facing: 'any', nodes: [] },
  fallen_log: { build: buildFallenLog, size: 'about 4 long', origin: 'ground contact centre', facing: 'along X', nodes: [] },
  forest_ground: { build: buildForestGround, size: '24 wide × 50 long', origin: 'start centre (z = 0)', facing: 'runs to z = +50; a 1.4 wide dirt path winds along x ≈ 0 (within ±1.5)', nodes: ['path'] },
  shelter_exterior: { build: buildShelterExterior, size: 'bunker about 7 wide × 3.8 tall × 6 deep (fits the game interior 6.4 × 3.4 × 5.4), half-buried in an earth berm', origin: 'floor centre of the door threshold', facing: 'door faces −Z (approach side); the body extends toward +Z; doorway 1.5 × 2.7 opens into a dark vestibule',
    nodes: ['hatch_door (group whose origin is on the hinge line at x = +0.75; rotation.y = 0 is closed, rotation.y = −1.6 swings it open toward −Z)', 'hatch_dent (child of hatch_door: an inward bulge on the inside face; hidden at rest, the scene grows scale.z from 0 to 1)', 'lamp_bulb (emissive lamp_warm above the door)', 'sign'] },
  fp_arms: { build: buildFpArms, size: 'first-person forearms and hands', origin: 'camera position', facing: 'camera space: forward is −Z, up is +Y',
    nodes: ['arm_l', 'arm_r (pivots near the elbows, out of frame)', 'hand_l', 'hand_r', 'flashlight (held in hand_r)', 'flashlight_lens (emissive)'] },
} satisfies Record<string, PropSpec>;
export type PropName = keyof typeof PROPS;
export const PROP_NAMES = Object.keys(PROPS) as PropName[];
