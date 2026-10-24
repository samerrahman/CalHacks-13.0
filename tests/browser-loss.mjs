import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5173');await page.getByRole('button',{name:'Take the night shift'}).click();
await expect(page.locator('.radio-caption')).toContainText('Night operator, this is Mara.');
await page.screenshot({path:'artifacts/final-laptop.png'});
await page.getByRole('button',{name:'Open left shutter',exact:true}).click();
await expect(page.getByRole('heading',{name:'The line went quiet.',exact:true})).toBeVisible({timeout:45000});
const reason=await page.getByRole('dialog',{name:'Shift results'}).innerText();await page.screenshot({path:'artifacts/loss.png'});
await page.getByRole('button',{name:'Replay this seed',exact:true}).click();
await expect(page.getByRole('heading',{name:'Synchronize carrier',exact:true})).toBeVisible();
await expect(page.locator('.top-power strong')).toHaveText('100%');
await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Shift paused'})).toBeVisible();
await writeFile('artifacts/loss-test.json',JSON.stringify({passed:true,reason,restartPassed:true,errors},null,2));console.log(JSON.stringify({passed:true,restartPassed:true,errors}));
}finally{await browser.close();}
