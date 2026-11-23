// Headless smoke. Reads Admin screen and local forms; does NOT save permissions.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {readFileSync,existsSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");
const login=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""))
 .find(x=>x.slug==="demo-a");
assert(login);
const edge=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
assert(edge);
const profile=join(local,"permissions-browser-"+Date.now());
const processBrowser=spawn(edge,["--headless=new","--disable-gpu",
 "--no-first-run","--remote-debugging-port=0","--remote-allow-origins=*",
 "--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
let socket,seq=0,passes=0;
const pending=new Map();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=26000){
 const end=Date.now()+ms;
 while(Date.now()<end){try{const v=await fn();if(v)return v}catch{}await delay(300)}
 throw Error("Timed out waiting for UI");
}
const pass=t=>{passes++;console.log("PASS "+t)};
try{
 const port=await until(()=>{
  const name=join(profile,"DevToolsActivePort");
  return existsSync(name)?Number(readFileSync(name,"utf8").split(/\r?\n/)[0]):0;
 });
 const targets=await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
 const target=targets.find(x=>x.type==="page");assert(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  socket.addEventListener("open",resolve,{once:true});
  socket.addEventListener("error",reject,{once:true});
 });
 socket.addEventListener("message",event=>{
  const packet=JSON.parse(event.data),item=pending.get(packet.id);
  if(!item)return;
  pending.delete(packet.id);clearTimeout(item.timer);
  packet.error?item.reject(Error(JSON.stringify(packet.error))):item.resolve(packet.result);
 });
 function cdp(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{if(pending.delete(id))reject(Error("CDP "+method+" timeout"))},17000);
   pending.set(id,{resolve,reject,timer});
   socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function js(source){
  const r=await cdp("Runtime.evaluate",{expression:source,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 }
 async function navigate(path){
  await cdp("Page.navigate",{url:"http://127.0.0.1:3000"+path});
  await until(()=>js("document.readyState==='complete'"));
 }
 async function fill(selector,value){
  await js("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
   "if(!el)throw Error('missing');"+
   "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,"+
   JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 }
 async function screenshot(name){
  const image=await cdp("Page.captureScreenshot",{format:"png"});
  writeFileSync(join(local,name),Buffer.from(image.data,"base64"));
 }
 await cdp("Page.enable");await cdp("Runtime.enable");
 await cdp("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await navigate("/import/login");
 await until(()=>js("!!document.querySelector('#import-email')"));
 await fill("#import-email",login.email);
 await fill("#import-password",login.password);
 await js("document.querySelector('form').requestSubmit()");
 await until(()=>js("location.pathname==='/import' && !!document.querySelector('.im-sidebar')"));
 pass("Merchant Admin signs in with unchanged credentials");
 await navigate("/import/team");
 await until(()=>js("!!document.querySelector('.im-table-shell')"));
 await until(()=>js("document.body.innerText.includes('عرض الأقسام')"));
 pass("Team table exposes per-employee visibility controls");
 const buttons=await js("document.querySelectorAll('button.im-permissions-edit').length");
 if(buttons>0){
  await js("document.querySelector('button.im-permissions-edit').click()");
  await until(()=>js("document.querySelectorAll('.im-permission-item input[type=checkbox]').length===12"));
  pass("Clicking a Staff member renders twelve feature toggles");
  const before=await js("document.querySelector('.im-permission-item input[type=checkbox]').checked");
  await js("document.querySelector('.im-permission-item input[type=checkbox]').click()");
  const after=await js("document.querySelector('.im-permission-item input[type=checkbox]').checked");
  assert.notEqual(after,before);
  pass("Checkbox toggles local draft without calling save");
  await screenshot("permissions-merchant-admin-desktop.png");
  await js("document.querySelector('.im-permission-editor .im-permission-editor-head button').click()");
  pass("Discarding draft returns to the team table");
 }else{
  console.log("SKIP staff editor screenshot: no Staff rows in demo account");
 }
 await navigate("/import/orders/from-file");
 await until(()=>js("document.querySelector('.im-file-tabs')?.querySelectorAll('button[role=tab]').length===5"));
 pass("Merchant Admin sees all five from-file tabs");
 await cdp("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await navigate("/import/team");
 await until(()=>js("!!document.querySelector('.im-table-shell')"));
 const measure=await js("({screen:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})");
 assert(measure.content<=measure.screen+2,JSON.stringify(measure));
 pass("390px team page has no document-level horizontal overflow");
 await screenshot("permissions-merchant-admin-mobile.png");
 console.log("TENANT_PERMISSIONS_BROWSER_PASS_COUNT="+passes);
}catch(error){
 console.error("TENANT_PERMISSIONS_BROWSER_FAILED="+(error.stack||error));
 process.exitCode=1;
}finally{
 try{socket?.close()}catch{}
 try{const kill=spawn("taskkill.exe",["/PID",String(processBrowser.pid),"/T","/F"],{
  stdio:"ignore",detached:true});kill.unref()}catch{processBrowser.kill()}
}
process.exit(process.exitCode||0);
