import { useState } from 'react';
import type { PulseReport as Report } from '../report/analysis';
const labels:Record<string,string>={SCARE:'jump scare',BLACKOUT:'blackout',MISTAKE:'machine error',CLOSE_ENCOUNTER:'close encounter',BREACH_WARNING:'breach warning',LURE_SUCCESS:'lure transmission',QUIET:'equipment isolated',POWER_RESTORED:'power restored',RECOVERY:'you steadied · it lost your trail'};
const PULSE='#c9d9ac',BREATH='#86a8a2',SCARE='#c9553a',CALM='#8fbf8f',EVENT='#d99450',LEFT=38,RIGHT=636,TOP=34,BOTTOM=172;
/** Draw a line that breaks at gaps, pauses and capture segments. */
function trace<T extends {gameMs:number;breakBefore?:boolean}>(rows:T[],x:(t:number)=>number,y:(row:T)=>number){
 return rows.map((row,i)=>`${i===0||row.breakBefore?'M':'L'}${x(row.gameMs).toFixed(1)},${y(row).toFixed(1)}`).join(' ');
}
export default function PulseReport({report}:{report:Report}){
 const[focus,setFocus]=useState<string|null>(null);
 if(report.status==='unrecorded')return <section className="pulse-report"><div className="eyebrow">PULSE RECORDING</div><h3>Physiological statistics unrecorded.</h3><p className="small muted">Pulse recording was off, or no accepted readings were available. Your research results still count.</p></section>;
 const breathing=report.breathing;
 const min=Math.floor(Math.min(report.baselineBpm??70,...report.timeline.map(p=>p.bpm))-4),max=Math.ceil(Math.max(report.baselineBpm??70,...report.timeline.map(p=>p.bpm))+4);
 const bMin=breathing?Math.max(0,Math.floor(Math.min(breathing.restingRpm??breathing.lowestRpm,breathing.lowestRpm)-2)):0,bMax=breathing?Math.ceil(Math.max(breathing.restingRpm??breathing.highestRpm,breathing.highestRpm)+2):1;
 const end=Math.max(1000,...report.timeline.map(p=>p.gameMs),...(breathing?.timeline.map(p=>p.gameMs)??[]),...report.markers.map(e=>e.gameMs));
 const x=(t:number)=>LEFT+t/end*(RIGHT-LEFT),y=(b:number)=>BOTTOM-(b-min)/(max-min)*(BOTTOM-TOP),yb=(r:number)=>BOTTOM-(r-bMin)/Math.max(1,bMax-bMin)*(BOTTOM-TOP);
 const largest=report.largestIncrease;const names=largest?.associatedEventIds.map(id=>labels[report.markers.find(e=>e.id===id)?.type??'']??'event').filter((v,i,a)=>a.indexOf(v)===i);const selected=report.markers.find(e=>e.id===focus);
 const steadied=report.markers.filter(e=>e.type==='RECOVERY').length,scares=report.markers.filter(e=>e.type==='SCARE').length;
 return <section className="pulse-report">
  <div className="eyebrow">{report.status==='simulated'?'SIMULATED DATA · DEVELOPMENT FIXTURE':'RECORDED LIVE · ACCEPTED SAMPLES'}</div>
  <div className="pulse-numbers">
   <div><strong>{report.baselineBpm?.toFixed(0)??'—'}</strong><span>BASELINE BPM</span></div>
   <div><strong>{report.highestBpm?.toFixed(0)??'—'}</strong><span>HIGHEST ACCEPTED BPM</span></div>
   {breathing&&<div><strong>{breathing.restingRpm?.toFixed(0)??'—'}</strong><span>RESTING BREATHS/MIN</span></div>}
   {breathing&&<div><strong>{Math.round(breathing.lowestRpm)}–{Math.round(breathing.highestRpm)}</strong><span>BREATHING RANGE</span></div>}
  </div>
  <div className="report-legend small"><span><i style={{background:PULSE}}/>Pulse (BPM, left)</span>{breathing&&<span><i style={{background:BREATH}}/>Breathing (breaths/min, right)</span>}<span><i className="marker" style={{background:SCARE}}/>Jump scare</span><span><i className="marker" style={{background:CALM}}/>You steadied</span><span><i className="marker"/>Other event</span></div>
  <svg className="pulse-chart" viewBox="0 0 680 205" role="img" aria-label={`Recorded pulse${breathing?' and breathing rate':''} over active game time with event markers. Lines break at missing readings and pauses.`}>
   <line x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} stroke="#445e4c"/>
   <text x="0" y={TOP+4}>{max}</text><text x="0" y={BOTTOM+2}>{min}</text>
   {breathing&&<><text x={RIGHT+8} y={TOP+4} fill={BREATH}>{bMax}</text><text x={RIGHT+8} y={BOTTOM+2} fill={BREATH}>{bMin}</text></>}
   {report.baselineBpm!==null&&<line x1={LEFT} x2={RIGHT} y1={y(report.baselineBpm)} y2={y(report.baselineBpm)} stroke="#73876b" strokeDasharray="4 5"/>}
   {breathing?.restingRpm!=null&&<line x1={LEFT} x2={RIGHT} y1={yb(breathing.restingRpm)} y2={yb(breathing.restingRpm)} stroke={BREATH} strokeOpacity=".45" strokeDasharray="2 6"/>}
   {breathing&&<path d={trace(breathing.timeline,x,row=>yb(row.rpm))} fill="none" stroke={BREATH} strokeWidth="2" strokeDasharray="6 3"/>}
   <path d={trace(report.timeline,x,row=>y(row.bpm))} fill="none" stroke={PULSE} strokeWidth="2.5"/>
   {report.markers.map(e=>{const recovery=e.type==='RECOVERY';return <g key={e.id} tabIndex={0} role="button" aria-label={`${labels[e.type]??e.type} at ${Math.round(e.gameMs/1000)} seconds`} onFocus={()=>setFocus(e.id)} onMouseEnter={()=>setFocus(e.id)} onClick={()=>setFocus(e.id)}>
    <line x1={x(e.gameMs)} x2={x(e.gameMs)} y1="26" y2={BOTTOM} stroke={focus===e.id?'#f0b478':recovery?'#5f8a63':e.type==='SCARE'?'#8a3b2a':'#825b3e'} strokeDasharray="2 4"/>
    <circle cx={x(e.gameMs)} cy="181" r={e.type==='SCARE'?6:5} fill={recovery?CALM:e.type==='SCARE'?SCARE:EVENT}/></g>})}
   <text x={LEFT} y="202">0s</text><text x={RIGHT-30} y="202">{Math.round(end/1000)}s</text>
  </svg>
  <p className="small">{selected?`${labels[selected.type]??selected.type} · ${Math.round(selected.gameMs/1000)}s`:'Focus an event marker to inspect it.'}</p>
  <p>{largest?`The largest recorded increase (${largest.deltaBpm.toFixed(1)} BPM) followed ${largest.clustered?'an event cluster including ':'the '}${names?.join(' and ')}.`:'No supported increase could be associated with an event.'}</p>
  {report.recovery.filter(r=>r.observed).slice(0,3).map(r=><p className="small" key={r.eventId}>Return toward baseline observed {r.elapsedSeconds}s after {labels[report.markers.find(e=>e.id===r.eventId)?.type??'']??'the event'}.</p>)}
  {(scares>0||steadied>0)&&<p className="small">{scares} jump scare{scares===1?'':'s'} marked{steadied>0?` · you steadied ${steadied} time${steadied===1?'':'s'} and it lost your trail`:''}.</p>}
  {breathing&&<p className="small">Breathing: {Math.round(breathing.lowestRpm)}–{Math.round(breathing.highestRpm)} breaths/min across accepted readings{breathing.restingRpm!==null?`, against a resting ${Math.round(breathing.restingRpm)}`:''}. Breathing uses a 30-second average, so it lags events more than pulse.</p>}
  <p className="small muted">Timing association only. Measurement delay, movement, lighting and other events may contribute. Gaps and pauses are excluded; this is not a fear score or a medical measurement.</p>
 </section>;
}
