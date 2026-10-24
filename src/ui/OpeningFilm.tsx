import {useEffect,useRef,useState} from 'react';
import {CUTSCENE,captionAt} from '../cutscene/timeline';

/** Pre-rendered opening cutscene (tools/cutscene.mjs render). Plays identically every run;
 * captions come from the same timeline the video was rendered from. */
export default function OpeningFilm({muted,volume,onDone,onFail}:{muted:boolean;volume:number;onDone:()=>void;onFail:()=>void}){
 const video=useRef<HTMLVideoElement>(null),done=useRef(false),[caption,setCaption]=useState('');
 const finish=()=>{if(!done.current){done.current=true;onDone()}};
 // The game's volume slider tops out at .7; map it onto the element's 0..1 range.
 useEffect(()=>{const v=video.current;if(v){v.muted=muted;v.volume=Math.min(1,volume/.7)}},[muted,volume]);
 useEffect(()=>{let frame=0;const tick=()=>{const v=video.current;if(v)setCaption(captionAt(v.currentTime)?.text??'');frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)},[]);
 // Retry muted only for a real autoplay block on a still-mounted film; a skip aborts play() too.
 useEffect(()=>{const v=video.current;if(!v)return;void v.play().catch(e=>{if(done.current||!v.isConnected||e?.name!=='NotAllowedError')return;v.muted=true;void v.play().catch(onFail)});return()=>v.pause()},[]);
 return <main className="opening-film" aria-label="Opening cutscene"><video ref={video} src={CUTSCENE.video} playsInline preload="auto" onEnded={finish} onError={onFail} aria-hidden="true"/><p className="opening-caption" aria-live="polite">{caption}</p><button className="text-button opening-skip" autoFocus onClick={finish}>Skip cutscene →</button></main>;
}
