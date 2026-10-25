import type {SensorView} from '../sensing/types';
import {readVitals,sharedVitals} from './vitalsHold';
import './vitals-status.css';

/** Local readout. No synthetic waveform or inferred diagnosis. When the estimate drops out, the last accepted pulse and breathing stay on screen and stop updating (see vitalsHold). */
export default function PulseMonitor({sensor,compact=false,onOpen}:{sensor:SensorView;compact?:boolean;onOpen?:()=>void}){
 const d=sensor.diagnostics,v=readVitals(sharedVitals,sensor),pulse=v.pulse,breath=v.breathing,live=v.pulseLive,shown=pulse!==null;
 const breathHint=breath!==null?(v.breathingLive?'Live breathing estimate':'Breathing estimate'):d?.breathingWarmupRemainingSeconds?`Breathing warm-up · ${Math.ceil(d.breathingWarmupRemainingSeconds)}s`:'Waiting for a breathing estimate';
 const simulated=sensor.source==='simulated',baseline=sensor.baselineBpm;
 const state=sensor.source==='manual'?'CAMERA OFF':sensor.status==='paused'?'CAPTURE PAUSED':shown?(simulated?'SIMULATED SIGNAL':'PRESAGE SIGNAL'):d?.warmupRemainingSeconds?'WARMING UP':sensor.status==='unavailable'?'CAPTURE UNAVAILABLE':'ACQUIRING SIGNAL';
 const age=d?.pulse.ageMs??sensor.ageMs;
 const reason=d?.blocker||sensor.hint;
 return <section className={`pulse-monitor ${compact?'compact':''}`} aria-label="Live pulse monitor">
  <div className="vitals-heading"><span>{simulated?'SIMULATED · NOT A LIVE READING':'PERSONAL VITALS'}</span>{onOpen&&<button onClick={onOpen} aria-label="Open pulse monitor settings">↗</button>}</div>
  <div className="vitals-grid"><div className="vital-primary"><span>PULSE</span><strong data-testid="current-pulse">{pulse===null?'—':Math.round(pulse)}</strong><small>BPM</small></div><div><span>BREATHING</span><strong data-testid="current-breathing">{breath===null?'—':Math.round(breath)}</strong><small>breaths / min</small></div></div>
  <p className="breathing-signal" data-testid="breathing-status">{breathHint}</p>
  <div className={`vitals-signal ${live?'accepted':shown?'steady':''}`}><i/>{state}</div>
  <div className="pulse-level"><div><span>Pulse level</span><b>{baseline===null?'Baseline collecting':`Baseline ${Math.round(baseline)}`}</b></div><div className="pulse-level-track" role="meter" aria-label="Current pulse level" aria-valuemin={40} aria-valuemax={110} aria-valuenow={pulse??undefined} aria-valuetext={pulse===null?'No accepted reading':`${Math.round(pulse)} beats per minute${live?'':', last accepted reading'}`}>
   {pulse!==null&&<i style={{width:`${Math.max(0,Math.min(100,(pulse-40)/70*100))}%`}}/>}{baseline!==null&&<b className="baseline-marker" style={{left:`${Math.max(0,Math.min(100,(baseline-40)/70*100))}%`}}/>}</div><small>40 BPM<span>110 BPM</span></small></div>
  {!compact&&<div className="signal-bar"><div><span>Signal confidence</span><b>{d?.pulse.confidence==null?(simulated?'SIMULATED':'WAITING'):`${Math.round(d.pulse.confidence)}%`}</b></div><progress aria-label="Presage signal confidence" max="100" value={d?.pulse.confidence??0}/></div>}
  {compact&&shown&&baseline!==null&&<p className="baseline-delta">{Math.round(pulse!-baseline)>0?'+':''}{Math.round(pulse!-baseline)} BPM from baseline</p>}
  {!compact&&<><dl className="vitals-details"><div><dt>Baseline</dt><dd>{baseline===null?`${Math.floor(sensor.acceptedSeconds)} / 30 usable seconds`:`${Math.round(baseline)} BPM`}</dd></div><div><dt>Pulse confidence</dt><dd>{d?.pulse.confidence==null?'—':`${Math.round(d.pulse.confidence)} / 100`}</dd></div><div><dt>Last pulse estimate</dt><dd>{age===null?'Waiting':`${Math.max(0,age/1000).toFixed(1)} seconds ago`}</dd></div><div><dt>Breathing confidence</dt><dd>{d?.breathing.confidence==null?'—':`${Math.round(d.breathing.confidence)} / 100`}</dd></div><div><dt>Last breathing estimate</dt><dd>{d?.breathing.ageMs==null?'Waiting':`${(Math.max(0,d.breathing.ageMs)/1000).toFixed(1)} seconds ago`}</dd></div><div><dt>Baseline trend</dt><dd>{baseline!==null&&v.trend!=='UNKNOWN'?v.trend:'Not available yet'}</dd></div></dl>{breath===null&&sensor.source==='presage'&&<p className="small muted">{d?.breathingWarmupRemainingSeconds?`Breathing needs ${Math.ceil(d.breathingWarmupRemainingSeconds)} more seconds of warm-up.`:d?.breathing.reasons.join(' · ')||'Waiting for an accepted breathing estimate.'}</p>}</>}
  <p className="vitals-hint">{compact?(shown?(simulated?'Development fixture':`Presage · ${baseline===null?'calibrating baseline':v.trend==='UNKNOWN'?`baseline ${Math.round(baseline)} BPM`:v.trend.toLowerCase()}`):reason):'Camera estimates update whenever a fresh one is accepted. If the signal drops out (framing, motion, the warm-up after a pause) the last accepted values stay on screen until the next one, and the game treats your pulse as neutral meanwhile. Live display stays local; pulse history recording is a separate setting.'}</p>
 </section>
}
