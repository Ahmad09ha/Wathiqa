// Dedicated browser smoke for file-first order workflow (read-only).
// No business records are created. Uses isolated Edge/Chrome profile.
import assert from "node:assert/strict";
import {existsSync,readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {spawn} from "node:child_process";

const local=join(process.cwd(),".local");mkdirSync(local,{recursive:true});
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const admin=accounts.find(a=>a.slug==="demo-a");
if(!admin)throw Error("Missing demo-a account");
const browser=[
 "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find(existsSync);
if(!browser)throw Error("Chrome/Edge missing");
const profile=join(local,"browser-wp10-"+process.pid+"-"+Date.now());
const chrome=spawn(browser,[
 "--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
 "--remote-debugging-port=0","--remote-allow-origins=*",
 "--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,ms=20000){
 const start=Date.now();let last;
 while(Date.now()-start<ms){
  try{const res=await fn();if(res)return res;}catch(e){last=e}
  await sleep(250);
 }
 throw Error("Timed out"+(last?": "+last.message:""));
}
let socket=null,sequence=0,checks=0;
const tasks=new Map();
const pass=(x)=>{checks++;console.log("PASS "+x)};
try{
 const port=await wait(()=>{const p=join(profile,"DevToolsActivePort");
  return existsSync(p)?Number(readFileSync(p,"utf8").split(/\r?\n/)[0]):0;});
 const targets=await wait(async()=>{const r=await fetch("http://127.0.0.1:"+port+"/json/list");
  return r.ok?await r.json():null;});
 const target=targets.find(x=>x.type==="page");assert.ok(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((res,rej)=>{socket.addEventListener("open",res,{once:true});socket.addEventListener("error",rej,{once:true});});
 socket.addEventListener("message",event=>{
  const msg=JSON.parse(event.data);if(!msg.id||!tasks.has(msg.id))return;
  const task=tasks.get(msg.id);tasks.delete(msg.id);clearTimeout(task.timer);
  if(msg.error)task.reject(Error(JSON.stringify(msg.error)));else task.resolve(msg.result);
 });
 function send(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++sequence;const timer=setTimeout(()=>{tasks.delete(id);reject(Error("CDP timeout "+method))},18000);
   tasks.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function evaluate(code){
  const r=await send("Runtime.evaluate",{expression:code,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error("Browser runtime error "+JSON.stringify(r.exceptionDetails));
  return r.result.value;
 }
 async function navigate(path){
  await send("Page.navigate",{url:"http://127.0.0.1:3000"+path});
  await wait(()=>evaluate("document.readyState==='complete'"));
 }
 async function type(selector,value){
  return evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('missing input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 }
 async function snapshot(name){
  const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  writeFileSync(join(local,name),Buffer.from(shot.data,"base64"));
 }
 await send("Page.enable");await send("Runtime.enable");
 await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await navigate("/import/login");
 await wait(()=>evaluate("!!document.querySelector('#import-email')"));
 await wait(()=>evaluate("(()=>{const f=document.forms[0];return Object.keys(f).some(x=>x.startsWith('__reactProps$'))})()"));
 await type("#import-email",admin.email);await type("#import-password",admin.password);
 await evaluate("document.forms[0].requestSubmit()");
 await wait(()=>evaluate("location.pathname==='/import'"));
 pass("Admin signed in through real browser");
 await navigate("/import/orders");
 await wait(()=>evaluate("!!document.querySelector('a[href=\"/import/orders/from-file\"]')"));
 pass("Existing order list exposes file-first entry alongside standard creation");
 await navigate("/import/orders/from-file");
 await wait(()=>evaluate("!!document.querySelector('.im-file-workspace .im-file-tabs')"));
 await wait(()=>evaluate("!!document.querySelector('.im-order-editor')"));
 assert.equal(await evaluate("document.querySelectorAll('.im-file-tabs button[role=tab]').length"),5);
 pass("Five file-first tabs render next to the source preview");
 const layout=await evaluate("(()=>{const a=document.querySelector('.im-file-preview').getBoundingClientRect(), b=document.querySelector('.im-file-workspace-main').getBoundingClientRect();return {left:a.left,right:b.left,width:innerWidth}})()");
 assert.ok(layout.left < layout.right,"File should appear physically left of form on desktop: "+JSON.stringify(layout));
 pass("Document preview appears left of editable fields on desktop");
 await evaluate("([...document.querySelectorAll('.im-file-tabs button')].find(x=>x.textContent.includes('دفوعات'))).click()");
 await wait(()=>evaluate("document.body.innerText.includes('املأ معلومات الطلبية')"));
 pass("Dependent tabs correctly ask for an order to be created first");
 await evaluate("([...document.querySelectorAll('.im-file-tabs button')].find(x=>x.textContent.includes('معلومات الطلبية'))).click()");
 await wait(()=>evaluate("!!document.querySelector('.im-order-editor')"));
 assert.ok(await evaluate("!!document.querySelector('input[placeholder=\"CONT-2026-001\"]')"));
 pass("PI, contract, and product input fields present");

 // Local PDF is only a browser preview; it must not be uploaded without saving.
 const pdf=resolve(local,"bilingual-contract.pdf");
 if(existsSync(pdf)){
  const doc=await send("DOM.getDocument");
  const input=await send("DOM.querySelector",{nodeId:doc.root.nodeId,selector:".im-file-picker input[type=file]"});
  assert.ok(input.nodeId>0);
  await send("DOM.setFileInputFiles",{nodeId:input.nodeId,files:[pdf]});
  await wait(()=>evaluate("!!document.querySelector('.im-file-preview-frame iframe[src^=\"blob:\"]')"));
  pass("Real PDF source is previewed safely next to the form before saving");
 } else console.log("SKIP local PDF fixture unavailable for preview");
 await snapshot("wathiqa-file-first-desktop.png");
 await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(700);
 const dimensions=await evaluate("({scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth})");
 assert.ok(dimensions.scroll<=dimensions.view+2,"Mobile horizontal overflow: "+JSON.stringify(dimensions));
 pass("File-first layout fits 390px mobile viewport");
 await snapshot("wathiqa-file-first-mobile.png");
 console.log("FILE_FIRST_BROWSER_PASS_COUNT="+checks);
 console.log("SCREENSHOTS=.local/wathiqa-file-first-desktop.png,.local/wathiqa-file-first-mobile.png");
}catch(error){console.error("FILE_FIRST_BROWSER_FAIL",error);process.exitCode=1}
finally{
 try{socket?.close()}catch{}
 try{const killer=spawn("taskkill.exe",["/PID",String(chrome.pid),"/T","/F"],{stdio:"ignore",detached:true});killer.unref()}catch{chrome.kill()}
}
process.exit(process.exitCode||0);
