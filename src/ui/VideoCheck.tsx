import {useEffect,useRef,useState} from 'react';
import type {SensorView} from '../sensing/types';
import {signalCheck} from '../sensing/signalCheck';
import './signals.css';

/** Start-of-game camera check. Shows the controller-owned stream only (never a second camera). */
export default function VideoCheck({sensor,stream,desktop,onEnable,onSimulated,onSkip,onContinue,onBack}:{sensor:SensorView;stream:MediaStream|null;desktop:boolean;onEnable:()=>void;onSimulated:()=>void;onSkip:()=>void;onContinue:()=>void;onBack?:()=>void}){
 const video=useRef<HTMLVideoElement>(null),[passed,setPassed]=useState(false);
 const check=signalCheck(sensor,desktop),lost=['failed','needs-camera','needs-desktop'].includes(check.state);
 useEffect(()=>{if(check.state==='ok')setPassed(true);else if(lost)setPassed(false)},[check.state,lost]);
 useEffect(()=>{const element=video.current;if(element){element.srcObject=stream;if(stream)void element.play().catch(()=>{});}return()=>{if(element)element.srcObject=null}},[stream]);
 const ready=check.state==='ok'||passed&&!lost,live=!!stream&&sensor.source==='presage';
 const badge=check.state==='ok'?(check.simulated?'SIMULATED':'SIGNAL OK'):check.state==='warming'?`WARMING${check.secondsLeft?` · ${check.secondsLeft}s`:''}`:check.state.replace('-',' ').toUpperCase();
 return <main className="video-check" aria-label="Camera signal check"><div className="video-check-card">
  <div className="eyebrow">SIGNAL CHECK / PERSONAL CAMERA</div>
  <h2>Quick camera check</h2>
  <div className="video-check-preview">
   <video ref={video} autoPlay muted playsInline aria-label="Your local mirrored webcam preview"/>
   {!live&&<div className="video-check-empty"><span>◎</span><p>{check.simulated?'SIMULATED · no camera':desktop?'Camera off':'Desktop app required'}</p></div>}
   {live&&<svg className="video-check-guide" viewBox="0 0 400 225" aria-hidden="true"><ellipse cx="200" cy="72" rx="36" ry="45"/><path d="M168 117L156 133Q108 139 99 168L88 225M232 117L244 133Q292 139 301 168L312 225"/></svg>}
   <span className="video-check-label">{live?'CAMERA ON · NOT RECORDED':check.simulated?'SIMULATED':'CAMERA OFF'}</span>
  </div>
  <div className={`video-check-state state-${check.state}`} role="status" aria-live="polite"><b>{badge}</b><strong>{check.title}</strong><p>{check.detail}</p>
   {check.state==='warming'&&!!check.secondsLeft&&<progress aria-label="Pulse warm-up" max={12} value={12-check.secondsLeft}/>}
   {check.state==='adjust'&&sensor.diagnostics?.validationHint&&<small>Camera says: {sensor.diagnostics.validationHint}</small>}
  </div>
  <div className="video-check-actions">
   {ready&&<button className="primary" autoFocus onClick={onContinue}>Continue <span>→</span></button>}
   {!ready&&check.state==='needs-camera'&&<button className="primary" autoFocus onClick={onEnable}>Turn on camera <span>◎</span></button>}
   {!ready&&check.state==='failed'&&<button className="primary" autoFocus onClick={onEnable}>Retry camera <span>↻</span></button>}
   {!ready&&check.state==='needs-desktop'&&<><p className="small muted">The browser build cannot read Presage signals. Run <kbd>npm run desktop</kbd> for live camera sensing, or try clearly labelled SIMULATED signals.</p><button autoFocus onClick={onSimulated}>Use SIMULATED signals</button></>}
   <button className="text-button" onClick={onSkip}>Play without camera</button>
   {onBack&&<button className="text-button video-check-back" onClick={onBack}>← Back</button>}
  </div>
  <p className="small muted video-check-note">Camera estimates for a game, not medical readings. Frames stay on this device and are never saved or shared.</p>
 </div></main>
}
