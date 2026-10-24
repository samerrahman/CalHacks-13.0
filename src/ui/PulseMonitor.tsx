import type {SensorView} from '../sensing/types';

/** Live local readout. No synthetic waveform, inferred diagnosis or retained history. */
export default function PulseMonitor({sensor,compact=false,onOpen}:{sensor:SensorView;compact?:boolean;onOpen?:()=>void}){
 const d=sensor.diagnostics;
 const usable=sensor.quality==='accepted'&&sensor.pulseBpm!==null&&['calibrating','ready'].includes(sensor.status);
 const pulse=usable?sensor.pulseBpm:null;
 const breath=d?.breathing.eligible?d.breathing.bpm:null;
 const simulated=sensor.source==='simulated';
 const state=usable?'SIGNAL ACCEPTED':sensor.status==='paused'?'CAPTURE PAUSED':sensor.source==='manual'?'CAMERA OFF':d?.warmupRemainingSeconds?'WARMING UP':sensor.status==='unavailable'?'CAPTURE UNAVAILABLE':'ACQUIRING SIGNAL';
 const age=d?.pulse.ageMs??sensor.ageMs;
 const reason=d?.blocker||sensor.hint;
 return <section className={`pulse-monitor ${compact?'compact':''}`} aria-label="Live pulse monitor">
  <div className="vitals-heading"><span>{simulated?'SIMULATED · NOT A LIVE READING':'PERSONAL VITALS'}</span>{onOpen&&<button onClick={onOpen} aria-label="Open pulse monitor settings">↗</button>}</div>
  <div className="vitals-grid"><div className="vital-primary"><span>PULSE</span><strong data-testid="current-pulse">{pulse===null?'—':Math.round(pulse)}</strong><small>BPM</small></div><div><span>BREATHING</span><strong data-testid="current-breathing">{breath===null?'—':Math.round(breath)}</strong><small>breaths / min</small></div></div>
  <div className={`vitals-signal ${usable?'accepted':''}`}><i/>{state}</div>
  <div className="pulse-level"><div><span>Pulse level</span><b>{sensor.baselineBpm===null?'Baseline collecting':`Baseline ${Math.round(sensor.baselineBpm)}`}</b></div><div className="pulse-level-track" role="meter" aria-label="Current pulse level" aria-valuemin={40} aria-valuemax={110} aria-valuenow={pulse??undefined} aria-valuetext={pulse===null?'No accepted reading':`${Math.round(pulse)} beats per minute`}>
   {pulse!==null&&<i style={{width:`${Math.max(0,Math.min(100,(pulse-40)/70*100))}%`}}/>}{sensor.baselineBpm!==null&&<b className="baseline-marker" style={{left:`${Math.max(0,Math.min(100,(sensor.baselineBpm-40)/70*100))}%`}}/>}</div><small>40 BPM<span>110 BPM</span></small></div>
  {!compact&&<div className="signal-bar"><div><span>Signal confidence</span><b>{d?.pulse.confidence==null?(simulated?'SIMULATED':'WAITING'):`${Math.round(d.pulse.confidence)}%`}</b></div><progress aria-label="Presage signal confidence" max="100" value={d?.pulse.confidence??0}/></div>}
  {compact&&usable&&sensor.baselineBpm!==null&&<p className="baseline-delta">{Math.round(pulse!-sensor.baselineBpm)>0?'+':''}{Math.round(pulse!-sensor.baselineBpm)} BPM from baseline</p>}
  {!compact&&<><dl className="vitals-details"><div><dt>Baseline</dt><dd>{sensor.baselineBpm===null?`${Math.floor(sensor.acceptedSeconds)} / 30 usable seconds`:`${Math.round(sensor.baselineBpm)} BPM`}</dd></div><div><dt>Pulse confidence</dt><dd>{d?.pulse.confidence==null?'—':`${Math.round(d.pulse.confidence)} / 100`}</dd></div><div><dt>Last pulse estimate</dt><dd>{age===null?'Waiting':`${Math.max(0,age/1000).toFixed(1)} seconds ago`}</dd></div><div><dt>Baseline trend</dt><dd>{usable&&sensor.baselineBpm!==null?sensor.trend:'Not available yet'}</dd></div></dl>{breath===null&&sensor.source==='presage'&&<p className="small muted">{d?.breathingWarmupRemainingSeconds?`Breathing needs ${Math.ceil(d.breathingWarmupRemainingSeconds)} more seconds of warm-up.`:d?.breathing.reasons.join(' · ')||'Waiting for an accepted breathing estimate.'}</p>}</>}
  <p className="vitals-hint">{compact?(usable?(simulated?'Development fixture':`Presage · ${sensor.baselineBpm===null?'calibrating baseline':sensor.trend.toLowerCase()}`):reason):'Camera estimates appear only when fresh and accepted. Live display stays local; pulse history recording is a separate setting.'}</p>
 </section>
}
