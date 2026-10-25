import {useEffect,useRef,useState} from 'react';
import type {SensorView,SignalName,SignalState} from '../sensing/types';
import type {SensorWaveforms,WaveName,WavePoint} from '../sensing/signals';
import './signals.css';

const SPAN_MS=15_000;
const STATUS:Record<SignalState['status'],string>={ok:'OK',warming:'WARMING',unavailable:'UNAVAILABLE',rejected:'REJECTED',stale:'STALE'};
function draw(canvas:HTMLCanvasElement|null,points:WavePoint[]|undefined,now:number){
 if(!canvas)return;const dpr=Math.min(2,window.devicePixelRatio||1),w=canvas.clientWidth||120,h=canvas.clientHeight||24;
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
 const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const recent=(points??[]).filter(p=>p.t>=now-SPAN_MS&&p.t<=now+1000);if(recent.length<2)return;
 let lo=Infinity,hi=-Infinity;for(const p of recent){lo=Math.min(lo,p.v);hi=Math.max(hi,p.v)}
 const range=hi-lo||1,x=(p:WavePoint)=>(p.t-(now-SPAN_MS))/SPAN_MS*w,y=(p:WavePoint)=>h-2-(p.v-lo)/range*(h-4);
 ctx.lineWidth=1.25;ctx.lineJoin='round';
 for(let i=1;i<recent.length;){const ok=recent[i]!.ok;ctx.strokeStyle=ok?'#d3c7a4':'#5f5949';ctx.beginPath();ctx.moveTo(x(recent[i-1]!),y(recent[i-1]!));
  for(;i<recent.length&&recent[i]!.ok===ok;i++){const p=recent[i]!;if(p.t-recent[i-1]!.t>1500)ctx.moveTo(x(p),y(p));else ctx.lineTo(x(p),y(p))}ctx.stroke()}
}
const pct=(v:number)=>`${Math.round(v*100)}%`;

/** Local readout of every Presage signal with honest status labels. Camera
 * estimates for a game, not medical readings; nothing here is shared. */
export default function VitalsPanel({sensor,waves,initiallyOpen=false}:{sensor:SensorView;waves:{waveforms():SensorWaveforms|null}|null;initiallyOpen?:boolean}){
 const[open,setOpen]=useState(initiallyOpen),canvases=useRef<Partial<Record<WaveName,HTMLCanvasElement|null>>>({});
 const visible=open&&sensor.source!=='manual'&&!!sensor.signals;
 useEffect(()=>{if(!visible)return;const paint=()=>{const w=waves?.waveforms()??null;for(const name of ['chest','abdomen','arterial','eda'] as WaveName[])draw(canvases.current[name]??null,w?.[name],w?.nowMs??performance.now())};paint();const timer=setInterval(paint,100);return()=>clearInterval(timer)},[visible,waves]);
 if(sensor.source==='manual'||!sensor.signals)return null;
 const s=sensor.signals,simulated=sensor.source==='simulated';
 const top=s.expressions?Object.entries(s.expressions).sort((a,b)=>b[1]-a[1])[0]:undefined;
 const rows:[SignalName,string,string,WaveName?][]=[
  ['pulse','Pulse',sensor.pulseBpm===null?'—':`${Math.round(sensor.pulseBpm)} BPM`],
  ['breathing','Breathing rate',s.breathingBpm===null?'—':`${s.breathingBpm} / min`],
  ['chest','Chest movement',s.breathPhase===null?'—':s.breathPhase==='in'?'Breathing in':'Breathing out','chest'],
  ['abdomen','Abdomen movement',s.abdomenShare===null?'—':`${pct(s.abdomenShare)} of breathing`,'abdomen'],
  ['hrv','Heart-rate variability',s.hrv?`RMSSD ${s.hrv.rmssdMs} · SDNN ${s.hrv.sdnnMs} ms`:'—'],
  ['blinking','Blinking',s.blinksPerMinute===null?'—':`${s.blinksPerMinute} / min${s.lastBlinkAgeMs===null?'':` · last ${(s.lastBlinkAgeMs/1000).toFixed(1)} s ago`}`],
  ['talking','Talking',s.talking===null?'—':s.talking?'Talking':'Quiet'],
  ['expressions','Expression',top?`${top[0][0]!.toUpperCase()}${top[0].slice(1)} ${pct(top[1])}${s.fear===null?'':` · fear ${pct(s.fear)}`}`:'—'],
  ['eda','EDA proxy',s.edaRelative===null?'—':`${s.edaRelative>0?'+':''}${s.edaRelative.toFixed(1)} vs your first minute`,'eda'],
  ['arterial','Pulse waveform',s.status.arterial.status==='ok'?'Tracking':'—','arterial'],
 ];
 const okCount=rows.filter(([name])=>s.status[name].status==='ok').length;
 return <aside className={`vitals-panel ${open?'open':''}`} aria-label="All camera signals">
  <button className="vitals-panel-toggle" aria-expanded={open} aria-label={`${simulated?'Simulated':'Camera'} signals: ${okCount} of 10 OK`} onClick={()=>setOpen(!open)}><span>{simulated?'SIMULATED':'SIGNALS'}</span><b>{okCount}/10 OK</b><i>{open?'−':'+'}</i></button>
  {open&&<><ul className="vitals-panel-list">{rows.map(([name,label,value,wave])=>{const state=s.status[name];return <li key={name} className={`sig-${state.status}`} data-signal={name}>
   <div className="sig-head"><span>{label}</span><em title={state.reason||undefined}>{STATUS[state.status]}{state.status==='warming'&&state.secondsLeft?` ${state.secondsLeft}s`:''}</em></div>
   <strong>{value}</strong>
   {wave&&state.status!=='unavailable'&&<canvas ref={el=>{canvases.current[wave]=el}} aria-hidden="true"/>}
   {state.status!=='ok'&&state.reason&&<small>{state.reason}</small>}
  </li>})}</ul>
  <p className="vitals-panel-note">{simulated?'SIMULATED development fixture · not a live reading. ':''}Camera estimates for a game, not medical readings. Shown only here and never sent to the director. With vitals sharing on, spectators get a fear number plus whole-number breathing, strongest expression, blinks and heart-rate variability; never waveforms or the rest.</p></>}
 </aside>
}
