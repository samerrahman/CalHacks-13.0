import test from 'node:test';
import assert from 'node:assert/strict';
import {energyAfter,canProgress,verifyOrder,buildFake,acceptedPulse,classifyWindow,validateProposal,mayBreach} from './rules.mjs';
test('camping cannot progress tasks and exhausts energy',()=>{
 let energy=100;for(let i=0;i<134;i++)energy=energyAfter(energy,2,1);
 assert.equal(energy,0);for(const t of ['sync','cartridge','upload'])assert.equal(canProgress(t,{leftOpen:false,rightOpen:false}),false);
});
test('valid door schedule meets task prerequisites with energy remaining',()=>{
 let e=100;for(const [task,left,right,seconds]of [['sync',true,false,20],['cartridge',true,false,3],['upload',false,true,12]]){
 assert.ok(canProgress(task,{leftOpen:left,rightOpen:right}));e=energyAfter(e,1,seconds);
 }assert.ok(e>90); // Necessary resource check only, NOT a complete game solvability proof.
});
test('paused time consumes no energy and open doors recharge within cap',()=>{
 assert.equal(energyAfter(50,2,300,true),50);assert.equal(energyAfter(99,0,20),100);
});
const truth={orderId:'NR-417',action:'OPEN_LEFT',challengeAnswer:'HARBOR'};
test('all fake kinds have a checkable mismatch even with matching old answer',()=>{
 for(const kind of ['expired','wrong-hatch','challenge']){
 const f=buildFake(truth,kind,'NR-416','HARBOR');assert.ok(!verifyOrder(f,truth).valid);assert.notEqual(f.challengeAnswer,truth.challengeAnswer);
 }assert.ok(verifyOrder(truth,truth).valid);
});
test('live pulse gating rejects stale, simulated, bad quality and unsupported range',()=>{
 const s={source:'presage',quality:'accepted',receivedAtMs:1000,pulseBpm:80};
 assert.equal(acceptedPulse(s,2000),80);assert.equal(acceptedPulse(s,7000),null);
 for(const change of [{source:'simulated'},{quality:'unknown'},{pulseBpm:130},{pulseBpm:NaN}])assert.equal(acceptedPulse({...s,...change},2000),null);
});
test('trend needs sustained accepted data and gaps become unknown',()=>{
 const s=Array.from({length:7},(_,i)=>({source:'presage',quality:'accepted',receivedAtMs:i*2000,pulseBpm:82}));
 assert.equal(classifyWindow(s,70,12000),'ELEVATED');s[3].quality='rejected';assert.equal(classifyWindow(s,70,12000),'UNKNOWN');
});
const p={requestId:'a',stateVersion:5,tactic:'WAIT',evidenceEventIds:['e1']};
const c={requestId:'a',usedRequestIds:new Set(),nowMs:10,expiresAtMs:20,stateVersion:5,allowedTactics:['WAIT'],publicEventIds:new Set(['e1'])};
test('late, duplicated, stale or illegal proposals never commit',()=>{
 assert.equal(validateProposal(p,c),null);
 assert.equal(validateProposal(p,{...c,nowMs:21}),'EXPIRED');
 assert.equal(validateProposal(p,{...c,stateVersion:6}),'STALE_STATE');
 assert.equal(validateProposal(p,{...c,usedRequestIds:new Set(['a'])}),'DUPLICATE');
 assert.equal(validateProposal({...p,tactic:'BREACH'},c),'ILLEGAL_TACTIC');
 assert.equal(validateProposal({...p,evidenceEventIds:['secret']},c),'UNKNOWN_EVIDENCE');
});
test('warning and safe-window/recovery guarantees override a breach',()=>{
 const b={nowMs:20000,thresholdStartedAtMs:10000,safeUntilMs:0,doorOpen:true,recoveryUntilMs:0};
 assert.equal(mayBreach(b),true);
 for(const change of [{safeUntilMs:21000},{recoveryUntilMs:21000},{doorOpen:false},{thresholdStartedAtMs:15000}])assert.equal(mayBreach({...b,...change}),false);
});
