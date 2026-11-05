import {spawn} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd(), local=path.join(root,'.local');
const pdfFixture=path.join(local,'smoke-contract.pdf');
if(!existsSync(pdfFixture)) throw new Error('Run Import-Smoke-Test.ps1 before this browser test');
const browser='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile=path.join(local,'browser-advanced-profile');mkdirSync(profile,{recursive:true});
const chrome=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9224','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
const api='http://127.0.0.1:5088/api';
const sleep=n=>new Promise(r=>setTimeout(r,n));
let ws=null,templateId=null,documentId=null,importedId=null,pass=0;
async function until(fn,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch{}await sleep(200)}throw new Error('Timeout waiting for condition');}
try{
 const targets=await until(async()=>{const r=await fetch('http://127.0.0.1:9224/json/list');return r.ok?r.json():null});
 const page=targets.find(x=>x.type==='page');
 ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
 const pending=new Map();let next=0;
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(!m.id)return;const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result)});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('Timeout: '+method))},15000)});
 async function evalJs(expression){const x=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(x.exceptionDetails)throw Error(JSON.stringify(x.exceptionDetails));return x.result.value}
 const navigate=async url=>{await command('Page.navigate',{url});await until(()=>evalJs('document.readyState === "complete"'),18000)};
 const findButton=text=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
 const check=(ok,label)=>{if(!ok)throw Error('FAILED '+label);console.log('PASS '+label);pass++};
 await command('Page.enable');await command('Runtime.enable');await command('DOM.enable');
 await navigate('http://localhost:3000/');
 await until(()=>evalJs("document.body.innerText.includes('عقد بيع')"));
 await evalJs(`(${findButton('قالب جديد')})?.click()`);
 await until(()=>evalJs("!!document.querySelector('input[placeholder^=\"اكتب اسم القالب\"]')"));
 await evalJs("document.querySelector('input[placeholder^=\"اكتب اسم القالب\"]').focus()");
 await command('Input.insertText',{text:'QA Custom Blank Template'});
 await evalJs(`(${findButton('إنشاء القالب')})?.click()`);
 const templatePath=await until(async()=>{const p=await evalJs('location.pathname');return p.startsWith('/editor/template/')?p:null},25000);
 templateId=templatePath.split('/').at(-1);
 await until(()=>evalJs("!!document.querySelector('.ProseMirror')"));
 check(!!templateId,'Create blank template from Workspace UI');
 await evalJs("document.querySelector('.ProseMirror p')?.focus()");
 await evalJs("document.querySelector('.ProseMirror')?.focus()");
 await command('Input.insertText',{text:'CUSTOM CONTRACT TERM: [VALUE]'});
 await until(()=>evalJs("document.querySelector('.ProseMirror')?.innerText.includes('CUSTOM CONTRACT TERM')"));
 await evalJs(`(${findButton('حفظ التعديلات')})?.click()`);
 await until(async()=>{const d=await(await fetch(api+'/templates/'+templateId)).json();return d.contentJson.includes('CUSTOM CONTRACT TERM')});
 check(true,'Enter and save editable content to new template');
 await evalJs(`(${findButton('إنشاء مستند')})?.click()`);
 const documentPath=await until(async()=>{const p=await evalJs('location.pathname');return p.startsWith('/editor/document/')?p:null},25000);
 documentId=documentPath.split('/').at(-1);
 await until(()=>evalJs("document.querySelector('.ProseMirror')?.innerText.includes('CUSTOM CONTRACT TERM')"));
 check(!!documentId,'Create independent document from newly edited template');
 await navigate('http://localhost:3000/');
 await until(()=>evalJs("document.body.innerText.includes('QA Custom Blank Template')"));
 check(await evalJs("document.body.innerText.includes('المستندات المحفوظة') && document.querySelectorAll('article.card').length>=4"),'Saved document appears in Workspace');
 const dom=await command('DOM.getDocument',{depth:3});
 const input=await command('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[type=file]'});
 await command('DOM.setFileInputFiles',{files:[pdfFixture],nodeId:input.nodeId});
 const importPath=await until(async()=>{const p=await evalJs('location.pathname');return p.startsWith('/editor/template/') && !p.endsWith(templateId)?p:null},30000);
 importedId=importPath.split('/').at(-1);
 await until(()=>evalJs("document.querySelector('.ProseMirror')?.innerText.includes('PRICE TERM')"),20000);
 check(true,'Import PDF through browser file picker and render extracted labels');
 const before=await evalJs("document.querySelector('.ProseMirror p:first-child')?.innerText");
 await evalJs("(()=>{const x=document.querySelector('.ProseMirror p:first-child');const s=getSelection(),r=document.createRange();r.selectNodeContents(x);r.collapse(true);s.removeAllRanges();s.addRange(r);document.querySelector('.ProseMirror').focus();return true})()");
 await evalJs("document.querySelector('button[title=\"تحريك القسم للأسفل\"]')?.click()");
 await until(async()=>{const x=await evalJs("document.querySelector('.ProseMirror p:first-child')?.innerText");return x && x!==before},10000);
 check(true,'Move content block to new position');
 await evalJs("document.querySelector('button[title=\"إضافة جدول (3×3)\"]')?.click()");
 await until(()=>evalJs("document.querySelectorAll('.ProseMirror table').length>0"));
 const rowsBefore=await evalJs("document.querySelector('.ProseMirror table').rows.length");
 await until(()=>evalJs("!!document.querySelector('button[title=\"إضافة صف بالأسفل\"]')"),8000);
 await evalJs("document.querySelector('button[title=\"إضافة صف بالأسفل\"]')?.click()");
 await until(async()=>{const x=await evalJs("document.querySelector('.ProseMirror table').rows.length");return x>rowsBefore},8000);
 check(true,'Add row to table from toolbar');
 const colsBefore=await evalJs("document.querySelector('.ProseMirror table tr').cells.length");
 await evalJs("document.querySelector('button[title=\"إضافة عمود بعد الحالي\"]')?.click()");
 await until(async()=>{const x=await evalJs("document.querySelector('.ProseMirror table tr').cells.length");return x>colsBefore},8000);
 check(true,'Add column to table from toolbar');
 console.log('ADVANCED BROWSER PASS COUNT: '+pass);
}catch(e){console.error('ADVANCED BROWSER TEST FAILED: '+e.message);process.exitCode=1;}
finally{
 for(const [type,id] of [['documents',documentId],['templates',importedId],['templates',templateId]]){if(id){try{await fetch(api+'/'+type+'/'+id,{method:'DELETE'})}catch{}}}
 try{ws?.close()}catch{};try{chrome.kill()}catch{}
}
