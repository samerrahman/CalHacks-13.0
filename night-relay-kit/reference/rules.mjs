// Original reference utilities, deliberately independent of engine/providers.
export const config = Object.freeze({energyMax:100,bothClosedDrain:.75,oneClosedDrain:.20,openRecharge:.35,sweepCost:8,safeWindowMs:12000,staleAfterMs:5000});
export function energyAfter(energy,closedCount,dtSec,paused=false){
  if(!Number.isFinite(energy)||!Number.isFinite(dtSec)||dtSec<0||![0,1,2].includes(closedCount)) throw new Error('Invalid energy input');
  if(paused)return energy;
  const rate=closedCount===2?-config.bothClosedDrain:closedCount===1?-config.oneClosedDrain:config.openRecharge;
  return Math.max(0,Math.min(config.energyMax,energy+rate*dtSec));
}
export function canProgress(task,doors){
  if(task==='sync')return doors.leftOpen||doors.rightOpen;
  if(task==='cartridge')return doors.leftOpen;
  if(task==='upload')return doors.rightOpen;
  return false;
}
export function verifyOrder(message,truth){
  const tells=[];
  if(message.orderId!==truth.orderId)tells.push('ORDER_MISMATCH');
  if(message.action!==truth.action)tells.push('ACTION_MISMATCH');
  if(message.challengeAnswer!==truth.challengeAnswer)tells.push('CHALLENGE_MISMATCH');
  return {valid:tells.length===0,tells};
}
// Caller emits this only when the player inspects the relevant evidence.
export function buildFake(truth,kind,previousOrderId,oldAnswer){
  const fake={...truth};
  if(kind==='expired'){
    if(previousOrderId===truth.orderId)throw new Error('Expired ID must differ');
    fake.orderId=previousOrderId;
  }else if(kind==='wrong-hatch'){
    fake.action=truth.action==='OPEN_LEFT'?'OPEN_RIGHT':'OPEN_LEFT';
  }else if(kind!=='challenge')throw new Error('Unknown tell');
  // All fakes additionally fail an explicit authentication request.
  fake.challengeAnswer=oldAnswer===truth.challengeAnswer?'NO_RESPONSE':oldAnswer;
  if(fake.challengeAnswer===truth.challengeAnswer)fake.challengeAnswer='REFUSED';
  return fake;
}
export function acceptedPulse(sample,nowMs){
  if(!sample||sample.source!=='presage'||sample.quality!=='accepted')return null;
  const age=nowMs-sample.receivedAtMs;
  if(!Number.isFinite(age)||age<0||age>config.staleAfterMs)return null;
  const p=sample.pulseBpm;
  return typeof p==='number'&&Number.isFinite(p)&&p>=40&&p<=110?p:null;
}
// Receive-time trend; native quality normalization is the provider adapter's job.
export function classifyWindow(samples,baselineBpm,nowMs){
  if(!Number.isFinite(baselineBpm))return 'UNKNOWN';
  const recent=samples.filter(s=>s.receivedAtMs>=nowMs-12000&&s.receivedAtMs<=nowMs).sort((a,b)=>a.receivedAtMs-b.receivedAtMs);
  if(recent.length<4||recent.at(-1).receivedAtMs-recent[0].receivedAtMs<10000)return 'UNKNOWN';
  if(acceptedPulse(recent.at(-1),nowMs)===null)return 'UNKNOWN';
  for(let i=0;i<recent.length;i++){
    if(acceptedPulse(recent[i],recent[i].receivedAtMs)===null)return 'UNKNOWN';
    if(i&&recent[i].receivedAtMs-recent[i-1].receivedAtMs>5000)return 'UNKNOWN';
  }
  const deltas=recent.map(s=>s.pulseBpm-baselineBpm);
  if(deltas.every(d=>d>=8))return 'ELEVATED';
  if(deltas.every(d=>d<4))return 'RECOVERED';
  return 'MIXED'; // Application adds 20-second minimum dwell / hysteresis.
}
export function validateProposal(proposal,context){
  if(!proposal||typeof proposal!=='object')return 'BAD_SHAPE';
  if(proposal.requestId!==context.requestId)return 'WRONG_REQUEST';
  if(context.usedRequestIds.has(proposal.requestId))return 'DUPLICATE';
  if(context.nowMs>context.expiresAtMs)return 'EXPIRED';
  if(proposal.stateVersion!==context.stateVersion)return 'STALE_STATE';
  if(!context.allowedTactics.includes(proposal.tactic))return 'ILLEGAL_TACTIC';
  if(!Array.isArray(proposal.evidenceEventIds)||proposal.evidenceEventIds.some(id=>!context.publicEventIds.has(id)))return 'UNKNOWN_EVIDENCE';
  return null;
}
export function mayBreach({nowMs,thresholdStartedAtMs,safeUntilMs,doorOpen,recoveryUntilMs}){
  return doorOpen&&Number.isFinite(thresholdStartedAtMs)&&nowMs-thresholdStartedAtMs>=6000&&nowMs>=safeUntilMs&&nowMs>=recoveryUntilMs;
}
