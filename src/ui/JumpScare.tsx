import {useEffect,useState} from 'react';
export default function JumpScare({scare,soft,reduced}:{scare:{id:number;kind:'impact'|'monitor'|'breach'}|null;soft:boolean;reduced:boolean}){
 const[active,setActive]=useState(false);useEffect(()=>{if(!scare)return;setActive(true);const timer=setTimeout(()=>setActive(false),scare.kind==='breach'?1000:380);return()=>clearTimeout(timer)},[scare?.id]);
 if(!active||!scare)return null;return <div key={scare.id} className={`jump-scare ${scare.kind} ${soft?'soft':''} ${reduced?'still':''}`} data-testid="jump-scare" aria-hidden="true">{scare.kind==='breach'&&!soft&&<img src="/assets/scares/breach-creature.png" alt=""/>}<div className="scare-grain"/></div>
}
