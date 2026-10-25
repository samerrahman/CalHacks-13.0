import { useState } from 'react';
import type { PulseReport as Report } from '../report/analysis';
import { continuousLine, measuredSegment, monotonePath, partialPath, timeTicks, valueAxis, type ChartPoint } from './pulseChart';
const labels:Record<string,string>={SCARE:'jump scare',BLACKOUT:'blackout',MISTAKE:'machine error',CLOSE_ENCOUNTER:'close encounter',BREACH_WARNING:'breach warning',LURE_SUCCESS:'lure transmission',QUIET:'equipment isolated',POWER_RESTORED:'power restored',RECOVERY:'you steadied · it lost your trail'};
const PULSE='#c9d9ac',BREATH='#86a8a2',SCARE='#c9553a',CALM='#8fbf8f',EVENT='#d99450',GRID='#223127',INK='#8d9c84',LEFT=40,RIGHT=628,TOP=16,BOTTOM=176,LANE=196;
/** Big moments get a line through the chart; everything else is a tick in the event lane. */
const MAJOR=new Set(['SCARE','RECOVERY']);
/** Why a run has no chart: the camera was off, or no accepted readings arrived. */
export type EmptyReason='no-camera'|'no-readings';
const EMPTY:Record<EmptyReason,string>={'no-camera':'The camera was off for this run, so there was nothing to chart. Enable it before you start to chart your pulse and breathing against the scares.','no-readings':'The camera was on, but no accepted readings arrived during play. Keep your face and upper chest in frame with steady light; readings pause while the camera cannot see you.'};
export default function PulseReport({report,empty='no-camera',durationMs}:{report:Report;empty?:EmptyReason;durationMs?:number}){
 const[focus,setFocus]=useState<string|null>(null);
 if(report.status==='unrecorded')return <section className="pulse-report"><div className="eyebrow">PULSE RECORDING</div><h3>Physiological statistics unrecorded.</h3><p className="small muted">{EMPTY[empty]} Your research results still count.</p></section>;
 const breathing=report.breathing,largest=report.largestIncrease;
 // One continuous line per signal over the whole run (see pulseChart.ts): bright where readings are measured, dim where gaps are bridged.
 const end=Math.max(1000,durationMs??0,...report.timeline.map(p=>p.gameMs),...(breathing?.timeline.map(p=>p.gameMs)??[]),...report.markers.map(e=>e.gameMs));
 const pulse=continuousLine(report.timeline.map(p=>({gameMs:p.gameMs,value:p.bpm})),end,report.baselineBpm);
 const breath=breathing?continuousLine(breathing.timeline.map(p=>({gameMs:p.gameMs,value:p.rpm})),end,breathing.restingRpm):[];
 const axis=valueAxis([...pulse.map(p=>p.v),...(report.baselineBpm===null?[]:[report.baselineBpm])],3,5),bAxis=breath.length?valueAxis(breath.map(p=>p.v),1,2):null;
 const x=(t:number)=>LEFT+t/end*(RIGHT-LEFT),y=(b:number)=>BOTTOM-(b-axis.min)/(axis.max-axis.min)*(BOTTOM-TOP),yb=(r:number)=>bAxis?BOTTOM-(r-bAxis.min)/(bAxis.max-bAxis.min)*(BOTTOM-TOP):BOTTOM;
 const screen=(points:ChartPoint[],to:(v:number)=>number)=>points.map(p=>({x:x(p.t),y:to(p.v)}));
 const pulsePts=screen(pulse,y),breathPts=screen(breath,yb),peak=report.timeline.reduce<typeof report.timeline[number]|null>((best,p)=>!best||p.bpm>best.bpm?p:best,null);
 const names=largest?.associatedEventIds.map(id=>labels[report.markers.find(e=>e.id===id)?.type??'']??'event').filter((v,i,a)=>a.indexOf(v)===i);const selected=report.markers.find(e=>e.id===focus);
 const steadied=report.markers.filter(e=>e.type==='RECOVERY').length,scares=report.markers.filter(e=>e.type==='SCARE').length;
 return <section className="pulse-report">
  <div className="eyebrow">{report.status==='simulated'?'SIMULATED DATA · DEVELOPMENT FIXTURE':'RECORDED LIVE · ACCEPTED SAMPLES'}</div>
  <div className="pulse-numbers">
   <div><strong>{report.baselineBpm?.toFixed(0)??'—'}</strong><span>BASELINE BPM</span></div>
   <div><strong>{report.highestBpm?.toFixed(0)??'—'}</strong><span>HIGHEST ACCEPTED BPM</span></div>
   {breathing&&<div><strong>{breathing.restingRpm?.toFixed(0)??'—'}</strong><span>RESTING BREATHS/MIN</span></div>}
   {breathing&&<div><strong>{Math.round(breathing.lowestRpm)}–{Math.round(breathing.highestRpm)}</strong><span>BREATHING RANGE</span></div>}
  </div>
  <div className="report-legend small"><span><i style={{background:PULSE}}/>Pulse (BPM)</span>{breathing&&<span><i className="dashed" style={{background:BREATH}}/>Breathing (breaths/min, right)</span>}<span><i className="marker" style={{background:SCARE}}/>Jump scare</span><span><i className="marker" style={{background:CALM}}/>You steadied</span><span><i className="tick"/>Other event</span></div>
  <svg className="pulse-chart" viewBox="0 0 680 236" role="img" aria-label={`Pulse${breathing?' and breathing rate':''} over the whole run with event markers. Bright stretches are measured readings; dim stretches bridge gaps between them.`}>
   <defs><linearGradient id="pulse-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={PULSE} stopOpacity=".26"/><stop offset="1" stopColor={PULSE} stopOpacity="0"/></linearGradient></defs>
   {axis.ticks.map(v=><g key={v}><line x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} stroke={GRID}/><text x={LEFT-7} y={y(v)+3} textAnchor="end" fill={INK}>{v}</text></g>)}
   {bAxis&&[bAxis.min,bAxis.max].map(v=><text key={v} x={RIGHT+7} y={yb(v)+3} fill={BREATH}>{v}</text>)}
   {timeTicks(end).map(tick=><g key={tick.t}><line x1={x(tick.t)} x2={x(tick.t)} y1={BOTTOM} y2={BOTTOM+4} stroke={INK}/><text x={x(tick.t)} y="230" textAnchor="middle" fill={INK}>{tick.label}</text></g>)}
   {report.markers.filter(e=>MAJOR.has(e.type)).map(e=><line key={`line-${e.id}`} x1={x(e.gameMs)} x2={x(e.gameMs)} y1={TOP} y2={LANE} stroke={focus===e.id?'#f0b478':e.type==='SCARE'?SCARE:CALM} strokeOpacity={focus===e.id?.9:.45} strokeWidth="1.2"/>)}
   {pulsePts.length>1&&<path d={`${monotonePath(pulsePts)} L${x(end).toFixed(1)},${BOTTOM} L${x(0).toFixed(1)},${BOTTOM} Z`} fill="url(#pulse-fill)"/>}
   {report.baselineBpm!==null&&<g><line x1={LEFT} x2={RIGHT} y1={y(report.baselineBpm)} y2={y(report.baselineBpm)} stroke="#8a9c7f" strokeOpacity=".7" strokeDasharray="5 5"/><text x={RIGHT-4} y={y(report.baselineBpm)-5} textAnchor="end" fill={INK}>baseline {Math.round(report.baselineBpm)}</text></g>}
   {breathPts.length>1&&<><path d={monotonePath(breathPts)} fill="none" stroke={BREATH} strokeOpacity=".35" strokeWidth="1.6" strokeDasharray="6 4"/><path d={partialPath(breathPts,i=>measuredSegment(breath,i))} fill="none" stroke={BREATH} strokeWidth="1.8" strokeDasharray="6 4"/></>}
   {pulsePts.length>1&&<><path d={monotonePath(pulsePts)} fill="none" stroke={PULSE} strokeOpacity=".42" strokeWidth="2.2" strokeLinecap="round"/><path d={partialPath(pulsePts,i=>measuredSegment(pulse,i))} fill="none" stroke={PULSE} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></>}
   {peak&&<g><circle cx={x(peak.gameMs)} cy={y(peak.bpm)} r="3.5" fill={PULSE}/><text x={x(peak.gameMs)} y={y(peak.bpm)-8} textAnchor="middle" fill={PULSE}>{Math.round(peak.bpm)}</text></g>}
   <line x1={LEFT} x2={RIGHT} y1={BOTTOM} y2={BOTTOM} stroke="#445e4c"/>
   <text x={LEFT-7} y={LANE+3} textAnchor="end" fill={INK} fontSize="8">EVENTS</text>
   {report.markers.map(e=>{const major=MAJOR.has(e.type),color=e.type==='SCARE'?SCARE:e.type==='RECOVERY'?CALM:EVENT,on=focus===e.id;return <g key={e.id} tabIndex={0} role="button" aria-label={`${labels[e.type]??e.type} at ${Math.round(e.gameMs/1000)} seconds`} onFocus={()=>setFocus(e.id)} onMouseEnter={()=>setFocus(e.id)} onClick={()=>setFocus(e.id)}>
    <rect x={x(e.gameMs)-6} y={LANE-10} width="12" height="20" fill="transparent"/>
    {major?<circle cx={x(e.gameMs)} cy={LANE} r={on?6.5:5} fill={color} stroke={on?'#f0b478':'none'} strokeWidth="1.5"/>:<rect x={x(e.gameMs)-1} y={LANE-5} width="2" height="10" fill={on?'#f0b478':color} fillOpacity=".85"/>}</g>})}
  </svg>
  <p className="small">{selected?`${labels[selected.type]??selected.type} · ${Math.round(selected.gameMs/1000)}s`:'Focus an event marker to inspect it.'}</p>
  <p>{largest?`The largest recorded increase (${largest.deltaBpm.toFixed(1)} BPM) followed ${largest.clustered?'an event cluster including ':'the '}${names?.join(' and ')}.`:'No supported increase could be associated with an event.'}</p>
  {report.recovery.filter(r=>r.observed).slice(0,3).map(r=><p className="small" key={r.eventId}>Return toward baseline observed {r.elapsedSeconds}s after {labels[report.markers.find(e=>e.id===r.eventId)?.type??'']??'the event'}.</p>)}
  {(scares>0||steadied>0)&&<p className="small">{scares} jump scare{scares===1?'':'s'} marked{steadied>0?` · you steadied ${steadied} time${steadied===1?'':'s'} and it lost your trail`:''}.</p>}
  {breathing&&<p className="small">Breathing: {Math.round(breathing.lowestRpm)}–{Math.round(breathing.highestRpm)} breaths/min across accepted readings{breathing.restingRpm!==null?`, against a resting ${Math.round(breathing.restingRpm)}`:''}. Breathing uses a 30-second average, so it lags events more than pulse.</p>}
  <p className="small muted">Timing association only. Measurement delay, movement, lighting and other events may contribute. Bright stretches are measured readings; dim stretches only bridge the gaps between them and never enter the numbers. This is not a fear score or a medical measurement.</p>
 </section>;
}
