"""Validate the authored uncompressed GLB subset plus audio/JSON/SVG. No network."""
import json,struct,wave,math,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
count=clips=vertices=0
for p in sorted((ROOT/'assets/models').glob('*.glb')):
 data=p.read_bytes();magic,version,total=struct.unpack_from('<III',data);assert magic==0x46546c67 and version==2 and total==len(data)
 jl,jt=struct.unpack_from('<II',data,12);assert jt==0x4e4f534a
 d=json.loads(data[20:20+jl]);bl,bt=struct.unpack_from('<II',data,20+jl);assert bt==0x004e4942
 b=data[28+jl:];assert len(b)==bl and d['buffers'][0]['byteLength']<=bl
 def acc(i):
  a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];assert a['componentType']==5126
  start=v.get('byteOffset',0)+a.get('byteOffset',0);end=start+a['count']*n*4;assert end<=len(b) and end<=v.get('byteOffset',0)+v['byteLength'];vals=struct.unpack_from('<'+'f'*(a['count']*n),b,start);assert all(math.isfinite(x) for x in vals);return vals
 for i in range(len(d['accessors'])):acc(i)
 for mesh in d['meshes']:
  for prim in mesh['primitives']:
   pi=prim['attributes']['POSITION'];ni=prim['attributes']['NORMAL'];assert d['accessors'][pi]['count']==d['accessors'][ni]['count'];assert d['accessors'][pi]['count']%3==0;vertices+=d['accessors'][pi]['count']
 for node in d['nodes']:
  assert all(0<=c<len(d['nodes']) for c in node.get('children',[]))
 for anim in d.get('animations',[]):
  clips+=1
  for ch in anim['channels']:
   assert ch['target']['node']<len(d['nodes']);s=anim['samplers'][ch['sampler']];times=acc(s['input']);assert all(a<b for a,b in zip(times,times[1:]));assert len(times)==d['accessors'][s['output']]['count']
 count+=1
for p in (ROOT/'assets/audio').glob('*.wav'):
 with wave.open(str(p)) as w:assert w.getnchannels()==1 and w.getsampwidth()==2 and w.getnframes()>0
for p in ROOT.rglob('*.json'):json.loads(p.read_text())
for p in (ROOT/'assets/decals').glob('*.svg'):ET.parse(p)
print(f'PASS: {count} GLB files, {clips} animation clips, {vertices} unindexed vertices; all accessors/channels and WAV/JSON/SVG checked.')
print('Not performed: Three.js import/render smoke test, full glTF conformance certification, gameplay playtest, or live sponsor API calls.')
