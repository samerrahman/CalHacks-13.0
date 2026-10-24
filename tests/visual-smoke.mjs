import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto('http://127.0.0.1:5173/');await page.getByRole('button',{name:'Take the night shift'}).waitFor();
await page.screenshot({path:'artifacts/setup.png'});
await page.getByRole('button',{name:'Take the night shift'}).click();
await page.screenshot({path:'artifacts/game-console.png'});
await page.keyboard.press('Escape');
await page.screenshot({path:'artifacts/pause.png'});
console.log(JSON.stringify({title:await page.title(),errors,buttons:await page.getByRole('button').allTextContents()}));
await writeFile('artifacts/visual-smoke.json',JSON.stringify({errors,viewport:{width:1440,height:960}},null,2));
}finally{await browser.close();}
