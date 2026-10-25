import {useEffect,useRef,useState} from 'react';
import type {SensorView} from '../sensing/types';
import {signalCheck} from '../sensing/signalCheck';
import PulseMonitor from './PulseMonitor';
import {useCameraDevices} from './useCameraDevices';
import './signals.css';

export type SharingControls={cameraWanted:boolean;onToggleCamera:(on:boolean)=>void;vitalsShare:boolean;onVitalsConsent:(on:boolean)=>void;shareTrace:boolean;onToggleShareTrace:(on:boolean)=>void};

/** Start-of-game camera check. Shows the controller-owned stream only (never a second camera), the
 * camera picker, the live readouts while calibrating, and what this run shares, all in one place. */
export default function VideoCheck({sensor,stream,desktop,withFriend=false,deviceId='',onDevice,sharing,onEnable,onSimulated,onSkip,onContinue,onBack}:{sensor:SensorView;stream:MediaStream|null;desktop:boolean;withFriend?:boolean;deviceId?:string;onDevice?:(id:string)=>void;sharing?:SharingControls;onEnable:()=>void;onSimulated:()=>void;onSkip:()=>void;onContinue:()=>void;onBack?:()=>void}){
 const cameraWanted=!!sharing?.cameraWanted;
 const canCapture=desktop||typeof navigator!=='undefined'&&!!navigator.mediaDevices?.getUserMedia;
 const video=useRef<HTMLVideoElement>(null),[passed,setPassed]=useState(false),devices=useCameraDevices(stream);
 const check=signalCheck(sensor,canCapture),lost=['failed','needs-camera','needs-desktop'].includes(check.state);
 const checkDone=check.state==='ok'&&(check.simulated||check.calibrated);
 useEffect(()=>{if(checkDone)setPassed(true);else if(lost)setPassed(false)},[checkDone,lost]);
 useEffect(()=>{const element=video.current;if(element){element.srcObject=stream;if(stream)void element.play().catch(()=>{});}return()=>{if(element)element.srcObject=null}},[stream]);
 const ready=checkDone||passed&&!lost,live=!!stream&&sensor.source==='presage';
 const calibrating=live&&check.state==='ok'&&!check.calibrated;
 const browserFriend=withFriend&&!canCapture&&check.state==='needs-desktop';
 const badge=check.state==='ok'?(check.simulated?'SIMULATED':check.calibrated?'SIGNAL OK':`CALIBRATING · ${check.baselineSeconds}/30s`):check.state==='warming'?`WARMING${check.secondsLeft?` · ${check.secondsLeft}s`:''}`:check.state.replace('-',' ').toUpperCase();
 return <main className="video-check" aria-label="Camera signal check"><div className="video-check-card">
  <div className="eyebrow">SIGNAL CHECK / PERSONAL CAMERA</div>
  <h2>Quick camera check</h2>
  <div className="video-check-preview">
   <video ref={video} autoPlay muted playsInline aria-label="Your local mirrored webcam preview"/>
   {!live&&<div className="video-check-empty"><span>◎</span><p>{check.simulated?'SIMULATED · no camera':canCapture?'Camera off':'Desktop app required'}</p></div>}
   {live&&<svg className="video-check-guide" viewBox="0 0 400 225" aria-hidden="true"><ellipse cx="200" cy="72" rx="36" ry="45"/><path d="M168 117L156 133Q108 139 99 168L88 225M232 117L244 133Q292 139 301 168L312 225"/></svg>}
   <span className="video-check-label">{live?'CAMERA ON · NOT RECORDED':check.simulated?'SIMULATED':'CAMERA OFF'}</span>
  </div>
  <div className={`video-check-state state-${check.state}`} role="status" aria-live="polite"><b>{browserFriend?'OPTIONAL CAMERA':badge}</b><strong>{browserFriend?'Let your friend see you':calibrating?'Calibrating Presage baseline':check.title}</strong><p>{browserFriend?'Share live video during the run, or continue without a camera.':check.detail}</p>
   {check.state==='warming'&&!!check.secondsLeft&&<progress aria-label="Pulse warm-up" max={12} value={12-check.secondsLeft}/>}
   {calibrating&&<progress aria-label="Pulse baseline calibration" max={30} value={check.baselineSeconds}/>}
   {check.state==='adjust'&&sensor.diagnostics?.validationHint&&<small>Camera says: {sensor.diagnostics.validationHint}</small>}
  </div>
  {canCapture&&onDevice&&<label className="camera-device">Camera<select aria-label="Camera device" value={deviceId} onChange={e=>onDevice(e.target.value)}><option value="">System default camera</option>{devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select></label>}
  {sensor.source!=='manual'&&<PulseMonitor sensor={sensor} compact/>}
  {sharing&&<fieldset className="video-check-sharing"><legend>Multiplayer & data sharing</legend>
   <label className="check"><input type="checkbox" checked={cameraWanted} disabled={!withFriend||sensor.source==='simulated'} onChange={e=>sharing.onToggleCamera(e.target.checked)}/> Share live webcam video with friend</label>
   <label className="check"><input type="checkbox" checked={sharing.vitalsShare} disabled={!sharing.shareTrace&&!withFriend} onChange={e=>sharing.onVitalsConsent(e.target.checked)}/> Share live emotion, breathing & vitals with spectators</label>
   <label className="check"><input type="checkbox" checked={sharing.shareTrace||withFriend} disabled={withFriend} onChange={e=>sharing.onToggleShareTrace(e.target.checked)}/> Share live shelter trace & puzzle manual</label>
   <p className="small muted">{withFriend?'Playing with a friend always shares the trace and manual.':'Spectators need the trace to follow your run.'} Vitals send your current heart rate, baseline and trend; spectators’ emotion and breathing readouts are estimated from it. Video goes only to your friend.</p>
  </fieldset>}
  <div className="video-check-actions">
   {ready&&<button className="primary" autoFocus onClick={onContinue}>Continue <span>→</span></button>}
   {!ready&&live&&check.state!=='failed'&&<button className="primary" disabled>{calibrating?`Calibrating Presage (${check.baselineSeconds} / 30s)…`:'Waiting for Presage calibration…'}</button>}
   {!ready&&check.state==='needs-camera'&&<button className="primary" autoFocus onClick={onEnable}>Turn on camera <span>◎</span></button>}
   {!ready&&check.state==='failed'&&<button className="primary" autoFocus onClick={onEnable}>Retry camera <span>↻</span></button>}
   {!ready&&check.state==='needs-desktop'&&<><p className="small muted">Camera signal sensing is available in the desktop app.{withFriend?' You can still share live video with your friend in this browser.':''}</p>{withFriend&&<button className="primary" onClick={onContinue}>Continue with live camera <span>→</span></button>}{new URLSearchParams(location.search).has('debug')&&<button onClick={onSimulated}>Use SIMULATED signals</button>}</>}
   <button className="text-button" onClick={onSkip}>Play without camera</button>
   {onBack&&<button className="text-button video-check-back" onClick={onBack}>← Back</button>}
  </div>
  <p className="small muted video-check-note">Camera estimates for a game, not medical readings. {withFriend&&cameraWanted?'Your friend can see your live camera while sharing is on. No camera recording is saved.':'Frames stay on this device and are never saved or shared.'}</p>
 </div></main>
}
