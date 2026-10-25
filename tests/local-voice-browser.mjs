// Explicit live-provider smoke: normal visible controls, read-only DOM proof.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
if (!process.argv.includes('--live')) throw new Error('Requires --live');
const result={checkedAt:new Date().toISOString(),application:'HUSH',scope:'Actual Chrome gameplay with Gemini-written monster dialogue through local Vite provider bridge',cameraRequested:false,traceSharingEnabled:false,status:'failed',errors:[],monsterResponses:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('docs/qa',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>result.errors.push(error.message.slice(0,200)));
 page.on('response',async response=>{if(!response.url().endsWith('/api/lock-in/monster'))return;try{const value=await response.json();if(!value.speech)return;result.monsterResponses.push({requestId:value.requestId,caption:value.caption,textSource:value.textSource,textLatencyMs:value.textLatencyMs,textReason:value.textReason??null,textProviderRequestId:value.textProviderRequestId??null,evidenceEventIds:value.evidenceEventIds,totalLatencyMs:value.totalLatencyMs,speech:{source:value.speech.source,latencyMs:value.speech.latencyMs,providerRequestId:value.speech.providerRequestId??null,reason:value.speech.reason??null,bytes:value.speech.audioBase64?Buffer.from(value.speech.audioBase64,'base64').length:0}});}catch{result.errors.push('Invalid contextual dialogue response');}});
 const target=new URL(process.env.HUSH_TEST_URL||'http://127.0.0.1:5174');target.searchParams.set('debug','1');await page.goto(target.href);
 await expect(page.getByRole('button',{name:'Skip guidance & start',exact:true})).toBeEnabled({timeout:20000});
 await expect(page.getByText('Monster speech enabled · ElevenLabs',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Skip guidance & start',exact:true}).click();
 await page.getByRole('dialog',{name:'Enable your camera'}).getByRole('button',{name:/I don’t want to/}).click({timeout:1500}).catch(()=>{});
 await page.getByRole('button',{name:'Skip cutscene →',exact:true}).click();
 await page.keyboard.press('e');
 await expect(page.getByRole('dialog',{name:'Research terminal'})).toBeVisible();
 const machine=page.getByRole('button',{name:'Machine 1',exact:true}); if(await machine.count())await machine.click();
 await page.getByRole('button',{name:'Judge view J',exact:true}).click();
 const audio=page.getByTestId('audio-diagnostics');
 await expect(page.locator('.radio-caption')).toContainText('faults, then the cables',{timeout:6000});
 result.initialInstruction=await page.locator('.radio-caption p').innerText();
 await expect(page.locator('.radio-caption')).toHaveCount(0,{timeout:20000});
 result.initialInstructionCompletedBeforeMonster=true;
 await expect(page.locator('.trace-list')).toContainText('PROXIMITY_ALARM',{timeout:120000});
 await page.keyboard.press('q');
 await expect(page.locator('.trace-list')).toContainText('QUIET_ENTERED');
 await expect.poll(()=>result.monsterResponses.some(value=>value.textSource==='gemini'&&value.speech.source==='elevenlabs'),{timeout:14000}).toBe(true);
 await expect(page.locator('.creature-voice')).toContainText('GEMINI GENERATED',{timeout:30000});
 await expect.poll(()=>result.monsterResponses.some(value=>value.textSource==='gemini'&&value.speech.source==='elevenlabs'),{timeout:1000}).toBe(true);
 const live=result.monsterResponses.find(value=>value.textSource==='gemini'&&value.speech.source==='elevenlabs');
 await expect(page.locator('.creature-voice')).toContainText(live.caption);
 await expect(page.locator('.creature-voice')).toContainText('ELEVENLABS VOICE');
 await expect.poll(async()=>{const state=JSON.parse(await audio.textContent());return state.startedSpeech>=2&&state.decodedSpeech>=2&&state.contextState==='running'&&state.speech==='live';},{timeout:8000}).toBe(true);
 result.caption=await page.locator('.creature-voice').innerText();
 result.audio=JSON.parse(await audio.textContent());
 result.providers=await page.locator('.provider-table').evaluate(element=>Object.fromEntries([...element.querySelectorAll('div')].map(row=>[row.querySelector('span')?.textContent,row.querySelector('b')?.textContent])));
 result.actualMonsterPlayback=true;result.actualGeneratedCaption=live.caption;result.status=result.errors.length?'failed':'passed';
 await page.screenshot({path:'docs/qa/generated-monster-browser.png'});
 await page.keyboard.press('q');await page.keyboard.press('Escape');
}catch(error){result.reason=String(error?.message??error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,400);}
finally{await browser.close();await writeFile('docs/qa/generated-monster-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(result.status!=='passed')process.exitCode=1;}
