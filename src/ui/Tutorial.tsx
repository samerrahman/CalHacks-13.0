import { useEffect, useState } from 'react';
import dialogue from '../game/dialogue.json';
/** Each card's text is its authored dialogue line, so the radio voice reads exactly what the card shows. */
const steps=[['fault-box-1','TUTORIAL_FAULT'],['emergency-quiet','TUTORIAL_QUIET'],['sound-caption','TUTORIAL_LISTEN'],['emergency-restore','TUTORIAL_RESTORE'],['replay-sequence','TUTORIAL_MEMORY'],['sequence-buttons','TUTORIAL_REPEAT'],['transmit','TUTORIAL_TRANSMIT']] as const;
const text=(id:string)=>dialogue.lines.find(line=>line.id===id)?.text??'';
/** The dialogue line the card shows now: the terminal prompt until the terminal is open for a terminal step. */
export function tutorialLineId(step:number,inspection:boolean):string{return !inspection&&[0,4,5,6].includes(step)?'TUTORIAL_TERMINAL':steps[step]?.[1]??'TUTORIAL_TRANSMIT'}
export default function Tutorial({step,onSkip,onContinue,inspection,sceneAnchor}:{step:number;onSkip:()=>void;onContinue:()=>void;inspection:boolean;sceneAnchor?:(id:string)=>{x:number;y:number}|null}){
 const id=tutorialLineId(step,inspection),current=[id==='TUTORIAL_TERMINAL'?'use-equipment':steps[step]?.[0]??'transmit',text(id)];
 const[anchor,setAnchor]=useState({x:innerWidth-250,y:innerHeight-300});
 useEffect(()=>{const find=()=>{const inRoom=sceneAnchor?.(current[0]);if(inRoom){setAnchor(inRoom);return}const target=document.querySelector(`[data-tutorial="${current[0]}"]`);if(target){const r=target.getBoundingClientRect();setAnchor({x:r.left+r.width/2,y:r.top+r.height/2})}};find();const timer=setInterval(find,180);window.addEventListener('resize',find);return()=>{clearInterval(timer);window.removeEventListener('resize',find)}},[step,inspection]);
 const left=Math.min(Math.max(18,anchor.x-410),innerWidth-310),top=Math.min(Math.max(100,anchor.y-185),innerHeight-440);
 return <><svg className="tutorial-arrow" aria-hidden="true"><defs><marker id="arrow-tip" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke="#e9b47c" strokeWidth="1.5"/></marker></defs><path d={`M${left+270} ${top+75} Q${(left+270+anchor.x)/2} ${top+20} ${anchor.x} ${anchor.y}`} fill="none" stroke="#e9b47c" strokeWidth="2" markerEnd="url(#arrow-tip)"/></svg><aside className="tutorial-card" style={{left,top}} aria-live="polite"><div className="eyebrow">GUIDED PRACTICE · {step+1} / 7</div><p>{current[1]}</p><small>Threat is paused during practice.</small><div className="tutorial-actions">{step===2&&<button onClick={onContinue}>I heard it →</button>}<button className="text-button" onClick={onSkip}>Skip tutorial</button></div></aside></>;
}
