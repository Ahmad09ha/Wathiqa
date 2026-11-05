import {spawn} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
const root=path.resolve(process.cwd());
const profile=path.join(root,'.local','browser-qa-profile');
mkdirSync(profile,{recursive:true});
const chromeCandidates=['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'];
const chromeExe=chromeCandidates.find(existsSync);
if(!chromeExe) throw new Error('Chromium-compatible browser is not installed');
const chrome=spawn(chromeExe,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9223','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws,createdDoc=null;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const base='http://127.0.0.1:5088';
async function waitUntil(task,timeout=20000){
 const end=Date.now()+timeout;let last;
 while(Date.now()<end){
  try{const value=await task();if(value)return value;}catch(e){last=e;}
  await delay(250);
 }
 throw new Error('Condition not met before timeout'+(last?': '+last.message:''));
}
async function openConnection(){
 const pages=await waitUntil(async()=>{const response=await fetch('http://127.0.0.1:9223/json/list');return response.ok?await response.json():null},15000);
 const target=pages.find(item=>item.type==='page');if(!target)throw new Error('No Chrome page target');
 const socket=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 ws=socket;
 let id=0;const pending=new Map();
 ws.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(!message.id)return;
  const d=pending.get(message.id);if(!d)return;pending.delete(message.id);
  if(message.error)d.reject(new Error(JSON.stringify(message.error)));else d.resolve(message.result);
 });
 return (method,params={})=>new Promise((resolve,reject)=>{
  const key=++id;pending.set(key,{resolve,reject});
  ws.send(JSON.stringify({id:key,method,params}));
  setTimeout(()=>{if(pending.delete(key))reject(new Error('CDP timeout: '+method))},13000);
 });
}
try{
 const cdp=await openConnection();
 async function evaluate(expression){
  const data=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(data.exceptionDetails)throw new Error(JSON.stringify(data.exceptionDetails));
  return data.result.value;
 }
 await cdp('Page.enable');await cdp('Runtime.enable');
 await cdp('Page.navigate',{url:'http://localhost:3000/'});
 await waitUntil(()=>evaluate("document.body?.innerText.includes('عقد بيع')"),20000);
 console.log('PASS Browser hydrates and fetches seeded templates');
 const count=await evaluate("document.querySelectorAll('article.card').length");
 if(count<2)throw new Error('Expected two template cards, got '+count);
 console.log('PASS Template gallery cards rendered ('+count+')');
 await evaluate("document.querySelector('article.card .btn.primary')?.click()");
 const editorPath=await waitUntil(async()=>{
  const p=await evaluate("location.pathname");
  return p?.startsWith('/editor/document/')?p:null;
 },25000);
 createdDoc=editorPath.split('/').at(-1);
 await waitUntil(()=>evaluate("!!document.querySelector('.ProseMirror')"),20000);
 console.log('PASS Use template navigates to an editable document');
 const initial=await waitUntil(async()=>{
  const t=await evaluate("document.querySelector('.ProseMirror')?.innerText || ''");
  return t.includes('PRICE TERM')?t:null;
 },20000);
 console.log('PASS Tiptap loads saved rich content');
 const initiallySaved=await evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('حفظ التعديلات'));return b?.disabled===true})()");
 if(!initiallySaved) throw new Error('Editor incorrectly marked freshly loaded content as unsaved');
 console.log('PASS Fresh document does not show false unsaved changes');
 await evaluate("(()=>{const root=document.querySelector('.ProseMirror');const p=root.querySelector('p');const selection=getSelection();const range=document.createRange();range.selectNodeContents(p);range.collapse(false);selection.removeAllRanges();selection.addRange(range);root.focus();return true})()");
 await cdp('Input.insertText',{text:' [BROWSER_QA_MARKER]'});
 await waitUntil(()=>evaluate("document.querySelector('.ProseMirror').innerText.includes('[BROWSER_QA_MARKER]')"),10000);
 await waitUntil(()=>evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('حفظ التعديلات'));return !!b&&!b.disabled})()"),10000);
 console.log('PASS Editor accepts keyboard input and marks document dirty');
 await evaluate("(()=>{[...document.querySelectorAll('button')].find(x=>x.innerText.includes('حفظ التعديلات')).click();return true})()");
 await waitUntil(()=>evaluate("document.body.innerText.includes('تم حفظ التعديلات')"),15000);
 let record=await (await fetch(base+'/api/documents/'+createdDoc)).json();
 if(!record.contentJson.includes('BROWSER_QA_MARKER'))throw new Error('Saved edit missing from PostgreSQL record');
 const original=await (await fetch(base+'/api/templates/'+record.templateId)).json();
 if(original.contentJson.includes('BROWSER_QA_MARKER'))throw new Error('Template was modified by document edit');
 console.log('PASS UI Save persists to PostgreSQL without changing template');
 const beforeTables=await evaluate("document.querySelectorAll('.ProseMirror table').length");
 await evaluate("(()=>{const b=document.querySelector('button[title=\"إضافة جدول (3×3)\"]');if(!b)throw new Error('Table button missing');b.click();return true})()");
 await waitUntil(()=>evaluate("document.querySelectorAll('.ProseMirror table').length") .then(c=>c>beforeTables),10000);
 await waitUntil(()=>evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('حفظ التعديلات'));return !!b&&!b.disabled})()"),10000);
 await evaluate("(()=>{[...document.querySelectorAll('button')].find(x=>x.innerText.includes('حفظ التعديلات')).click();return true})()");
 await waitUntil(async()=>{const d=await (await fetch(base+'/api/documents/'+createdDoc)).json();return d.revision>=3 && JSON.parse(d.contentJson).content.filter(x=>x.type==='table').length>beforeTables},15000);
 console.log('PASS Insert table through toolbar and persist it');
 await cdp('Page.navigate',{url:'http://localhost:3000/editor/document/'+createdDoc});
 await waitUntil(()=>evaluate("document.querySelector('.ProseMirror')?.innerText.includes('[BROWSER_QA_MARKER]')"),20000);
 console.log('PASS Reopened document displays saved edit');
 console.log('BROWSER PASS COUNT: 9');
}finally{
 if(createdDoc){await fetch(base+'/api/documents/'+createdDoc,{method:'DELETE'}).catch(()=>{});}
 try{ws?.close();}catch{}
 try{chrome.kill();}catch{}
}
