import {useEffect,useState} from 'react';
import './jumpscare.css';
/** Overlay lifetimes. The breach lunge outlasts the result delay so the run report covers it, never the scene. */
export const SCARE_MS={impact:520,monitor:640,breach:2100} as const;
const FACE='/assets/scares/breach-creature.png';
export default function JumpScare({scare,soft,reduced}:{scare:{id:number;kind:'impact'|'monitor'|'breach'}|null;soft:boolean;reduced:boolean}){
 const[active,setActive]=useState(false);useEffect(()=>{if(!scare)return;setActive(true);const timer=setTimeout(()=>setActive(false),SCARE_MS[scare.kind]);return()=>clearTimeout(timer)},[scare?.id]);
 if(!active||!scare)return null;const lunge=scare.kind==='breach'&&!soft;
 return <div key={scare.id} className={`jump-scare ${scare.kind} ${soft?'soft':''} ${reduced?'still':''}`} data-testid="jump-scare" aria-hidden="true">
  {lunge&&<div className="scare-shake"><div className="scare-face"><img src={FACE} alt=""/>{!reduced&&<><img className="scare-ghost red" src={FACE} alt=""/><img className="scare-ghost cyan" src={FACE} alt=""/>{[0,1,2].map(n=><img key={n} className={`scare-slice s${n}`} src={FACE} alt=""/>)}</>}</div></div>}
  <div className="scare-vignette"/><div className="scare-grain"/>
 </div>
}
