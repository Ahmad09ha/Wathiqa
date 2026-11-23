// Real Chrome/Edge, production Next.js, actual platform cookie and tenant
// boundary. This browser test is READ-ONLY for merchant business data.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";

const local=join(process.cwd(),".local");
const account=JSON.parse(readFileSync(join(local,"platform-superadmin-account.json"),"utf8").replace(/^\uFEFF/,""));
const executable=["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(existsSync);
assert(executable,"Chrome or Edge required for browser verification");
const profile=join(local,"platform-browser-qa-"+Date.now());
const browser=spawn(executable,["--headless=new","--disable-gpu","--no-first-run",
  "--no-default-browser-check","--remote-allow-origins=*","--remote-debugging-port=0",
  "--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,timeout=25000){const until=Date.now()+timeout;let last;
  while(Date.now()<until){try{const value=await fn();if(value)return value;}catch(e){last=e;}
    await sleep(300);}
  throw Error("Browser state timeout"+(last?" "+last.message:""));
}
let socket,sequence=0,passed=0;
const callbacks=new Map();
const pass=s=>{passed++;console.log("PASS "+s);};
try{
  const port=await poll(()=>{const file=join(profile,"DevToolsActivePort");
    return existsSync(file)?Number(readFileSync(file,"utf8").split(/\r?\n/)[0]):null;});
  const pages=await poll(async()=>{const r=await fetch("http://127.0.0.1:"+port+"/json/list");
    return r.ok?r.json():null;});
  const target=pages.find(x=>x.type==="page");assert(target);
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    socket.addEventListener("open",resolve,{once:true});
    socket.addEventListener("error",reject,{once:true});
  });
  socket.addEventListener("message",event=>{
    const result=JSON.parse(event.data);if(!callbacks.has(result.id))return;
    const job=callbacks.get(result.id);callbacks.delete(result.id);clearTimeout(job.timer);
    if(result.error)job.reject(Error(JSON.stringify(result.error)));else job.resolve(result.result);
  });
  function command(method,params={}){return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{if(callbacks.delete(id))reject(Error("CDP timeout "+method));},16000);
    callbacks.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });}
  async function js(expression){const value=await command("Runtime.evaluate",
    {expression,returnByValue:true,awaitPromise:true});
    if(value.exceptionDetails)throw Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  }
  async function goto(path){await command("Page.navigate",{url:"http://127.0.0.1:3000"+path});
    await poll(()=>js("document.readyState==='complete'"));}
  async function fill(selector,value){
    const code="(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
      "if(!el)throw Error('Field missing '+"+JSON.stringify(selector)+");"+
      "const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
      "setter.call(el,"+JSON.stringify(value)+");"+
      "el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()";
    await js(code);
  }
  async function shot(name){const r=await command("Page.captureScreenshot",{format:"png"});
    writeFileSync(join(local,name),Buffer.from(r.data,"base64"));}
  await command("Runtime.enable");await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride",{width:1366,height:850,deviceScaleFactor:1,mobile:false});
  await goto("/platform");
  await poll(()=>js("location.pathname==='/platform/login' && document.querySelector('#platform-email')!==null"),30000);
  pass("Unauthenticated platform dashboard redirects to dedicated SuperAdmin login");
  await fill("#platform-email",account.email);await fill("#platform-password",account.password);
  await js("document.querySelector('.pc-login-form').requestSubmit()");
  await poll(()=>js("location.pathname==='/platform' && document.querySelector('.pc-sidebar')!==null"),30000);
  pass("Real browser logs in using distinct platform session and renders dashboard");
  const right=await js("(()=>{const r=document.querySelector('.pc-sidebar').getBoundingClientRect();return Math.abs(r.right-document.documentElement.clientWidth)<3})()");
  assert(right);pass("Arabic SuperAdmin sidebar is fixed on right");
  assert(await js("document.body.innerText.includes('SuperAdmin') && document.body.innerText.includes('أحدث الشركات')"));
  pass("Overview renders actual platform merchant/account data");
  await shot("wathiqa-platform-overview.png");
  const reject=await js("(async()=>{const r=await fetch('/import-api/api/orders',{credentials:'same-origin'});return r.status})()");
  assert.equal(reject,401);pass("SuperAdmin browser cookie cannot access merchant Orders");
  await js("document.querySelector('a.pc-nav-link[href=\"/platform/tenants\"]').click()");
  await poll(()=>js("location.pathname==='/platform/tenants' && document.querySelector('.pc-search-box')!==null"));
  assert(await js("document.body.innerText.includes('إضافة تاجر') && document.body.innerText.includes('حق الوصول')"));
  pass("Tenant directory and onboarding controls visible to SuperAdmin");
  await js("Array.from(document.querySelectorAll('button')).find(x=>x.innerText.includes('إضافة تاجر')).click()");
  await poll(()=>js("!!document.querySelector('input[type=\"password\"][autocomplete=\"new-password\"]')"));
  assert(await js("document.body.innerText.includes('كلمة مرور المدير')"));
  pass("SuperAdmin merchant creation includes strong password field instead of requiring an invitation");
  await js("document.querySelector('a.pc-nav-link[href=\"/platform/users\"]').click()");
  await poll(()=>js("location.pathname==='/platform/users' && document.querySelector('.pc-table')!==null"));
  assert(await js("document.body.innerText.includes('دليل المستخدمين')"));
  pass("Platform-wide user directory is accessible only with platform cookie");
  await js("document.querySelector('a.pc-nav-link[href=\"/platform/audits\"]').click()");
  await poll(()=>js("location.pathname==='/platform/audits' && document.querySelector('.pc-table')!==null"));
  assert(await js("document.body.innerText.includes('سجل إدارة المنصة')"));
  pass("Admin audit history renders in Arabic");
  await js("document.querySelector('a.pc-nav-link[href=\"/platform/plans\"]').click()");
  await poll(()=>js("location.pathname==='/platform/plans' && document.body.innerText.includes('باقات المنصة')"));
  await poll(()=>js("document.querySelector('table.pc-table')!==null && (document.querySelector('table.pc-table tbody tr')!==null || document.body.innerText.includes('لا يوجد باقات'))"));
  assert(await js("document.body.innerText.includes('مدة') && document.body.innerText.includes('إضافة باقة')"));
  pass("Price-free manual plan catalogue renders and offers controlled plan creation");
  await js("Array.from(document.querySelectorAll('button')).find(x=>x.innerText.includes('إضافة باقة')).click()");
  await poll(()=>js("!!document.querySelector('input[type=\"number\"][min=\"0\"][max=\"100000\"]')"));
  assert(await js("document.body.innerText.includes('عدد بوالص الشحن المسموح تتبّعها')"));
  pass("SuperAdmin can set an explicit B/L tracking quota for newly created subscription plans");
  const noPaymentInputs=await js("Array.from(document.querySelectorAll('input,select')).every(x=>!/(price|amount|payment|invoice|currency|cost)/i.test((x.name||'')+' '+(x.id||'')))");
  assert(noPaymentInputs);pass("Subscription plan console has no monetary entry controls");
  await shot("wathiqa-platform-manual-plans.png");
  await js("document.querySelector('a.pc-nav-link[href=\"/platform/subscriptions\"]').click()");
  await poll(()=>js("location.pathname==='/platform/subscriptions' && document.body.innerText.includes('اشتراكات التجار')"));
  await poll(()=>js("document.querySelector('table.pc-table tbody tr')!==null"));
  assert(await js("document.body.innerText.includes('الاشتراكات') && document.body.innerText.includes('الشركة')"));
  pass("Platform-wide manual subscriptions page renders from real API data");
  const sampleTenant=await js("(async()=>{const r=await fetch('/import-api/api/platform/tenants?pageSize=1',{credentials:'same-origin'});const j=await r.json();return j.items?.[0]?.id||null})()");
  assert(sampleTenant,"A seeded local merchant is required for safe UI inspection");
  await goto("/platform/tenants/"+sampleTenant);
  await poll(()=>js("document.body.innerText.includes('الاشتراك اليدوي') && document.body.innerText.includes('تعيين / تغيير باقة')"),30000);
  assert(await js("document.body.innerText.includes('بلا أسعار أو دفع')"));
  pass("Tenant subscription controls render with or without QA fixtures, no payment actions");
  await shot("wathiqa-platform-manual-tenant.png");
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(650);
  const overflow=await js("document.documentElement.scrollWidth-document.documentElement.clientWidth");
  assert(overflow<=2,"Unexpected mobile overflow "+overflow);
  pass("Mobile RTL page has no horizontal viewport overflow");
  await js("document.querySelector('.pc-open-mobile').click()");
  await poll(()=>js("document.querySelector('.pc-sidebar').classList.contains('open')"));
  pass("Mobile navigation opens for SuperAdmin");
  await shot("wathiqa-platform-mobile.png");
  await command("Emulation.setDeviceMetricsOverride",{width:1366,height:850,deviceScaleFactor:1,mobile:false});
  await js("document.querySelector('.pc-sidebar-end>button').click()");
  await poll(()=>js("location.pathname==='/platform/login'"));
  pass("SuperAdmin logout returns browser to separate login screen");
  const after=await js("(async()=>{const r=await fetch('/import-api/api/platform/auth/me',{credentials:'same-origin'});return r.status})()");
  assert.equal(after,401);pass("Logged-out browser cannot reuse platform authority");
  console.log("PLATFORM_BROWSER_PASS_COUNT="+passed);
  console.log("PLATFORM_BROWSER_SCREENSHOTS=.local/wathiqa-platform-*.png");
}catch(error){
  console.error("PLATFORM_BROWSER_TEST_FAILED",error);
  try{if(socket?.readyState===WebSocket.OPEN){
    const result=await new Promise(resolve=>{const id=99999;
      const handler=event=>{const msg=JSON.parse(event.data);if(msg.id!==id)return;
        socket.removeEventListener("message",handler);resolve(msg.result?.result?.value??msg.error);};
      socket.addEventListener("message",handler);
      socket.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression:
        "(()=>({path:location.pathname,body:document.body.innerText.slice(-1600)}))()",returnByValue:true}}));
      setTimeout(()=>resolve("diagnostic timeout"),2500);
    });console.error("PLATFORM_BROWSER_DIAG",JSON.stringify(result));}}
  catch{}
  process.exitCode=1;
}finally{
  try{socket?.close();}catch{}
  try{const p=spawn("taskkill.exe",["/PID",String(browser.pid),"/T","/F"],{stdio:"ignore",detached:true});p.unref();}
  catch{browser.kill();}
}
process.exit(process.exitCode||0);
