import {useEffect,useRef} from 'react';
import type {SensorView} from '../sensing/types';
import PulseMonitor from './PulseMonitor';

export default function CornerVitals({sensor,stream,onOpen}:{sensor:SensorView;stream:MediaStream|null;onOpen:()=>void}){
 const video=useRef<HTMLVideoElement>(null);
 useEffect(()=>{const element=video.current;if(element){element.srcObject=stream;if(stream)void element.play().catch(()=>{});}return()=>{if(element)element.srcObject=null}},[stream]);
 if(sensor.source==='manual')return null;
 return <aside className="corner-vitals" aria-label="Your camera and heartbeat">
  {sensor.source==='presage'&&<div className="corner-camera"><video ref={video} autoPlay muted playsInline aria-label="Your live local camera"/>{!stream&&<span>{sensor.status==='paused'?'CAMERA PAUSED':'CAMERA OFF'}</span>}<small>PERSONAL CAMERA · LOCAL</small></div>}
  <PulseMonitor sensor={sensor} compact onOpen={onOpen}/>
 </aside>
}
