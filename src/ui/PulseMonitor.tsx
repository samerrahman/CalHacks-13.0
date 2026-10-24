import {useRef} from 'react';
import type {SensorView} from '../sensing/types';
import {holdable,holdVital,type HeldVital} from './vitalsHold';
import './vitals-status.css';

/** Live local readout. No synthetic waveform or inferred diagnosis; the only retained value is a briefly held, labelled last accepted reading. */
export default function PulseMonitor({sensor,compact=false,onOpen}:{sensor:SensorView;compact?:boolean;onOpen?:()=>void}){
 const d=sensor.diagnostics,pulseHold=useRef<HeldVital|null>(null),breathHold=useRef<HeldVital|null>(null);
 const usable=sensor.quality==='accepted'&&sensor.pulseBpm!==null&&['calibrating','ready'].includes(sensor.status);
 const key=`${sensor.source}:${sensor.captureSegment}`,now=performance.now(),bridge=holdable(sensor);
 const p=holdVital(pulseHold.current,usable?sensor.pulseBpm:null,now,key,bridge);pulseHold.current=p.held;
 const b=holdVital(breathHold.current,d?.breathing.eligible?d.breathing.bpm:null,now,key,bridge);breathHold.current=b.held;
 const pulse=p.value,breath=b.value,holding=p.heldMs!==null,heldFor=(ms:number)=>`${Math.max(1,Math.round(ms/1000))}s`;
 const breathHint=b.heldMs!==null?`Held · last estimate ${heldFor(b.heldMs)} ago`:breath!==null?'Live breathing estimate':d?.breathingWarmupRemainingSeconds?`Breathing warm-up · ${Math.ceil(d.breathingWarmupRemainingSeconds)}s`:d?.breathing.reasons.join(' · ')||'Waiting for a breathing estimate';
 const simulated=sensor.source==='simulated';
 const state=usable?'SIGNAL ACCEPTED':holding?'SIGNAL INTERRUPTED · HOLDING':sensor.status==='paused'?'CAPTURE PAUSED':sensor.source==='manual'?'CAMERA OFF':d?.warmupRemainingSeconds?'WARMING UP':sensor.status==='unavailable'?'CAPTURE UNAVAILABLE':'ACQUIRING SIGNAL';
 const age=d?.pulse.ageMs??sensor.ageMs;
 const reason=d?.blocker||sensor.hint;
 return <section className={`pulse-monitor ${compact?'compact':''}`} aria-label="Live pulse monitor">
  <div className="vitals-heading"><span>{simulated?'SIMULATED · NOT A LIVE READING':'PERSONAL VITALS'}</span>{onOpen&&<button onClick={onOpen} aria-label="Open pulse monitor settings">↗</button>}</div>
  <div className="vitals-grid"><div className="vital-primary"><span>PULSE</span><strong data-testid="current-pulse" className={holding?'held':''}>{pulse===null?'—':Math.round(pulse)}</strong><small>{holding?`BPM · HELD ${heldFor(p.heldMs!)}`:'BPM'}</small></div><div><span>BREATHING</span><strong data-testid="current-breathing" className={b.heldMs!==null?'held':''}>{breath===null?'—':Math.round(breath)}</strong><small>breaths / min</small></div></div>
  <p className="breathing-signal" data-testid="breathing-status">{breathHint}</p>
  <div className={`vitals-signal ${usable?'accepted':holding?'holding':''}`}><i/>{state}</div>
  <div className="pulse-level"><div><span>Pulse level</span><b>{sensor.baselineBpm===null?'Baseline collecting':`Baseline ${Math.round(sensor.baselineBpm)}`}</b></div><div className="pulse-level-track" role="meter" aria-label="Current pulse level" aria-valuemin={40} aria-valuemax={110} aria-valuenow={pulse??undefined} aria-valuetext={pulse===null?'No accepted reading':`${Math.round(pulse)} beats per minute${holding?`, held from ${heldFor(p.heldMs!)} ago`:''}`}>
   {pulse!==null&&<i className={holding?'held':''} style={{width:`${Math.max(0,Math.min(100,(pulse-40)/70*100))}%`}}/>}{sensor.baselineBpm!==null&&<b className="baseline-marker" style={{left:`${Math.max(0,Math.min(100,(sensor.baselineBpm-40)/70*100))}%`}}/>}</div><small>40 BPM<span>110 BPM</span></small></div>
  {!compact&&<div className="signal-bar"><div><span>Signal confidence</span><b>{d?.pulse.confidence==null?(simulated?'SIMULATED':'WAITING'):`${Math.round(d.pulse.confidence)}%`}</b></div><progress aria-label="Presage signal confidence" max="100" value={d?.pulse.confidence??0}/></div>}
  {compact&&usable&&sensor.baselineBpm!==null&&<p className="baseline-delta">{Math.round(pulse!-sensor.baselineBpm)>0?'+':''}{Math.round(pulse!-sensor.baselineBpm)} BPM from baseline</p>}
  {!compact&&<><dl className="vitals-details"><div><dt>Baseline</dt><dd>{sensor.baselineBpm===null?`${Math.floor(sensor.acceptedSeconds)} / 30 usable seconds`:`${Math.round(sensor.baselineBpm)} BPM`}</dd></div><div><dt>Pulse confidence</dt><dd>{d?.pulse.confidence==null?'—':`${Math.round(d.pulse.confidence)} / 100`}</dd></div><div><dt>Last pulse estimate</dt><dd>{age===null?'Waiting':`${Math.max(0,age/1000).toFixed(1)} seconds ago`}</dd></div><div><dt>Breathing confidence</dt><dd>{d?.breathing.confidence==null?'—':`${Math.round(d.breathing.confidence)} / 100`}</dd></div><div><dt>Last breathing estimate</dt><dd>{d?.breathing.ageMs==null?'Waiting':`${(Math.max(0,d.breathing.ageMs)/1000).toFixed(1)} seconds ago`}</dd></div><div><dt>Baseline trend</dt><dd>{usable&&sensor.baselineBpm!==null?sensor.trend:'Not available yet'}</dd></div></dl>{breath===null&&sensor.source==='presage'&&<p className="small muted">{d?.breathingWarmupRemainingSeconds?`Breathing needs ${Math.ceil(d.breathingWarmupRemainingSeconds)} more seconds of warm-up.`:d?.breathing.reasons.join(' · ')||'Waiting for an accepted breathing estimate.'}</p>}</>}
  {holding&&<p className="vitals-held" data-testid="vitals-held">Reading paused: {reason}. Calibration is kept; hold still and it resumes. Until then the game treats your pulse as neutral.</p>}
  {!(compact&&holding)&&<p className="vitals-hint">{compact?(usable?(simulated?'Development fixture':`Presage · ${sensor.baselineBpm===null?'calibrating baseline':sensor.trend.toLowerCase()}`):reason):'Camera estimates appear only when fresh and accepted. During a brief framing or motion warning the last accepted value stays visible, marked HELD, for up to 15 seconds. Live display stays local; pulse history recording is a separate setting.'}</p>}
 </section>
}
