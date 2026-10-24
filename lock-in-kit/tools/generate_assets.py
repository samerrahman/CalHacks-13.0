#!/usr/bin/env python3
"""Rebuild LOCK IN's original GLBs, geometry previews and synthesized effects.

Python 3.10+ standard library only. No API, downloaded model, recording or voice.
The compact GLB writer adapts the permitted original Night Relay kit approach.

Original Night Relay kit material: Permission is granted, free of charge, to any
person obtaining a copy of the original code, procedural models, animations,
SVG graphics, synthesized WAV sounds, dialogue and documentation in this kit,
to use, copy, modify, merge, publish, distribute, sublicense and/or sell copies,
subject to retaining this notice with redistributed source or asset packs.
THE MATERIAL IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND. No claim is made
that it constitutes a completed game, a medical device, verified sponsor
integration or guaranteed prize eligibility. No third-party model pack is
bundled. Referenced services, SDKs, libraries, trademarks, external art and
provider-generated audio retain their respective terms. This permission does
not grant rights to third-party voices or authorize cloning a real person's voice.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
TAU = math.tau
PALETTE = {
    'steel_teal': (.095, .19, .175, 1),
    'wall_teal': (.13, .22, .20, 1),
    'deep_steel': (.022, .055, .052, 1),
    'black': (.008, .015, .014, 1),
    'cream': (.59, .57, .44, 1),
    'amber': (.76, .32, .065, 1),
    'rust': (.27, .105, .042, 1),
    'screen': (.012, .045, .037, 1),
    'phosphor': (.16, .46, .31, 1),
    'emergency_glow': (.56, .35, .075, 1),
    'status_dim': (.09, .13, .105, 1),
}


def quaternion(axis, angle):
    s = math.sin(angle / 2)
    return [axis[0] * s, axis[1] * s, axis[2] * s, math.cos(angle / 2)]


def rotated(v, q):
    x, y, z, w = q
    tx, ty, tz = 2*(y*v[2]-z*v[1]), 2*(z*v[0]-x*v[2]), 2*(x*v[1]-y*v[0])
    return [v[0]+w*tx+y*tz-z*ty, v[1]+w*ty+z*tx-x*tz, v[2]+w*tz+x*ty-y*tx]


class Model:
    def __init__(self, name, description):
        self.name, self.description = name, description
        self.binary, self.preview, self.parents = bytearray(), [], {}
        self.doc = {'asset': {'version': '2.0', 'generator': 'LOCK IN original procedural kit',
                    'copyright': 'Original kit material; retain LICENSE.txt'},
                    'scene': 0, 'scenes': [{'name': name, 'nodes': []}], 'nodes': [],
                    'meshes': [], 'materials': [], 'buffers': [], 'bufferViews': [], 'accessors': [],
                    'extras': {'units': 'meters', 'up': '+Y', 'front': '+Z', 'description': description}}
        for key, color in PALETTE.items():
            mat = {'name': key, 'pbrMetallicRoughness': {'baseColorFactor': color,
                   'metallicFactor': .45 if 'steel' in key else .1, 'roughnessFactor': .82}}
            if key == 'emergency_glow': mat['emissiveFactor'] = [.36, .18, .02]
            if key == 'phosphor': mat['emissiveFactor'] = [.02, .10, .045]
            self.doc['materials'].append(mat)

    def accessor(self, values, kind):
        dimensions = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[kind]
        flat = values if dimensions == 1 else [n for row in values for n in row]
        while len(self.binary) % 4: self.binary.append(0)
        offset = len(self.binary)
        self.binary.extend(struct.pack('<' + 'f' * len(flat), *flat))
        view = len(self.doc['bufferViews'])
        self.doc['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(flat)*4})
        data = {'bufferView': view, 'componentType': 5126, 'count': len(values), 'type': kind}
        if kind in ('VEC3', 'SCALAR'):
            rows = [[x] for x in values] if dimensions == 1 else values
            data['min'] = [min(row[k] for row in rows) for k in range(dimensions)]
            data['max'] = [max(row[k] for row in rows) for k in range(dimensions)]
        index = len(self.doc['accessors']); self.doc['accessors'].append(data)
        return index

    def node(self, name, position=(0, 0, 0), parent=None, rotation=None):
        assert not any(n['name'] == name for n in self.doc['nodes']), name
        node = {'name': name, 'translation': list(position)}
        if rotation: node['rotation'] = rotation
        index = len(self.doc['nodes']); self.doc['nodes'].append(node); self.parents[index] = parent
        if parent is None: self.doc['scenes'][0]['nodes'].append(index)
        else: self.doc['nodes'][parent].setdefault('children', []).append(index)
        return index

    def world(self, vertex, node, normal=False):
        result = list(vertex)
        while node is not None:
            part = self.doc['nodes'][node]
            result = rotated(result, part.get('rotation', [0, 0, 0, 1]))
            if not normal: result = [result[k] + part['translation'][k] for k in range(3)]
            node = self.parents[node]
        return result

    def faces(self, name, faces, position, material, parent=None, rotation=None):
        vertices, normals, uvs = [], [], []
        for points, normal in faces:
            face_uv = [(0,0),(1,0),(1,1),(0,1)] if len(points)==4 else [(.5+.5*math.cos(TAU*i/len(points)),.5+.5*math.sin(TAU*i/len(points))) for i in range(len(points))]
            for j in range(1, len(points)-1):
                vertices.extend([points[0], points[j], points[j+1]])
                normals.extend([normal] * 3)
                uvs.extend([face_uv[0],face_uv[j],face_uv[j+1]])
        mesh = len(self.doc['meshes'])
        self.doc['meshes'].append({'name': name, 'primitives': [{'attributes': {
            'POSITION': self.accessor(vertices, 'VEC3'), 'NORMAL': self.accessor(normals, 'VEC3'), 'TEXCOORD_0': self.accessor(uvs, 'VEC2')},
            'material': list(PALETTE).index(material)}]})
        node = self.node(name, position, parent, rotation); self.doc['nodes'][node]['mesh'] = mesh
        for points, normal in faces:
            self.preview.append({'points': [self.world(point, node) for point in points],
                'normal': self.world(normal, node, True), 'color': PALETTE[material][:3], 'node': name})
        return node

    def box(self, name, position, size, material='steel_teal', parent=None, rotation=None):
        x, y, z = [n/2 for n in size]
        v = [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
        indices = [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(0,1,5,4),(3,7,6,2)]
        normals = [(0,0,-1),(0,0,1),(-1,0,0),(1,0,0),(0,-1,0),(0,1,0)]
        return self.faces(name, [([v[i] for i in face], normal) for face, normal in zip(indices, normals)], position, material, parent, rotation)

    def cylinder(self, name, position, radius, height, material='steel_teal', parent=None, rotation=None, sides=12):
        faces = []
        bottom = [(math.cos(TAU*i/sides)*radius, -height/2, math.sin(TAU*i/sides)*radius) for i in range(sides)]
        top = [(x, height/2, z) for x, _, z in bottom]
        for i in range(sides):
            j = (i+1) % sides; angle = TAU*(i+.5)/sides
            faces.append(([bottom[i], top[i], top[j], bottom[j]], (math.cos(angle), 0, math.sin(angle))))
        faces += [(list(reversed(top)), (0,1,0)), (bottom, (0,-1,0))]
        return self.faces(name, faces, position, material, parent, rotation)

    def animate(self, name, channels, description):
        samplers, targets = [], []
        for node, path, times, values in channels:
            sampler = len(samplers)
            samplers.append({'input': self.accessor(times, 'SCALAR'), 'output': self.accessor(values, 'VEC4' if path == 'rotation' else 'VEC3'), 'interpolation': 'LINEAR'})
            targets.append({'sampler': sampler, 'target': {'node': node, 'path': path}})
        self.doc.setdefault('animations', []).append({'name': name, 'samplers': samplers, 'channels': targets, 'extras': {'description': description}})

    def save(self):
        self.doc['buffers'] = [{'byteLength': len(self.binary)}]
        encoded = json.dumps(self.doc, separators=(',', ':')).encode()
        encoded += b' ' * (-len(encoded) % 4)
        binary = bytes(self.binary) + b'\0' * (-len(self.binary) % 4)
        length = 12 + 8 + len(encoded) + 8 + len(binary)
        output = struct.pack('<III', 0x46546c67, 2, length) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + struct.pack('<II', len(binary), 0x004e4942) + binary
        (ASSETS/'models'/f'{self.name}.glb').write_bytes(output)
        (ASSETS/'previews'/f'{self.name}.geometry.json').write_text(json.dumps(self.preview, separators=(',', ':'))+'\n')
        return {'file': f'models/{self.name}.glb', 'nodes': len(self.doc['nodes']), 'meshes': len(self.doc['meshes']),
                'animations': [{'name': a['name'], 'description': a['extras']['description']} for a in self.doc.get('animations', [])]}


def make_models():
    models = []
    m = Model('shelter', 'Windowless 6 x 5 x 3m interior; closed solid shell, no corridor or glass. Origin floor center.')
    m.box('floor_slab', (0,-.10,0), (6.4,.2,5.4), 'deep_steel')
    m.box('ceiling_slab', (0,3.10,0), (6.4,.2,5.4), 'deep_steel')
    for side in (-1,1):
        m.box(f'side_wall_{side}', (side*3.1,1.5,0), (.2,3,5.4), 'wall_teal')
        m.box(f'end_wall_{side}', (0,1.5,side*2.6), (6.4,3,.2), 'wall_teal')
        for z in (-2.3,-.8,.8,2.3):
            m.box(f'wall_rib_{side}_{z}', (side*2.97,1.5,z), (.065,3,.08), 'steel_teal')
        for y in (.16,2.78): m.box(f'wall_rail_{side}_{y}', (side*2.96,y,0), (.06,.055,5), 'steel_teal')
    for x in (-2.7,-1.2,.3,1.8,2.7):
        m.box(f'front_rib_{x}', (x,1.5,-2.46), (.065,3,.06), 'steel_teal')
    for x in (-2,-1,0,1,2): m.box(f'floor_seam_x{x}', (x,.002,0), (.014,.004,5), 'black')
    for z in (-2,-1,0,1,2): m.box(f'floor_seam_z{z}', (0,.002,z), (6,.004,.014), 'black')
    for x in (-1.65,1.65):
        m.box(f'ceiling_fixture_{x}', (x,2.94,-.5), (.8,.1,.19), 'black')
        m.box(f'ceiling_diffuser_{x}', (x,2.883,-.5), (.7,.018,.12), 'cream')
    for x in (1.5,1.65): m.cylinder(f'front_conduit_{x}', (x,1.5,-2.42), .025, 2.85, 'rust', sides=8)
    m.box('sealed_vent_back', (-2.945,2.20,.35), (.06,.48,.85), 'black')
    for i in range(7): m.box(f'vent_louvre_{i}', (-2.90,2.02+i*.06,.35), (.065,.025,.79), 'steel_teal')
    m.box('emergency_cable_trunk', (-.7,2.45,2.45), (.05,1.1,.07), 'rust')
    models.append(m.save())

    m = Model('sealed_door', 'Reinforced sealed door. Cosmetic impact/dent only; no opening or toggle clip. Floor origin, front +Z.')
    root = m.node('sealed_door_root')
    m.box('door_backing', (0,1.3,-.025), (1.32,2.6,.13), 'deep_steel', root)
    for x in (-.7,.7): m.box(f'door_frame_{x}', (x,1.32,.02), (.12,2.7,.24), 'steel_teal', root)
    m.box('door_header', (0,2.66,.02), (1.52,.12,.24), 'steel_teal', root)
    m.box('door_threshold', (0,.04,.075), (1.45,.08,.33), 'rust', root)
    panels = []
    for i,x in enumerate((-.42,0,.42)):
        part=m.node(f'dent_panel_{i+1}',(x,1.30,.075),root); panels.append(part)
        m.box(f'door_steel_leaf_{i+1}', (0,0,0), (.414,2.46,.08), 'wall_teal',part)
    for y in (.48,1.12,1.91):
        m.box(f'cross_brace_{y}', (0,y,.16), (1.24,.10,.10), 'deep_steel',root)
    for side in (-1,1):
        for i,y in enumerate((.25,.85,1.5,2.2)):
            m.cylinder(f'lock_bolt_{side}_{i}', (side*.58,y,.20), .034,.035,'cream',root,quaternion((1,0,0),math.pi/2),8)
    m.box('door_handle', (.37,1.38,.25), (.075,.32,.09), 'cream',root)
    m.box('door_warning_band', (0,2.34,.124), (1.20,.12,.02), 'amber',root)
    m.box('door_blank_label', (-.20,1.60,.123), (.42,.18,.018), 'cream',root)
    impact=[];dent=[]
    for i,node in enumerate(panels):
        x=(-.42,0,.42)[i];depth=.10 if i==1 else .04
        impact.append((node,'translation',[0,.07,.18,.45],[[x,1.3,.075],[x,1.3,.075+depth],[x,1.3,.06],[x,1.3,.075]]))
        dent.append((node,'translation',[0,.12,.8],[[x,1.3,.075],[x,1.3,.075+depth*1.6],[x,1.3,.075+depth*1.4]]))
        dent.append((node,'rotation',[0,.12,.8],[quaternion((0,1,0),0),quaternion((0,1,0),(i-1)*.11),quaternion((0,1,0),(i-1)*.075)]))
    m.animate('impact',impact,'Nonlethal or warning-time cosmetic vibration; returns to base. No door opens.')
    m.animate('dent',dent,'Final cosmetic crease. LoopOnce + clampWhenFinished after authoritative breach, then fade to black.')
    models.append(m.save())

    m=Model('workdesk','Three-metre steel workbench; floor-centered origin. Work surface at y=.92.')
    m.box('desk_top',(0,.86,0),(3.25,.12,.88),'steel_teal')
    m.box('desk_front_lip',(0,.86,.45),(3.25,.10,.04),'deep_steel')
    for x in (-1.45,1.45):
        m.box(f'leg_{x}',(x,.41,0),(.08,.82,.72),'deep_steel')
        m.box(f'foot_{x}',(x,.045,0),(.3,.09,.9),'black')
    m.box('cable_tray',(0,.63,-.28),(2.85,.08,.25),'deep_steel')
    m.box('underdesk_drawer',(-.95,.65,.03),(.65,.26,.63),'wall_teal')
    m.box('drawer_handle',(-.95,.65,.36),(.22,.025,.04),'cream')
    m.box('desk_wear_strip',(0,.925,.37),(2.9,.008,.055),'rust')
    models.append(m.save())

    m=Model('terminal','Task terminal, base origin on desk; terminal_screen +Z front for runtime UI.')
    m.box('terminal_base',(0,.045,0),(.78,.09,.57),'deep_steel')
    m.box('terminal_body',(0,.30,-.075),(.70,.49,.31),'steel_teal')
    m.box('terminal_bezel',(0,.33,.09),(.62,.37,.04),'black')
    m.box('terminal_screen',(0,.34,.114),(.55,.28,.009),'screen')
    m.box('terminal_screen_lip',(0,.14,.13),(.62,.045,.07),'steel_teal')
    for row in range(2):
        for col in range(6): m.box(f'terminal_key_{row}_{col}',(-.245+col*.097,.10,.18+row*.10),(.07,.025,.06),'cream')
    m.box('terminal_status_led',(.28,.535,.088),(.035,.015,.012),'status_dim')
    for i in range(5): m.box(f'terminal_vent_{i}',(-.355,.17+i*.055,-.08),(.012,.018,.19),'black')
    models.append(m.save())

    m=Model('security_monitor','Fictional CCTV monitor. security_screen is 16:9; never use it as the webcam preview.')
    m.box('security_foot',(0,.025,0),(.60,.05,.32),'deep_steel')
    m.box('security_stem',(0,.115,-.05),(.12,.18,.14),'steel_teal')
    m.box('security_case',(0,.44,-.035),(1.01,.63,.34),'steel_teal')
    m.box('security_bezel',(0,.46,.15),(.90,.51,.04),'black')
    m.box('security_screen',(0,.46,.174),(.80,.45,.008),'screen')
    for i in range(3):m.box(f'security_control_{i}',(-.30+i*.13,.165,.16),(.065,.03,.03),'cream')
    m.box('security_on_led',(.37,.17,.164),(.025,.025,.015),'status_dim')
    models.append(m.save())

    m=Model('proximity_detector','Wall-mounted detector. Root is panel centre; distance must come from authoritative creature position.')
    m.box('detector_case',(0,0,0),(.42,.58,.17),'steel_teal')
    m.box('detector_bezel',(0,.08,.097),(.34,.29,.035),'black')
    m.box('proximity_screen',(0,.085,.119),(.285,.22,.009),'screen')
    for i in range(5):m.box(f'distance_segment_{i}',(-.13+i*.065,-.115,.095),(.045,.055,.018),'status_dim')
    m.box('detector_blank_label',(0,-.226,.095),(.30,.065,.015),'cream')
    m.cylinder('detector_receiver',(0,.36,0),.025,.16,'rust',sides=8)
    models.append(m.save())

    m=Model('radio_speaker','Desk radio speaker; same audio processing for authored/emergency/creature speech; no voice included.')
    m.box('radio_case',(0,.18,0),(.48,.36,.25),'deep_steel')
    for i in range(7):m.box(f'speaker_grille_{i}',(-.07,.065+i*.036,.137),(.27,.013,.027),'steel_teal')
    m.cylinder('radio_tuning_knob',(.16,.22,.155),.045,.045,'cream',rotation=quaternion((1,0,0),math.pi/2))
    m.box('radio_signal_led',(.16,.095,.137),(.025,.025,.02),'status_dim')
    m.cylinder('radio_antenna',(-.17,.49,-.06),.008,.33,'steel_teal',sides=8)
    models.append(m.save())

    m=Model('machine_rack','Four numbered mechanical units in one rack; fault_01..04 drive individual captive mechanisms.')
    root=m.node('machine_rack_root')
    m.box('rack_back',(0,1.0,-.19),(1.84,2,.12),'deep_steel',root)
    for x in (-.9,.9):m.box(f'rack_side_{x}',(x,1.0,0),(.08,2.0,.53),'steel_teal',root)
    for y in (.07,.98,1.94):m.box(f'rack_rail_{y}',(0,y,0),(1.84,.07,.53),'steel_teal',root)
    for i,(x,y) in enumerate(((-.44,.53),(.44,.53),(-.44,1.45),(.44,1.45)),1):
        unit=m.node(f'unit_{i:02d}',(x,y,0),root)
        m.box(f'unit_{i:02d}_housing',(0,0,0),(.74,.70,.43),'wall_teal',unit)
        m.box(f'unit_{i:02d}_recess',(0,.035,.225),(.53,.44,.025),'black',unit)
        fault=m.node(f'unit_{i:02d}_fault_assembly',(0,.035,.25),unit)
        m.cylinder(f'unit_{i:02d}_rotor',(0,0,0),.15,.035,'steel_teal',fault,quaternion((1,0,0),math.pi/2),12)
        for arm in range(3):
            m.box(f'unit_{i:02d}_rotor_spoke_{arm}',(0,0,.025),(.24,.027,.02),'rust',fault,quaternion((0,0,1),arm*TAU/3))
        m.box(f'unit_{i:02d}_fault_lamp',(.27,.245,.23),(.055,.065,.02),'status_dim',unit)
        m.box(f'unit_{i:02d}_number_plate',(-.23,.245,.232),(.13,.065,.014),'cream',unit)
        # Tactile notch counts identify physical units without color or a font texture.
        for notch in range(i):m.box(f'unit_{i:02d}_id_notch_{notch}',(-.27+notch*.026,.245,.243),(.012,.035,.007),'deep_steel',unit)
        m.box(f'unit_{i:02d}_reset_button',(.23,-.24,.245),(.10,.06,.045),'cream',unit)
        m.animate(f'fault_{i:02d}',[(fault,'translation',[0,.08,.16,.24,.32],[[0,.035,.25],[.012,.025,.27],[-.012,.045,.25],[.008,.035,.26],[0,.035,.25]]),
            (fault,'rotation',[0,.16,.32],[quaternion((0,0,1),0),quaternion((0,0,1),.34),quaternion((0,0,1),0)])],
            f'Loop only while unit {i} has an active fault; stop/reset when silenced. Light/noise remain game-controlled.')
    models.append(m.save())

    m=Model('emergency_switch','Fixed wall switch; root panel centre, front +Z. Emergency indicator remains emissive in blackout.')
    root=m.node('emergency_switch_root')
    m.box('switch_backplate',(0,0,0),(.38,.58,.10),'cream',root)
    m.box('switch_socket',(0,-.025,.066),(.16,.24,.045),'black',root)
    for x in (-.125,.125):m.box(f'switch_guard_{x}',(x,-.025,.16),(.035,.34,.22),'amber',root)
    pivot=m.node('switch_lever',(0,-.025,.095),root,quaternion((1,0,0),-.45))
    m.box('lever_stem',(0,.075,.035),(.045,.17,.045),'steel_teal',pivot)
    m.box('lever_grip',(0,.16,.035),(.15,.06,.075),'amber',pivot)
    m.box('emergency_locator',(0,.222,.069),(.22,.045,.025),'emergency_glow',root)
    m.box('switch_blank_label',(0,-.235,.066),(.27,.06,.016),'deep_steel',root)
    m.animate('flip_off',[(pivot,'rotation',[0,.35],[quaternion((1,0,0),-.45),quaternion((1,0,0),.45)])],'Cosmetic on→off lever motion; power state is code-authoritative.')
    m.animate('flip_on',[(pivot,'rotation',[0,.35],[quaternion((1,0,0),.45),quaternion((1,0,0),-.45)])],'Cosmetic off→on lever motion; fixed key action remains usable in blackout.')
    models.append(m.save())

    m=Model('creature_cctv','Fictional security-feed silhouette ONLY. Never place this model inside the shelter or reveal it directly.')
    root=m.node('cctv_creature_root');torso=m.node('cctv_torso',(0,1.35,0),root,quaternion((1,0,0),.18))
    m.box('angular_torso',(0,0,0),(.42,.83,.27),'black',torso)
    m.box('raised_shoulder',(-.06,.42,-.025),(.68,.16,.30),'black',torso,quaternion((0,0,1),.15))
    neck=m.node('cctv_neck',(.08,.56,.12),torso)
    m.box('featureless_head',(0,0,0),(.22,.33,.25),'black',neck,quaternion((0,0,1),-.23))
    m.box('back_ridge',(0,.20,-.18),(.085,.7,.10),'deep_steel',torso)
    limbs=[]
    for side in (-1,1):
        arm=m.node(f'cctv_arm_{side}',(side*.34,.30,.02),torso,quaternion((0,0,1),side*.13));limbs.append(arm)
        m.box(f'long_arm_{side}',(side*.04,-.51,.035),(.09,1.1,.10),'black',arm)
        for digit in range(3):m.box(f'cctv_digit_{side}_{digit}',(side*.04+(digit-1)*.037,-1.12,.06),(.022,.25,.032),'black',arm)
        m.box(f'cctv_leg_{side}',(side*.13,.45,-.045),(.13,.9,.17),'black',root,quaternion((0,0,1),side*-.06))
        m.box(f'cctv_foot_{side}',(side*.15,.045,.07),(.15,.09,.32),'black',root)
    m.animate('idle',[(torso,'translation',[0,1.5,3],[[0,1.35,0],[.025,1.37,.015],[0,1.35,0]])],'Subtle CCTV-only silhouette motion; no world movement.')
    m.animate('listen',[(neck,'rotation',[0,.5,1.3,1.8],[quaternion((0,0,1),0),quaternion((0,0,1),.38),quaternion((0,0,1),.38),quaternion((0,0,1),0)])],'Feed-only listening tilt, synchronized to an eligible observed event.')
    m.animate('recoil',[(torso,'rotation',[0,.15,.7],[quaternion((1,0,0),.18),quaternion((1,0,0),-.12),quaternion((1,0,0),.18)])],'Brief camera interruption silhouette movement; never an interior death reveal.')
    models.append(m.save())
    return models


def make_audio():
    sr=22050; entries=[]

    def generate(name,duration,formula,description,loop=False,peak_limit=.68):
        count=round(duration*sr);rng=random.Random(int.from_bytes(hashlib.sha256(name.encode()).digest()[:8],'little'))
        low=0.;samples=[]
        for i in range(count):
            t=i/sr;white=rng.uniform(-1,1);low=.88*low+.12*white
            value=formula(t,white,low)
            if not loop:value*=min(1,t/.006,max(0,(duration-t)/.045))
            samples.append(value)
        peak=max(abs(v) for v in samples) or 1;factor=min(1,peak_limit/peak)
        pcm=array.array('h',(round(v*factor*32767) for v in samples))
        measured=max(abs(v) for v in pcm)/32768
        rms=math.sqrt(sum((v/32768)**2 for v in pcm)/count)
        if sys.byteorder!='little':pcm.byteswap()
        destination=ASSETS/'audio'/f'{name}.wav'
        with wave.open(str(destination),'wb') as f:
            f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes(pcm.tobytes())
        entries.append({'file':f'audio/{name}.wav','sampleRateHz':sr,'channels':1,'bitsPerSample':16,'durationSeconds':count/sr,
            'loop':loop,'peakLinear':round(measured,6),'rmsLinear':round(rms,6),'description':description,
            'provenance':'Original deterministic procedural synthesis; no recorded voice or provider output'})

    def tone(t,f):return math.sin(TAU*f*t)
    def hit(t,start,freq=75,strength=1,decay=22):
        x=t-start
        return strength*tone(x,freq)*math.exp(-decay*x)*min(1,max(0,x/.004)) if 0<=x<.5 else 0
    def noise_bed(t,duration):return sum(math.sin(TAU*k*t/duration+k*.91)/10 for k in (23,37,59,89,149,233,397,619))
    def steps(t,white,starts,gains):return sum(hit(t,a,67,g,26)+(.18*white*math.exp(-35*(t-a)) if 0<t-a<.23 else 0) for a,g in zip(starts,gains))

    generate('intro_alarm',4,lambda t,w,l:.22*tone(t,580+45*math.sin(TAU*t))*min(1,(t%1.0)/.04)*max(0,1-(t%1.0)/.52),
             'Opening containment alarm; two-tone texture distinct from the learned breach warning.')
    forest_times=[.12+i*.27 for i in range(13)]
    generate('forest_run',3.8,lambda t,w,l:steps(t,w,forest_times,[.50]*13)+.07*l,
             'Opening running footfalls and synthesized foliage rustle; dark-screen intro only.')
    generate('door_slam',1.8,lambda t,w,l:hit(t,.06,43,.85,7)+hit(t,.08,119,.35,13)+(.3*l*math.exp(-5*(t-.06)) if t>.06 else 0),
             'Researcher seals the shelter. Heavy low slam with short metal resonance, not a gameplay door toggle.')
    generate('room_hum',6,lambda t,w,l:.065*tone(t,60)+.022*tone(t,120)+.035*noise_bed(t,6),
             'Quiet seamless mains/vent bed; stop when equipment is powered down.',True,.20)
    generate('fault_rattle',2,lambda t,w,l:(.035*tone(t,72)+.10*noise_bed(t,2))*(.35+.65*math.sin(TAU*7*t)**2),
             'Seamless active-fault bed. Position on the currently faulty machine; gain follows active fault count.',True,.24)
    generate('fault_silenced',.42,lambda t,w,l:hit(t,.015,240,.28,35)+hit(t,.09,130,.12,28),
             'Single correct fault repair. Brief tactile mechanism reset; gameplay may emit its small local noise clue.')
    generate('machine_mistake',1.25,lambda t,w,l:hit(t,.035,91,.65,5)+hit(t,.035,291,.24,8)+(.13*w*math.exp(-16*(t-.035)) if t>.035 else 0),
             'Incorrect quiet-box click: obvious sustained metal clang and a code-authored noise spike.')
    generate('relay_confirm',.6,lambda t,w,l:hit(t,.025,180,.36,30)+hit(t,.16,280,.20,24),
             'Stage completion relay: audible local cost paired with code-authored progress benefit.')
    generate('terminal_press',.14,lambda t,w,l:.22*w*math.exp(-55*t)+.09*tone(t,700)*math.exp(-45*t),
             'Ordinary interface key tactile feedback; do not treat every UI focus action as a monster clue.')
    for i,freq in enumerate((330,440,554,659),1):
        generate(f'sequence_tone_{i}',.42,lambda t,w,l,f=freq:.18*tone(t,f)*math.sin(math.pi*min(1,t/.42))**2,
                 f'Input {i} sequence cue. Distinct pitch accompanies visible numeral; never audio-only authentication.')
    generate('lure_heartbeat',4,lambda t,w,l:hit(t%1,.08,58,.49,27)+hit(t%1,.255,76,.35,35),
             'Seamless synthetic remote heartbeat template at 60 cycles/min. Fictional lure, not recorded player pulse.',True,.58)
    generate('lure_transmit',1.3,lambda t,w,l:.13*tone(t,280+230*t)*(math.sin(math.pi*min(1,t/1.3))**2)+hit(t,.05,135,.25,28),
             'Brief local transmitter activation; stronger sustained heartbeat belongs at the actual remote emitter.')
    starts=[.12,.9,1.67,2.41,3.12,3.80,4.45]
    generate('steps_approaching',5,lambda t,w,l:steps(t,w,starts,[.13,.18,.24,.31,.40,.49,.58]),
             'Distinct footsteps growing closer. Mono source position/distance must follow the same creature state as the detector.')
    generate('steps_receding',5,lambda t,w,l:steps(t,w,starts,[.58,.49,.40,.31,.24,.18,.13]),
             'Same footsteps clearly receding; truthful restart-opportunity cue. Never play while the authoritative creature is approaching.')
    generate('wall_breath',4,lambda t,w,l:.30*l*math.sin(math.pi*t/2)**2+.018*tone(t,53)*math.sin(math.pi*t/2)**2,
             'Synthesized low wall-side exhalation texture. No recorded person and no spoken voice.')
    generate('wall_scrape',2.8,lambda t,w,l:(.24*l+.035*tone(t,140+30*math.sin(t*7)))*math.sin(math.pi*t/2.8)**2,
             'Slow metal contact outside a wall; position at the actual adjacent creature location.')
    generate('breach_warning',3.2,lambda t,w,l:sum(hit(t,a,110,.28,15) for a in (.12,.62,1.12)) + (.08*l*math.sin(math.pi*(t-1.5)/1.5)**2 if 1.5<t<3 else 0),
             'Reserved learned lethal-warning cue: three equally spaced low knocks, then drag. Pair with accessible warning caption; never use for a harmless scare.')
    generate('breach_impact',1.8,lambda t,w,l:hit(t,.035,38,.9,5)+hit(t,.045,83,.45,7)+(.24*l*math.exp(-4*(t-.035)) if t>.035 else 0),
             'Final heavy door deformation sound after the entire legal warning expires; follows authoritative loss, never causes it.')
    generate('blackout',1.4,lambda t,w,l:.20*tone(t,140-65*t)*max(0,1-t/1.3)+hit(t,.04,230,.18,40)+.02*l,
             'Power-down motor decay. Visual puzzles preserve progress while threat simulation continues.')
    generate('power_restart',2.2,lambda t,w,l:.15*tone(t,55+55*t)*min(1,t/.2)*max(0,1-t/2.2)+hit(t,1.5,240,.25,25),
             'Audible restart ramp and relay. Code decides its noise clue based on true creature distance.')
    generate('containment_success',2.5,lambda t,w,l:hit(t,.08,95,.23,16)+sum(.085*tone(max(0,t-a),f)*math.exp(-2*max(0,t-a)) if t>=a else 0 for a,f in ((.35,330),(.65,440),(.95,550))),
             'Remote containment latch plus restrained confirmation chord; play only after final success commits.')
    generate('radio_static',2,lambda t,w,l:.065*noise_bed(t,2)+.016*tone(t,1490),
             'Seamless neutral radio interference bed. Same processing for prepared and generated dialogue.',True,.18)
    generate('radio_chime',.65,lambda t,w,l:.15*tone(t,620 if t<.3 else 790)*math.exp(-7*(t%.3)),
             'Short emergency message/caption fallback chime; no speech content or provider attribution.')
    generate('monitor_interrupt',.8,lambda t,w,l:.10*w*math.exp(-5*t)+.06*tone(t,350-200*t)*max(0,1-t/.8),
             'Fictional CCTV dropout; never a webcam permission/error cue and never implies a creature teleport.')
    (ASSETS/'audio'/'audio-manifest.json').write_text(json.dumps({'sampleFormat':'PCM signed 16-bit mono, 22050 Hz','maxAllowedPeakLinear':.7,'assets':entries},indent=2)+'\n')
    return entries


if __name__=='__main__':
    for directory in ('models','audio','previews'):(ASSETS/directory).mkdir(parents=True,exist_ok=True)
    model_info=make_models();audio_info=make_audio()
    (ASSETS/'models'/'model-manifest.json').write_text(json.dumps({'units':'metres','up':'+Y','front':'+Z','assets':model_info},indent=2)+'\n')
    print(f'Generated {len(model_info)} original GLBs, {len(audio_info)} mono WAVs and geometry previews; no external dependencies or network calls.')
