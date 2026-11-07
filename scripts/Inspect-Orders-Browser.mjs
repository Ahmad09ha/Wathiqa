const port=process.argv[2] || "9237";
const controller=new AbortController();
setTimeout(()=>controller.abort(),4500);
let targets;
try{
 const r=await fetch("http://127.0.0.1:"+port+"/json/list",{signal:controller.signal});
 targets=await r.json();
}catch(err){console.error("CDP_UNAVAILABLE",String(err));process.exit(1)}
const page=targets.find(t=>t.type==="page");
if(!page)throw Error("No page target");
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true})});
const describe=()=>{
 const input=[...document.querySelectorAll("input,select")].map(x=>({type:x.type,name:x.name,value:x.type==="password"?"[redacted]":x.value,valid:x.validity.valid})).slice(0,45);
 const messages=[...document.querySelectorAll("[role=alert],.toast-item,.im-empty")].map(x=>x.innerText).slice(0,8);
 return {url:location.href,ready:document.readyState,title:document.title,formCount:document.forms.length,inputs:input,messages,body:document.body.innerText.slice(0,2300)};
};
const expression="("+describe.toString()+")()";
const timeout=setTimeout(()=>{console.error("CDP_INSPECTION_TIMEOUT");ws.close();process.exit(2)},8000);
ws.addEventListener("message",e=>{
 const obj=JSON.parse(e.data);
 if(obj.id!==1)return;
 clearTimeout(timeout);
 if(obj.error)console.error(obj.error);
 else console.log("UI_STATE",JSON.stringify(obj.result.result.value,null,2));
 ws.close();
});
ws.send(JSON.stringify({id:1,method:"Runtime.evaluate",params:{expression,returnByValue:true,awaitPromise:true}}));
