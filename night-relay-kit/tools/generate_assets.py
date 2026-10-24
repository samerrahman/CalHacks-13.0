"""Original procedural game assets. Run with Python 3; numpy/Pillow needed only for previews."""
import json, math, struct, wave, random
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets'
PALETTE={'steel':(.17,.22,.23,1),'dark':(.035,.055,.065,1),'wall':(.32,.37,.36,1),'cream':(.72,.70,.58,1),'orange':(.95,.35,.10,1),'green':(.18,.85,.62,1),'red':(.85,.08,.07,1),'black':(.012,.017,.020,1)}

class Model:
 def __init__(self,name):
  self.name=name; self.data=bytearray(); self.doc={'asset':{'version':'2.0','generator':'Night Relay original asset generator'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],'buffers':[],'bufferViews':[],'accessors':[]};self.preview=[]
  for key,c in PALETTE.items():
   self.doc['materials'].append({'name':key,'pbrMetallicRoughness':{'baseColorFactor':c,'metallicFactor':.15,'roughnessFactor':.85},'doubleSided':False})
 def acc(self,values,kind,components):
  while len(self.data)%4:self.data.append(0)
  offset=len(self.data); flat=[x for v in values for x in v] if components>1 else values
  self.data.extend(struct.pack('<'+'f'*len(flat),*flat)); view=len(self.doc['bufferViews']);self.doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4})
  a={'bufferView':view,'componentType':5126,'count':len(values),'type':kind}
  if kind in ('VEC3','SCALAR'):
   vv=values if components>1 else [[x] for x in values];a['min']=[min(v[k] for v in vv) for k in range(components)];a['max']=[max(v[k] for v in vv) for k in range(components)]
  i=len(self.doc['accessors']);self.doc['accessors'].append(a);return i
 def node(self,name,pos=(0,0,0),parent=None):
  i=len(self.doc['nodes']);self.doc['nodes'].append({'name':name,'translation':list(pos)})
  if parent is None:self.doc['scenes'][0]['nodes'].append(i)
  else:self.doc['nodes'][parent].setdefault('children',[]).append(i)
  return i
 def box(self,name,pos,size,mat='steel',parent=None):
  x,y,z=[v/2 for v in size];verts=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
  faces=[(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(0,1,5,4),(3,7,6,2)]
  normals=[(0,0,-1),(0,0,1),(-1,0,0),(1,0,0),(0,-1,0),(0,1,0)];p=[];n=[]
  for f,no in zip(faces,normals):
   for j in (0,1,2,0,2,3):p.append(verts[f[j]]);n.append(no)
  mesh=len(self.doc['meshes']);self.doc['meshes'].append({'name':name,'primitives':[{'attributes':{'POSITION':self.acc(p,'VEC3',3),'NORMAL':self.acc(n,'VEC3',3)},'material':list(PALETTE).index(mat)}]})
  node=self.node(name,pos,parent);self.doc['nodes'][node]['mesh']=mesh
  # Store base-pose geometry for dependency-free previews; accumulate translations.
  pp=list(pos);up=parent
  while up is not None:
   q=self.doc['nodes'][up];pp=[pp[k]+q.get('translation',[0,0,0])[k] for k in range(3)];up=next((j for j,a in enumerate(self.doc['nodes']) if up in a.get('children',[])),None)
  for f,no in zip(faces,normals):self.preview.append({'points':[[verts[j][k]+pp[k] for k in range(3)] for j in f],'normal':no,'color':PALETTE[mat][:3]})
  return node
 def animate(self,name,channels):
  samplers=[];chs=[]
  for node,path,times,values in channels:
   s=len(samplers);samplers.append({'input':self.acc(times,'SCALAR',1),'output':self.acc(values,'VEC4' if path=='rotation' else 'VEC3',4 if path=='rotation' else 3),'interpolation':'LINEAR'});chs.append({'sampler':s,'target':{'node':node,'path':path}})
  self.doc.setdefault('animations',[]).append({'name':name,'samplers':samplers,'channels':chs})
 def save(self):
  self.doc['buffers']=[{'byteLength':len(self.data)}];js=json.dumps(self.doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);bin=bytes(self.data)+b'\x00'*((-len(self.data))%4)
  blob=struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(bin))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(bin),0x004e4942)+bin
  (OUT/'models'/f'{self.name}.glb').write_bytes(blob)
  (OUT/'previews'/f'{self.name}.geometry.json').write_text(json.dumps(self.preview))
  return self

def quat(axis,angle):
 s=math.sin(angle/2);return [axis[0]*s,axis[1]*s,axis[2]*s,math.cos(angle/2)]

def models():
 m=Model('booth');m.box('floor',(0,-.13,0),(8,.25,6),'dark');m.box('back_wall',(0,1.5,3),(8,3,.15),'wall');m.box('console_wall',(0,1.5,-3),(8,3,.15),'wall')
 for side in (-1,1):
  x=side*4
  for z in (-2,2):m.box(f'wall_{side}_{z}',(x,1.5,z),(.18,3,2),'wall')
  m.box(f'lintel_{side}',(x,2.9,0),(.22,.2,2),'orange')
  m.box(f'corridor_floor_{side}',(side*6,-.13,0),(4,.25,2),'dark')
  for z in (-1.1,1.1):m.box(f'corridor_wall_{side}_{z}',(side*6,1.5,z),(4,3,.2),'steel')
 m.box('desk_top',(0,.85,-1.7),(3,.12,.8),'steel')
 for x in (-1.25,1.25):m.box(f'desk_leg_{x}',(x,.4,-1.7),(.12,.8,.6),'dark')
 m.box('ceiling_strip',(0,2.9,-1.5),(2.7,.05,.1),'cream');m.box('rear_shelf',(0,.9,2.6),(2.4,.12,.5),'steel');m.save()
 m=Model('shutter');root=m.node('shutter_root');leaf=m.node('shutter_leaf',(0,1.35,0),root);m.box('leaf',(0,0,0),(.16,2.7,1.9),'steel',leaf)
 for y in range(9):m.box(f'rib_{y}',(-.10,-1.2+y*.3,0),(.06,.055,1.9),'dark',leaf)
 m.box('warning_stripe',(-.14,0,0),(.02,.22,1.9),'orange',leaf)
 m.animate('open',[(leaf,'translation',[0,.8],[[0,1.35,0],[0,4.15,0]])]);m.save()
 m=Model('console');m.box('body',(0,.16,0),(.85,.32,.48),'steel');m.box('screen',(0,.33,-.04),(.61,.025,.25),'green')
 for i in range(4):m.box(f'key_{i}',(-.25+i*.17,.335,.16),(.10,.025,.055),'cream')
 m.save()
 m=Model('radio');m.box('case',(0,.17,0),(.52,.34,.23),'dark');m.box('dial',(-.14,.2,.13),(.15,.11,.03),'cream')
 for i in range(5):m.box(f'grille_{i}',(.13,.07+i*.045,.13),(.17,.012,.025),'steel')
 m.box('antenna',(.18,.55,0),(.015,.45,.015),'steel');m.save()
 m=Model('relay');m.box('cabinet',(0,.55,0),(.8,1.1,.35),'steel')
 for i in range(3):m.box(f'socket_{i}',(-.24+i*.24,.62,.20),(.15,.34,.05),'dark');m.box(f'light_{i}',(-.24+i*.24,.92,.20),(.07,.05,.025),'orange')
 m.save()
 m=Model('fuse');m.box('cartridge',(0,.12,0),(.14,.24,.12),'cream')
 for y in (0,.24):m.box(f'contact_{y}',(0,y,0),(.16,.05,.13),'orange')
 m.save()
 m=Model('floodlight');m.box('foot',(0,.04,0),(.45,.08,.35),'dark');m.box('stem',(0,.7,0),(.07,1.4,.07),'steel');m.box('housing',(0,1.4,0),(.52,.32,.18),'dark');m.box('lens',(0,1.4,.1),(.44,.24,.02),'cream');m.save()
 m=Model('mimic');root=m.node('mimic_root');torso=m.node('torso',(0,1.45,0),root);m.box('coat',(0,0,0),(.45,.9,.25),'black',torso);m.box('chest_seam',(0,.15,.14),(.025,.35,.02),'cream',torso)
 head=m.node('head',(0,.67,0),torso);m.box('mask',(0,0,0),(.29,.36,.22),'cream',head);m.box('eye_line',(0,.055,.118),(.23,.025,.018),'black',head);m.box('mouth',(0,-.09,.12),(.10,.015,.02),'black',head)
 arms=[]
 for s in (-1,1):
  sh=m.node(f'shoulder_{s}',(s*.28,.35,0),torso);arms.append(sh);m.box(f'arm_{s}',(s*.04,-.52,0),(.12,1.12,.13),'black',sh);m.box(f'hand_{s}',(s*.04,-1.13,.02),(.09,.22,.08),'cream',sh)
  m.box(f'leg_{s}',(s*.12,.46,0),(.14,.92,.17),'black',root)
 m.animate('idle',[(torso,'translation',[0,1.5,3],[[0,1.45,0],[.035,1.48,0],[0,1.45,0]]),(head,'rotation',[0,1.5,3],[quat((0,0,1),-.12),quat((0,0,1),.14),quat((0,0,1),-.12)])])
 m.animate('listen',[(head,'rotation',[0,.4,1.2,1.6],[quat((0,0,1),0),quat((0,0,1),.42),quat((0,0,1),.42),quat((0,0,1),0)])])
 m.animate('reach',[(arms[0],'rotation',[0,.5,1],[quat((1,0,0),0),quat((1,0,0),-1.25),quat((1,0,0),0)]),(arms[1],'rotation',[0,.5,1],[quat((1,0,0),0),quat((1,0,0),-1.25),quat((1,0,0),0)])]);m.save()

def audio():
 sr=22050;r=random.Random(400);names={'room_hum':6,'radio_static':1.2,'radio_chime':.65,'knock':1.1,'shutter_motor':1.1,'relay_click':.25,'warning_pulse':1.2,'mimic_rustle':1.6,'success':1.4}
 for name,dur in names.items():
  samples=[];smooth=0
  for i in range(int(sr*dur)):
   t=i/sr;noise=r.uniform(-1,1);smooth=.92*smooth+.08*noise;env=min(1,t/.025,(dur-t)/.06)
   if name=='room_hum':v=.07*math.sin(2*math.pi*60*t)+.025*math.sin(2*math.pi*120*t)+.06*smooth
   elif name=='radio_static':v=.10*noise+.1*smooth
   elif name=='radio_chime':v=.16*math.sin(2*math.pi*(600 if t<.3 else 820)*t)*math.exp(-3*(t%.3))
   elif name=='knock':v=sum(.36*math.sin(2*math.pi*95*(t-a))*math.exp(-45*(t-a)) for a in (.05,.4,.85) if 0<t-a<.18)
   elif name=='shutter_motor':v=.08*math.sin(2*math.pi*(90+15*math.sin(t*4))*t)+.12*smooth
   elif name=='relay_click':v=.3*noise*math.exp(-40*t)
   elif name=='warning_pulse':v=.12*math.sin(2*math.pi*440*t)*(1 if t%.4<.15 else 0)
   elif name=='mimic_rustle':v=.4*smooth*(.4+.6*math.sin(t*8)**2)
   else:v=.10*sum(math.sin(2*math.pi*f*t) for f in (330,440,550))*math.exp(-2*t)
   samples.append(struct.pack('<h',int(max(-.8,min(.8,v*env))*32767)))
  with wave.open(str(OUT/'audio'/f'{name}.wav'),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(sr);w.writeframes(b''.join(samples))

def decals():
 items={'rules_card':('STATION 04 / NIGHT SHIFT',['VERIFY THE ORDER ID','CHECK THE CURRENT CHALLENGE','VOICE ALONE IS NOT IDENTITY','SWEEP BEFORE OPENING','CLOSED SHUTTERS DRAIN POWER']), 'work_order':('RELAY MAINTENANCE',['ORDER NR-417 / ACTIVE','LEFT SERVICE HATCH','INSERT CARTRIDGE → CONFIRM','An instruction is valid only','when the console matches.']), 'challenge_card':('PRIVATE CHANNEL KEY',['CHALLENGE: LANTERN','RESPONSE: HARBOR','REFERENCE ART ONLY','Render a fresh key in the game.']), 'warning':('KEEP LINE ACTIVE',['BOTH SHUTTERS CLOSED','ISOLATES THE RELAY','POWER IS LIMITED']), 'title':('NIGHT RELAY',['IT LEARNED YOUR BOSS’S VOICE.','NOW IT IS LEARNING YOU.'])}
 for name,(title,lines) in items.items():
  body=''.join(f'<text x="45" y="{150+j*53}" font-size="25">{s.replace("&","&amp;").replace("→","&#8594;")}</text>' for j,s in enumerate(lines))
  svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="460" viewBox="0 0 720 460"><rect width="720" height="460" fill="#c5c6b2"/><rect x="18" y="18" width="684" height="424" fill="none" stroke="#263a3b" stroke-width="4"/><g fill="#172e30" font-family="monospace"><text x="45" y="82" font-size="31" font-weight="bold">{title}</text>{body}</g><rect x="45" y="400" width="80" height="12" fill="#bc491f"/></svg>'
  (OUT/'decals'/f'{name}.svg').write_text(svg)

def preview():
 import numpy as np
 from PIL import Image, ImageDraw, ImageFont
 W,H=1440,820;im=Image.new('RGB',(W,H),'#0d171b');d=ImageDraw.Draw(im)
 try:font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18);title=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30)
 except:font=title=None
 d.text((35,23),'NIGHT RELAY  /  ORIGINAL LOW-POLY ASSET KIT',fill='#d4dacb',font=title)
 def render(name,rect,eye,scale):
  cx,cy=rect;polys=json.loads((OUT/'previews'/f'{name}.geometry.json').read_text());eye=np.array(eye,float);forward=-eye/np.linalg.norm(eye);right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,forward);light=np.array([.5,.8,.4]);light/=np.linalg.norm(light);painter=[]
  for p in polys:
   pts=np.array(p['points']);coords=[(cx+np.dot(a,right)*scale,cy-np.dot(a,up)*scale) for a in pts];depth=np.dot(pts.mean(axis=0),forward);normal=np.array(p['normal']);shade=.35+.65*max(0,float(np.dot(normal,light)));color=tuple(int(min(255,c*shade*255)) for c in p['color']);painter.append((depth,coords,color))
  for _,coords,c in sorted(painter,reverse=True):d.polygon(coords,fill=c)
 render('mimic',(1120,620),(4,2,8),190);d.text((995,680),'MIMIC / 3 animation clips',fill='#d4dacb',font=font)
 # Environment overview without a ceiling; actual game views originate inside.
 render('booth',(410,365),(8,12,12),44);d.text((50,520),'BOOTH + TWO CORRIDORS / environment overview',fill='#d4dacb',font=font)
 for n,x,s in [('radio',150,150),('console',350,140),('relay',590,95),('floodlight',800,95)]:
  render(n,(x,733),(4,3,6),s);d.text((x-45,765),n.upper(),fill='#d4dacb',font=font)
 im.save(OUT/'previews'/'asset-sheet.png')

if __name__=='__main__':
 for d in ('models','audio','decals','previews'):(OUT/d).mkdir(parents=True,exist_ok=True)
 models();audio();decals();preview();print('Created 8 GLB models, 9 WAV sounds, 5 SVG decals, preview, and mesh metadata.')
