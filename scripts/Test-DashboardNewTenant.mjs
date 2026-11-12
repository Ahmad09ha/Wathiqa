// Empty-tenant dashboard and Staff visibility on a disposable Platform QA tenant.
// Safe cleanup: scripts/Cleanup-PlatformSuperAdminQa.ps1 -FixturePath <path> -Apply.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const local=join(process.cwd(),".local");
const platform=JSON.parse(readFileSync(join(local,"platform-superadmin-account.json"),"utf8").replace(/^\uFEFF/,""));
const run="PA_QA_"+randomUUID().replaceAll("-","").slice(0,12);
const slug="pa-qa-"+run.slice(6);
const email="admin-"+run.toLowerCase()+"@wathiqa.invalid";
const staffEmail="staff-"+run.toLowerCase()+"@wathiqa.invalid";
const password="QA!Owner9Aa"+randomUUID().replaceAll("-").slice(0,15);
const staffPassword="QA!Staff9Aa"+randomUUID().replaceAll("-").slice(0,15);
const fixture={run,tenantId:null,adminUserId:null,planIds:[]};
const path=join(local,"platform-qa-fixture-"+run+".json");
const save=()=>writeFileSync(path,JSON.stringify(fixture,null,2),"utf8");
const root="http://127.0.0.1:5089";
let checks=0;
function pass(description){checks++;console.log("PASS "+description)}
function session(){
  const cookies={};let csrf="";
  async function request(url,method="GET",body){
    const headers={Accept:"application/json",Cookie:Object.entries(cookies).map(([k,v])=>k+"="+v).join("; ")};
    if(method!=="GET")headers["X-Wathiqa-CSRF"]=csrf;
    if(body!==undefined)headers["Content-Type"]="application/json";
    const response=await fetch(root+url,{method,headers,
      body:body===undefined?undefined:JSON.stringify(body),redirect:"manual",
      signal:AbortSignal.timeout(20000)});
    for(const raw of response.headers.getSetCookie?.()||[]){
      const match=raw.match(/^([^=;]+)=([^;]*)/);
      if(match)cookies[match[1]]=match[2];
    }
    let data=null;try{data=await response.json()}catch{}
    return {status:response.status,data};
  }
  async function login(url,user,pass){
    const get=await request("/api/auth/csrf");assert.equal(get.status,200);
    csrf=get.data.token;
    const result=await request(url,"POST",{email:user,password:pass});
    assert.equal(result.status,200,"Login failed: "+result.status+" "+JSON.stringify(result.data));
    csrf=(await request("/api/auth/csrf")).data.token;
  }
  async function initCsrf(){csrf=(await request("/api/auth/csrf")).data.token}
  return {request,login,initCsrf};
}
try{
  save();
  const superadmin=session();
  await superadmin.login("/api/platform/auth/login",platform.email,platform.password);
  const created=await superadmin.request("/api/platform/tenants","POST",{
    name:run+" merchant",slug,adminEmail:email,adminPassword:password,
    accessMode:"Unlimited",accessExpiresAtUtc:null,
    reason:"Dashboard empty tenant and staff visibility local QA"
  });
  assert.equal(created.status,201,JSON.stringify(created.data));
  fixture.tenantId=created.data.id;
  fixture.adminUserId=created.data.adminUserId;
  save();
  pass("Fresh isolated merchant created with direct Admin credentials");

  const admin=session();
  await admin.login("/api/auth/login",email,password);
  const dashboard=await admin.request("/api/dashboard/overview?days=30");
  assert.equal(dashboard.status,200);
  assert.equal(dashboard.data.orders.total,0);
  assert.equal(dashboard.data.shipping.total,0);
  assert.equal(dashboard.data.documents.total,0);
  assert.equal(dashboard.data.financial.currencies.length,0);
  assert.equal(dashboard.data.trend.length,14);
  assert.equal(dashboard.data.team.total,1);
  pass("Empty tenant renders all zero-state metrics without server error");

  const orders=await admin.request("/api/dashboard/activity?days=0&category=orders&page=1");
  assert.equal(orders.status,200);
  assert.equal(orders.data.total,0);
  pass("Empty order activity returns a valid empty page");

  const invite=await admin.request("/api/users/invitations","POST",{email:staffEmail});
  assert.equal(invite.status,200,JSON.stringify(invite.data));
  const guest=session();await guest.initCsrf();
  const accept=await guest.request("/api/auth/invitations/accept","POST",{
    token:invite.data.token,displayName:"Dashboard QA Staff",password:staffPassword
  });
  assert.equal(accept.status,201,JSON.stringify(accept.data));
  pass("Invited QA Staff registered under same merchant");

  const staff=session();
  await staff.login("/api/auth/login",staffEmail,staffPassword);
  const staffOverview=await staff.request("/api/dashboard/overview?days=30");
  assert.equal(staffOverview.status,200);
  assert.equal(staffOverview.data.team.total,2);
  assert.equal(staffOverview.data.orders.total,0);
  pass("Staff can read tenant-scoped dashboard statistics");

  for(const category of ["security","subscription"]){
    const blocked=await staff.request("/api/dashboard/activity?category="+category);
    assert.equal(blocked.status,403,category+" should be Admin-only");
  }
  const all=await staff.request("/api/dashboard/activity?days=0&category=all");
  assert.equal(all.status,200);
  assert(all.data.items.every(x=>x.category!=="security"&&x.category!=="subscription"));
  pass("Staff cannot access Admin-only security or platform events, even via all");

  const adminHistory=await admin.request("/api/dashboard/activity?days=0&category=subscription");
  assert.equal(adminHistory.status,200);
  assert(adminHistory.data.items.every(x=>x.category==="subscription"));
  pass("Merchant Admin retains access to its own subscription events");

  console.log("DASHBOARD_NEW_TENANT_PASS_COUNT="+checks);
}catch(error){
  console.error("DASHBOARD_NEW_TENANT_FAILED="+(error.stack||error));
  process.exitCode=1;
}finally {
  console.log("DASHBOARD_NEW_TENANT_QA_FIXTURE="+path);
}
process.exit(process.exitCode||0);
