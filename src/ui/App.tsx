import { useEffect, useRef, useState } from 'react';
import { createGame, dispatch, step } from '../game/reducer';
import { validateProposal } from '../game/directorValidation';
import type { GameAction, GameState, Station } from '../game/state';
import { createScene, type SceneView } from '../render/scene';
import { createAudioEngine, type AudioEngine } from '../audio/engine';
import { SensorController } from '../sensing/controller';
import type { SensorView } from '../sensing/types';
import { requestDirector, requestSpeech, TraceBridge, beginIntegrationRun } from '../integrations/client';
import Setup, { type Preferences } from './Setup';
import HUD from './HUD';
import JudgeView from './JudgeView';
import { AsyncRun } from './asyncRun';

const STATIONS:Station[]=['console','left','right','relay'];
const DEFAULT_PREFS:Preferences={mode:'demo',seed:17,reducedMotion:false,sensing:'manual',shareTrace:false};
const INITIAL_SENSOR:SensorView={source:'manual',status:'manual',trend:'UNKNOWN',quality:'unknown',hint:'MANUAL · no camera or pulse data',baselineBpm:null,pulseBpm:null,ageMs:null,acceptedSeconds:0,canContinueManual:true};

function GameApp(){
  const container=useRef<HTMLDivElement>(null),authority=useRef<GameState>(createGame(17,'demo'));
  const [game,setGame]=useState(authority.current),[screen,setScreen]=useState<'setup'|'play'>('setup');
  const screenRef=useRef(screen),[prefs,setPrefs]=useState(DEFAULT_PREFS),prefsRef=useRef(prefs);
  const [ready,setReady]=useState(false),[sceneError,setSceneError]=useState<string|null>(null);
  const view=useRef<SceneView|null>(null),audio=useRef<AudioEngine|null>(null),sensing=useRef<SensorController|null>(null);
  const [sensor,setSensor]=useState(INITIAL_SENSOR),sensorRef=useRef(INITIAL_SENSOR);
  const trace=useRef<TraceBridge|null>(null),[traceStatus,setTraceStatus]=useState('Trace sharing off');
  const [traceOpen,setTraceOpen]=useState(false),[traceConsent,setTraceConsent]=useState(false),[orders,setOrders]=useState(false);
  const [muted,setMuted]=useState(false),[volume,setVolume]=useState(.5);
  const [provider,setProvider]=useState({gemini:'FALLBACK · authored director',elevenlabs:'FALLBACK · captions + radio beep'});
  const run=useRef(new AsyncRun()),pending=useRef(new Set<string>()),spoken=useRef(new Set<string>()),lastEvent=useRef(0);
  function send(action:GameAction){authority.current=dispatch(authority.current,action);setGame({...authority.current});}
  function pause(value:boolean){if(authority.current.status!=='playing'||authority.current.paused===value)return;send({type:'interact',held:false});send({type:'pause',paused:value});audio.current?.setPaused(value);if(value)void sensing.current?.pause();else void sensing.current?.resume();}

  useEffect(()=>{
    const controller=new SensorController();sensing.current=controller;
    const unsubscribe=controller.subscribe(value=>{sensorRef.current=value;setSensor(value);if(authority.current.trend!==value.trend)authority.current=dispatch(authority.current,{type:'trend',trend:value.trend});});
    const engine=createAudioEngine();audio.current=engine;engine.setVolume(.5);trace.current=new TraceBridge();
    let cancelled=false,renderer:SceneView|null=null;
    try{renderer=createScene(container.current!);view.current=renderer;renderer.ready.then(()=>{if(!cancelled){setSceneError(renderer?.diagnostics.error??null);setReady(true)}}).catch(error=>{if(!cancelled){setSceneError(String(error));setReady(true)}});}catch(error){setSceneError(String(error));setReady(true);}
    let previous=performance.now(),accumulator=0,lastUI=0,raf=0;
    function frame(now:number){
      if(cancelled)return;const elapsed=Math.min(.15,(now-previous)/1000);previous=now;
      if(screenRef.current==='play'&&!authority.current.paused&&authority.current.status==='playing'){accumulator+=elapsed;while(accumulator>=1/30){authority.current=step(authority.current,1/30);accumulator-=1/30;}}else accumulator=0;
      const state=authority.current;
      renderer?.setStation(state.station,prefsRef.current.reducedMotion);
      renderer?.update({time:state.time,paused:screenRef.current==='setup'||state.paused||state.status!=='playing',doors:state.doors,creature:state.creature,safeUntil:state.safeUntil,task:state.tasks.stage,power:state.energy,challenge:{prompt:state.privateChallenge.prompt,response:state.privateChallenge.answer},orderId:state.order.id},elapsed);
      engine.setListenerYaw(state.station==='left'?Math.PI/2:state.station==='right'?-Math.PI/2:state.station==='relay'?Math.PI:0);
      engine.update(state.time,request=>request.id===state.call?.id&&!state.call.rejected&&state.call.expiresAt>state.time&&state.status==='playing');
      if(now-lastUI>=100){lastUI=now;if(screenRef.current==='play'){setGame({...state});trace.current?.publish(state,sensorRef.current);setTraceStatus(trace.current?.status??'Trace sharing off');}}
      raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
    return()=>{cancelled=true;cancelAnimationFrame(raf);renderer?.dispose();view.current=null;engine.dispose();audio.current=null;unsubscribe();sensing.current=null;void controller.dispose();void trace.current?.dispose();run.current.invalidate();};
  },[]);
  useEffect(()=>{audio.current?.setMuted(muted);},[muted]);
  useEffect(()=>{audio.current?.setVolume(volume);},[volume]);
  useEffect(()=>{
    if(screen!=='play')return;
    function keydown(event:KeyboardEvent){
      const element=event.target as HTMLElement;if(['INPUT','SELECT','TEXTAREA'].includes(element.tagName))return;
      const key=event.key.toLowerCase();
      if(key==='escape'){event.preventDefault();if(!event.repeat){setOrders(false);pause(!authority.current.paused);}return;}
      if(authority.current.paused||authority.current.status!=='playing'||event.repeat)return;
      if(['1','2','3','4'].includes(key)){send({type:'station',station:STATIONS[Number(key)-1]});return;}
      if(['a','d','arrowleft','arrowright'].includes(key)){event.preventDefault();const next=STATIONS.indexOf(authority.current.station)+(['a','arrowleft'].includes(key)?-1:1);send({type:'station',station:STATIONS[(next+4)%4]});}
      if(key==='q'){send({type:'inspect'});setOrders(v=>!v);}
      if(key==='r'){send({type:'authenticate'});setOrders(true);}
      if(key==='e'){event.preventDefault();send({type:'interact',held:true});}
      if(key===' '&&element.tagName!=='BUTTON'){event.preventDefault();send({type:'sweep',side:authority.current.station==='right'?'right':'left'});}
      if(key==='j')setTraceOpen(v=>!v);
    }
    function keyup(event:KeyboardEvent){if(event.key.toLowerCase()==='e')send({type:'interact',held:false});}
    function hidden(){if(document.hidden&&authority.current.status==='playing'&&!authority.current.paused)pause(true);}
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);document.addEventListener('visibilitychange',hidden);
    return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);document.removeEventListener('visibilitychange',hidden)};
  },[screen]);
  useEffect(()=>{
    if(screen!=='play'||game.paused||game.status!=='playing')return;
    run.current.flush();
    const request=authority.current.director.request;
    if(request&&!pending.current.has(request.requestId)){
      pending.current.add(request.requestId);const current=run.current.token;
      void requestDirector(request).then(result=>{
        if(screenRef.current!=='play'||authority.current.status!=='playing')return;
        if(run.current.enqueue(current,`director:${request.requestId}`,()=>{
          if(authority.current.director.request?.requestId!==request.requestId){if(result.source==='gemini')setProvider(p=>({...p,gemini:`LIVE RESPONSE · ${result.latencyMs}ms · stale, not applied`}));return;}
          const rejection=result.proposal?validateProposal(result.proposal,authority.current):'NO_PROPOSAL';
          if(result.proposal)send({type:'proposal',proposal:result.proposal,source:result.source==='gemini'?'GEMINI':'FALLBACK'});
          setProvider(p=>({...p,gemini:result.source==='gemini'?`LIVE · ${result.latencyMs}ms · ${rejection?`rejected ${rejection}`:'applied'}`:'FALLBACK · seeded local director'}));
        }))setGame({...authority.current});
      });
    }
    const call=authority.current.call;
    if(call&&!call.rejected&&call.expiresAt>authority.current.time&&!spoken.current.has(call.id)){
      spoken.current.add(call.id);const current=run.current.token;
      void requestSpeech({requestId:call.id,caption:call.text,encounterId:call.id,expiresAtMs:Date.now()+Math.max(0,call.expiresAt-authority.current.time)*1000}).then(result=>{
        if(screenRef.current!=='play'||authority.current.status!=='playing')return;
        if(run.current.enqueue(current,`speech:${call.id}`,()=>{
          if(authority.current.call?.id!==call.id||authority.current.call.rejected||authority.current.time>=call.expiresAt)return;
          setProvider(p=>({...p,elevenlabs:result.source==='elevenlabs'?`LIVE · ${result.latencyMs}ms`:result.source==='cached'?'CACHED · exact-caption generated speech':'FALLBACK · captions + radio beep'}));
          audio.current?.speak({id:call.id,text:call.text,expiresAt:call.expiresAt,priority:3,encounterId:call.id,audioBase64:result.audioBase64??undefined});
        }))setGame({...authority.current});
      });
    }
    for(const event of game.events.filter(e=>e.seq>lastEvent.current)){
      const side=event.detail.toLowerCase().includes('left')?'left':event.detail.toLowerCase().includes('right')?'right':undefined;
      if(event.type==='DOOR')audio.current?.playEffect('shutter_motor',side,.35);
      if(event.type==='SWEEP')audio.current?.playEffect('shutter_motor',side,.45);
      if(event.type==='APPROACH')audio.current?.playEffect('knock',side,.3);
      if(event.type==='THRESHOLD')audio.current?.playEffect('warning_pulse',side,.35);
      if(event.type==='TASK_COMPLETE')audio.current?.playEffect('relay_click',undefined,.5);
      if(event.type==='CALL_REJECTED')audio.current?.playEffect('mimic_rustle',side,.3);
      lastEvent.current=event.seq;
    }
  },[game,screen]);
  useEffect(()=>{if(screen==='play'&&game.status!=='playing'){void sensing.current?.stop();audio.current?.reset();audio.current?.playEffect(game.status==='won'?'success':'warning_pulse',undefined,.4);}},[game.status,screen]);
  async function begin(p:Preferences){
    run.current.invalidate();beginIntegrationRun();pending.current.clear();spoken.current.clear();lastEvent.current=0;
    setProvider({gemini:'FALLBACK · authored director',elevenlabs:'FALLBACK · captions + radio beep'});
    authority.current=createGame(p.seed,p.mode);setGame(authority.current);prefsRef.current=p;setPrefs(p);screenRef.current='play';setScreen('play');setOrders(false);setTraceOpen(false);setTraceConsent(p.shareTrace);
    audio.current?.reset();audio.current?.setPaused(false);void audio.current?.start();
    if(sensorRef.current.source!==p.sensing||['paused','manual','unavailable'].includes(sensorRef.current.status))void sensing.current?.start(p.sensing);
    const previousTrace=trace.current;const nextTrace=new TraceBridge();trace.current=nextTrace;setTraceStatus(p.shareTrace?'Connecting consenting trace…':'Trace sharing off');
    void previousTrace?.dispose();void nextTrace.connect(p.shareTrace,p.seed,p.mode);
  }
  async function menu(){run.current.invalidate();beginIntegrationRun();pause(true);screenRef.current='setup';setScreen('setup');setTraceOpen(false);audio.current?.reset();audio.current?.setPaused(true);const previousTrace=trace.current;trace.current=new TraceBridge();void previousTrace?.dispose();setTraceStatus('Trace sharing off');setTraceConsent(false);await sensing.current?.stop();}
  function enableTrace(value:boolean){setTraceConsent(value);if(value)void trace.current?.connect(true,game.seed,game.mode);else{void trace.current?.dispose();trace.current=new TraceBridge();setTraceStatus('Trace sharing off');}}
  const sensorLabel=sensor.source==='simulated'?`SIMULATED · ${sensor.trend}`:sensor.source==='presage'?(sensor.ageMs!==null&&sensor.ageMs>5000?'STALE':sensor.status==='ready'?'LIVE':sensor.status.toUpperCase())+' · '+sensor.trend:'MANUAL · SENSING UNAVAILABLE';
  return <><div className="scene" ref={container}/><div className="scene-vignette"/>{screen==='setup'?<Setup ready={ready} error={sceneError} onStart={begin} onSensor={mode=>void sensing.current?.start(mode)} sensorLabel={`${sensor.hint}${sensor.status==='calibrating'?` · ${Math.floor(sensor.acceptedSeconds)}/30 usable seconds`:''}`}/>:<>
    <HUD game={game} send={send} orders={orders} setOrders={setOrders} muted={muted} setMuted={setMuted} onPause={()=>pause(true)} onJudge={()=>setTraceOpen(v=>!v)} sensorLabel={sensorLabel} trace={traceConsent} setTrace={enableTrace}/>
    {traceOpen&&<aside className="trace-panel"><button className="text-button" onClick={()=>setTraceOpen(false)}>Close ×</button><div className="eyebrow">JUDGE VIEW / DEVELOPMENT TRACE</div><h3>One authority. Every decision visible.</h3><p className="small muted">Only coarse sensing and authored event identifiers are shared. Private challenges and camera frames stay out of the trace.</p><div className="provider-table">{Object.entries({...provider,presage:sensorLabel,convex:traceStatus}).map(([k,v])=><div key={k}><span>{k.toUpperCase()}</span><b>{v}</b></div>)}</div><p className="small">Tactic: {game.director.lastTactic} · {game.director.source}<br/>Outcome: {game.director.lastOutcome}<br/>Evidence: {game.director.lastEvidenceIds.join(', ')||'none'}</p><label><input type="checkbox" checked={traceConsent} onChange={e=>enableTrace(e.target.checked)}/> Consent to sanitized trace sharing</label><div className="modal-actions"><button disabled={!traceConsent} onClick={()=>{const url=trace.current?.judgeUrl();if(url)window.open(url,'_blank','noopener');}}>Open second screen ↗</button><button onClick={()=>{void trace.current?.deleteSession().then(()=>setTraceStatus('Session deleted')).catch(()=>setTraceStatus('Delete unavailable · retry when connected'));}}>Delete session</button></div><div className="sensor-dev"><div className="eyebrow">SENSOR STATUS</div><p className="small">{sensor.hint}<br/>Quality: {sensor.quality} · age {sensor.ageMs===null?'unavailable':`${Math.round(sensor.ageMs)}ms`}<br/>Baseline: {sensor.baselineBpm?.toFixed(1)??'not calibrated'} · {Math.floor(sensor.acceptedSeconds)}/30 usable seconds</p>{sensor.source==='simulated'&&<label><input type="checkbox" onChange={e=>sensing.current?.setSimulatedElevated(e.target.checked)}/> Simulate sustained +12 BPM (development only)</label>}<button className="text-button" onClick={()=>{const value={...prefsRef.current,sensing:'manual' as const};prefsRef.current=value;setPrefs(value);void sensing.current?.start('manual');}}>Stop capture → manual mode</button></div><h3>Recent events</h3><div className="trace-list">{game.events.slice(-20).reverse().map(e=><div key={e.id}><span>{e.time.toFixed(1)}s</span><b>{e.id} / {e.type}</b><span>{e.detail}</span></div>)}</div><div className="small muted">Models: {view.current?.diagnostics.loadedAssets.length??0}/8 · Clips: {view.current?.diagnostics.animationClips.join(', ')} · Audio: {audio.current?.diagnostics.loadedEffects.length??0}/9</div></aside>}
    {game.paused&&game.status==='playing'&&<div className="modal-shade"><section className="modal" role="dialog" aria-modal="true" aria-label="Shift paused"><div className="eyebrow">RADIO HOLD / GAME TIME FROZEN</div><h2>Take a quiet moment.</h2><p>Power, threats, and tasks are paused. Camera capture has stopped; stale readings are discarded on resume.</p><div className="controls-grid"><span><kbd>1–4</kbd> Select station</span><span><kbd>A D</kbd> Turn stations</span><span><kbd>E</kbd> Hold interaction</span><span><kbd>Q</kbd> Work orders</span><span><kbd>R</kbd> Authenticate</span><span><kbd>Space</kbd> Sweep side</span><span><kbd>J</kbd> Judge trace</span><span><kbd>ESC</kbd> Pause / resume</span></div><p>Mouse: drag the room to look around. Click a task button to begin its timed interaction. Tab reaches every control.</p><label className="volume-row">Master volume<input aria-label="Master volume" type="range" min="0" max="0.7" step="0.05" value={volume} onChange={e=>setVolume(Number(e.target.value))}/>{Math.round(volume/.7*100)}%</label><label className="small"><input type="checkbox" checked={prefs.reducedMotion} onChange={e=>{const value={...prefs,reducedMotion:e.target.checked};setPrefs(value);prefsRef.current=value}}/> Reduced motion</label><button className="primary" onClick={()=>pause(false)}>Resume shift <span>↗</span></button><div className="modal-actions"><button onClick={()=>void begin(prefs)}>Restart same seed</button><button onClick={()=>void menu()}>Return to desk</button></div></section></div>}
    {game.status!=='playing'&&<div className="modal-shade"><section className="modal" role="dialog" aria-label="Shift results"><div className="eyebrow">STATION 04 / SHIFT REPORT</div><div className="result-mark">{game.status==='won'?'↗':'⊘'}</div><h2>{game.status==='won'?'Signal received.':'The line went quiet.'}</h2><p>{game.status==='won'?'Three operations complete. The transmission is safe. Leave the radio on the desk.':game.lossReason}</p><div className="result-stats"><div><strong>{Math.min(3,game.tasks.stage-1)}/3</strong><span>OPERATIONS</span></div><div><strong>{Math.floor(game.time)}s</strong><span>ELAPSED</span></div><div><strong>{game.fakeRejected}</strong><span>FAKES REJECTED</span></div><div><strong>{Math.ceil(game.energy)}%</strong><span>POWER</span></div></div><p>Seed {game.seed} · {game.mode==='demo'?'Two-minute demo':'Five-minute shift'}<br/>{provider.gemini}<br/>{sensorLabel}</p><button className="primary" onClick={()=>void begin({...prefs,seed:prefs.seed+1})}>Take another shift <span>↗</span></button><div className="modal-actions"><button onClick={()=>void begin(prefs)}>Replay this seed</button><button onClick={()=>void menu()}>Return to desk</button></div></section></div>}
  </>}</>;
}
export default function App(){return location.hash.startsWith('#judge=')?<JudgeView/>:<GameApp/>;}
