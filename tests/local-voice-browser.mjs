// Explicit live-provider smoke: normal visible controls, read-only DOM proof.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
if (!process.argv.includes('--live')) throw new Error('Requires --live');
const result={checkedAt:new Date().toISOString(),application:'LOCK IN',scope:'Actual Chrome gameplay through local Vite provider bridge',cameraRequested:false,traceSharingEnabled:false,status:'failed',errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('docs/qa',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',error=>result.errors.push(error.message.slice(0,200)));
 await page.goto('http://127.0.0.1:5174');
 await expect(page.getByRole('button',{name:'Skip guidance & start',exact:true})).toBeEnabled({timeout:20000});
 await expect(page.getByText('Monster speech enabled · ElevenLabs',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Skip guidance & start',exact:true}).click();
 await page.getByRole('button',{name:'Skip opening →',exact:true}).click();
 await page.keyboard.press('e');
 await expect(page.getByRole('dialog',{name:'Research terminal'})).toBeVisible();
 const marked=page.getByRole('button',{name:/^Machine [1-4] FAULT$/}); const count=await marked.count(); if(count)await marked.nth(0).click();
 await page.getByRole('button',{name:'Judge view J',exact:true}).click();
 await expect(page.locator('.creature-voice')).toContainText('I can hear you working.',{timeout:25000});
 const audio=page.getByTestId('audio-diagnostics');
 await expect.poll(async()=>{const state=JSON.parse(await audio.textContent());return state.startedSpeech>=2&&state.decodedSpeech>=2&&state.contextState==='running'&&state.speech==='live';},{timeout:8000}).toBe(true);
 result.caption=await page.locator('.creature-voice').innerText();
 result.audio=JSON.parse(await audio.textContent());
 result.providers=await page.locator('.provider-table').evaluate(element=>Object.fromEntries([...element.querySelectorAll('div')].map(row=>[row.querySelector('span')?.textContent,row.querySelector('b')?.textContent])));
 result.actualMonsterPlayback=true;result.status=result.errors.length?'failed':'passed';
 await page.screenshot({path:'docs/qa/local-api-monster-browser.png'});
 await page.keyboard.press('q');await page.keyboard.press('Escape');
}catch(error){result.reason=String(error?.message??error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,400);}
finally{await browser.close();await writeFile('docs/qa/local-api-monster-browser.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(result.status!=='passed')process.exitCode=1;}
