import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
const root=process.cwd();
const mime={'.html':'text/html','.js':'text/javascript','.png':'image/png','.glb':'model/gltf-binary'};
const server=http.createServer(async(req,res)=>{try{let file=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(file.startsWith('/assets/'))file='/public'+file;const full=path.resolve(root,'.'+file);if(!full.startsWith(root+path.sep))throw Error('Invalid path');const body=await fs.readFile(full);res.setHeader('content-type',mime[path.extname(full)]||'application/octet-stream');res.end(body);}catch{res.statusCode=404;res.end('Not found');}});
server.listen(3014,'127.0.0.1');
if(process.argv.includes('--serve')) {
  console.log('Robot QA: http://127.0.0.1:3014/scripts/prepare-model-qa.html');
} else {
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1800,height:980},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:3014/scripts/prepare-model-qa.html');
await page.waitForFunction(()=>window.qaReady,{timeout:30000});
await page.screenshot({path:'assets-source/automaton-animation-qa.png',fullPage:true});
console.log(JSON.stringify({poses:await page.evaluate(()=>window.qa),errors},null,2));
await browser.close();server.close();
if(errors.length)process.exitCode=1;
}
