import CameraPanel from './CameraPanel';
import type {SensorView} from '../sensing/types';

/** First-start request (once per session): why Presage wants the webcam, then either the real calibration
 * panel or neutral play. Declining stops any capture this prompt started before the game begins. */
export default function CameraPrompt({sensor,stream,desktop,deviceId,onDevice,enabled,onEnable,onStop,onDecline,onStart,onBack}:{sensor:SensorView;stream:MediaStream|null;desktop:boolean;deviceId:string;onDevice:(id:string)=>void;enabled:boolean;onEnable:()=>void;onStop:()=>void;onDecline:()=>void;onStart:()=>void;onBack:()=>void}){
 const canCapture=desktop||typeof navigator!=='undefined'&&!!navigator.mediaDevices?.getUserMedia;
 const calibrated=sensor.source==='presage'&&sensor.baselineBpm!==null;
 return <div className="modal-shade camera-prompt-shade" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();onBack()}}}><section className="modal camera-modal camera-prompt" role="dialog" aria-modal="true" aria-label="Enable your camera">
  <button className="text-button" onClick={onBack}>← Back</button>
  <div className="eyebrow">BEFORE YOU ENTER / PRESAGE PULSE</div>
  <h2>Please enable your camera.</h2>
  <p className="camera-prompt-why">HUSH uses Presage to read your heartbeat and breathing from your webcam. We set up your pulse baseline before the shelter seals: a racing heart bleeds into the heartbeat mask, and a steady one helps you hold calm.</p>
  {!enabled&&<><div className="setup-actions camera-prompt-actions">
   <button className="primary" autoFocus={canCapture} disabled={!canCapture} onClick={onEnable}>Enable camera & set up Presage <span>↗</span></button>
   <button className="camera-decline" autoFocus={!canCapture} onClick={onDecline}>I don’t want to turn on my camera</button>
  </div>
  {!canCapture&&<p className="small camera-prompt-note">Camera pulse sensing needs a browser with webcam support or the desktop app (npm run desktop).</p>}
  <p className="small muted">Your run report charts your pulse and breathing against the scares. Everything stays on this computer, frames are never recorded, and you can stop the camera any time from the ◎ button in game.</p></>}
  {enabled&&<><div className="setup-actions camera-prompt-actions split">
    {!calibrated&&<button onClick={onStart}>Start now · keep calibrating in game</button>}
    <button className="camera-decline" onClick={onDecline}>I don’t want to set up Presage</button>
   </div>
   <CameraPanel sensor={sensor} stream={stream} desktop={canCapture} deviceId={deviceId} onDevice={onDevice} onStart={onEnable} onStop={onStop} onReadyStart={onStart}/></>}
 </section></div>;
}
