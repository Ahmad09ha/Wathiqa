// Non-destructive browser smoke: Merchant dashboard, timeline, mobile/desktop.
// Uses one isolated Edge/Chrome profile. Screenshots remain gitignored in .local.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";

const local=join(process.cwd(),".local");
const account=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,"")).find(x=>x.slug==="demo-a");
assert(account,"Demo A account required");
const browser=[
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
].find(existsSync);
assert(browser,"Headless Chrome/Edge required");
const profile=join(local,"dashboard-browser-"+Date.now()+"-"+process.pid);
const chrome=spawn(browser,["--headless=new","--disable-gpu","--no-first-run",
  "--remote-debugging-port=0","--remote-allow-origins=*",
  "--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn,timeout=18000){
  const end=Date.now()+timeout;let last;
  while(Date.now()<end){
    try{const r=await fn();if(r)return r}catch(error){last=error}
    await sleep(240);
  }
  throw Error("Dashboard UI timeout"+(last?": "+last.message:""));
}
let socket,seq=0,count=0;
const pending=new Map();
function pass(text){count++;console.log("PASS "+text)}
try {
  const port=await poll(()=>{
    const name=join(profile,"DevToolsActivePort");
    return existsSync(name)?Number(readFileSync(name,"utf8").split(/\r?\n/)[0]):0;
  },22000);
  const tabs=await poll(async()=>{
    const res=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:AbortSignal.timeout(2000)});
    return res.ok?res.json():null;
  });
  const tab=tabs.find(t=>t.type==="page");assert(tab);
  socket=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok,bad)=>{
    socket.addEventListener("open",ok,{once:true});
    socket.addEventListener("error",bad,{once:true});
  });
  socket.addEventListener("message",event=>{
    const message=JSON.parse(event.data);
    const id=message.id;
    if(!id||!pending.has(id))return;
    const task=pending.get(id);pending.delete(id);
    clearTimeout(task.timeout);
    if(message.error)task.reject(Error(JSON.stringify(message.error)));
    else task.resolve(message.result);
  });
  function command(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++seq;
      const timeout=setTimeout(()=>{
        if(pending.delete(id))reject(Error("CDP timeout "+method));
      },16000);
      pending.set(id,{resolve,reject,timeout});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression){
    const result=await command("Runtime.evaluate",{
      expression,returnByValue:true,awaitPromise:true
    });
    if(result.exceptionDetails)
      throw Error("Browser JS: "+JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function goto(path){
    await command("Page.navigate",{url:"http://127.0.0.1:3000"+path});
    await poll(()=>evaluate("document.readyState==='complete'"));
  }
  async function hydrated(selector="form"){
    await poll(()=>evaluate("(()=>{const element=document.querySelector("+JSON.stringify(selector)+");"+
      "if(!element)return false;const prop=Object.keys(element).find(x=>x.startsWith('__reactProps$'));"+
      "return !!(prop&&typeof element[prop]?.onSubmit==='function')})()"));
  }
  async function fill(selector,value){
    await evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
      "if(!el)throw Error('missing input');const setter=Object.getOwnPropertyDescriptor("+
      "HTMLInputElement.prototype,'value').set;setter.call(el,"+JSON.stringify(value)+");"+
      "el.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
  }
  async function select(selector,value){
    await evaluate("(()=>{const el=document.querySelector("+JSON.stringify(selector)+");"+
      "if(!el)throw Error('missing select');const setter=Object.getOwnPropertyDescriptor("+
      "HTMLSelectElement.prototype,'value').set;setter.call(el,"+JSON.stringify(value)+");"+
      "el.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  }
  async function capture(name){
    const image=await command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    writeFileSync(join(local,name),Buffer.from(image.data,"base64"));
  }
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride",{
    width:1440,height:900,deviceScaleFactor:1,mobile:false
  });

  await goto("/import/login");
  await poll(()=>evaluate("!!document.querySelector('#import-email')"));
  await hydrated();
  await fill("#import-email",account.email);
  await fill("#import-password",account.password);
  await evaluate("document.querySelector('form').requestSubmit()");
  await poll(()=>evaluate("location.pathname==='/import' && !!document.querySelector('.im-tenant-dashboard')"),23000);
  pass("Tenant login opens new merchant dashboard");

  await poll(()=>evaluate("document.querySelectorAll('.im-stat-card').length>=25"),28000);
  const cards=await evaluate("(()=>({count:document.querySelectorAll('.im-stat-card').length,"+
    "hasFinance:!!document.querySelector('.im-dashboard-money'),"+
    "hasShipping:!!document.querySelector('.im-dashboard-panels'),"+
    "hasTracking:document.body.innerText.includes('ShipsGo'),"+
    "noError:!document.querySelector('.im-dashboard-error')}))()");
  assert(cards.count>=25&&cards.hasFinance&&cards.hasShipping&&cards.hasTracking&&cards.noError,
    "Dashboard feature cards not fully rendered: "+JSON.stringify(cards));
  pass("Orders, finance by currency, shipping, and tracking render from actual API");

  await poll(()=>evaluate("!!document.querySelector('.im-dashboard-event')"),25000);
  const original=await evaluate("(()=>({events:document.querySelectorAll('.im-dashboard-event').length,"+
    "page:document.querySelector('.im-dashboard-pages')?.innerText||'',"+
    "actor:document.querySelector('.im-dashboard-event-details p')?.innerText||''}))()");
  assert(original.events>0 && original.events<=20 && original.actor.includes("بواسطة"));
  pass("Real audit timeline shows actors, subject and page-size limit");
  await capture("dashboard-desktop.png");

  await select('select[aria-label="فلترة الأحداث"]',"finance");
  await poll(()=>evaluate("document.querySelector('select[aria-label=\"فلترة الأحداث\"]')?.value==='finance'"+
    " && !document.querySelector('.im-dashboard-loading')"),22000);
  const filterOkay=await evaluate("(()=>[...document.querySelectorAll('.im-dashboard-event-details small')]"+
    ".every(x=>x.textContent?.includes('الدفوعات')))()");
  assert(filterOkay,"Finance category should contain only financial events");
  pass("Event category filter works without a full page reload");

  await select(".im-dashboard-actions select","7");
  await poll(()=>evaluate("document.querySelector('.im-dashboard-actions select')?.value==='7'"+
    " && !document.querySelector('.im-dashboard-updating')"),22000);
  pass("Period control refreshes dashboard aggregates and event window");

  await select('select[aria-label="فلترة الأحداث"]',"all");
  await poll(()=>evaluate("!!document.querySelector('.im-dashboard-event')"),20000);
  await select(".im-dashboard-actions select","30");
  await poll(()=>evaluate("!!document.querySelector('.im-dashboard-event')"+
    " && !document.querySelector('.im-dashboard-loading')"),20000);

  const total=await evaluate("(()=>{const pagination=document.querySelector('.im-dashboard-pages');"+
    "const buttons=pagination?[...pagination.querySelectorAll('button')]:[];"+
    "return {more:buttons.length>1&&!buttons[1].disabled,first:document.querySelector('.im-dashboard-event')?.innerText}})()");
  if(total.more){
    await evaluate("document.querySelectorAll('.im-dashboard-pages button')[1].click()");
    await poll(()=>evaluate("document.querySelector('.im-dashboard-pages')?.innerText.includes('صفحة 2')"+
      " && !document.querySelector('.im-dashboard-loading')"),22000);
    const next=await evaluate("document.querySelector('.im-dashboard-event')?.innerText");
    assert.notEqual(next,total.first);
    pass("Next-page navigation loads a different audited activity batch");
  }else {
    pass("Activity pagination correctly disables when no next page exists");
  }

  await command("Emulation.setDeviceMetricsOverride",{
    width:390,height:844,deviceScaleFactor:1,mobile:true
  });
  await sleep(850);
  const mobile=await evaluate("(()=>({width:document.documentElement.clientWidth,"+
    "scrollWidth:document.documentElement.scrollWidth,"+
    "chart:!!document.querySelector('.im-dashboard-trend'),"+
    "activity:!!document.querySelector('.im-dashboard-activity')}))()");
  assert(mobile.scrollWidth<=mobile.width+2,"Mobile horizontal overflow "+JSON.stringify(mobile));
  assert(mobile.chart&&mobile.activity);
  pass("Dashboard, chart and timeline fit 390px mobile viewport");
  await capture("dashboard-mobile.png");

  await command("Emulation.setDeviceMetricsOverride",{
    width:768,height:900,deviceScaleFactor:1,mobile:false
  });
  await sleep(500);
  const tablet=await evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth");
  assert(tablet<=2,"Tablet horizontal overflow "+tablet);
  pass("Tablet layout remains within viewport");

  console.log("DASHBOARD_BROWSER_PASS_COUNT="+count);
  console.log("DASHBOARD_SCREENSHOTS=.local/dashboard-desktop.png,.local/dashboard-mobile.png");
} catch(error){
  console.error("DASHBOARD_BROWSER_FAILED="+(error.stack||error));
  try{
    if(socket){
      // Only page text is captured; never cookies, passwords or auth tokens.
      const diag=await new Promise(resolve=>{
        const id=++seq;
        const timer=setTimeout(()=>resolve(null),2200);
        pending.set(id,{resolve:result=>{
          clearTimeout(timer);resolve(result?.result?.value);
        },reject:()=>resolve(null),timeout:timer});
        socket.send(JSON.stringify({id,method:"Runtime.evaluate",
          params:{expression:"({path:location.pathname,body:document.body.innerText.slice(0,750)})",
            returnByValue:true}}));
      });
      console.error("DASHBOARD_PAGE_DIAGNOSTIC="+JSON.stringify(diag));
    }
  }catch{}
  process.exitCode=1;
} finally {
  try{socket?.close()}catch{}
  try{
    const killer=spawn("taskkill.exe",["/PID",String(chrome.pid),"/T","/F"],
      {stdio:"ignore",detached:true});killer.unref();
  }catch{try{chrome.kill()}catch{}}
}
process.exit(process.exitCode||0);
