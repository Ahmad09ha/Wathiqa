// Local-only browser test: invite -> password validation -> accept -> login.
// The QA address is written to .local for explicit, scoped test cleanup.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {spawn} from "node:child_process";
const local=join(process.cwd(),".local");
const account=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,"")).find(x=>x.slug==="demo-a");
assert(account);
const suffix=randomUUID().replaceAll("-","").slice(0,12);
const email="invite-qa-"+suffix+"@wathiqa.invalid";
const password="Qa!Secure9Aa"+randomUUID().replaceAll("-","").slice(0,15);
writeFileSync(join(local,"invitation-qa-current.txt"),email);
const host="http://127.0.0.1:3000/import-api";
function session(){return {cookies:{},csrf:""}}
async function api(s,path,method="GET",body){
  const headers={Accept:"application/json",Cookie:Object.entries(s.cookies).map(([k,v])=>k+"="+v).join("; ")};
  if(method!=="GET")headers["X-Wathiqa-CSRF"]=s.csrf;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const r=await fetch(host+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  for(const raw of r.headers.getSetCookie?.()||[]){
    const m=raw.match(/^([^=;]+)=([^;]*)/);if(m)s.cookies[m[1]]=m[2];
  }
  let result;try{result=await r.json()}catch{result=null}
  return {status:r.status,result};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,ms=20000){
  const deadline=Date.now()+ms, errors=[];
  while(Date.now()<deadline){try{const x=await fn();if(x)return x}catch(e){errors.push(e.message)}await sleep(250)}
  throw Error("Timed out "+errors.at(-1));
}
let chrome,socket,checks=0;
const pass=m=>{checks++;console.log("PASS "+m)};
try{
  const admin=session();
  admin.csrf=(await api(admin,"/api/auth/csrf")).result.token;
  assert.equal((await api(admin,"/api/auth/login","POST",{email:account.email,password:account.password})).status,200);
  admin.csrf=(await api(admin,"/api/auth/csrf")).result.token;
  const invite=await api(admin,"/api/users/invitations","POST",{email});
  assert.equal(invite.status,200);
  const token=invite.result.token;
  pass("Tenant Admin issued one-time invite");
  const anon=session();
  anon.csrf=(await api(anon,"/api/auth/csrf")).result.token;
  const invalid=await api(anon,"/api/auth/invitations/accept","POST",{
    token,displayName:"QA User",password:"onlylowercase123"});
  assert.equal(invalid.status,400);
  assert.equal(invalid.result.error,"invalid_user_or_password");
  assert(invalid.result.details.includes("PasswordRequiresUpper"));
  pass("API returns specific password validation failures");
  const app=[
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ].find(existsSync);assert(app);
  const profile=join(local,"browser-invite-"+suffix);
  chrome=spawn(app,["--headless=new","--disable-gpu","--no-first-run",
    "--remote-debugging-port=0","--remote-allow-origins=*",
    "--user-data-dir="+profile,"about:blank"],{stdio:"ignore"});
  const port=await poll(()=>{
    const file=join(profile,"DevToolsActivePort");
    return existsSync(file)?Number(readFileSync(file,"utf8").split(/\r?\n/)[0]):0;
  });
  const tabs=await poll(async()=>{const r=await fetch("http://127.0.0.1:"+port+"/json/list");return r.ok?r.json():null});
  socket=new WebSocket(tabs.find(x=>x.type==="page").webSocketDebuggerUrl);
  await new Promise((ok,no)=>{socket.addEventListener("open",ok,{once:true});socket.addEventListener("error",no,{once:true})});
  let sequence=0;const pending=new Map(),acceptStatuses=[];
  socket.addEventListener("message",e=>{
    const msg=JSON.parse(e.data);
    if(msg.method==="Network.responseReceived" &&
      msg.params?.response?.url?.includes("/api/auth/invitations/accept"))
      acceptStatuses.push(msg.params.response.status);
    if(!pending.has(msg.id))return;
    const p=pending.get(msg.id);pending.delete(msg.id);clearTimeout(p.timeout);
    if(msg.error)p.reject(Error(JSON.stringify(msg.error)));else p.resolve(msg.result);
  });
  function send(method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout"))},16000);
      pending.set(id,{resolve,reject,timeout});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evalJs(expression){
    const res=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    if(res.exceptionDetails)throw Error("Browser expression failure");
    return res.result.value;
  }
  async function navigate(path){
    await send("Page.navigate",{url:"http://127.0.0.1:3000"+path});
    await poll(()=>evalJs("document.readyState==='complete'"));
  }
  async function hydrated(){
    await poll(()=>evalJs("(()=>{const f=document.forms[0];if(!f)return false;const k=Object.keys(f).find(x=>x.startsWith('__reactProps$'));return !!(k&&typeof f[k]?.onSubmit==='function')})()"));
  }
  async function type(selector,value){
    await evalJs("(()=>{const el=document.querySelector("+JSON.stringify(selector)+
      ");if(!el)throw Error('missing input');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
      "set.call(el,"+JSON.stringify(value)+");el.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
  }
  await send("Page.enable");await send("Runtime.enable");await send("Network.enable");
  await navigate("/import/join");await hydrated();
  await type("#invite-token",token.slice(0,13)+" "+token.slice(13));
  await type("#invite-display","QA Invited Member");
  await type("#invite-password","onlylowercase123");
  await type("#invite-confirm","onlylowercase123");
  await evalJs("document.forms[0].requestSubmit()");
  await poll(()=>evalJs("document.body.innerText.includes('كلمة المرور لا تحقق الشروط')"));
  pass("Join page shows exact password requirements without using invite");
  await type("#invite-password",password);
  await type("#invite-confirm",password);
  // Prime the anonymous CSRF token using a non-existent invitation. It must
  // not consume the genuine token; then remove its cookie to simulate a stale
  // cached antiforgery token from another browser session.
  await type("#invite-token","not-a-real-invitation-token");
  await evalJs("document.forms[0].requestSubmit()");
  await poll(()=>acceptStatuses.length>=1);
  assert.equal(acceptStatuses.at(-1),400);
  await send("Network.deleteCookies",{
    name:"wathiqa.import.antiforgery",
    url:"http://127.0.0.1:3000/import-api/api/auth/csrf"
  });
  await type("#invite-token",token.slice(0,13)+" "+token.slice(13));
  await evalJs("document.forms[0].requestSubmit()");
  await poll(()=>evalJs("location.pathname==='/import/login'"),25000);
  assert.deepEqual(acceptStatuses.slice(-2),[400,201]);
  pass("Join page retries stale CSRF cookie once without consuming invitation");
  pass("Real browser accepts token pasted with whitespace");
  await poll(()=>evalJs("!!document.querySelector('#import-email')"),18000);
  await hydrated();
  console.log("QA_LOGIN_FORM_READY");
  await type("#import-email",email);
  await type("#import-password",password);
  await evalJs("document.forms[0].requestSubmit()");
  try {
    await poll(()=>evalJs("location.pathname==='/import'"),22000);
  } catch(error) {
    const diagnostic=await evalJs("({path:location.pathname,toast:document.querySelector('.toast-item.error')?.innerText||'',hasLogin:!!document.querySelector('#import-email')})()");
    console.error("QA_LOGIN_DIAG="+JSON.stringify(diagnostic));
    throw error;
  }
  const me=await poll(()=>evalJs("(async()=>{const r=await fetch('/import-api/api/auth/me',{credentials:'include'});return r.ok?r.json():null})()"));
  assert.equal(me.slug,"demo-a");assert.equal(me.role,"Staff");
  pass("Invited Staff signs in and remains within its tenant");
  const repeated=await api(anon,"/api/auth/invitations/accept","POST",{token,displayName:"QA Invited Member",password});
  assert.equal(repeated.status,400);
  pass("Invitation cannot be reused");
  console.log("INVITE_BROWSER_PASS_COUNT="+checks);
}catch(e){console.error("INVITE_BROWSER_FAIL="+e.message);process.exitCode=1}
finally{
  try{socket?.close()}catch{}
  if(chrome){try{const p=spawn("taskkill.exe",["/PID",String(chrome.pid),"/T","/F"],{stdio:"ignore",detached:true});p.unref()}catch{chrome.kill()}}
}
process.exit(process.exitCode||0);
