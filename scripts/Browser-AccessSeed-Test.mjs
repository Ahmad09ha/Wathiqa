// Actual Chrome/Edge acceptance test for seeded Trial + Unlimited UI.
// No passwords are logged; screenshots are saved to gitignored .local.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");
const seeds=JSON.parse(readFileSync(join(local,"import-access-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const trial=seeds.find(x=>x.slug==="trial-access");
const unlimited=seeds.find(x=>x.slug==="unlimited-access");
assert(trial?.password&&unlimited?.password);
const executable=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
assert(executable,"Chrome/Edge missing");
const profile=join(local,"browser-seed-"+process.pid+"-"+Date.now());
const browser=spawn(executable,["--headless=new","--disable-gpu","--no-first-run",
 "--remote-debugging-port=0","--remote-allow-origins=*","--user-data-dir="+profile,"about:blank"],
 {stdio:"ignore"});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn,ms=18000){
 const until=Date.now()+ms;let error;
 while(Date.now()<until){
  try{const value=await fn();if(value)return value}catch(e){error=e}
  await sleep(250);
 }
 throw Error("Browser seed test timeout"+(error?": "+error.message:""));
}
let socket,sequence=0,passed=0;
const inflight=new Map();
const pass=label=>{passed++;console.log("PASS "+label)};
try {
 const port=await poll(()=>{
  const file=join(profile,"DevToolsActivePort");
  return existsSync(file)?Number(readFileSync(file,"utf8").split(/\r?\n/)[0]):0;
 });
 const tabs=await poll(async()=>{
  const r=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(1200)});
  return r.ok?await r.json():null;
 });
 const tab=tabs.find(x=>x.type==="page");assert(tab,"Missing headless tab");
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  socket.addEventListener("open",resolve,{once:true});
  socket.addEventListener("error",reject,{once:true});
 });
 socket.addEventListener("message",event=>{
  const data=JSON.parse(event.data);
  if(!data.id||!inflight.has(data.id))return;
  const c=inflight.get(data.id);inflight.delete(data.id);clearTimeout(c.timeout);
  if(data.error)c.reject(Error(JSON.stringify(data.error)));
  else c.resolve(data.result);
 });
 function command(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++sequence,timeout=setTimeout(()=>{
    if(inflight.delete(id))reject(Error("CDP command timeout "+method));
   },16000);
   inflight.set(id,{resolve,reject,timeout});
   socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function evaluate(expression){
  const r=await command("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 }
 async function navigate(url){
  await command("Page.navigate",{url});
  await poll(()=>evaluate("document.readyState==='complete'"));
 }
 async function fill(selector,value){
  const js="(()=>{const e=document.querySelector("+JSON.stringify(selector)+");"+
   "if(!e)throw Error('Missing input');"+
   "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
   "setter.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()";
  await evaluate(js);
 }
 async function shot(name){
  const data=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  writeFileSync(join(local,name),Buffer.from(data.data,"base64"));
 }
 await command("Page.enable");
 await command("Runtime.enable");
 await command("Emulation.setDeviceMetricsOverride",{width:1366,height:840,deviceScaleFactor:1,mobile:false});
 async function loginFromUi(seed){
  await navigate("http://127.0.0.1:3000/import/login");
  await poll(()=>evaluate("(()=>{const f=document.querySelector('.im-login-card');"+
   "if(!f)return false;const k=Object.keys(f).find(x=>x.startsWith('__reactProps$'));return Boolean(k&&f[k]?.onSubmit)})()"));
  await fill("#import-email",seed.email);
  await fill("#import-password",seed.password);
  await evaluate("document.querySelector('.im-login-card').requestSubmit()");
  await poll(()=>evaluate("location.pathname==='/import' && !!document.querySelector('.im-access-type')"),22000);
  return evaluate("(()=>({label:document.querySelector('.im-access-type').textContent.trim(),"+
   "company:document.querySelector('.im-company strong').textContent.trim()}))()");
 }
 const trialUi=await loginFromUi(trial);
 assert(trialUi.label.includes("تجريبي")&&trialUi.label.includes("ينتهي"),JSON.stringify(trialUi));
 pass("Trial Admin authenticates and sees expiry date in Arabic sidebar");
 await shot("wathiqa-access-trial.png");
 await evaluate("document.querySelector('.im-logout').click()");
 await poll(()=>evaluate("location.pathname==='/import/login'"),15000);
 pass("Trial account can sign out");
 const permanentUi=await loginFromUi(unlimited);
 assert(permanentUi.label.includes("حساب دائم")&&permanentUi.label.includes("بدون انتهاء"),
  JSON.stringify(permanentUi));
 assert.notEqual(trialUi.company,permanentUi.company);
 pass("Unlimited Admin authenticates and sees permanent access in Arabic sidebar");
 await shot("wathiqa-access-unlimited.png");
 await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(450);
 const overflow=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
 assert(overflow<=2,"Seeded account sidebar introduced mobile overflow: "+overflow);
 pass("Seed account mobile UI does not overflow");
 console.log("ACCESS_BROWSER_PASS_COUNT="+passed);
 console.log("SCREENSHOTS=.local/wathiqa-access-trial.png,.local/wathiqa-access-unlimited.png");
}catch(error){
 console.error("ACCESS_BROWSER_FAILED",error);
 process.exitCode=1;
}finally{
 try{socket?.close()}catch{}
 try{
  const p=spawn("taskkill.exe",["/PID",String(browser.pid),"/T","/F"],{stdio:"ignore",detached:true});
  p.unref();
 }catch{browser.kill()}
}
process.exit(process.exitCode||0);
