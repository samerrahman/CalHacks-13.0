#!/usr/bin/env python3
"""Validate this kit's actual binary assets; Python standard library only.

No rendering, audio playback, provider request or game-completeness claim.
Run from any working directory. --manifest additionally checks the root hash
inventory; build that inventory last, after writing any validation report.
"""
import argparse
import array
import binascii
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import wave
import xml.etree.ElementTree as ET
import zlib

from build_manifest import ROOT, eligible_files, safe_path

EXPECTED_CLIPS = {
    'shelter': set(), 'sealed_door': {'impact', 'dent'}, 'workdesk': set(),
    'terminal': set(), 'security_monitor': set(), 'proximity_detector': set(), 'radio_speaker': set(),
    'machine_rack': {f'fault_{i:02d}' for i in range(1, 5)},
    'emergency_switch': {'flip_off', 'flip_on'}, 'creature_cctv': {'idle', 'listen', 'recoil'},
}
REQUIRED_NODES = {
    'shelter': {'floor_slab', 'ceiling_slab', 'side_wall_-1', 'side_wall_1', 'end_wall_-1', 'end_wall_1'},
    'sealed_door': {'sealed_door_root', 'dent_panel_1', 'dent_panel_2', 'dent_panel_3'},
    'terminal': {'terminal_screen'}, 'security_monitor': {'security_screen'},
    'proximity_detector': {'proximity_screen', *(f'distance_segment_{i}' for i in range(5))},
    'machine_rack': {f'unit_{i:02d}_fault_assembly' for i in range(1, 5)},
    'emergency_switch': {'switch_lever', 'emergency_locator'},
    'creature_cctv': {'cctv_creature_root', 'cctv_torso', 'cctv_neck'},
}
COMPONENTS = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
DIMENSIONS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, message, minimum=0):
    require(type(value) is int and value >= minimum, message)
    return value


def finite_tree(value):
    if isinstance(value, float):
        require(math.isfinite(value), 'JSON contains NaN or Infinity')
    elif isinstance(value, dict):
        for item in value.values(): finite_tree(item)
    elif isinstance(value, list):
        for item in value: finite_tree(item)


def json_data(content):
    result = json.loads(content)
    finite_tree(result)
    return result


def index(sequence, value, label):
    integer(value, f'{label} index must be a nonnegative integer')
    require(value < len(sequence), f'{label} index {value} is out of range')
    return sequence[value]


def validate_glb(path):
    raw = path.read_bytes()
    require(len(raw) >= 28, 'Truncated GLB header')
    magic, version, length = struct.unpack_from('<III', raw)
    require(magic == 0x46546c67 and version == 2, 'Not a GLB 2.0 file')
    require(length == len(raw), 'GLB declared byte length differs from file length')
    chunks = []; offset = 12
    while offset < length:
        require(offset + 8 <= length, 'Truncated GLB chunk header')
        size, kind = struct.unpack_from('<II', raw, offset); offset += 8
        require(size % 4 == 0 and offset + size <= length, 'Invalid GLB chunk bounds/alignment')
        chunks.append((kind, raw[offset:offset+size])); offset += size
    require(len(chunks) == 2 and chunks[0][0] == 0x4e4f534a and chunks[1][0] == 0x004e4942,
            'Kit GLBs must contain exactly one JSON chunk then one embedded BIN chunk')
    doc = json_data(chunks[0][1].decode('utf-8')); binary = chunks[1][1]
    require(doc.get('asset', {}).get('version') == '2.0', 'JSON asset.version is not 2.0')
    buffers = doc.get('buffers', [])
    require(len(buffers) == 1 and 'uri' not in buffers[0], 'GLB must be self-contained with one embedded buffer')
    declared = integer(buffers[0].get('byteLength'), 'Invalid buffer length', 1)
    require(declared <= len(binary) <= declared + 3, 'Embedded buffer length/padding mismatch')
    require(not doc.get('extensionsRequired'), 'This uncompressed kit must not require external decoder extensions')
    views = doc.get('bufferViews', []); accessors = doc.get('accessors', [])
    require(views and accessors, 'Missing vertex data')
    for material in doc.get('materials', []):
        pbr = material.get('pbrMetallicRoughness', {})
        for key, dimensions in [('baseColorFactor',4)]:
            if key in pbr:require(len(pbr[key])==dimensions and all(0<=v<=1 for v in pbr[key]),'Material color factor outside 0..1')
        for key in ('roughnessFactor','metallicFactor'):
            if key in pbr:require(0<=pbr[key]<=1,f'Material {key} outside 0..1')
        if 'emissiveFactor' in material:require(len(material['emissiveFactor'])==3 and all(0<=v<=1 for v in material['emissiveFactor']),'Invalid emissive factor')
    for image in doc.get('images',[]):
        require('uri' not in image,'GLB texture must not reference an external URI')
        index(views,image.get('bufferView'),'embedded image bufferView')
        require(image.get('mimeType') in ('image/png','image/jpeg'),'Unexpected embedded image MIME type')
    for i, view in enumerate(views):
        require(view.get('buffer', 0) == 0, f'bufferView {i} targets an unavailable buffer')
        start = integer(view.get('byteOffset', 0), f'bufferView {i} has invalid offset')
        size = integer(view.get('byteLength'), f'bufferView {i} has invalid length', 1)
        require(start + size <= declared, f'bufferView {i} exceeds embedded buffer bounds')
        if 'byteStride' in view:
            stride = integer(view['byteStride'], 'Invalid byteStride', 4)
            require(stride <= 252 and stride % 4 == 0, 'byteStride must be 4..252 and divisible by four')
    decoded = []
    for i, accessor in enumerate(accessors):
        require('sparse' not in accessor, f'Accessor {i}: sparse data is not used/supported by this kit validator')
        view = index(views, accessor.get('bufferView'), f'accessor {i} bufferView')
        kind = accessor.get('type'); component = accessor.get('componentType')
        require(kind in DIMENSIONS and component in COMPONENTS, f'Accessor {i} has unsupported type')
        code, size = COMPONENTS[component]; dimensions = DIMENSIONS[kind]
        require(not kind.startswith('MAT') or size == 4, 'Small-component matrix padding is outside this kit format')
        count = integer(accessor.get('count'), f'Accessor {i} count is invalid', 1)
        local = integer(accessor.get('byteOffset', 0), f'Accessor {i} offset is invalid')
        stride = view.get('byteStride', dimensions * size)
        require(stride >= dimensions * size and stride % size == 0, f'Accessor {i} has invalid stride')
        require(local % size == 0 and (view.get('byteOffset', 0)+local) % size == 0, f'Accessor {i} is misaligned')
        require(local + (count-1)*stride + dimensions*size <= view['byteLength'], f'Accessor {i} exceeds its bufferView')
        rows = [struct.unpack_from('<'+code*dimensions, binary, view.get('byteOffset', 0)+local+j*stride) for j in range(count)]
        require(all(math.isfinite(n) for row in rows for n in row), f'Accessor {i} contains nonfinite binary values')
        for bound, function in [('min', min), ('max', max)]:
            if bound in accessor:
                expected = accessor[bound]
                require(len(expected) == dimensions, f'Accessor {i} {bound} has wrong dimensions')
                actual = [function(row[k] for row in rows) for k in range(dimensions)]
                require(all(math.isclose(a,b,rel_tol=1e-5,abs_tol=1e-6) for a,b in zip(actual,expected)),
                        f'Accessor {i} {bound} differs from actual binary bounds')
        decoded.append(rows)
    meshes = doc.get('meshes', []); primitive_count = 0
    require(meshes, 'No meshes')
    for mesh in meshes:
        require(mesh.get('name') and mesh.get('primitives'), 'Each mesh needs a name and primitives')
        for primitive in mesh['primitives']:
            primitive_count += 1; attrs = primitive.get('attributes', {})
            require(primitive.get('mode', 4) == 4, 'Kit geometry must use triangle primitives')
            require({'POSITION','NORMAL','TEXCOORD_0'} <= attrs.keys(), 'Mesh missing position, normal or usable texture UVs')
            position = index(accessors, attrs['POSITION'], 'POSITION'); vertices = decoded[attrs['POSITION']]
            require(position['type'] == 'VEC3' and position['componentType'] == 5126 and 'min' in position and 'max' in position, 'POSITION requires float VEC3 and finite bounds')
            for attribute, kind in [('NORMAL','VEC3'),('TEXCOORD_0','VEC2')]:
                data = index(accessors, attrs[attribute], attribute)
                require(data['type'] == kind and data['count'] == position['count'], f'{attribute} has wrong type/count')
            normals = decoded[attrs['NORMAL']]
            require(all(abs(sum(n*n for n in row)-1) < .002 for row in normals), 'Normals are not normalized')
            if 'indices' in primitive:
                data = index(accessors, primitive['indices'], 'index accessor')
                require(data['type'] == 'SCALAR' and data['componentType'] in (5121,5123,5125), 'Triangle indices need unsigned integer scalars')
                indices = [row[0] for row in decoded[primitive['indices']]]
                require(all(n < len(vertices) for n in indices), 'Triangle references a nonexistent vertex')
            else: indices = list(range(len(vertices)))
            require(len(indices) % 3 == 0, 'Triangle primitive vertex/index count is not divisible by three')
            for a,b,c in zip(indices[0::3],indices[1::3],indices[2::3]):
                u=[vertices[b][k]-vertices[a][k] for k in range(3)];v=[vertices[c][k]-vertices[a][k] for k in range(3)]
                area=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
                require(sum(n*n for n in area)>1e-20, 'Degenerate triangle')
            if 'material' in primitive: index(doc.get('materials', []), primitive['material'], 'material')
    nodes = doc.get('nodes', []); names=[node.get('name') for node in nodes]
    require(all(isinstance(n,str) and n for n in names) and len(set(names))==len(names), 'Node names are empty or duplicated')
    parents = {}
    for i,node in enumerate(nodes):
        if 'mesh' in node:index(meshes,node['mesh'],'node mesh')
        if 'matrix' in node:
            require(len(node['matrix'])==16 and not any(k in node for k in ('translation','rotation','scale')), 'Node mixes matrix and TRS transforms')
        for key,length in [('translation',3),('rotation',4),('scale',3)]:
            if key in node:require(len(node[key])==length,f'Node {i} malformed {key}')
        if 'rotation' in node:require(abs(sum(n*n for n in node['rotation'])-1)<.002,'Node quaternion is not normalized')
        for child in node.get('children',[]):
            index(nodes,child,'child node');require(child!=i and child not in parents,'Node has duplicate parents or self-reference');parents[child]=i
    visited=set();active=set()
    def walk(i):
        require(i not in active,'Node hierarchy contains a cycle')
        if i in visited:return
        active.add(i)
        for child in nodes[i].get('children',[]):walk(child)
        active.remove(i);visited.add(i)
    scene=index(doc.get('scenes',[]),doc.get('scene',0),'default scene')
    for root in scene.get('nodes',[]):
        index(nodes,root,'scene root');require(root not in parents,'Scene root is also a child');walk(root)
    require(len(visited)==len(nodes),'Nodes are unreachable from the default scene')
    clips=doc.get('animations',[]);clip_names=[clip.get('name') for clip in clips]
    require(len(set(clip_names))==len(clip_names) and all(clip_names),'Animation names must be unique and nonempty')
    for clip in clips:
        samplers=clip.get('samplers',[]);targets=set()
        require(samplers and clip.get('channels'),'Animation is empty')
        for channel in clip['channels']:
            sampler=index(samplers,channel.get('sampler'),'animation sampler');target=channel.get('target',{})
            index(nodes,target.get('node'),'animation target');prop=target.get('path')
            require(prop in ('translation','rotation','scale'),'Only authored TRS node animations are expected')
            identity=(target['node'],prop);require(identity not in targets,'Animation has duplicate channels for a target');targets.add(identity)
            inp=index(accessors,sampler.get('input'),'animation input');out=index(accessors,sampler.get('output'),'animation output')
            require(inp['type']=='SCALAR' and inp['componentType']==5126,'Animation times must be float scalars')
            times=[row[0] for row in decoded[sampler['input']]]
            require(len(times)>=2 and times[0]>=0 and all(a<b for a,b in zip(times,times[1:])),'Animation times must be nonnegative and strictly increasing')
            interpolation=sampler.get('interpolation','LINEAR');require(interpolation in ('LINEAR','STEP','CUBICSPLINE'),'Unknown interpolation')
            factor=3 if interpolation=='CUBICSPLINE' else 1
            require(out['count']==inp['count']*factor and out['type']==('VEC4' if prop=='rotation' else 'VEC3'),'Animation output shape mismatch')
            if prop=='rotation':
                values=decoded[sampler['output']][1::3] if factor==3 else decoded[sampler['output']]
                require(all(abs(sum(n*n for n in row)-1)<.002 for row in values),'Animation contains non-unit quaternions')
    name=path.stem
    require(name in EXPECTED_CLIPS,f'Unregistered model: {name}')
    require(set(clip_names)==EXPECTED_CLIPS[name],f'{name}: expected clip names differ')
    require(REQUIRED_NODES.get(name,set())<=set(names),f'{name}: required runtime node is missing')
    return {'file':f'assets/models/{path.name}','nodes':len(nodes),'meshes':len(meshes),'primitives':primitive_count,'accessors':len(accessors),'clips':clip_names}


def validate_wav(path, metadata):
    with wave.open(str(path),'rb') as handle:
        require((handle.getnchannels(),handle.getsampwidth(),handle.getframerate(),handle.getcomptype())==(1,2,22050,'NONE'),'WAV must be uncompressed 16-bit mono 22050 Hz')
        count=handle.getnframes();require(count>0,'Empty WAV')
        raw=handle.readframes(count);require(len(raw)==count*2,'Truncated PCM payload')
    pcm=array.array('h',raw)
    if sys.byteorder!='little':pcm.byteswap()
    peak=max(abs(n) for n in pcm)/32768
    require(peak<=.7,'WAV peak exceeds 0.7 full scale')
    require(math.isclose(metadata['durationSeconds'],count/22050,abs_tol=1/22050),'Audio metadata duration differs')
    require(abs(metadata['peakLinear']-peak)<1e-5,'Audio metadata peak differs')
    seam=abs(pcm[0]-pcm[-1])/32768
    if metadata.get('loop'):require(seam<.03,'Loop edge discontinuity exceeds 0.03 full scale')
    return {'file':f'assets/audio/{path.name}','durationSeconds':count/22050,'peakLinear':round(peak,6),'loop':bool(metadata.get('loop')),'edgeDifferenceLinear':round(seam,6)}


def validate_png(path):
    raw=path.read_bytes();require(raw[:8]==b'\x89PNG\r\n\x1a\n','Invalid PNG signature')
    offset=8;chunks=[];compressed=bytearray();header=None;ended=False
    while offset<len(raw):
        require(offset+12<=len(raw),'Truncated PNG chunk')
        size=struct.unpack_from('>I',raw,offset)[0];kind=raw[offset+4:offset+8];offset+=8
        require(offset+size+4<=len(raw),'PNG chunk exceeds file bounds')
        content=raw[offset:offset+size];crc=struct.unpack_from('>I',raw,offset+size)[0]
        require((binascii.crc32(kind+content)&0xffffffff)==crc,'PNG chunk CRC mismatch')
        offset+=size+4;chunks.append(kind)
        if kind==b'IHDR':
            require(header is None and len(chunks)==1 and size==13,'Invalid/duplicate PNG IHDR')
            header=struct.unpack('>IIBBBBB',content)
        elif kind==b'IDAT':compressed.extend(content)
        elif kind==b'IEND':require(size==0 and offset==len(raw),'Data after PNG IEND');ended=True;break
    require(header and compressed and ended,'Missing PNG header/image/end chunk')
    width,height,depth,color,compression,filtering,interlace=header
    require(0<width<=16384 and 0<height<=16384,'Invalid/unreasonable PNG dimensions')
    allowed={0:{1,2,4,8,16},2:{8,16},3:{1,2,4,8},4:{8,16},6:{8,16}}
    require(color in allowed and depth in allowed[color] and compression==0 and filtering==0 and interlace in (0,1),'Unsupported PNG header combination')
    if color==3:require(b'PLTE' in chunks,'Indexed PNG missing palette')
    channels={0:1,2:3,3:1,4:2,6:4}[color];rowbytes=(width*channels*depth+7)//8
    limit=min(256*1024*1024,(rowbytes+1)*height*2+1024)
    decoder=zlib.decompressobj();pixels=decoder.decompress(bytes(compressed),limit+1)
    require(len(pixels)<=limit and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,'PNG compressed image is incomplete or exceeds bounds')
    if interlace==0:
        require(len(pixels)==(rowbytes+1)*height,'PNG raster length differs from dimensions')
        require(all(pixels[row*(rowbytes+1)]<=4 for row in range(height)),'PNG contains invalid scanline filter')
    return {'width':width,'height':height,'bitDepth':depth,'colorType':color,'crcVerified':True}


def validate_svg(path,root):
    content=path.read_text();require('<!DOCTYPE' not in content.upper() and '<!ENTITY' not in content.upper(),'SVG must not contain DTD/entity declarations')
    svg=ET.fromstring(content);require(svg.tag=='{http://www.w3.org/2000/svg}svg','Root is not an SVG element')
    view=svg.attrib.get('viewBox','').replace(',',' ').split()
    if view:require(len(view)==4 and all(math.isfinite(float(v)) for v in view) and float(view[2])>0 and float(view[3])>0,'Invalid SVG viewBox')
    else:require(svg.attrib.get('width') and svg.attrib.get('height'),'SVG has no dimensions/viewBox')
    elements=0
    for element in svg.iter():
        elements+=1;tag=element.tag.split('}')[-1]
        require(tag not in ('script','foreignObject'),'SVG contains executable/foreign content')
        for key,value in element.attrib.items():
            require(not key.split('}')[-1].lower().startswith('on'),'SVG contains an event handler')
            if key.split('}')[-1]=='href' and not value.startswith(('#','data:')):
                require(not re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:',value) and not value.startswith('//'),'SVG references an external or executable URL')
                safe_path(root,(path.parent.relative_to(root)/value).as_posix())
    return {'viewBox':view,'elements':elements,'xmlVerified':True}


def validate_geometry_preview(path):
    faces=json_data(path.read_text());require(isinstance(faces,list) and faces,'Empty geometry preview')
    for face in faces:
        points=face.get('points',[])
        require(len(points)>=3 and all(len(point)==3 and all(isinstance(v,(float,int)) for v in point) for point in points),'Malformed preview polygon')
        require(len(face.get('normal',[]))==3 and abs(sum(v*v for v in face['normal'])-1)<.002,'Invalid preview normal')
        require(len(face.get('color',[]))==3 and all(0<=v<=1 for v in face['color']),'Invalid preview color')
        require(isinstance(face.get('node'),str) and face['node'],'Preview face lacks its model node name')
    return {'faces':len(faces)}


def validate_manifest(root,relative):
    path=safe_path(root,relative);require(path.is_file(),f'Manifest missing: {relative}')
    data=json_data(path.read_text());require(data.get('format')=='lock-in-kit-manifest-v1' and data.get('algorithm')=='sha256','Unknown manifest format/algorithm')
    entries=data.get('files');require(isinstance(entries,list),'Manifest files must be a list')
    errors=[];seen=set()
    for entry in entries:
        name=entry.get('path')
        try:
            file=safe_path(root,name)
            require(name not in seen,'Duplicate manifest path');seen.add(name)
            require(isinstance(entry.get('sha256'),str) and re.fullmatch('[0-9a-f]{64}',entry['sha256']),'Invalid SHA-256 digest')
            require(type(entry.get('bytes')) is int and entry['bytes']>=0,'Invalid byte count')
            require(file.is_file(),'Missing file')
            content=file.read_bytes()
            require(len(content)==entry['bytes'],'Byte count changed')
            require(hashlib.sha256(content).hexdigest()==entry['sha256'],'SHA-256 changed')
        except (ValueError,OSError) as error:errors.append({'path':str(name),'error':str(error)})
    actual={name for name,_ in eligible_files(root,relative)}
    errors.extend({'path':name,'error':'File not listed in manifest'} for name in sorted(actual-seen))
    for name in sorted(seen-actual):
        if not any(item['path']==name for item in errors):errors.append({'path':name,'error':'Excluded file must not be in manifest'})
    return {'file':relative,'listedFiles':len(entries),'passed':not errors,'errors':errors}


def validate(root=ROOT,manifest=None):
    report={'scope':'Binary asset structure, file format and optional hashes only; not full game, visual, audio-listening or provider QA',
            'passed':True,'models':[],'audio':[],'png':[],'svg':[],'geometryPreviews':[],'errors':[]}
    def run(path,section,function,*args):
        relative=path.relative_to(root).as_posix()
        try:
            safe_path(root,relative)
            result=function(path,*args);result['file']=relative;report[section].append(result)
        except (ValueError,KeyError,TypeError,OSError,struct.error,ET.ParseError,wave.Error,zlib.error,UnicodeError) as error:
            report['errors'].append({'path':relative,'error':str(error)})
    models=sorted((root/'assets/models').glob('*.glb'))
    if {p.stem for p in models}!=set(EXPECTED_CLIPS):report['errors'].append({'path':'assets/models','error':'Expected exactly the ten documented model names'})
    for path in models:run(path,'models',validate_glb)
    try:
        audio_meta=json_data((root/'assets/audio/audio-manifest.json').read_text())
        entries={entry['file']:entry for entry in audio_meta['assets']}
        paths=sorted((root/'assets/audio').glob('*.wav'))
        require(len(entries)==len(audio_meta['assets'])==27,'Expected 27 unique audio metadata entries')
        require({f'audio/{p.name}' for p in paths}==set(entries),'WAV filenames differ from audio manifest')
        for path in paths:run(path,'audio',validate_wav,entries[f'audio/{path.name}'])
    except (ValueError,KeyError,TypeError,OSError) as error:report['errors'].append({'path':'assets/audio/audio-manifest.json','error':str(error)})
    for path in sorted((root/'assets').rglob('*.png')):run(path,'png',validate_png)
    for path in sorted((root/'assets').rglob('*.svg')):run(path,'svg',validate_svg,root)
    preview_paths=sorted((root/'assets/previews').glob('*.geometry.json'))
    if {path.name.removesuffix('.geometry.json') for path in preview_paths}!=set(EXPECTED_CLIPS):report['errors'].append({'path':'assets/previews','error':'Expected ten matching geometry previews'})
    for path in preview_paths:run(path,'geometryPreviews',validate_geometry_preview)
    # Validate every authored model manifest entry against the parsed actual file.
    try:
        data=json_data((root/'assets/models/model-manifest.json').read_text())
        actual={Path(item['file']).stem:item for item in report['models']}
        require(len(data['assets'])==10,'Model manifest must contain ten entries')
        require({entry['file'] for entry in data['assets']}=={f'models/{name}.glb' for name in EXPECTED_CLIPS},'Model manifest names differ from the documented models')
        for entry in data['assets']:
            found=actual[Path(entry['file']).stem]
            require(entry['nodes']==found['nodes'] and entry['meshes']==found['meshes'],'Model manifest count differs from GLB')
            require({x['name'] for x in entry['animations']}==set(found['clips']),'Model manifest clips differ from GLB')
    except (ValueError,KeyError,TypeError,OSError) as error:report['errors'].append({'path':'assets/models/model-manifest.json','error':str(error)})
    if manifest:
        try:
            report['manifest']=validate_manifest(root,manifest)
            if not report['manifest']['passed']:report['errors'].extend(report['manifest']['errors'])
        except (ValueError,KeyError,TypeError,OSError) as error:report['errors'].append({'path':manifest,'error':str(error)})
    report['passed']=not report['errors']
    report['counts']={key:len(report[key]) for key in ('models','audio','png','svg','geometryPreviews')}
    report['counts']['animationClips']=sum(len(item['clips']) for item in report['models'])
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',nargs='?',const='MANIFEST.json',help='Also verify the root manifest, optionally naming another relative path')
    parser.add_argument('--report',help='Write asset-only JSON report to this relative kit path; do this before building final manifest')
    args=parser.parse_args()
    result=validate(manifest=args.manifest)
    if args.report:
        try:
            destination=safe_path(ROOT,args.report);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(json.dumps(result,indent=2)+'\n')
        except (ValueError,OSError) as error:parser.exit(1,f'Cannot write report: {error}\n')
    print(json.dumps({'passed':result['passed'],'counts':result['counts'],'errors':result['errors']},indent=2))
    raise SystemExit(0 if result['passed'] else 1)
