import { useEffect, useRef, useState } from 'react';
import { createGame, dispatch, step, canRestore } from '../game/reducer';
import { NODES, config } from '../game/config';
import { buildDirectorRequest, validateProposal } from '../game/directorValidation';
import type { GameAction, GameState, Station } from '../game/state';
import { createScene, type SceneView } from '../render/scene';
import { createAudioEngine, type AudioEngine, type EffectName } from '../audio/engine';
import { SensorController } from '../sensing/controller';
import type { SensorView, SensorMode } from '../sensing/types';
import { requestDirector, requestSpeech, requestMonster, TraceBridge, beginIntegrationRun, integrationStatus } from '../integrations/client';
import { buildPulseReport, type BreathSample, type PulseSample, type PulseEvent, type PulseReport as Report } from '../report/analysis';
import dialogue from '../game/dialogue.json';
import Setup, { DEFAULT_PREFS, type Preferences } from './Setup';
import HUD from './HUD';
import CameraPanel from './CameraPanel';
import JumpScare,{SCARE_MS} from './JumpScare';
import { calmBreath, calmMatched, faultSounds, listeningTo, pulseFlash, taskProgress } from '../game/tasks';
import { creatureBearing, creatureHeardPosition, huntActive } from '../game/creature';
import Tutorial from './Tutorial';
import OpeningFilm from './OpeningFilm';
import PulseReport, { type EmptyReason } from './PulseReport';
import JudgeView from './JudgeView';
import SpectateView from './SpectateView';
import InviteFriend from './InviteFriend';
import { useCameraShare } from './useCameraShare';
import { CoopManualPublisher } from '../integrations/coop';
import { AsyncRun } from './asyncRun';
import { VoiceScheduler, type VoiceLine } from './voiceScheduler';
import type { SpeechResult, MonsterFallbackId } from '../integrations/contracts';
import CornerVitals from './CornerVitals';
import VideoCheck from './VideoCheck';
import VitalsPanel from './VitalsPanel';
import StatusGuide from './StatusGuide';
import { Heartbeat, WornTitle } from './Worn';
import {resumeSensorCapture} from './sensorHandoff';
import {readVitals,sharedVitals} from './vitalsHold';
import { FILM as ENDING, captionAt as endingCaptionAt } from '../cutscene/ending';
type VoicePayload={caption:string;speech:SpeechResult;textSource:'gemini'|'authored-fallback'|'authored';textLatencyMs?:number};

type Screen='setup'|'check'|'intro'|'tutorial'|'play';
const INITIAL_SENSOR:SensorView={source:'manual',status:'manual',trend:'UNKNOWN',quality:'unknown',hint:'Pulse input off · neutral gameplay',baselineBpm:null,pulseBpm:null,ageMs:null,sampleAtMs:null,captureSegment:0,acceptedSeconds:0,canContinueManual:true};
const EMPTY_REPORT=buildPulseReport({recordingConsent:false,source:'manual',baselineBpm:null});
const STATIONS:Station[]=['terminal','cameras','equipment'];
/** The judge trace panel is a developer tool now (?debug); players never see it. */
const DEBUG=typeof location!=='undefined'&&new URLSearchParams(location.search).has('debug');
const reportTypes:Record<string,string>={SCARE:'SCARE',BLACKOUT_STARTED:'BLACKOUT',WRONG_INPUT:'MISTAKE',NEAR_LISTEN:'CLOSE_ENCOUNTER',BREACH_WARNING:'BREACH_WARNING',LURE_TRANSMITTED:'LURE_SUCCESS',QUIET_ENTERED:'QUIET',RESTORED:'POWER_RESTORED',RECOVERY_REWARD:'RECOVERY'};
const stageLines:Record<number,string>={1:'FAULTS_START',2:'LURE_A_START',3:'LURE_A_SUCCESS',4:'LURE_B_START',5:'FINAL_READY'};
const INTRO=['Containment failure. Proceed to the emergency observation shelter.','[running through wet branches — something follows]','[the reinforced door slams shut]','Silence the faults. Release the four basement locks. Get out.'];
/** Text cards for the ending when motion is reduced or the film cannot play. */
const OUTRO=['[the basement door motor grinds — loud]','[on the sonar, it turns toward the noise and charges]','[it slams into the shelter door; the gap is barely wide enough]','[you squeeze through as the shelter door bursts in]','[you drop the basement door on its claws]','[the pounding stops. A sign in the basement: KEEP ALL FOUR LOCKS ENGAGED]','[something breathes in the dark. It lunges as the torch dies]','You are not alone down here.'];
function GameApp(){
 const container=useRef<HTMLDivElement>(null),authority=useRef<GameState>(createGame(17));
 const[game,setGame]=useState(authority.current),[screen,setScreen]=useState<Screen>('setup'),screenRef=useRef<Screen>('setup');
 const[prefs,setPrefs]=useState<Preferences>(()=>({...DEFAULT_PREFS,reducedMotion:typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches})),prefsRef=useRef(prefs);
 const[sensor,setSensor]=useState(INITIAL_SENSOR),sensorRef=useRef(INITIAL_SENSOR),sensing=useRef<SensorController|null>(null);
 const view=useRef<SceneView|null>(null),audio=useRef<AudioEngine|null>(null),[ready,setReady]=useState(false),[loadProgress,setLoadProgress]=useState(0),[sceneError,setSceneError]=useState<string|null>(null);
 const[inspection,setInspection]=useState(false),[statusOpen,setStatusOpen]=useState(false),[remoteOpen,setRemoteOpenState]=useState(false),[pauseSettings,setPauseSettings]=useState(false),[reportDetails,setReportDetails]=useState(false),remoteOpenRef=useRef(false),inspectionRef=useRef(false),[cameraOpen,setCameraOpen]=useState(false),[cameraStream,setCameraStream]=useState<MediaStream|null>(null),[cameraDevice,setCameraDevice]=useState(''),[desktop,setDesktop]=useState(false),[voiceAvailable,setVoiceAvailable]=useState(false),[resultReady,setResultReady]=useState(false),[cameraAsked,setCameraAsked]=useState(false),[ending,setEnding]=useState<'film'|'text'|null>(null),[outroStep,setOutroStep]=useState(0);
 const[radioRole,setRadioRole]=useState('supervisor'),[radioSource,setRadioSource]=useState(''),voices=useRef(new VoiceScheduler<VoicePayload>()),firstVoice=useRef(false),lastCreatureVoice=useRef(-1000),lastScare=useRef(0),pulseBeat=useRef(-1);
 const[muted,setMuted]=useState(false),[volume,setVolume]=useState(.45),[judge,setJudge]=useState(false),[traceConsent,setTraceConsent]=useState(false),trace=useRef<TraceBridge|null>(null),[traceStatus,setTraceStatus]=useState('Trace sharing off');
 const[vitalsShare,setVitalsShare]=useState(false),[linkCopied,setLinkCopied]=useState(false);
 const friend=useRef(false),invitePaused=useRef(false),inviteRef=useRef(false),[inviteOpen,setInviteOpenState]=useState(false);
 const cameraWanted=useRef(false),cameraDeclined=useRef(false),manual=useRef<CoopManualPublisher|null>(null);
 // The player's sharing choices, made before or during a run; vitals are applied once the run's trace connects.
 const[cameraChoice,setCameraChoice]=useState(false),vitalsWanted=useRef(false),[vitalsChoice,setVitalsChoice]=useState(false);
 const cameraShare=useCameraShare(()=>trace.current?.cameraAccess()??null,cameraStream);
 const cameraActions=useRef(cameraShare);cameraActions.current=cameraShare;
 const[provider,setProvider]=useState({gemini:'FALLBACK · deterministic director',dialogue:'SCRIPTED FALLBACK · no generated line yet',elevenlabs:'FALLBACK · captions + original effects'});
 const run=useRef(new AsyncRun()),pending=useRef(new Set<string>()),lastEvent=useRef(0),lastStage=useRef(0),rackStage=useRef(0),cueRef=useRef<number|null>(null);
 const[radio,setRadio]=useState<string|null>(null),radioRef=useRef<{id:string;expires:number;stage:number;role:string}|null>(null),lineSequence=useRef(0);
 const[tutorialStep,setTutorialStep]=useState(0),tutorialStepRef=useRef(0),tutorialWatching=useRef(false),[introStep,setIntroStep]=useState(0),[introMode,setIntroMode]=useState<'film'|'text'>('film'),guided=useRef(true);
 const recording=useRef(false),recordSource=useRef<SensorMode>('manual'),recordEventSeq=useRef(0);
 const breaths=useRef<BreathSample[]>([]),lastBreath=useRef<string|null>(null),reportBreathing=useRef<number|null>(null);
 const samples=useRef<PulseSample[]>([]),markers=useRef<PulseEvent[]>([]),recordSegment=useRef(0),lastSample=useRef<string|null>(null),reportBaseline=useRef<number|null>(null),[report,setReport]=useState<Report>(EMPTY_REPORT),[reportEmpty,setReportEmpty]=useState<EmptyReason>('no-camera'),[deleted,setDeleted]=useState(false);
 function setScreenNow(s:Screen){screenRef.current=s;setScreen(s)}
 function changePrefs(p:Preferences){prefsRef.current=p;setPrefs(p)}
 function inspect(value:boolean){inspectionRef.current=value;setInspection(value)}
 function setRemoteOpen(value:boolean){remoteOpenRef.current=value;setRemoteOpenState(value)}
 function openEquipment(station:Station){if(!['play','tutorial'].includes(screenRef.current)||authority.current.paused||authority.current.status!=='playing')return;setRemoteOpen(false);send({type:'station',station});if(station==='terminal'&&authority.current.tasks.step==='faults'&&authority.current.mode!=='coop'&&rackStage.current!==authority.current.tasks.stage){rackStage.current=authority.current.tasks.stage;authority.current={...authority.current,tasks:{...authority.current.tasks,faults:{...authority.current.tasks.faults,listenFrom:authority.current.time}}};setGame({...authority.current})}inspect(true)}
 function selectCamera(id:string){setCameraDevice(id);sensing.current?.setCameraDevice(id)}
 function wantCamera(on:boolean){cameraWanted.current=on;setCameraChoice(on)}
 function toggleCamera(on:boolean){cameraDeclined.current=!on;wantCamera(on&&friend.current&&sensorRef.current.source!=='simulated');if(on)startFriendCamera();else void cameraActions.current.setEnabled(false)}
 function setTracePref(on:boolean){changePrefs({...prefsRef.current,shareTrace:on});if(!on){vitalsWanted.current=false;setVitalsChoice(false)}}
 function showCamera(){if(!['play','tutorial'].includes(screenRef.current)||authority.current.status!=='playing')return;pause(true,true);inspect(false);setCameraOpen(true)}
 function hideCamera(){setCameraOpen(false);if(['play','tutorial'].includes(screenRef.current))pause(false)}
 function setPracticeStep(n:number){tutorialStepRef.current=n;setTutorialStep(n)}
 function voiceValid(line:VoiceLine){const s=authority.current;return screenRef.current==='play'&&!s.paused&&s.status==='playing'&&s.tasks.stage===line.stage&&(s.equipment==='on'||line.role==='creature'||line.id.endsWith('-FAULTS_START'));}
 function clearRadio(predicate:(line:VoiceLine)=>boolean=()=>true){const removed=voices.current.cancel(predicate);for(const id of removed)audio.current?.cancelSpeech(id);if(radioRef.current&&removed.includes(radioRef.current.id)){radioRef.current=null;setRadio(null);setRadioSource('')}}
 function recordEvents(state:GameState){
  if(screenRef.current!=='play'||!recording.current)return;
  for(const e of state.events){if(e.seq<=recordEventSeq.current)continue;recordEventSeq.current=e.seq;if(reportTypes[e.type])markers.current.push({id:e.id,type:reportTypes[e.type],capturedAtMs:Math.max(0,performance.now()-(state.time-e.time)*1000),gameMs:e.time*1000,segment:recordSegment.current*100000+sensorRef.current.captureSegment});}
 }
 /** Rounded, frozen resting pulse and breathing personalize the mask and pacer. Neutral without opted-in sensing. */
 function syncPersonal(value:SensorView){
  const own=value.source!=='manual',bpm=own&&value.baselineBpm!==null?Math.round(value.baselineBpm):null,rpm=own&&value.restingBreathingRpm!=null?Math.round(value.restingBreathingRpm):null,p=authority.current.personal;
  if(p.restingBpm!==bpm||p.restingBreathsPerMinute!==rpm)authority.current=dispatch(authority.current,{type:'personal',restingBpm:bpm,restingBreathsPerMinute:rpm});
 }
 function send(action:GameAction){
  if(['input','replay','transmit'].includes(action.type)&&!inspectionRef.current)return;
  if(action.type==='station')inspect(false);
  if(action.type==='quiet'){inspect(false);clearRadio(line=>line.role!=='creature'&&!line.id.endsWith('-FAULTS_START'));}
  if(screenRef.current==='tutorial'&&action.type==='replay'&&tutorialStepRef.current===4)tutorialWatching.current=true;
  const before=authority.current;authority.current=dispatch(before,action);recordEvents(authority.current);setGame({...authority.current});
  if(screenRef.current==='tutorial'&&action.type==='transmit'&&tutorialStepRef.current===6&&authority.current.tasks.stage!==before.tasks.stage)startRun(false);
 }
 function pause(value:boolean,keepCapture=false){if(!['play','tutorial'].includes(screenRef.current)||authority.current.status!=='playing'||authority.current.paused===value)return;send({type:'restore',held:false});send({type:'pause',paused:value});if(!value)setPauseSettings(false);recordSegment.current++;lastSample.current=null;lastBreath.current=null;if(value)clearRadio();audio.current?.setPaused(value);if(value&&!keepCapture){void sensing.current?.pause();void cameraActions.current.stop()}else if(!value){if(sensing.current)resumeSensorCapture(sensing.current,sensorRef.current,prefsRef.current.sensing,true);startFriendCamera()}}
 function effect(name:EffectName,level=.4,position?:[number,number,number]){audio.current?.playEffect(name,position,prefsRef.current.softScares?level*.55:level)}
 async function line(id:string){
  if(screenRef.current!=='play'||authority.current.status!=='playing')return;
  const authored=dialogue.lines.find(l=>l.id===id);if(!authored)return;const creatureVoice=authored.role==='creature';
  if(!creatureVoice&&authority.current.equipment!=='on')return;if(creatureVoice&&authority.current.time-lastCreatureVoice.current<18)return;
  const identity=`line-${++lineSequence.current}-${id}`,token=run.current.token,stage=authority.current.tasks.stage,expires=authority.current.time+25;
  const reserved:VoiceLine={id:identity,text:authored.text,role:creatureVoice?'creature':authored.role==='system'?'system':'supervisor',stage,expiresAt:expires,priority:authored.priority};
  if(!voices.current.enqueue(reserved))return;if(creatureVoice)lastCreatureVoice.current=authority.current.time;
  let payload:VoicePayload;
  if(creatureVoice){
   const result=await requestMonster({requestId:identity,context:buildDirectorRequest(authority.current),fallbackId:id as MonsterFallbackId,expiresAtMs:Date.now()+25000});
   payload={caption:result.caption,speech:result.speech,textSource:result.textSource,textLatencyMs:result.textLatencyMs};
  }else{payload={caption:authored.text,textSource:'authored',speech:await requestSpeech({requestId:identity,caption:authored.text,encounterId:identity,expiresAtMs:Date.now()+25000})};}
  if(run.current.enqueue(token,`speech:${identity}`,()=>{if(voices.current.has(identity)&&voiceValid(reserved)&&authority.current.time<expires)voices.current.resolve(identity,payload)}))setGame({...authority.current});
 }
 function startRun(practice:boolean){
  void cameraActions.current.stop();manual.current?.dispose();manual.current=null;setInviteOpen(false);invitePaused.current=false;setCameraOpen(false);
  run.current.invalidate();beginIntegrationRun();pending.current.clear();lastEvent.current=0;lastStage.current=0;rackStage.current=0;cueRef.current=null;lineSequence.current=0;firstVoice.current=false;lastCreatureVoice.current=-1000;lastScare.current=0;inspect(false);setResultReady(false);setEnding(null);setReportDetails(false);clearRadio();voices.current.reset();
  const fresh=createGame(prefsRef.current.seed,practice?'tutorial':friend.current?'coop':'standard');authority.current=dispatch(fresh,{type:'accessibility',fixedMemoryTempo:practice||prefsRef.current.fixedTempo});if(document.hidden)authority.current=dispatch(authority.current,{type:'pause',paused:true});
  const currentSensor=sensorRef.current;authority.current=dispatch(authority.current,{type:'sensor',source:currentSensor.source,quality:currentSensor.quality,trend:currentSensor.trend});syncPersonal(currentSensor);
  // Charting is on whenever the camera is: enabling it is the opt-in.
  recording.current=!practice&&prefsRef.current.sensing!=='manual';recordSource.current=prefsRef.current.sensing;recordEventSeq.current=0;samples.current=[];markers.current=[];breaths.current=[];lastBreath.current=null;reportBreathing.current=currentSensor.restingBreathingRpm??null;recordSegment.current++;lastSample.current=null;reportBaseline.current=currentSensor.baselineBpm;setReport(EMPTY_REPORT);setDeleted(false);
  setGame(authority.current);setScreenNow(practice?'tutorial':'play');setPracticeStep(0);tutorialWatching.current=false;setJudge(false);
  setProvider({gemini:'FALLBACK · deterministic director',dialogue:'SCRIPTED FALLBACK · no generated line yet',elevenlabs:'FALLBACK · captions + original effects'});
  audio.current?.reset();audio.current?.setPaused(document.hidden);void audio.current?.start();
  if(document.hidden)void sensing.current?.pause();else if(sensing.current)resumeSensorCapture(sensing.current,currentSensor,prefsRef.current.sensing,currentSensor.source===prefsRef.current.sensing&&currentSensor.baselineBpm!==null);
  const old=trace.current;trace.current=new TraceBridge();void old?.dispose();setVitalsShare(false);
  const consent=!practice&&(friend.current||prefsRef.current.shareTrace);setTraceConsent(consent);setTraceStatus(consent?'Connecting consenting trace…':'Trace sharing off');const target=trace.current;void target.connect(consent,prefsRef.current.seed,fresh.mode).then(()=>{if(trace.current!==target)return;startFriendCamera();if(vitalsWanted.current)setVitalsShare(target.setVitalsConsent(true))});
  if(!practice&&friend.current){
   manual.current=new CoopManualPublisher(()=>trace.current===target?target.coopLink():null);
   // Play with a friend is the opt-in: it shares the run and, unless the player unticked it, the live heart rate, and holds game time on the invite until Start.
   setVitalsShare(trace.current.setVitalsConsent(vitalsWanted.current));setInviteOpen(true);invitePaused.current=true;pause(true,true);
  }
 }
 function endEnding(){setEnding(null);setResultReady(true)}
 function begin(tutorial:boolean){friend.current=false;wantCamera(false);guided.current=tutorial;setIntroStep(0);setIntroMode(prefsRef.current.reducedMotion?'text':'film');setScreenNow('intro');audio.current?.setPaused(false);void audio.current?.start();}
 function check(tutorial:boolean,withFriend=false){friend.current=withFriend;cameraDeclined.current=false;wantCamera(withFriend&&sensorRef.current.source!=='simulated');if(withFriend){vitalsWanted.current=true;setVitalsChoice(true)}guided.current=tutorial;setScreenNow('check')}
 function checkSensor(mode:SensorMode){wantCamera(friend.current&&mode==='presage'&&!cameraDeclined.current);changePrefs({...prefsRef.current,sensing:mode});sensorMode(mode)}
 async function deleteRun(){
  void cameraActions.current.stop();manual.current?.dispose();manual.current=null;setInviteOpen(false);invitePaused.current=false;
  const target=trace.current;recording.current=false;samples.current=[];markers.current=[];breaths.current=[];lastBreath.current=null;reportBreathing.current=null;reportBaseline.current=null;lastSample.current=null;setReport(EMPTY_REPORT);setDeleted(true);setTraceConsent(false);setVitalsShare(false);
  try{await target?.deleteSession();if(trace.current===target)setTraceStatus('Session deleted')}catch{if(trace.current===target)setTraceStatus('Local data deleted · remote delete unavailable; retry when connected')}
 }
 async function menu(){friend.current=false;setInviteOpen(false);setCameraOpen(false);run.current.invalidate();beginIntegrationRun();clearRadio();setJudge(false);audio.current?.reset();audio.current?.setPaused(true);const deletion=deleteRun();const stopping=sensing.current?.stop();setScreenNow('setup');await Promise.all([deletion,stopping]);}
 function sensorMode(mode:SensorMode){lastSample.current=null;lastBreath.current=null;recordSegment.current++;if(screenRef.current==='play'&&mode!=='manual'){recordSource.current=mode;recording.current=true}void sensing.current?.start(mode)}
 function toggleTrace(value:boolean){if(!value){changePrefs({...prefsRef.current,shareTrace:false});stopSharing();return}setTraceConsent(true);changePrefs({...prefsRef.current,shareTrace:true});void trace.current?.connect(true,game.seed,game.mode)}
 function setInviteOpen(value:boolean){inviteRef.current=value;setInviteOpenState(value)}
 function startFriendCamera(){if(friend.current&&cameraWanted.current&&trace.current?.remoteReady&&!document.hidden&&authority.current.status==='playing')void cameraActions.current.setEnabled(true)}
 function openInvite(){invitePaused.current=!authority.current.paused;pause(true,true);setInviteOpen(true)}
 function startWithFriend(){setInviteOpen(false);if(invitePaused.current){invitePaused.current=false;pause(false)}startFriendCamera()}
 function stopSharing(){
  friend.current=false;wantCamera(false);void cameraActions.current.stop();manual.current?.dispose();manual.current=null;
  setVitalsShare(false);vitalsWanted.current=false;setVitalsChoice(false);setTraceConsent(false);
  // The player gets their puzzle keys back when their friend leaves.
  if(authority.current.mode==='coop'){authority.current={...authority.current,mode:'standard'};setGame(authority.current)}
  startWithFriend();void trace.current?.deleteSession().then(()=>setTraceStatus('Session deleted')).catch(()=>setTraceStatus('Sharing stopped · remote deletion pending'));
 }
 function toggleVitals(value:boolean){vitalsWanted.current=value;setVitalsChoice(value);setVitalsShare(trace.current?.setVitalsConsent(value)??false)}
 function copySpectate(){const url=trace.current?.shareableSpectateUrl();if(!url)return;if(!navigator.clipboard){window.open(url,'_blank','noopener');return}void navigator.clipboard.writeText(url).then(()=>{setLinkCopied(true);setTimeout(()=>setLinkCopied(false),2000)},()=>window.open(url,'_blank','noopener'))}
 useEffect(()=>{
  let stopped=false,raf=0,previous=performance.now(),lastUI=0;
  const controller=new SensorController();controller.setBrowserCamera(true);sensing.current=controller;
  const visibility=()=>{if(document.hidden){pause(true);void controller.pause();void cameraActions.current.stop()}};document.addEventListener('visibilitychange',visibility);
  const previewOff=controller.subscribePreview(setCameraStream);void integrationStatus().then(status=>{if(!stopped){setDesktop(status.desktop);setVoiceAvailable(status.elevenlabs)}});
  const off=controller.subscribe(value=>{if(stopped)return;sensorRef.current=value;setSensor(value);const current=authority.current;
   if(current.sensor.source!==value.source||current.sensor.quality!==value.quality||current.trend!==value.trend)authority.current=dispatch(current,{type:'sensor',source:value.source,quality:value.quality,trend:value.trend});
   syncPersonal(value);
   if(screenRef.current==='play'&&!authority.current.paused&&authority.current.status==='playing'&&recording.current&&value.source===recordSource.current&&value.quality==='accepted'&&value.pulseBpm!==null&&value.sampleAtMs!==null&&value.source!=='manual'){
    const key=`${value.captureSegment}:${value.sampleAtMs}`;if(key!==lastSample.current){lastSample.current=key;samples.current.push({capturedAtMs:value.sampleAtMs,gameMs:authority.current.time*1000,segment:recordSegment.current*100000+value.captureSegment,bpm:value.pulseBpm,source:value.source,accepted:true});if(samples.current.length>7200)samples.current.shift();}
    if(value.baselineBpm!==null)reportBaseline.current=value.baselineBpm;
   }
   if(screenRef.current==='play'&&!authority.current.paused&&authority.current.status==='playing'&&recording.current&&value.source===recordSource.current&&value.source!=='manual'&&value.breathingRpm!=null&&value.breathingAtMs!=null){
    const key=`${value.captureSegment}:${value.breathingAtMs}`;if(key!==lastBreath.current){lastBreath.current=key;breaths.current.push({capturedAtMs:value.breathingAtMs,gameMs:authority.current.time*1000,segment:recordSegment.current*100000+value.captureSegment,rpm:value.breathingRpm,source:value.source,accepted:true});if(breaths.current.length>7200)breaths.current.shift();}
    if(value.restingBreathingRpm!=null)reportBreathing.current=value.restingBreathingRpm;
   }
  });
  const engine=createAudioEngine();audio.current=engine;engine.setVolume(.45);trace.current=new TraceBridge();let renderer:SceneView|null=null;
  const speechOff=engine.subscribeSpeech(event=>{
   if(stopped)return;
   if(event.type==='started'){
    const current=voices.current.current;if(!current||current.id!==event.id||!voiceValid(current)){engine.cancelSpeech(event.id);return;}
    radioRef.current={id:current.id,expires:Infinity,stage:current.stage,role:current.role};setRadioRole(current.role);setRadio(event.text);
    const payload=current.payload;setRadioSource(current.role==='creature'?`${payload.textSource==='gemini'?'GEMINI GENERATED':'SCRIPTED FALLBACK'} · ${event.mode==='caption'?'CAPTION':event.mode==='cached'?'CACHED VOICE':'ELEVENLABS VOICE'}`:'');
    setProvider(p=>({...p,...(current.role==='creature'?{dialogue:payload.textSource==='gemini'?`LIVE GENERATED · ${payload.textLatencyMs}ms`:'SCRIPTED FALLBACK · generation unavailable'}:{}),elevenlabs:event.mode==='live'?`LIVE · ${payload.speech.latencyMs}ms`:event.mode==='cached'?'CACHED · exact-caption speech':'FALLBACK · captions + original effects'}));
   }else if(event.type==='ended'||event.type==='cancelled'){
    voices.current.complete(event.id);if(radioRef.current?.id===event.id){radioRef.current=null;setRadio(null);setRadioSource('')}
   }
  });
  try{renderer=createScene(container.current!,(loaded,total)=>{if(!stopped)setLoadProgress(Math.round(loaded/total*95))});view.current=renderer;renderer.onInteract(openEquipment);renderer.onRemote((target,pressed)=>{if(!['play','tutorial'].includes(screenRef.current)||authority.current.paused||authority.current.status!=='playing')return;if(target==='remote'){if(pressed)inspect(false);setRemoteOpen(pressed)}else if(target==='quiet')send({type:'quiet'});else send({type:'restore',held:pressed})});renderer.onLever((action,pressed)=>{if(!['play','tutorial'].includes(screenRef.current)||authority.current.paused||authority.current.status!=='playing')return;if(action==='quiet')send({type:'quiet'});else send({type:'restore',held:pressed})});renderer.onStatus(()=>{if(['play','tutorial'].includes(screenRef.current)&&!authority.current.paused&&authority.current.status==='playing')setStatusOpen(true)});Promise.all([renderer.ready,typeof document!=='undefined'&&document.fonts?.ready?document.fonts.ready:Promise.resolve()]).then(()=>{if(!stopped){setLoadProgress(100);setSceneError(renderer?.diagnostics.error??null);setTimeout(()=>{if(!stopped)setReady(true)},200)}}).catch(()=>{if(!stopped){setSceneError('Required 3D assets unavailable');setReady(true)}})}catch(e){setSceneError(e instanceof Error?e.message:'WebGL unavailable');setReady(true)}
  function frame(now:number){if(stopped)return;const dt=Math.min(.1,(now-previous)/1000);previous=now;const playing=['play','tutorial'].includes(screenRef.current);
   if(playing&&!authority.current.paused&&authority.current.status==='playing'){authority.current=step(authority.current,dt);recordEvents(authority.current);}
   const s=authority.current;if(playing){renderer?.setStation(s.station,prefsRef.current.reducedMotion);renderer?.update({time:s.time,paused:!playing||s.paused||s.status!=='playing',power:s.equipment,stage:s.tasks.stage,faults:s.tasks.faults.active,faultsResolved:s.tasks.faults.completed,faultsRequired:s.tasks.faults.required,sequenceCue:s.mode==='coop'?null:s.tasks.memory.cue,sequenceLength:s.tasks.memory.sequence.length,entered:s.tasks.memory.input,armed:s.tasks.memory.armed,step:s.tasks.step,listening:listeningTo(s),progress:taskProgress(s),pulseFlash:s.tasks.step==='pulse'?pulseFlash(s):0,breath:s.tasks.step==='calm'&&s.mode!=='coop'?calmBreath(s):0,breathMatched:s.tasks.step==='calm'&&s.mode!=='coop'?calmMatched(s):true,blind:s.mode==='coop'&&s.tasks.step==='locate',creature:{...s.creature,sensorBearing:creatureBearing(s.seed,s.creature.sensorSampleAt)},cameraFeed:s.cameraFeed,locks:s.tasks.completedStages.length,doorMotor:s.tasks.finalTransmitted&&s.status==='playing',status:s.status,inspection:inspectionRef.current,scare:s.scare,softScares:prefsRef.current.softScares,survival:{secondsLeft:s.mode==='tutorial'?null:Math.max(0,Math.ceil(config.line.deadlineSeconds-s.time)),cells:s.shutdown.chargesRemaining,maxCells:config.shutdown.charges,exposure:s.danger},remote:{open:remoteOpenRef.current,cells:s.shutdown.chargesRemaining,maxCells:config.shutdown.charges,quietReady:s.equipment==='on'&&(s.mode==='tutorial'||s.shutdown.chargesRemaining>0&&s.time>=s.shutdown.cooldownUntil),cooldown:Math.max(0,s.shutdown.cooldownUntil-s.time),autoRestore:Math.max(0,s.shutdown.activeUntil-s.time),restoreReady:canRestore(s),restoreHold:s.restoreHold}},dt);}
   if(playing){const heard=creatureHeardPosition(s);engine.updateWorld({hunting:huntActive(s),faultSounds:faultSounds(s),listening:listeningTo(s),softScares:prefsRef.current.softScares,time:s.time,power:s.equipment,faults:s.tasks.faults.active,creature:{...s.creature,position:heard},lure:s.creature.lure?{active:true,position:NODES[s.creature.lure.target]}:undefined,paused:s.paused||s.status!=='playing'});engine.setListenerYaw(renderer?.diagnostics.listenerYaw??0);engine.setListenerPosition(renderer?.diagnostics.listenerPosition??[.05,1.62,.60]);for(const id of voices.current.prune(s.time,voiceValid))engine.cancelSpeech(id);if(!engine.isSpeechBusy()&&!s.paused&&s.status==='playing'){const next=voices.current.next(s.time,voiceValid);if(next&&!engine.speak({id:next.id,text:next.payload.caption,expiresAt:next.expiresAt,priority:next.priority,encounterId:next.id,audioBase64:next.payload.speech.audioBase64??undefined,source:next.payload.speech.source==='cached'?'cached':'live',followCreature:next.role==='creature',position:next.role==='creature'?heard:undefined}))voices.current.complete(next.id);}engine.update(s.time,r=>voices.current.current?.id===r.id&&voiceValid(voices.current.current));}
   if(now-lastUI>90){lastUI=now;if(playing){setGame({...s});if(screenRef.current==='play'){trace.current?.publish(s,sensorRef.current);manual.current?.publish(s,now);}setTraceStatus(trace.current?.status??'Trace sharing off');}}
   raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);return()=>{stopped=true;document.removeEventListener('visibilitychange',visibility);cancelAnimationFrame(raf);off();previewOff();speechOff();voices.current.reset();void controller.dispose();sensing.current=null;engine.dispose();audio.current=null;renderer?.dispose();view.current=null;manual.current?.dispose();manual.current=null;void cameraActions.current.stop();void trace.current?.dispose();run.current.invalidate();};
 },[]);
 // A click anywhere outside the status explainer closes it (clicking the wall unit again reopens it).
 useEffect(()=>{if(!statusOpen)return;const outside=(e:PointerEvent)=>{if(!(e.target as HTMLElement|null)?.closest('.status-guide'))setStatusOpen(false)};window.addEventListener('pointerdown',outside);return()=>window.removeEventListener('pointerdown',outside)},[statusOpen]);
 useEffect(()=>{audio.current?.setMuted(muted)},[muted]);useEffect(()=>{audio.current?.setVolume(volume)},[volume]);
 useEffect(()=>{
  if(screen!=='intro'||introMode!=='text')return;let n=0;setIntroStep(0);effect('intro_alarm',.35);const timer=setInterval(()=>{n++;if(n>=4){clearInterval(timer);startRun(guided.current);return}setIntroStep(n);if(n===1)effect('forest_run',.35);if(n===2)effect('door_slam',.3)},2100);return()=>clearInterval(timer);
 },[screen,introMode]);
 useEffect(()=>{
  if(ending!=='text')return;let n=0;setOutroStep(0);const timer=setInterval(()=>{n++;if(n>=OUTRO.length){clearInterval(timer);endEnding();return}setOutroStep(n)},2100);return()=>clearInterval(timer);
 },[ending]);
 useEffect(()=>{
  if(!['play','tutorial'].includes(screen))return;
  const down=(e:KeyboardEvent)=>{const element=e.target as HTMLElement;const key=e.key.toLowerCase();if(cameraOpen){if(key==='escape'){e.preventDefault();if(!e.repeat)hideCamera()}return}if(inviteRef.current){if(key==='escape'){e.preventDefault();if(!e.repeat)startWithFriend()}return}if(['SELECT','TEXTAREA'].includes(element.tagName)||(element.tagName==='INPUT'&&!['checkbox','range','button'].includes((element as HTMLInputElement).type)))return;
   if(key==='escape'){e.preventDefault();if(!e.repeat)pause(!authority.current.paused);return}if(authority.current.paused||authority.current.status!=='playing'||e.repeat)return;
   if(key==='e'){e.preventDefault();openEquipment(authority.current.station)}if(key===' '){e.preventDefault();inspect(false);setStatusOpen(false);setRemoteOpen(false)}
   if(['1','2','3','4'].includes(key)){e.preventDefault();send({type:'input',value:Number(key)})}
   if(key==='q'){e.preventDefault();send({type:'quiet'})}if(key==='b'){e.preventDefault();send({type:'breathe',holding:true})}if(key==='l'){e.preventDefault();send({type:'listen'})}if(key==='f'){e.preventDefault();send({type:'restore',held:true})}if(key==='r'){e.preventDefault();send({type:'replay'})}if(key==='t'){e.preventDefault();send({type:'transmit'})}if(key==='j'&&DEBUG){e.preventDefault();setJudge(v=>!v)}
   if(key==='tab'&&(element===document.body||element.tagName==='CANVAS')){e.preventDefault();const i=STATIONS.indexOf(authority.current.station);send({type:'station',station:STATIONS[(i+(e.shiftKey?2:1))%3]})}
  };
  const up=(e:KeyboardEvent)=>{const key=e.key.toLowerCase();if(key==='f')send({type:'restore',held:false});if(key==='b')send({type:'breathe',holding:false})};
  const blur=()=>{send({type:'restore',held:false});send({type:'breathe',holding:false})};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur)};
 },[screen,cameraOpen]);
 useEffect(()=>{
  if(!['play','tutorial'].includes(screen)||game.paused||game.status!=='playing')return;
  run.current.flush();
  if(screen==='tutorial'){
   if(tutorialStep===0&&game.tasks.faults.completed>0)setPracticeStep(1);
   if(tutorialStep===1&&game.equipment==='quiet')setPracticeStep(2);
   if(tutorialStep===2&&canRestore(game))setPracticeStep(3);
   if(tutorialStep===3&&game.equipment==='on'){send({type:'practice-memory'});openEquipment('terminal');setPracticeStep(4)}
   if(tutorialStep===4&&tutorialWatching.current&&!game.tasks.memory.playing)setPracticeStep(5);
   if(tutorialStep===5&&game.tasks.memory.armed)setPracticeStep(6);
  }else{
   const request=authority.current.director.request;
   if(request&&!pending.current.has(request.requestId)){pending.current.add(request.requestId);const token=run.current.token;void requestDirector(request).then(result=>{if(run.current.enqueue(token,`director:${request.requestId}`,()=>{
    if(screenRef.current!=='play'||authority.current.status!=='playing')return;
    if(authority.current.director.request?.requestId!==request.requestId){if(result.source==='gemini')setProvider(p=>({...p,gemini:`LIVE RESPONSE · ${result.latencyMs}ms · stale, not applied`}));return;}
    const rejection=result.proposal?validateProposal(result.proposal,authority.current):'NO_PROPOSAL';if(result.proposal)send({type:'proposal',proposal:result.proposal,source:result.source==='gemini'?'GEMINI':'FALLBACK'});
    setProvider(p=>({...p,gemini:result.source==='gemini'?`LIVE · ${result.latencyMs}ms · ${rejection?'rejected '+rejection:'applied'}`:'FALLBACK · '+(result.reason??'deterministic director')}));
   }))setGame({...authority.current})});}
   if(lastStage.current!==game.tasks.stage){lastStage.current=game.tasks.stage;clearRadio();const id=stageLines[game.tasks.stage];if(id)void line(id)}
  }
  const events=game.events.filter(e=>e.seq>lastEvent.current);for(const e of events){
   const effects:Record<string,EffectName>={FAULT_CLEARED:'fault_silenced',WRONG_INPUT:'machine_mistake',TASK_COMPLETE:'relay_confirm',BLACKOUT_STARTED:'blackout',RESTORED:'power_restart',LURE_TRANSMITTED:'lure_transmit',HUNT_STARTED:'breach_warning',RECOVERY_REWARD:'steps_receding'};
   if(effects[e.type]&&(!['FAULT_CLEARED','WRONG_INPUT','TASK_COMPLETE'].includes(e.type)||game.equipment==='on'))effect(effects[e.type],e.type==='HUNT_STARTED'?.5:.32,e.type==='HUNT_STARTED'||e.type==='RECOVERY_REWARD'?game.creature.position:undefined);
   if(e.type==='BREACH_WARNING')clearRadio();if(e.type==='BLACKOUT_STARTED')clearRadio(line=>line.role!=='creature'&&!line.id.endsWith('-FAULTS_START'));
   if(e.type==='SCARE'&&game.scare&&game.scare.id!==lastScare.current){lastScare.current=game.scare.id;audio.current?.playScare(game.scare.kind,game.creature.position,prefsRef.current.softScares);}
   if(e.type==='PROXIMITY_ALARM'&&!firstVoice.current&&screen==='play'){firstVoice.current=true;void line('FIRST_APPROACH')}
   if(e.type==='TAUNT'&&screen==='play')void line(e.detail);
   lastEvent.current=e.seq;
  }
  const cue=game.tasks.memory.cue;if(cue!==cueRef.current){cueRef.current=cue;if(cue&&game.equipment==='on')effect(`sequence_tone_${game.mode==='coop'?1:cue}` as EffectName,.32)} // co-op: one neutral tone, so only the friend's page has the digits
  const pulse=game.tasks.pulse;if(game.tasks.step==='pulse'&&game.equipment==='on'&&!game.paused){const beat=Math.floor((game.time-pulse.startedAt)/pulse.periodSeconds);if(beat!==pulseBeat.current){pulseBeat.current=beat;effect('terminal_press',.24)}}else pulseBeat.current=-1;
 },[game,screen,tutorialStep]);
 useEffect(()=>{
  if(screen!=='play'||game.status==='playing')return;
  // A win plays the ending (text cards with reduced motion); the run report follows it.
  void cameraActions.current.stop();run.current.invalidate();clearRadio();inspect(false);audio.current?.reset();if(game.status==='won')setEnding(prefsRef.current.reducedMotion?'text':'film');else audio.current?.playScare('breach',game.creature.position,prefsRef.current.softScares);
  const resultTimer=game.status==='lost'?setTimeout(()=>setResultReady(true),SCARE_MS.breach-200):undefined;
  setReportEmpty(recording.current?'no-readings':'no-camera');setReport(buildPulseReport({recordingConsent:recording.current,source:recordSource.current,baselineBpm:reportBaseline.current,samples:samples.current,events:markers.current,breathingSamples:breaths.current,restingBreathingRpm:reportBreathing.current}));void sensing.current?.stop();return()=>clearTimeout(resultTimer);
 },[screen,game.status]);
 const judgeSensorLabel=sensor.source==='simulated'?`SIMULATED · ${sensor.trend}`:sensor.source==='presage'?`${sensor.status==='ready'&&sensor.quality==='accepted'?'LIVE':sensor.ageMs!==null&&sensor.ageMs>5000?'STALE':sensor.status.toUpperCase()} · PULSE ${sensor.trend}`:'PULSE INPUT OFF · NEUTRAL';
 // The HUD keeps the last known trend between accepted estimates, like the vitals readout; the judge trace stays exact.
 const shownTrend=readVitals(sharedVitals,sensor).trend,sensorLabel=sensor.source==='presage'?`PRESAGE · ${sensor.status==='unavailable'?'CAMERA UNAVAILABLE':sensor.baselineBpm===null?'CALIBRATING':shownTrend==='UNKNOWN'?'PULSE ON':`PULSE ${shownTrend}`}`:judgeSensorLabel;
 const startIntro=()=>{guided.current=guided.current;setIntroStep(0);setIntroMode(prefsRef.current.reducedMotion?'text':'film');setScreenNow('intro');audio.current?.setPaused(false);void audio.current?.start();};
 return <><div className="scene" ref={container} style={screen==='play'||screen==='tutorial'?undefined:{visibility:'hidden'}}/><div className="vignette"/><div className="film-grain"/>{screen==='setup'?<Setup vitalsShare={vitalsChoice} onVitalsConsent={toggleVitals} ready={ready} progress={loadProgress} error={sceneError} prefs={prefs} onPrefs={changePrefs} onStart={(tutorial,withFriend)=>withFriend?check(tutorial,true):begin(tutorial)} onSensor={sensorMode} sensor={sensor} stream={cameraStream} desktop={desktop} voiceAvailable={voiceAvailable} cameraDevice={cameraDevice} onDevice={selectCamera} askCamera={!cameraAsked} onCameraAnswered={()=>setCameraAsked(true)}/>:screen==='check'?<VideoCheck withFriend={friend.current} sensor={sensor} stream={cameraStream} desktop={desktop} deviceId={cameraDevice} onDevice={selectCamera} sharing={{cameraWanted:cameraChoice,onToggleCamera:toggleCamera,vitalsShare:vitalsChoice,onVitalsConsent:toggleVitals,shareTrace:prefs.shareTrace,onToggleShareTrace:setTracePref}} onEnable={()=>checkSensor('presage')} onSimulated={()=>checkSensor('simulated')} onSkip={()=>{wantCamera(false);checkSensor('manual');startIntro()}} onContinue={startIntro} onBack={()=>setScreenNow('setup')}/>:screen==='intro'?introMode==='film'?<OpeningFilm muted={muted} volume={volume} onDone={()=>startRun(guided.current)} onFail={()=>setIntroMode('text')}/>:<main className="intro"><div className="eyebrow">FIELD RECORDING / CONTAINMENT FAILURE</div><p key={introStep}>{INTRO[introStep]}</p><button className="text-button" onClick={()=>startRun(guided.current)}>Skip cutscene →</button></main>:<>
  <HUD captions={prefs.captions} game={game} send={send} onPause={()=>pause(true)} onJudge={DEBUG?()=>setJudge(v=>!v):undefined} live={friend.current&&traceConsent?openInvite:undefined} onStopSharing={friend.current&&traceConsent?stopSharing:undefined} muted={muted} setMuted={setMuted} sensorLabel={sensorLabel} radio={radio} radioRole={radioRole} radioSource={radioSource} inspection={inspection} onOpen={openEquipment} onClose={()=>inspect(false)} onCamera={showCamera}/><CornerVitals sensor={sensor} stream={cameraStream} onOpen={showCamera}/>{statusOpen&&game.status==='playing'&&<StatusGuide game={game} onClose={()=>setStatusOpen(false)}/>}{DEBUG&&screen==='play'&&<VitalsPanel sensor={sensor} waves={sensing.current}/>}<JumpScare scare={game.scare} soft={prefs.softScares} reduced={prefs.reducedMotion}/>
  {screen==='tutorial'&&!game.paused&&<Tutorial sceneAnchor={id=>{const key=({'use-equipment':'terminal','emergency-quiet':'quiet','emergency-restore':'restore'} as const)[id as 'use-equipment'];return key?view.current?.diagnostics.anchors[key]??null:null}} inspection={inspection} step={tutorialStep} onSkip={()=>startRun(false)} onContinue={()=>{if(canRestore(authority.current))setPracticeStep(3)}}/>}
  {judge&&DEBUG&&<aside className="judge-panel"><button className="text-button close" onClick={()=>setJudge(false)}>Close ×</button><div className="eyebrow">JUDGE TRACE</div><h2>Every decision leaves a trace.</h2><p className="small muted">Game events and coarse signal status only, plus your current heart rate if you turn that on below. Pulse recordings and camera frames stay out of this feed.</p><div className="provider-table">{Object.entries({...provider,presage:judgeSensorLabel,spacetime:traceStatus}).map(([k,v])=><div key={k}><span>{k.toUpperCase()}</span><b>{v}</b></div>)}</div><p className="small">Tactic: {game.director.lastTactic} → {game.director.lastTarget}<br/>Outcome: {game.director.lastOutcome}<br/>Evidence: {game.director.lastEvidenceIds.join(', ')||'none'}</p><label className="check"><input type="checkbox" checked={traceConsent} onChange={e=>toggleTrace(e.target.checked)}/> Consent to sanitized trace sharing</label><div className="button-row"><button disabled={!traceConsent} onClick={()=>{const url=trace.current?.judgeUrl();if(url)window.open(url,'_blank','noopener')}}>Open second screen ↗</button><button onClick={()=>void deleteRun()}>Delete session & report</button></div><label className="check"><input type="checkbox" checked={vitalsShare} disabled={!traceConsent} onChange={e=>toggleVitals(e.target.checked)}/> Also share my live heart rate with spectators: current BPM, change from baseline, trend and signal quality. Never the camera image or a recording. Anyone with the link sees it; turn it off any time.</label><div className="button-row"><button disabled={!traceConsent||!trace.current?.shareableSpectateUrl()} title={trace.current?.shareableSpectateUrl()?undefined:'Set VITE_SPECTATE_ORIGIN to a hosted web build so friends can open the link'} onClick={copySpectate}>{linkCopied?'Spectate link copied':trace.current?.remoteReady?'Copy spectate link':'Copy same-browser link'}</button><button disabled={!traceConsent} onClick={()=>{const url=trace.current?.spectateUrl();if(url)window.open(url,'_blank','noopener')}}>Open spectator view ↗</button></div><p className="small">{sensor.hint}<br/>Quality: {sensor.quality} · sample age: {sensor.ageMs===null?'unavailable':Math.round(sensor.ageMs)+'ms'} · baseline: {Math.floor(sensor.acceptedSeconds)}/30 usable seconds</p>{sensor.source==='simulated'&&<label className="check"><input type="checkbox" onChange={e=>sensing.current?.setSimulatedElevated(e.target.checked)}/> Simulate sustained +12 BPM (development)</label>}<button className="text-button" onClick={()=>{changePrefs({...prefsRef.current,sensing:'manual'});sensorMode('manual')}}>Stop capture → neutral play</button><div className="trace-list">{game.events.slice(-25).reverse().map(e=><div key={e.id}><time>{e.time.toFixed(1)}s</time><b>{e.id} / {e.type}</b><span>{e.detail}</span></div>)}</div><p className="small muted">Models {view.current?.diagnostics.loadedAssets.length??0}/10 · Audio {audio.current?.diagnostics.loadedEffects.length??0}/27<br/>Speech playback: {audio.current?.diagnostics.speech??'idle'} · {audio.current?.diagnostics.status??'idle'}</p><output className="small muted" data-testid="audio-diagnostics">{JSON.stringify(audio.current?.diagnostics??{})}</output></aside>}
  {inviteOpen&&screen==='play'&&<InviteFriend camera={cameraShare.state} cameraWanted={cameraChoice} onToggleCamera={toggleCamera} vitalsShare={vitalsShare} onVitalsConsent={toggleVitals} bridge={trace.current} starting={invitePaused.current} onStart={startWithFriend} onStop={stopSharing}/>}
  {game.paused&&!cameraOpen&&!inviteOpen&&game.status==='playing'&&<div className="modal-shade pause-shade"><section className="modal pause-screen" role="dialog" aria-modal="true" aria-label="Game paused"><div className="screen-left"><WornTitle text="PAUSED" level={2}/><Heartbeat/><div className="worn-menu"><button className="primary" onClick={()=>pause(false)}>Resume protocol →</button><button aria-expanded={pauseSettings} onClick={()=>setPauseSettings(v=>!v)}>{pauseSettings?'Hide settings':'Settings'}</button><button onClick={()=>{void deleteRun();startRun(false)}}>Restart seed</button><button onClick={()=>void menu()}>Return to shelter setup</button></div></div>{pauseSettings&&<div className="screen-right"><div className="controls-grid"><span><kbd>1–4</kbd> Task input</span><span><kbd>R</kbd> Replay sequence</span><span><kbd>T</kbd> Transmit lure</span><span><kbd>Q</kbd> Quiet equipment</span><span><kbd>F</kbd> Hold to restore</span><span><kbd>B</kbd> Hold to breathe</span><span><kbd>L</kbd> Listen to the rack</span>{DEBUG&&<span><kbd>J</kbd> Judge trace</span>}<span><kbd>← → ↑ ↓</kbd> Look around</span></div><p className="small muted">Click equipment to use it. E opens the item you are facing; Space looks away. Q only works before it commits at the wall. Listen for its footsteps getting louder.</p><label className="volume-row">Master volume<input aria-label="Master volume" type="range" min="0" max=".7" step=".05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/></label><label className="check"><input type="checkbox" checked={prefs.reducedMotion} onChange={e=>changePrefs({...prefsRef.current,reducedMotion:e.target.checked})}/> Reduced motion</label><label className="check"><input type="checkbox" checked={prefs.captions} onChange={e=>changePrefs({...prefsRef.current,captions:e.target.checked})}/> Show captions</label><label className="check"><input type="checkbox" checked={prefs.softScares} onChange={e=>changePrefs({...prefsRef.current,softScares:e.target.checked})}/> Softer scares & impact sounds</label></div>}</section></div>}
  {screen==='play'&&resultReady&&game.status!=='playing'&&<div className={`modal-shade result-shade ${game.status==='lost'?'lost':''}`}><section className="modal results" role="dialog" aria-label="Run results">{!reportDetails?<div className="screen-left"><WornTitle text={game.status==='won'?'NOT ALONE':'SILENCED'} level={2}/><Heartbeat/><div className="worn-menu"><button className="primary" onClick={()=>{void deleteRun();changePrefs({...prefsRef.current,seed:prefs.seed+1});startRun(false)}}>Begin another protocol →</button><button onClick={()=>setReportDetails(true)}>View report</button><button onClick={()=>void menu()}>Return to title screen</button></div></div>:<div className="screen-left"><WornTitle text={game.status==='won'?'NOT ALONE':'SILENCED'} level={2}/><Heartbeat/><h3 className="result-verdict">{game.status==='won'?'You are not alone down here.':'The shelter fell silent.'}</h3><p>{game.status==='won'?'You got through the basement door and dropped it on its claws. But the four locks were never keeping it out. They were keeping something in, and it was waiting in the dark.':game.lossReason}</p><div className="result-stats"><div><strong>{game.tasks.completedStages.length}/4</strong><span>RESEARCH STAGES</span></div><div><strong>{Math.round(game.time)}s</strong><span>ELAPSED</span></div><div><strong>{game.events.filter(e=>e.type==='QUIET_ENTERED').length}</strong><span>QUIET RESPONSES</span></div></div><p className="small muted">Seed {game.seed} · {game.director.source} director · {prefs.sensing==='manual'?'Neutral physiology':prefs.sensing.toUpperCase()}</p><div className="worn-menu"><button className="primary" onClick={()=>setReportDetails(false)}>← Back</button><button onClick={()=>{void deleteRun();startRun(false)}}>Replay this seed</button><button onClick={()=>void deleteRun()}>{deleted?'Local report deleted':'Delete report & shared session'}</button></div><PulseReport report={report} empty={reportEmpty} durationMs={game.time*1000}/></div>}</section></div>}
  {screen==='play'&&ending==='film'&&<OpeningFilm video={ENDING.video} captionOf={endingCaptionAt} label="Ending cutscene" className="ending-film" muted={muted} volume={volume} onDone={endEnding} onFail={()=>setEnding('text')}/>}
  {screen==='play'&&ending==='text'&&<main className="intro ending-cards" aria-label="Ending"><div className="eyebrow">FIELD RECORDING / BASEMENT ACCESS</div><p key={outroStep}>{OUTRO[outroStep]}</p><button className="text-button" onClick={endEnding}>Skip cutscene →</button></main>}
 </>}{cameraOpen&&<div className="modal-shade"><section className="modal camera-modal" role="dialog" aria-modal="true" aria-label="Camera settings"><button className="text-button" onClick={hideCamera}>Back to game →</button><CameraPanel sensor={sensor} stream={cameraStream} desktop={desktop} deviceId={cameraDevice} onDevice={selectCamera} onReadyStart={hideCamera} readyLabel="Return to game →" onStart={()=>{changePrefs({...prefsRef.current,sensing:'presage'});sensorMode('presage')}} onStop={()=>{changePrefs({...prefsRef.current,sensing:'manual'});sensorMode('manual')}}/></section></div>}</>;
}
export default function App(){return location.hash.startsWith('#judge=')?<JudgeView/>:location.hash.startsWith('#watch=')?<SpectateView/>:<GameApp/>}
