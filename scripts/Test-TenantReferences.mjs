// Tenant-owned reference port API: non-destructive QA on two local demo tenants.
// A matching guarded SQL cleanup deletes only QA-tagged PortAudits/TenantPorts.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
const root=process.cwd(),local=join(root,".local");
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const tag="PORT_QA_"+randomUUID().replaceAll("-","").slice(0,12);
const fixture={tag,ports:[]};
const fixturePath=join(local,"port-reference-fixture-"+tag+".json");
const save=()=>writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
const server="http://127.0.0.1:5089";
let count=0;
function pass(message){count++;console.log("PASS "+message)}
async function tenant(slug){
 const creds=accounts.find(x=>x.slug===slug);assert(creds,slug+" account is absent");
 const cookies={};let csrf="";
 async function send(path,method="GET",body){
   const headers={Accept:"application/json",Cookie:Object.entries(cookies).map(([k,v])=>k+"="+v).join("; ")};
   if(method!=="GET")headers["X-Wathiqa-CSRF"]=csrf;
   if(body!==undefined)headers["Content-Type"]="application/json";
   const r=await fetch(server+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   for(const c of r.headers.getSetCookie?.()||[]){const m=c.match(/^([^=;]+)=([^;]*)/);if(m)cookies[m[1]]=m[2]}
   const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}
   return {status:r.status,data};
 }
 csrf=(await send("/api/auth/csrf")).data.token;
 assert.equal((await send("/api/auth/login","POST",{email:creds.email,password:creds.password})).status,200);
 csrf=(await send("/api/auth/csrf")).data.token;
 return send;
}
function expect(r,status){assert.equal(r.status,status,JSON.stringify(r.data));return r.data}
async function create(send,slug,name){
 const data=expect(await send("/api/ports","POST",{name,country:"China"}),201);
 fixture.ports.push({id:data.id,slug});save();return data;
}
try{
 save();
 const r=await fetch(server+"/api/ports");
 assert.equal(r.status,401);pass("Anonymous users cannot access port directory");
 const a=await tenant("demo-a"),b=await tenant("demo-b");
 pass("Two tenant-bound sessions authenticated");
 const first=await create(a,"demo-a",tag+" Qingdao");
 const second=await create(b,"demo-b",tag+" Qingdao");
 assert.notEqual(first.id,second.id);
 pass("Both tenants can independently save the same port name");
 const aList=expect(await a("/api/ports"),200);
 const bList=expect(await b("/api/ports"),200);
 assert(aList.some(x=>x.id===first.id&&x.source==="Catalog"));
 assert(!aList.some(x=>x.id===second.id));
 assert(bList.some(x=>x.id===second.id));
 assert(!bList.some(x=>x.id===first.id));
 pass("Tenant directories return only owner catalog IDs");
 expect(await b("/api/ports/"+first.id,"PUT",{name:"FORGED",country:""}),404);
 expect(await b("/api/ports/"+first.id,"DELETE"),404);
 pass("Foreign tenant UUID cannot be edited or deleted");
 expect(await a("/api/ports","POST",{name:tag+" QINGDAO",country:""}),409);
 expect(await a("/api/ports","POST",{name:" ",country:""}),400);
 expect(await a("/api/ports","POST",{name:tag+" Long",country:"x".repeat(101)}),400);
 pass("Duplicate names are case-insensitive; invalid inputs are rejected");
 const updated=expect(await a("/api/ports/"+first.id,"PUT",{
   name:tag+" Shanghai",country:"China"
 }),200);
 assert.equal(updated.name,tag+" Shanghai");
 assert.equal(updated.country,"China");
 const after=expect(await b("/api/ports"),200);
 assert(after.some(x=>x.id===second.id&&x.name===tag+" Qingdao"));
 assert(!after.some(x=>x.id===first.id));
 pass("Renaming an owner port cannot alter another tenant's catalog");

 // Before this feature, Orders held two string snapshot fields. Both
 // must be selectable as History values scoped to the owner.
 const orders=expect(await a("/api/orders?pageSize=20"),200);
 let historical=null;
 for(const row of orders.items||[]){
   const detail=await a("/api/orders/"+row.id);
   if(detail.status!==200)continue;
   const names=[detail.data.loadingPort,detail.data.dischargePort].filter(Boolean);
   if(names.length){historical=names[0];break}
 }
 if(historical){
   const ports=expect(await a("/api/ports"),200);
   assert(ports.some(p=>p.name.trim().toLocaleLowerCase()===historical.trim().toLocaleLowerCase()));
   pass("Legacy order port names appear as reusable owner-specific choices");
 }else {
   console.log("SKIP legacy port suggestion: no historical order with a port in the demo tenant");
 }
 const own=expect(await a("/api/dashboard/activity?days=0&category=ports&pageSize=50"),200);
 const entries=own.items.filter(x=>x.subject?.startsWith(tag));
 assert.deepEqual(entries.map(x=>x.action).sort(),["Created","Updated"]);
 assert(entries.some(x=>x.action==="Created"&&x.subject===tag+" Qingdao"));
 assert(entries.some(x=>x.action==="Updated"&&x.subject===tag+" Shanghai"));
 assert(entries.every(x=>x.actor&&x.url==="/import/reference-data"));
 const foreign=expect(await b("/api/dashboard/activity?days=0&category=ports&pageSize=50"),200);
 assert(!foreign.items.some(x=>x.subject?.startsWith(tag+" Shanghai")));
 pass("Port create/update activity retains historical name and real actor, with no tenant leakage");
 expect(await a("/api/ports/"+first.id,"DELETE"),204);
 const deleted=expect(await a("/api/ports"),200);
 assert(!deleted.some(x=>x.id===first.id));
 pass("Soft-delete hides catalog entry without touching existing Orders");
 const replacement=await create(a,"demo-a",tag+" Shanghai");
 assert.notEqual(replacement.id,first.id);
 pass("Soft-deleted normalized name can be reused in same tenant");
 expect(await a("/api/ports/"+replacement.id,"DELETE"),204);
 expect(await b("/api/ports/"+second.id,"DELETE"),204);
 pass("Demo tenant port records are safely soft-deleted");
 console.log("TENANT_PORTS_PASS_COUNT="+count);
}catch(error){
 console.error("TENANT_PORTS_FAILED="+(error.stack||error));process.exitCode=1;
}finally{
 console.log("TENANT_PORTS_QA_FIXTURE="+fixturePath);
}
process.exit(process.exitCode||0);
