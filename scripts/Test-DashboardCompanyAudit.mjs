// Stateful QA on demo-a only: audit create -> update -> soft delete,
// then validate cross-tenant privacy. Data is uniquely tagged and cleaned by
// scripts/Cleanup-DashboardCompanyAuditQa.ps1 (dry run first).
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const run="DASH_QA_"+randomUUID().replaceAll("-","").slice(0,12);
const fixture={run,companyId:null,tenantSlug:"demo-a"};
const fixturePath=join(local,"dashboard-company-qa-"+run+".json");
const save=()=>writeFileSync(fixturePath,JSON.stringify(fixture,null,2),"utf8");
const base="http://127.0.0.1:5089";
let checked=0;
const pass=description=>{checked++;console.log("PASS "+description)};
async function connect(slug){
  const cred=accounts.find(x=>x.slug===slug);assert(cred);
  const cookies={};let csrf="";
  async function request(path,method="GET",body){
    const headers={Accept:"application/json",
      Cookie:Object.entries(cookies).map(([k,v])=>k+"="+v).join("; ")};
    if(method!=="GET")headers["X-Wathiqa-CSRF"]=csrf;
    if(body!==undefined)headers["Content-Type"]="application/json";
    const res=await fetch(base+path,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(15000)});
    for(const c of res.headers.getSetCookie?.()||[]){
      const m=c.match(/^([^=;]+)=([^;]*)/);
      if(m)cookies[m[1]]=m[2];
    }
    const raw=await res.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
    return {status:res.status,data};
  }
  csrf=(await request("/api/auth/csrf")).data.token;
  const logged=await request("/api/auth/login","POST",{email:cred.email,password:cred.password});
  assert.equal(logged.status,200);
  csrf=(await request("/api/auth/csrf")).data.token;
  return request;
}
try {
  save();
  const a=await connect("demo-a");
  const b=await connect("demo-b");
  const company=await a("/api/companies","POST",{name:run+" Supplier",type:"Supplier"});
  assert.equal(company.status,201,"Create returned "+company.status);
  fixture.companyId=company.data.id;save();
  pass("QA merchant company created with audit row");
  const updated=await a("/api/companies/"+fixture.companyId,"PUT",{
    name:run+" Updated",type:"Supplier",country:"China"
  });
  assert.equal(updated.status,200);
  pass("Existing company updated with audited actor");
  const deleted=await a("/api/companies/"+fixture.companyId,"DELETE");
  assert.equal(deleted.status,204);
  assert.equal((await a("/api/companies/"+fixture.companyId)).status,404);
  pass("Company soft-delete creates activity without exposing deleted directory row");
  const own=await a("/api/dashboard/activity?days=7&category=companies&page=1&pageSize=50");
  assert.equal(own.status,200);
  const matching=own.data.items.filter(x=>x.subject?.startsWith(run));
  assert.equal(matching.length,3,
    "Expected exactly three audit rows (no duplicate synthetic Create); got "+matching.length);
  assert.deepEqual([...matching.map(x=>x.action)].sort(),["Created","Deleted","Updated"]);
  assert.equal(matching.find(x=>x.action==="Created")?.subject,run+" Supplier");
  assert.equal(matching.find(x=>x.action==="Updated")?.subject,run+" Updated");
  assert.equal(matching.find(x=>x.action==="Deleted")?.subject,run+" Updated");
  assert(matching.every(x=>x.actor && !x.actor.includes("غير مسجّل")
    && !x.actor.includes("النظام")));
  assert(matching.every(x=>x.url==="/import/companies"));
  pass("Created, updated and deleted events appear exactly once, with real actor");
  const foreign=await b("/api/dashboard/activity?days=7&category=companies&page=1&pageSize=50");
  assert.equal(foreign.status,200);
  assert(foreign.data.items.every(x=>!x.subject?.startsWith(run)));
  pass("Company audit actor, label and events never leak to another tenant");
  console.log("DASHBOARD_COMPANY_AUDIT_PASS_COUNT="+checked);
} catch(error){
  console.error("DASHBOARD_COMPANY_AUDIT_FAILED="+(error.stack||error));
  process.exitCode=1;
} finally {
  console.log("DASHBOARD_COMPANY_QA_FIXTURE="+fixturePath);
}
process.exit(process.exitCode||0);
