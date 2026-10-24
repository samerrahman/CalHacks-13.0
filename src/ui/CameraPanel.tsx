import {useEffect,useRef,useState} from 'react';
import type {SensorView} from '../sensing/types';
import PulseMonitor from './PulseMonitor';

export default function CameraPanel({sensor,stream,onStart,onStop,onDevice,desktop,deviceId,onReadyStart,readyLabel='Start calibrated game →'}:{sensor:SensorView;stream:MediaStream|null;onStart:()=>void;onStop:()=>void;onDevice:(id:string)=>void;desktop:boolean;deviceId:string;onReadyStart?:()=>void;readyLabel?:string}){
 const video=useRef<HTMLVideoElement>(null);
 const[devices,setDevices]=useState<MediaDeviceInfo[]>([]);
 const refresh=()=>{void navigator.mediaDevices?.enumerateDevices().then(list=>setDevices(list.filter(d=>d.kind==='videoinput'))).catch(()=>setDevices([]));};
 useEffect(()=>{refresh();navigator.mediaDevices?.addEventListener('devicechange',refresh);return()=>navigator.mediaDevices?.removeEventListener('devicechange',refresh)},[]);
 useEffect(()=>{const element=video.current;if(element){element.srcObject=stream;if(stream)void element.play().catch(()=>{});}if(stream)refresh();return()=>{if(element)element.srcObject=null}},[stream]);
 const active=!!stream,d=sensor.diagnostics;
 const warming=active&&!!d&&d.warmupRemainingSeconds>0;
 return <section className="camera-calibration" aria-label="Personal camera and pulse calibration">
  <div className="eyebrow">PERSONAL CAMERA / PRESAGE</div>
  <div className="camera-preview"><video ref={video} autoPlay muted playsInline aria-label="Your local mirrored webcam preview"/>
   {!active&&<div className="preview-empty"><span>◎</span><p>{desktop?'Camera off':'Desktop camera required'}</p><small>{desktop?'Enable below to frame your face and upper chest.':'Run npm run desktop to enable Presage.'}</small></div>}
   {active&&<svg className="body-guide" viewBox="0 0 400 225" aria-hidden="true"><ellipse cx="200" cy="66" rx="34" ry="43"/><path d="M170 109L158 126Q109 132 100 162L87 215M230 109L242 126Q291 132 300 162L313 215M111 164H289"/><text x="200" y="199">FACE + UPPER CHEST IN FRAME</text></svg>}
   <span className="preview-label">{active?'CAMERA ON · NOT RECORDED':'CAMERA OFF'}</span>
  </div>
  <label className="camera-device">Camera<select aria-label="Camera device" value={deviceId} onChange={e=>onDevice(e.target.value)}><option value="">System default camera</option>{devices.map((d,i)=><option key={d.deviceId||i} value={d.deviceId}>{d.label||`Camera ${i+1}`}</option>)}</select></label>
  {active&&<p className="small muted">After changing cameras, select Recalibrate to use the selected device.</p>}
  <p className="framing-instruction">Sit back so your whole face, shoulders and upper chest are visible. Keep the camera still and use steady light on your face.</p>
  <div className="calibration-readout"><b>{sensor.source==='presage'?(warming?'WARMING UP':sensor.status.toUpperCase()):'OFF'}</b><span>{Math.floor(sensor.acceptedSeconds)} / 30 usable seconds</span></div>
  <progress aria-label="Pulse baseline calibration" max="30" value={sensor.source==='presage'?sensor.acceptedSeconds:0}/>
  {warming&&<p className="warmup-progress">Pulse warm-up · {Math.ceil(d!.warmupRemainingSeconds)} seconds remaining</p>}
  <p className="camera-guidance" role="status">{sensor.source==='presage'?(d?.blocker||sensor.hint):'Pulse needs a 12-second warm-up, followed by 30 usable seconds for your baseline. Framing or signal warnings pause baseline progress.'}</p>
  <div className="button-row"><button disabled={!desktop||sensor.status==='starting'} onClick={onStart}>{active?'Recalibrate':'Enable camera & calibrate'}</button><button disabled={!active&&sensor.source!=='presage'} onClick={onStop}>Stop camera</button></div>
  {sensor.source==='presage'&&sensor.baselineBpm!==null&&<div className="calibration-ready" role="status"><strong>Baseline calibrated</strong><p>30 usable seconds collected. Your camera and pulse display can continue into the game.</p>{onReadyStart&&<button className="primary" onClick={onReadyStart}>{readyLabel}</button>}</div>}
  {active&&sensor.baselineBpm===null&&<p className="small muted">Keep capture running while you adjust your framing. Recalibrate starts the baseline over.</p>}
  <PulseMonitor sensor={sensor}/>
  {d&&sensor.source==='presage'&&<details className="capture-details"><summary>Capture details</summary><dl className="vitals-details"><div><dt>Camera / processing</dt><dd>{d.captureState} / {d.processingStatus}</dd></div><div><dt>Frames accepted / rejected</dt><dd>{d.framesSentThrough} / {d.framesRejected}</dd></div><div><dt>Frame rate</dt><dd>{d.frameRate===null?'Waiting':`${d.frameRate.toFixed(1)} FPS`}</dd></div><div><dt>Pulse / breathing samples</dt><dd>{d.pulseSamples} / {d.breathingSamples}</dd></div><div><dt>Capture guidance</dt><dd>{d.validationHint||'Waiting for validation'}</dd></div></dl></details>}
  <p className="small muted">The preview and Presage use the same video stream. No frames are saved or sent to the game director. Stop camera releases capture immediately.</p>
 </section>
}
