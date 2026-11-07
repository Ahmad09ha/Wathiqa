// WP-06 real browser test with disposable merchant QA order.
// Records the QA tag in .local for targeted cleanup via Cleanup-ImportLogisticsQa.ps1.
import {spawn} from "node:child_process";
import {readFileSync,writeFileSync,existsSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";

const local=join(process.cwd(),".local");
mkdirSync(local,{recursive:true});
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const admin=accounts.find(a=>a.slug==="demo-a");
if(!admin)throw Error("Missing demo-a QA account");
const tag="WP06_QA_"+randomUUID().replaceAll("-","").slice(0,9);
const logFile=join(local,"logistics-qa-fixtures-"+tag+".json");
const tracking={run:tag,orders:[],companies:[],shipments:[],containers:[]};
function persist(){writeFileSync(logFile,JSON.stringify(tracking,null,2))}
persist();
const base="http://127.0.0.1:5089";
const cookies={};
let token="";
async function api(path,method="GET",body){
 const headers={Cookie:Object.entries(cookies).map(([k,v])=>k+"="+v).join("; ")};
 if(method!=="GET")headers["X-Wathiqa-CSRF"]=token;
 if(body!==undefined)headers["Content-Type"]="application/json";
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 for(const line of r.headers.getSetCookie?.()||[]){
  const m=line.match(/^([^=;]+)=([^;]*)/);if(m)cookies[m[1]]=m[2];
 }
 return {status:r.status,data:r.status===204?null:await r.json()};
}
let r=await api("/api/auth/csrf");token=r.data.token;
r=await api("/api/auth/login","POST",{email:admin.email,password:admin.password});
assert.equal(r.status,200);
r=await api("/api/auth/csrf");token=r.data.token;
r=await api("/api/companies","POST",{name:tag+" QA Supplier",type:"Supplier"});
assert.equal(r.status,201);
tracking.companies.push({tenant:"A",id:r.data.id});persist();
const supplierId=r.data.id;
const orderInput={
 supplierId,customerId:null,supplierRef:tag,orderDate:"2026-11-06",
 incoterm:"FOB",loadingPort:"Ningbo",dischargePort:"Latakia",
 currency:"USD",notes:"Disposable logistics browser QA",revision:null,
 items:[{productType:"POY",denier:"150/48",luster:"SD",grade:"AA",colorType:"Raw White",
  quantity:1000,quantityUnit:"KG",unitPrice:2,priceUnit:"KG",hsCode:"540246"}]
};
r=await api("/api/orders","POST",orderInput);
assert.equal(r.status,201);
const orderId=r.data.id;
tracking.orders.push({tenant:"A",id:orderId});persist();
console.log("QA_ORDER_CREATED="+orderId);

const edge=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
if(!edge)throw Error("Browser missing");
const profile=join(local,"browser-logistics-"+process.pid+"-"+Date.now());
const browser=spawn(edge,["--headless=new","--disable-gpu","--no-first-run",
 "--remote-debugging-port=0","--remote-allow-origins=*","--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn,timeout=18000){
 const until=Date.now()+timeout;let last;
 while(Date.now()<until){try{const value=await fn();if(value)return value}catch(e){last=e}await sleep(220)}
 throw Error("UI did not reach expected state"+(last?": "+last.message:""));
}
let socket,sequence=0,checks=0;
const pending=new Map();
function pass(s){console.log("PASS "+s);checks++}
try{
 const port=await poll(()=>{
  const path=join(profile,"DevToolsActivePort");
  return existsSync(path)?Number(readFileSync(path,"utf8").split(/\r?\n/)[0]):0;
 },18000);
 const pages=await poll(async()=>{
  const res=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(2000)});
  return res.ok?await res.json():null;
 });
 const tab=pages.find(x=>x.type==="page");assert(tab,"No browser page");
 socket=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  socket.addEventListener("open",resolve,{once:true});
  socket.addEventListener("error",reject,{once:true})
 });
 socket.addEventListener("message",event=>{
  const data=JSON.parse(event.data);
  if(!data.id||!pending.has(data.id))return;
  const entry=pending.get(data.id);pending.delete(data.id);
  clearTimeout(entry.timer);
  if(data.error)entry.reject(Error(JSON.stringify(data.error)));
  else entry.resolve(data.result);
 });
 function command(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++sequence;
   const timer=setTimeout(()=>{if(pending.delete(id))reject(Error("CDP timeout "+method))},16000);
   pending.set(id,{resolve,reject,timer});
   socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function evaluate(expression){
  const output=await command("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if(output.exceptionDetails)throw Error("Browser JS exception "+JSON.stringify(output.exceptionDetails));
  return output.result.value;
 }
 async function navigate(url){
  await command("Page.navigate",{url});
  await poll(()=>evaluate("document.readyState==='complete'"),14000);
 }
 async function fill(selector,value){
  await evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('Missing input');"+
   "const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
   "set.call(e,"+JSON.stringify(String(value))+");e.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 }
 async function select(selector,value){
  await evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('Missing select');"+
   "const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;"+
   "set.call(e,"+JSON.stringify(value)+");e.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
 }
 async function click(selector){
  await evaluate("(()=>{const e=document.querySelector("+JSON.stringify(selector)+");if(!e)throw Error('Missing clickable');e.click();return true})()");
 }
 async function shot(name){
  const result=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
  writeFileSync(join(local,name),Buffer.from(result.data,"base64"));
 }
 await command("Page.enable");
 await command("Runtime.enable");
 await command("Emulation.setDeviceMetricsOverride",{width:1360,height:840,deviceScaleFactor:1,mobile:false});
 await navigate("http://127.0.0.1:3000/import/login");
 await poll(()=>evaluate("(()=>{const f=document.querySelector('form');if(!f)return false;const key=Object.keys(f).find(x=>x.startsWith('__reactProps$'));return Boolean(key&&f[key]?.onSubmit)})()"));
 await fill("#import-email",admin.email);
 await fill("#import-password",admin.password);
 await evaluate("document.querySelector('form').requestSubmit()");
 await poll(()=>evaluate("location.pathname==='/import' && document.body.innerText.includes('طلبات الشراء')"),20000);
 pass("Real merchant logs in to logistics workspace");
 await navigate("http://127.0.0.1:3000/import/orders/"+orderId);
 await poll(()=>evaluate("!!document.querySelector('.im-logistics') && document.body.innerText.includes('بوالص الشحن')"),18000);
 pass("Purchase Order detail displays logistics section");
 await click(".im-logistics-actions button.btn.primary");
 await poll(()=>evaluate("!!document.querySelector('input[placeholder=\"BL-2026-001\"]')"),9000);
 await fill('input[placeholder="BL-2026-001"]',tag+"-BL-1");
 await evaluate("document.querySelector('.im-logistics>.im-logistics-form').requestSubmit()");
 try{
  await poll(()=>evaluate("!!document.querySelector('.im-logistics-tab') && document.body.innerText.includes("+JSON.stringify((tag+"-BL-1").toUpperCase())+")"),16000);
 }catch(error){
  const state=await evaluate("(()=>({path:location.pathname,forms:[...document.forms].map(x=>({valid:x.checkValidity(),html:x.outerHTML.slice(0,400)})),alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.innerText),text:document.body.innerText.slice(-1500)}))()");
  console.error("BL_UI_DIAG "+JSON.stringify(state));
  await shot("wathiqa-logistics-error.png");
  throw error;
 }
 pass("Create Bill of Lading from order UI");
 await poll(()=>evaluate("(()=>{const btn=document.querySelector('.im-logistics-details-toolbar button');return !!btn&&!btn.disabled})()"),12000);
 await click(".im-logistics-details-toolbar button");
 await poll(()=>evaluate("!!document.querySelector('input[placeholder=\"BL-2026-001\"]')"),8000);
 await fill(".im-logistics>.im-logistics-form input[dir=auto]","MV Wathiqa QA");
 await evaluate("document.querySelector('.im-logistics>.im-logistics-form').requestSubmit()");
 await poll(()=>evaluate("document.querySelector('.im-logistics-meta')?.innerText.includes('MV Wathiqa QA')"),15000);
 pass("Edit B/L metadata without changing owning Order");
 await click(".im-logistics-subhead .btn");
 await poll(()=>evaluate("!!document.querySelector('input[placeholder=\"CSQU3054383\"]')"),8000);
 await fill('input[placeholder="CSQU3054383"]',"CSQU3054383");
 await poll(()=>evaluate("document.body.innerText.includes('رقم التحقق صحيح')"),5000);
 pass("ISO 6346 valid number shows positive feedback");
 await evaluate("document.querySelector('.im-logistics-inner-form').requestSubmit()");
 await poll(()=>evaluate("document.body.innerText.includes('CSQU3054383') && document.querySelectorAll('.im-logistics-table tbody tr').length===1"),16000);
 pass("Create Planned container through Arabic UI");
 await click(".im-logistics-edit-btn");
 await poll(()=>evaluate("!!document.querySelector('input[placeholder=\"CSQU3054383\"]')"),8000);
 await evaluate("(()=>{const e=document.querySelectorAll('.im-logistics-inner-form select')[1];"+
  "if(!e)throw Error('Missing container status select');"+
  "const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;"+
  "set.call(e,'AtSea');e.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
 await evaluate("document.querySelector('.im-logistics-inner-form').requestSubmit()");
  await poll(()=>evaluate("document.querySelector('.im-logistics-table tbody')?.innerText.includes('في البحر')"),16000);
  pass("Container progresses from Planned to AtSea");
  // The row state can render just before the asynchronous save's finally
  // releases `saving`. Wait for the edit control to be usable, not merely
  // visible; a click on a disabled button is intentionally ignored by HTML.
  await poll(()=>evaluate("document.querySelector('.im-logistics-edit-btn')?.disabled===false"),10000);
  await click(".im-logistics-edit-btn");
 await poll(()=>evaluate("!!document.querySelector('input[placeholder=\"CSQU3054383\"]')"));
  await evaluate("(()=>{const e=document.querySelectorAll('.im-logistics-inner-form select')[1];const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(e,'AtPort');e.dispatchEvent(new Event('change',{bubbles:true}));const d=document.querySelectorAll('.im-logistics-inner-form input[type=date]')[0];const ds=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;ds.call(d,'2026-11-19');d.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 await evaluate("document.querySelector('.im-logistics-inner-form').requestSubmit()");
 await poll(()=>evaluate("document.querySelector('.im-logistics-table tbody')?.innerText.includes('في الميناء')"),16000);
 pass("Container advances to AtPort with arrival date");
 await click(".im-logistics-edit-btn");
 await poll(()=>evaluate("!!document.querySelector('input[placeholder=\"CSQU3054383\"]')"));
  await evaluate("(()=>{const e=document.querySelectorAll('.im-logistics-inner-form select')[1];const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(e,'Delivered');e.dispatchEvent(new Event('change',{bubbles:true}));const d=document.querySelectorAll('.im-logistics-inner-form input[type=date]')[1];const ds=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;ds.call(d,'2026-11-21');d.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 await evaluate("document.querySelector('.im-logistics-inner-form').requestSubmit()");
 await poll(()=>evaluate("document.querySelector('.im-logistics-table tbody')?.innerText.includes('مسلّمة') && document.querySelector('.im-logistics-tab')?.innerText.includes('1/1')"),18000);
 pass("Container delivered; B/L rollup displays one of one");
 await evaluate("(()=>{const e=document.querySelectorAll('.im-logistics-customs-head + form select')[1];if(!e)throw Error('Missing customs status field');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(e,'MissingDocs');e.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
 await evaluate("document.querySelector('.im-logistics-customs-head + form').requestSubmit()");
 await poll(()=>evaluate("document.querySelector('.im-logistics-customs-head')?.innerText.includes('مستندات ناقصة')"),16000);
 pass("Save independent customs status for this B/L");
 await evaluate("document.querySelector('.im-logistics-tabs').scrollIntoView({block:'start',behavior:'instant'})");
 await sleep(650);
 await shot("wathiqa-logistics-desktop.png");
 await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(700);
 await evaluate("document.querySelector('.im-logistics-tabs').scrollIntoView({block:'start',behavior:'instant'})");
 await sleep(600);
 const overflow=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
 if(overflow>2)throw Error("Horizontal overflow outside logistics tables: "+overflow);
 await shot("wathiqa-logistics-mobile.png");
 pass("Mobile logistics detail does not overflow viewport");
 console.log("LOGISTICS_BROWSER_PASS_COUNT="+checks);
 console.log("SCREENSHOTS=.local/wathiqa-logistics-desktop.png,.local/wathiqa-logistics-mobile.png");
}catch(e){
 console.error("WP06_BROWSER_FAIL",e);
 process.exitCode=1;
}finally{
 try{socket?.close()}catch{}
 try{
  const cleaner=spawn("taskkill.exe",["/PID",String(browser.pid),"/T","/F"],{stdio:"ignore",detached:true});
  cleaner.unref();
 }catch{browser.kill()}
}
process.exit(process.exitCode||0);
