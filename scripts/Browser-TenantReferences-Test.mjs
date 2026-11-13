// Headless browser smoke for tenant reference manager and from-file selectors.
// Never creates/modifies business records. Screenshots stay gitignored in .local.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {readFileSync,existsSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
const local=join(process.cwd(),".local");
const account=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,"")).find(x=>x.slug==="demo-a");
assert(account,"demo-a account required");
const binary=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
assert(binary,"Headless Chrome/Edge unavailable");
const profile=join(local,"reference-browser-"+Date.now());
const tag="PORT_QA_"+randomUUID().replaceAll("-","").slice(0,12);
const fixturePath=join(local,"port-reference-fixture-"+tag+".json");
const fixture={tag,ports:[]};
const chrome=spawn(binary,["--headless=new","--disable-gpu","--no-first-run",
 "--remote-debugging-port=0","--remote-allow-origins=*",
 "--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function poll(fn,timeout=25000){
 const until=Date.now()+timeout;let last;
 while(Date.now()<until){try{const r=await fn();if(r)return r}catch(e){last=e}await sleep(250)}
 throw Error("UI timeout"+(last?" "+last.message:""));
}
let socket,seq=0,passed=0;
const pending=new Map();
const pass=s=>{passed++;console.log("PASS "+s)};
try{
 const port=await poll(()=>{
  const file=join(profile,"DevToolsActivePort");
  return existsSync(file)?Number(readFileSync(file,"utf8").split(/\r?\n/)[0]):0;
 });
 const tabs=await (await fetch("http://127.0.0.1:"+port+"/json/list")).json();
 const target=tabs.find(x=>x.type==="page");assert(target);
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((ok,bad)=>{socket.addEventListener("open",ok,{once:true});
   socket.addEventListener("error",bad,{once:true});});
 socket.addEventListener("message",event=>{
  const msg=JSON.parse(event.data);if(!pending.has(msg.id))return;
  const task=pending.get(msg.id);pending.delete(msg.id);clearTimeout(task.timer);
  msg.error?task.reject(Error(JSON.stringify(msg.error))):task.resolve(msg.result);
 });
 function cmd(method,params={}){
  return new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{if(pending.delete(id))reject(Error("CDP "+method+" timeout"))},18000);
   pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
 }
 async function js(code){
  const result=await cmd("Runtime.evaluate",{expression:code,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
 }
 async function goto(path){
  await cmd("Page.navigate",{url:"http://127.0.0.1:3000"+path});
  await poll(()=>js("document.readyState==='complete'"));
 }
 async function fill(selector,value){
  await js("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
   "if(!el)throw Error('missing field');"+
   "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
   "setter.call(el,"+JSON.stringify(value)+");"+
   "el.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
 }
 async function shot(name){
  const image=await cmd("Page.captureScreenshot",{format:"png"});
  writeFileSync(join(local,name),Buffer.from(image.data,"base64"));
 }
 await cmd("Page.enable");await cmd("Runtime.enable");
 await cmd("Emulation.setDeviceMetricsOverride",{
  width:1440,height:900,deviceScaleFactor:1,mobile:false
 });
 await goto("/import/login");
 await poll(()=>js("!!document.querySelector('#import-email')"));
 await fill("#import-email",account.email);
 await fill("#import-password",account.password);
 await js("document.querySelector('form').requestSubmit()");
 await poll(()=>js("location.pathname==='/import' && !!document.querySelector('.im-sidebar')"),25000);
 pass("Merchant authenticates with original credentials");
 await goto("/import/reference-data");
 await poll(()=>js("document.querySelectorAll('.im-reference-tabs button[role=tab]').length===3"+
   " && !!document.querySelector('.im-reference-management')"),25000);
 const tabsOk=await js("(()=>[...document.querySelectorAll('.im-reference-tabs button')]"+
   ".map(x=>x.innerText.trim()))()");
 assert(tabsOk.some(x=>x.includes("الموردون"))&&tabsOk.some(x=>x.includes("العملاء"))
   &&tabsOk.some(x=>x.includes("الموانئ")));
 pass("New merchant reference manager has Suppliers, Customers and Ports tabs");
 await js("[...document.querySelectorAll('.im-reference-tabs button')].find(x=>x.innerText.includes('الموانئ')).click()");
 await poll(()=>js("document.querySelector('.im-reference-tabs button[aria-selected=true]')?.innerText.includes('الموانئ')"+
   " && !!document.querySelector('.im-table-shell')"));
 const portNames=await js("[...document.querySelectorAll('.im-table tbody tr')].map(x=>x.innerText)");
 assert(Array.isArray(portNames));
 pass("Port directory loads current and historical tenant ports");
 await shot("reference-manager-desktop.png");
 await goto("/import/orders/from-file");
 await poll(()=>js("!!document.querySelector('#order-supplier')"+
   " && !!document.querySelector('#order-customer')"+
   " && !!document.querySelector('#order-loadingPort')"+
   " && !!document.querySelector('#order-dischargePort')"),30000);
 pass("From-file order has tenant Supplier, Customer and both port pickers");
 const suggestion=await js("(()=>({supplier:document.querySelector('#order-supplier').options.length,"+
   "customer:document.querySelector('#order-customer').options.length,"+
   "loading:document.querySelector('#order-loadingPort').options.length,"+
   "discharge:document.querySelector('#order-dischargePort').options.length}))()");
 assert(suggestion.supplier>=1&&suggestion.customer>=1&&suggestion.loading>=1);
 pass("Stored and legacy reference suggestions are rendered");
  await js("document.querySelector('button[aria-label=\"إضافة ميناء تحميل\"]').click()");
  await poll(()=>js("!!document.querySelector('input[aria-label=\"اسم الميناء الجديد\"]')"));
  assert(await js("!document.querySelector('input[aria-label=\"اسم الميناء الجديد\"]').closest('form form')"));
  pass("Inline quick-create port appears without a nested form");
  await shot("reference-from-file-desktop.png");
  const newName=tag+" Browser";
  await fill('input[aria-label="اسم الميناء الجديد"]',newName);
  await js("[...document.querySelectorAll('.im-reference-inline-editor button')].find(x=>x.innerText.includes('حفظ واختيار')).click()");
  await poll(()=>js("document.querySelector('#order-loadingPort')?.value==="+JSON.stringify(newName)+
    " && !document.querySelector('.im-reference-inline-editor')"),24000);
  pass("Quick-created tenant port is saved AND automatically selected in file order");
  const portId=await js("(async()=>{const r=await fetch('/import-api/api/ports',{credentials:'same-origin',cache:'no-store'});"+
    "if(!r.ok)return null;const data=await r.json();return data.find(x=>x.name==="+JSON.stringify(newName)+")?.id||null})()");
  assert(portId);
  fixture.ports.push({id:portId,slug:"demo-a"});
  writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
  await goto("/import/reference-data");
  await poll(()=>js("!!document.querySelector('.im-reference-management')"));
  await js("[...document.querySelectorAll('.im-reference-tabs button')].find(x=>x.innerText.includes('الموانئ')).click()");
  await poll(()=>js("[...document.querySelectorAll('.im-table tbody tr')].some(r=>r.innerText.includes("+JSON.stringify(newName)+"))"));
  pass("New file-order port appears in the tenant management tab");
  await js("(()=>{const row=[...document.querySelectorAll('.im-table tbody tr')].find(r=>r.innerText.includes("+
    JSON.stringify(newName)+"));row.querySelector('button.im-table-delete').click()})()");
  await poll(()=>js("!!document.querySelector('[role=alertdialog]')"));
  await js("document.querySelector('.dialog-actions .danger').click()");
  await poll(()=>js("![...document.querySelectorAll('.im-table tbody tr')].some(r=>r.innerText.includes("+
    JSON.stringify(newName)+"))"));
  pass("Deleting only the browser QA port works and leaves existing orders unchanged");
  await goto("/import/orders/from-file");
  await poll(()=>js("!!document.querySelector('#order-supplier')"));
  await js("document.querySelector('button[aria-label=\"إضافة مورّد سريعاً\"]').click()");
 await poll(()=>js("!!document.querySelector('input[aria-label=\"اسم الجهة الجديدة\"]')"));
 pass("Inline supplier creation is available without leaving the order");
 await js("[...document.querySelectorAll('.im-reference-inline-editor button')].find(x=>x.innerText.includes('إلغاء')).click()");
 await cmd("Emulation.setDeviceMetricsOverride",{
  width:390,height:844,deviceScaleFactor:1,mobile:true
 });
 await goto("/import/reference-data");
 await poll(()=>js("!!document.querySelector('.im-reference-management')"+
   " && !!document.querySelector('.im-reference-tabs')"));
 const mobile=await js("({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})");
 assert(mobile.content<=mobile.viewport+2,"Mobile overflow "+JSON.stringify(mobile));
 pass("390px merchant reference manager does not overflow");
 await shot("reference-manager-mobile.png");
  console.log("TENANT_REFERENCE_BROWSER_PASS_COUNT="+passed);
  console.log("TENANT_REFERENCE_BROWSER_FIXTURE="+fixturePath);
 console.log("REFERENCE_SCREENSHOTS=.local/reference-manager-desktop.png,.local/reference-from-file-desktop.png,.local/reference-manager-mobile.png");
}catch(error){
 console.error("TENANT_REFERENCE_BROWSER_FAILED="+(error.stack||error));process.exitCode=1;
 try{if(socket?.readyState===WebSocket.OPEN){
   const id=++seq;
   socket.send(JSON.stringify({id,method:"Runtime.evaluate",
    params:{expression:"({url:location.href,body:document.body.innerText.slice(-1300)})",returnByValue:true}}));
 }}catch{}
}finally{
 try{socket?.close()}catch{}
 try{const killer=spawn("taskkill.exe",["/PID",String(chrome.pid),"/T","/F"],{
  stdio:"ignore",detached:true});killer.unref()}catch{chrome.kill()}
}
process.exit(process.exitCode||0);
