"""Optional ElevenLabs authored speech generation. Uses your quota when run.
Set ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID; optionally ELEVENLABS_MODEL_ID.
Run: python3 tools/generate_voices.py --generate --limit 3
No keys are printed or stored. Existing outputs are skipped. Network path untested here.
"""
import argparse,json,os,sys,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--generate',action='store_true');p.add_argument('--limit',type=int,default=3);args=p.parse_args()
lines=json.loads((ROOT/'design/dialogue.json').read_text())['lines']
if not args.generate:
 print('Dry run. Would generate authored lines:',', '.join(x['id'] for x in lines[:max(0,args.limit)]));print('Use --generate to make paid/quota-consuming requests.');sys.exit(0)
key=os.environ.get('ELEVENLABS_API_KEY');voice=os.environ.get('ELEVENLABS_VOICE_ID')
if not key or not voice:sys.exit('Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID locally.')
if not all(ch.isalnum() or ch in '_-' for ch in voice):sys.exit('Unexpected voice ID format.')
out=ROOT/'assets/audio/voice';out.mkdir(exist_ok=True)
for line in lines[:max(0,args.limit)]:
 dest=out/(line['id']+'.mp3')
 if dest.exists():print('Skipped',dest.name);continue
 body={'text':line['text']}
 if os.environ.get('ELEVENLABS_MODEL_ID'):body['model_id']=os.environ['ELEVENLABS_MODEL_ID']
 req=urllib.request.Request('https://api.elevenlabs.io/v1/text-to-speech/'+voice+'/stream?output_format=mp3_44100_128',data=json.dumps(body).encode(),headers={'xi-api-key':key,'Content-Type':'application/json'},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=40) as res:data=res.read()
  if len(data)<100:raise ValueError('Unexpectedly short audio response')
  dest.write_bytes(data);print('Generated',dest.name)
 except urllib.error.HTTPError as e:sys.exit('Provider HTTP '+str(e.code)+'; stopping without retry. Check account/voice/model access.')
 except Exception as e:sys.exit('Generation stopped: '+type(e).__name__)
