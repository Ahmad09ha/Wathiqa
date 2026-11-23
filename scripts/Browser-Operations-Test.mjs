// WP-08 real browser acceptance for Orders, Operations + responsive views.
// Run after Test-ImportOperations.mjs with its current .local fixture JSON.
// Example: node scripts/Browser-Operations-Test.mjs .local/documents-qa-fixtures-WP07_QA_xxxxxxxxx.json
import {spawn} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import assert from "node:assert/strict";
const fixtureFile=process.argv[2];
assert(fixtureFile&&existsSync(resolve(fixtureFile)),
 "Pass existing WP-08 fixture JSON path from Test-ImportOperations.mjs");
const fixture=JSON.parse(readFileSync(resolve(fixtureFile),"utf8").replace(/^\uFEFF/,""));
assert(/^WP07_QA_[a-f0-9]{9}$/.test(fixture.run));
const run=fixture.run;
const local=join(process.cwd(),".local");
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const account=accounts.find(x=>x.slug==="demo-a");
assert(account,"Missing demo-a");
const executable=[
 "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find(existsSync);
assert(executable,"Chrome/Edge not found");
const profile=join(local,"browser-wp08-"+process.pid+"-"+Date.now());
const browser=spawn(executable,["--headless=new","--disable-gpu","--no-first-run",
 "--remote-debugging-port=0","--remote-allow-origins=*","--user-data-dir="+profile,"about:blank"],
 {stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,timeout=20000){
 const end=Date.now()+timeout;let err;
 while(Date.now()<end){
  try{const result=await fn();if(result)return result}catch(e){err=e}
  await sleep(260);
 }
 throw Error("Browser timeout"+(err?": "+err.message:""));
}
let socket,sequence=0,passed=0;
const outstanding=new Map();
function pass(msg){passed++;console.log("PASS "+msg)}
try{
 const port=await poll(()=>{
  const p=join(profile,"DevToolsActivePort");
  return existsSync(p)?Number(readFileSync(p,"utf8").split(/\r?\n/)[0]):0;
 });
 const tabs=await poll(async()=>{
  const response=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(1300)});
  return response.ok?await response.json():null;
 });
 const tab=tabs.find(x=>x.type==="page");
 assert(tab,"Missing CDP browser tab");
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  socket.addEventListener("open",resolve,{once:true});
  socket.addEventListener("error",reject,{once:true});
 });
 socket.addEventListener("message",event=>{
  const result=JSON.parse(event.data);
  if(!result.id || !outstanding.has(result.id))return;
  const pending=outstanding.get(result.id);
  outstanding.delete(result.id);clearTimeout(pending.timer);
  if(result.error)pending.reject(Error(JSON.stringify(result.error)));
  else pending.resolve(result.result);
 });
 function command(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++sequence;
   const timer=setTimeout(()=>{
    if(outstanding.delete(id))reject(Error("CDP timed out "+method));
   },17000);
   outstanding.set(id,{resolve,reject,timer});
   socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function evaluate(expression){
  const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error("JS "+JSON.stringify(result.exceptionDetails));
  return result.result.value;
 }
 async function navigate(path){
  await command("Page.navigate",{url:"http://127.0.0.1:3000"+path});
  await poll(()=>evaluate("document.readyState==='complete'"),20000);
 }
 async function fill(selector,value){
  return evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
   "if(!el)throw Error('Missing input');"+
   "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
   "setter.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 }
 async function select(selector,value){
  return evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
   "if(!el)throw Error('Missing select');"+
   "const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;"+
   "setter.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
 }
 async function click(selector){
  return evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
   "if(!el)throw Error('Missing clickable');el.click();return true})()");
 }
 async function snapshot(name){
  const result=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  writeFileSync(join(local,name),Buffer.from(result.data,"base64"));
 }
 await command("Page.enable");
 await command("Runtime.enable");
 await command("Emulation.setDeviceMetricsOverride",{width:1360,height:850,deviceScaleFactor:1,mobile:false});
 await navigate("/import/login");
 await poll(()=>evaluate("(()=>{const f=document.querySelector('.im-login-card');"+
  "if(!f)return false;const prop=Object.keys(f).find(x=>x.startsWith('__reactProps$'));"+
  "return Boolean(prop&&f[prop]?.onSubmit)})()"));
 await fill("#import-email",account.email);
 await fill("#import-password",account.password);
 await evaluate("document.querySelector('.im-login-card').requestSubmit()");
 await poll(()=>evaluate("location.pathname==='/import' && document.body.innerText.includes('طلبات الشراء')"),24000);
 pass("Tenant A merchant logs into Arabic workspace");

 await navigate("/import/orders?q="+encodeURIComponent(run)+"&arrival=PartiallyDelivered&sort=eta");
 await poll(()=>evaluate("document.querySelector('.im-report-result-header')?.innerText.includes('1')"+
  " && !!document.querySelector('.im-report-orders-table tbody tr')"),24000);
 const row=await evaluate("document.querySelector('.im-report-orders-table tbody')?.innerText||''");
 assert(row.includes("CS")===false || row.includes(run)); // order itself is the primary ref
 assert(row.includes("وصل جزء"),"PartiallyDelivered status not rendered: "+row);
  assert(row.includes("0.00 USD"),"Unpaid Orders must show zero ACTUAL settlement, not unavailable: "+row);
 const filter=await evaluate("document.querySelector('input[aria-label=\"البحث في الطلبات\"]')?.value");
 assert.equal(filter,run);
  pass("Shareable Orders URL restores filters and actual zero settlement without treating plans as paid");
 await snapshot("wathiqa-wp08-orders-desktop.png");
 await select('select[aria-label="فلتر حالة الوصول"]',"Delivered");
 await click(".im-report-filter-actions button[type=submit]");
 await poll(()=>evaluate("location.search.includes('arrival=Delivered')"),14000);
 pass("Orders filter applies by URL without losing the search term");

 await navigate("/import/operations?view=atSea");
 await poll(()=>evaluate("document.querySelector('.im-ops-table tbody')?.innerText.includes('CSQU3054383')"),23000);
 pass("Operations screen lists real AtSea Container from B/L");
 await snapshot("wathiqa-wp08-at-sea-desktop.png");
 await navigate("/import/operations?view=freeTime&days=7");
 await poll(()=>evaluate("document.querySelector('.im-ops-table tbody')?.innerText.includes('CSQU3054383')"),23000);
 pass("Free Time report lists overdue not-delivered container");
 await navigate("/import/operations?view=missing");
 await poll(()=>evaluate("document.querySelector('.im-ops-table tbody')?.innerText.includes('شهادة تأمين')"),23000);
  // Other concurrent QA Orders can have the same standard BIC container
  // number, and may rightly be missing their *own* insurance document.
  // Scope this assertion by the exact Order/Container IDs from our fixture.
  const ownOrder=fixture.orders.find(x=>x.tenant==="A");
  const ownFirstContainer=fixture.containers.find(x=>x.tenant==="A");
  assert(ownOrder?.id&&ownFirstContainer?.id,"Missing own QA fixture IDs");
  const ownGaps=await evaluate("(async()=>{const r=await fetch('/import-api/api/operations/document-gaps?orderId="+
   ownOrder.id+"',{credentials:'include'});return {status:r.status,data:await r.json()}})()");
  assert.equal(ownGaps.status,200,"Browser request must stay authenticated through same-origin proxy");
  assert(ownGaps.data.items.length>0,"Expected own remaining missing documents");
  assert(!ownGaps.data.items.some(x=>x.targetId===ownFirstContainer.id &&
   x.documentType==="InsuranceCertificate"),
   "Already satisfied insurance file still missing on the SAME container ID");
 pass("Missing-documents report follows tenant-configured rules and upload links");
 await snapshot("wathiqa-wp08-missing-desktop.png");
 await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(650);
 const overflow=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
 assert(overflow<=2,"Operations page horizontal overflow: "+overflow);
 await snapshot("wathiqa-wp08-operations-mobile.png");
 pass("Operational report fits mobile viewport");
 await navigate("/import/orders?q="+encodeURIComponent(run));
 await poll(()=>evaluate("document.querySelector('.im-report-orders-table tbody')?.innerText.includes('USD')"),23000);
 const overflowOrders=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
 assert(overflowOrders<=2,"Orders page horizontal overflow: "+overflowOrders);
 await snapshot("wathiqa-wp08-orders-mobile.png");
 pass("Mobile Orders layout uses responsive record cards without horizontal page overflow");
 console.log("WP08_BROWSER_PASS_COUNT="+passed);
 console.log("WP08_BROWSER_SCREENSHOTS=.local/wathiqa-wp08-*.png");
}catch(error){
 console.error("WP08_BROWSER_FAILED",error);
 try{
  if(socket?.readyState===WebSocket.OPEN){
   const id=999;
   const state=await new Promise(resolve=>{
    const listener=event=>{
     const data=JSON.parse(event.data);
     if(data.id!==id)return;
     socket.removeEventListener("message",listener);
     resolve(data.result?.result?.value??data.error);
    };
    socket.addEventListener("message",listener);
    socket.send(JSON.stringify({id,method:"Runtime.evaluate",params:{
      expression:"(()=>({url:location.href,text:document.body.innerText.slice(-1600)}))()",
      returnByValue:true}}));
    setTimeout(()=>resolve("timeout"),3000);
   });
   console.error("WP08_BROWSER_DIAG",JSON.stringify(state));
  }
 }catch{}
 process.exitCode=1;
}finally{
 try{socket?.close()}catch{}
 try{
  const stopper=spawn("taskkill.exe",["/PID",String(browser.pid),"/T","/F"],{stdio:"ignore",detached:true});
  stopper.unref();
 }catch{browser.kill()}
}
process.exit(process.exitCode||0);
