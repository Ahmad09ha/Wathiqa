// SuperAdmin integration on real local PostgreSQL and authenticated HTTP.
// The QA merchant created here is explicitly tagged for selective cleanup.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";

const local=join(process.cwd(),".local");
const host="http://127.0.0.1:5089";
const admin=JSON.parse(readFileSync(join(local,"platform-superadmin-account.json"),"utf8").replace(/^\uFEFF/,""));
const demo=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const run="PA_QA_"+randomUUID().replaceAll("-","").slice(0,12);
const file=join(local,"platform-qa-fixture-"+run+".json");
const fixture={run,tenantId:null,adminUserId:null,staffUserId:null,planIds:[]};
function persist(){writeFileSync(file,JSON.stringify(fixture,null,2));}persist();
let count=0;
function pass(s){count++;console.log("PASS "+s);}
function expect(r,status,s){assert.equal(r.status,status,s+" "+JSON.stringify(r.data).slice(0,700));pass(s);return r.data;}
function session(){return {cookies:{},csrf:""};}
async function call(s,path,method="GET",body){
  const headers={Accept:"application/json"};
  if(s){
    headers.Cookie=Object.entries(s.cookies).filter(([name])=>path.startsWith("/api/platform")
      ?name.includes("platform")||name.includes("antiforgery")
      :!name.includes("platform")||name.includes("antiforgery"))
      .map(([name,value])=>name+"="+value).join("; ");
    if(!["GET","HEAD","OPTIONS"].includes(method))headers["X-Wathiqa-CSRF"]=s.csrf;
  }
  if(body!==undefined)headers["Content-Type"]="application/json";
  const res=await fetch(host+path,{method,headers,redirect:"manual",
    body:body===undefined?undefined:JSON.stringify(body)});
  if(s)for(const raw of res.headers.getSetCookie?.()||[]){
    const match=raw.match(/^([^=;]+)=([^;]*)/);if(match)s.cookies[match[1]]=match[2];
  }
  const raw=await res.text();let data=raw;try{data=JSON.parse(raw);}catch{}
  return {status:res.status,data};
}
async function csrf(s){const res=await call(s,"/api/auth/csrf");
  assert.equal(res.status,200);s.csrf=res.data.token;return s;}
async function login(s,path,email,password){await csrf(s);
  const res=await call(s,path,"POST",{email,password});
  if(res.status===200)await csrf(s);return res;}
const anyUnauthorized=r=>assert([401,403].includes(r.status),"Expected rejected access: "+JSON.stringify(r));
const passDenied=(r,s)=>{anyUnauthorized(r);pass(s);};
try{
  expect(await call(null,"/api/platform/overview"),401,"Anonymous cannot read platform overview");
  const merchant=session();
  const source=demo.find(x=>x.slug==="demo-a");assert(source,"QA merchant not found");
  expect(await login(merchant,"/api/auth/login",source.email,source.password),200,"Existing merchant signs in normally");
  passDenied(await call(merchant,"/api/platform/tenants"),"Tenant Admin cannot reach platform directory");
  passDenied(await call(merchant,"/api/platform/auth/me"),"Tenant Admin cannot masquerade as SuperAdmin");

  const platform=session();await csrf(platform);
  expect(await call(platform,"/api/platform/auth/login","POST",{email:admin.email,password:"wrong-password"}),401,
    "Incorrect SuperAdmin password rejected");
  expect(await login(platform,"/api/platform/auth/login",admin.email,admin.password),200,
    "SuperAdmin signs in using its independent platform session");
  const me=expect(await call(platform,"/api/platform/auth/me"),200,"SuperAdmin identity has dedicated role");
  assert.equal(me.role,"SuperAdmin");assert(!("tenantId" in me));
  const noCsrfHeaders={Cookie:Object.entries(platform.cookies).filter(([key])=>
    key.includes("platform")||key.includes("antiforgery"))
    .map(([key,value])=>key+"="+value).join("; "),"Content-Type":"application/json"};
  const noCsrf=await fetch(host+"/api/platform/tenants",{method:"POST",headers:noCsrfHeaders,
    body:JSON.stringify({name:"Must not create",slug:"csrf-must-fail"})});
  assert.equal(noCsrf.status,400);
  pass("SuperAdmin platform writes reject missing CSRF token even with valid cookie");
  passDenied(await call(platform,"/api/orders"),"Platform cookie alone cannot read merchant purchase orders");
  passDenied(await call(platform,"/api/users"),"Platform cookie alone cannot list a merchant's tenant users API");
  const initial=expect(await call(platform,"/api/platform/overview"),200,"Platform overview lists tenant-only metadata");
  assert(initial.totalTenants>=2);
  const list=expect(await call(platform,"/api/platform/tenants?page=1&pageSize=5"),200,
    "Platform directory lists merchants without trade or payment records");
  assert(list.items.every(x=>!Object.hasOwn(x,"orders")&&!Object.hasOwn(x,"transfers")));
  expect(await call(platform,"/api/platform/tenants?pageSize=101"),400,"Excessive directory page size rejected");
  const createInput={name:run+" merchant",slug:"pa-qa-"+run.slice("PA_QA_".length),
    adminEmail:"owner-"+run.toLowerCase()+"@wathiqa.invalid",accessMode:"Expires",
    accessExpiresAtUtc:"2027-11-07T23:59:59Z",reason:"Provision explicit QA merchant tenancy"};
  expect(await call(platform,"/api/platform/tenants","POST",
    {...createInput,reason:"x"}),400,"Creating merchant without audited reason rejected");
  const created=expect(await call(platform,"/api/platform/tenants","POST",createInput),201,
    "SuperAdmin creates merchant and one-time Tenant Admin invitation");
  fixture.tenantId=created.id;persist();
  assert.equal(created.platformRevision,1);assert(created.invitationToken.length>30);
  expect(await call(platform,"/api/platform/tenants","POST",createInput),409,
    "Duplicate merchant slug prevented");
  const tenant=expect(await call(platform,"/api/platform/tenants/"+created.id),200,
    "New merchant initially isolated and time-limited");
  assert.equal(tenant.userCount,0);
  const member=session(),ownerPw="A!b123456789_"+randomUUID().replaceAll("-","").slice(0,13);
  await csrf(member);
  const activated=expect(await call(member,"/api/auth/invitations/accept","POST",
    {token:created.invitationToken,displayName:"Merchant QA Owner",password:ownerPw}),201,
    "Platform-issued invitation creates a TENANT Admin, not SuperAdmin");
  fixture.adminUserId=activated.id;persist();
  expect(await call(member,"/api/auth/invitations/accept","POST",
    {token:created.invitationToken,displayName:"Duplicate",password:ownerPw}),400,
    "Initial Admin invitation is single-use");
  expect(await login(member,"/api/auth/login",createInput.adminEmail,ownerPw),200,
    "Invited merchant Admin signs in on merchant cookie");
  const memberMe=expect(await call(member,"/api/auth/me"),200,"Invited account belongs to new Tenant");
  assert.equal(memberMe.role,"Admin");assert.equal(memberMe.tenantId,created.id);
  passDenied(await call(member,"/api/platform/overview"),"New Tenant Admin cannot query platform statistics");
  passDenied(await call(platform,"/api/orders"),"Platform session still cannot see new tenant Orders");

  const newStaffEmail="staff-"+run.toLowerCase()+"@wathiqa.invalid";
  const invite=expect(await call(member,"/api/users/invitations","POST",{email:newStaffEmail,role:"Admin"}),200,
    "Tenant Admin creates staff invitation; forged role Admin is ignored");
  const staff=session(),staffPw="Z!t123456789_"+randomUUID().replaceAll("-","").slice(0,11);
  await csrf(staff);
  const staffAdded=expect(await call(staff,"/api/auth/invitations/accept","POST",
    {token:invite.token,displayName:"QA Staff",password:staffPw}),201,
    "Tenant invitation produces Staff role only");
  fixture.staffUserId=staffAdded.id;persist();
  expect(await login(staff,"/api/auth/login",newStaffEmail,staffPw),200,
    "Tenant Staff logs in under merchant auth only");
  assert.equal((await call(staff,"/api/auth/me")).data.role,"Staff");
  const people=expect(await call(platform,"/api/platform/tenants/"+created.id+"/users"),200,
    "SuperAdmin sees account directory with true merchant roles");
  assert.equal(people.total,2);
  assert(people.items.some(x=>x.id===activated.id&&x.role==="Admin"));
  assert(people.items.some(x=>x.id===staffAdded.id&&x.role==="Staff"));
  const all=expect(await call(platform,"/api/platform/users?q=QA"),200,
    "SuperAdmin searches platform-wide user directory without merchant contents");
  assert(all.total>=1);
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/users/"+activated.id+"/active",
    "POST",{isActive:false,reason:"Attempt to block last company Admin"}),409,
    "Last active merchant Admin cannot be disabled");
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/users/"+staffAdded.id+"/active",
    "POST",{isActive:false,reason:"Disable QA staff during permission check"}),200,
    "SuperAdmin can deactivate a merchant Staff with audit");
  passDenied(await call(staff,"/api/auth/me"),"Deactivated Staff loses access with pre-existing session");
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/users/"+staffAdded.id+"/active",
    "POST",{isActive:true,reason:"Reactivate QA staff after authorization test"}),200,
    "SuperAdmin can restore Staff account");
  expect(await login(staff,"/api/auth/login",newStaffEmail,staffPw),200,
    "Restored Staff can reauthenticate under original tenant");
  const paused=expect(await call(platform,"/api/platform/tenants/"+created.id+"/active","POST",
    {isActive:false,revision:1,reason:"Suspend QA merchant for lifecycle test"}),200,
    "SuperAdmin suspends an entire Tenant with audit");
  assert.equal(paused.platformRevision,2);
  passDenied(await call(member,"/api/auth/me"),"Suspension revokes pre-existing merchant Admin session");
  passDenied(await call(staff,"/api/auth/me"),"Suspension revokes pre-existing merchant Staff session");
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/active","POST",
    {isActive:true,revision:1,reason:"Stale admin request must not succeed"}),409,
    "Stale platform revision blocks repeated suspension changes");
  const resumed=expect(await call(platform,"/api/platform/tenants/"+created.id+"/active","POST",
    {isActive:true,revision:2,reason:"Resume merchant after QA suspension"}),200,
    "SuperAdmin reactivates original merchant");
  assert.equal(resumed.platformRevision,3);
  expect(await login(member,"/api/auth/login",createInput.adminEmail,ownerPw),200,
    "Reactivated tenant Admin signs in again");
  const updated=expect(await call(platform,"/api/platform/tenants/"+created.id+"/access","POST",
    {accessMode:"Unlimited",accessExpiresAtUtc:null,revision:3,
      reason:"Change merchant entitlement to unlimited for QA"}),200,
    "SuperAdmin explicitly changes entitlement from expiry to unlimited");
  assert.equal(updated.accessExpiresAtUtc,null);
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/access","POST",
    {accessMode:"Unlimited",accessExpiresAtUtc:null,revision:3,
      reason:"Attempt duplicate subscription extension"}),409,
    "Stale entitlement request cannot silently extend access twice");
  // PA-02: strict manual subscriptions, with absolutely no platform billing.
  expect(await call(null,"/api/platform/plans"),401,
    "Anonymous visitors cannot read the platform subscription catalogue");
  passDenied(await call(member,"/api/platform/subscriptions"),
    "Merchant Admin cannot inspect platform-wide subscriptions");
  const monthsCode="pa-qa-"+run.slice(6)+"-3m";
  const foreverCode="pa-qa-"+run.slice(6)+"-unlimited";
  const monthsInput={code:monthsCode,name:"QA three month plan",durationMonths:3,
    reason:"Create QA manual duration-only plan"};
  expect(await call(platform,"/api/platform/plans","POST",
    {...monthsInput,durationMonths:0}),400,"Invalid plan duration is rejected");
  expect(await call(platform,"/api/platform/plans","POST",
    {...monthsInput,reason:"tiny"}),400,"Manual plan creation requires an audit reason");
  const monthsPlan=expect(await call(platform,"/api/platform/plans","POST",monthsInput),201,
    "SuperAdmin creates a three-month plan with no monetary fields");
  fixture.planIds.push({id:monthsPlan.id,code:monthsCode});persist();
  assert.equal(monthsPlan.durationMonths,3);
  assert(!Object.keys(monthsPlan).some(k=>/price|amount|payment|invoice|cost|currency/i.test(k)));
  const foreverPlan=expect(await call(platform,"/api/platform/plans","POST",{
    code:foreverCode,name:"QA unlimited plan",durationMonths:null,
    reason:"Create QA unlimited access plan"}),201,
    "SuperAdmin creates unlimited plan without billing fields");
  fixture.planIds.push({id:foreverPlan.id,code:foreverCode});persist();
  expect(await call(platform,"/api/platform/plans","POST",monthsInput),409,
    "Duplicate subscription plan code is rejected");
  const plans=expect(await call(platform,"/api/platform/plans"),200,
    "Plan catalogue lists real duration-only plans and assignment counts");
  assert(plans.some(p=>p.id===monthsPlan.id&&p.durationMonths===3));
  assert(plans.every(p=>!Object.keys(p).some(k=>/price|amount|payment|invoice|cost|currency/i.test(k))));
  const beforeManual=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription"),200,
    "Previously seeded entitlement is visible but not converted automatically");
  assert.equal(beforeManual.hasSubscription,false);assert.equal(beforeManual.accessExpiresAtUtc,null);
  const assigned=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/assign",
    "POST",{planId:monthsPlan.id,revision:4,reason:"Assign three month access to QA merchant"}),200,
    "SuperAdmin manually assigns three-month subscription to tenant");
  assert.equal(assigned.platformRevision,5);
  const assignedExpiry=new Date(assigned.expiresAtUtc).getTime();
  assert(assignedExpiry>Date.now()+74*86400000&&assignedExpiry<Date.now()+100*86400000);
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/assign",
    "POST",{planId:monthsPlan.id,revision:4,reason:"Retry of stale manual assign"}),409,
    "Duplicate subscription assignment retry cannot change expiration twice");
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/access","POST",
    {accessMode:"Unlimited",revision:5,reason:"Attempt subscription bypass via old access API"}),409,
    "Legacy entitlement editor cannot override a managed subscription");
  const subDetails=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription"),200,
    "Subscription is associated with its plan and authoritative tenant expiry");
  assert.equal(subDetails.subscription.planId,monthsPlan.id);
  assert.equal(subDetails.accessExpiresAtUtc,subDetails.subscription.expiresAtUtc);
  const directory=expect(await call(platform,"/api/platform/subscriptions?pageSize=5"),200,
    "Platform subscription directory paginates tenant plans and legacy access");
  assert(directory.items.some(x=>x.tenantId===created.id&&x.planId===monthsPlan.id));
  expect(await call(platform,"/api/platform/subscriptions?pageSize=200"),400,
    "Unbounded platform subscription directory is rejected");
  const renewReq={revision:5,reason:"Extend this manual QA subscription exactly once"};
  const renewPair=await Promise.all([
    call(platform,"/api/platform/tenants/"+created.id+"/subscription/renew","POST",renewReq),
    call(platform,"/api/platform/tenants/"+created.id+"/subscription/renew","POST",renewReq)]);
  assert.deepEqual(renewPair.map(x=>x.status).sort(),[200,409]);
  pass("Concurrent renewal requests extend the period exactly once via tenant revision lock");
  const renewal=renewPair.find(x=>x.status===200).data;
  assert(new Date(renewal.expiresAtUtc).getTime()>assignedExpiry+74*86400000);
  const stoppedPlan=expect(await call(platform,"/api/platform/plans/"+monthsPlan.id+"/active",
    "POST",{isActive:false,reason:"Suspend new subscriptions to QA plan"}),200,
    "SuperAdmin can stop a plan for new assignments without touching current access");
  assert.equal(stoppedPlan.isActive,false);
  const afterStop=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription"),200,
    "Existing subscription remains intact after disabling its plan");
  assert.equal(afterStop.accessExpiresAtUtc,renewal.expiresAtUtc);
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/renew",
    "POST",{revision:6,reason:"Renew a now-disabled plan"}),409,
    "Disabled plan rejects future renewals without deleting subscription");
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/assign",
    "POST",{planId:monthsPlan.id,revision:6,reason:"Assign disabled plan"}),400,
    "Disabled plan rejects assignment");
  expect(await call(platform,"/api/platform/plans/"+monthsPlan.id+"/active",
    "POST",{isActive:true,reason:"Restore QA plan availability"}),200,
    "SuperAdmin can re-enable a plan without modifying tenant expiry");
  const unlimited=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/assign",
    "POST",{planId:foreverPlan.id,revision:6,reason:"Switch QA merchant to lifetime manual plan"}),200,
    "SuperAdmin can deliberately switch to unlimited plan");
  assert.equal(unlimited.expiresAtUtc,null);
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/renew",
    "POST",{revision:7,reason:"Unlimited access must not renew"}),409,
    "Unlimited subscription does not support meaningless renewal");
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/assign",
    "POST",{planId:foreverPlan.id,revision:7,reason:"Assign existing plan again"}),409,
    "Assigning same active plan again cannot silently reset its start date");
  const ended=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/end",
    "POST",{revision:7,reason:"End QA subscription manually with full audit"}),200,
    "SuperAdmin can manually end unlimited subscription without deleting tenant");
  assert.equal(ended.platformRevision,8);
  const endedState=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription"),200,
    "Subscription end preserves historical plan and records expiration");
  assert(endedState.subscription.endedAtUtc);
  assert.equal(endedState.isActive,true);
  passDenied(await call(member,"/api/auth/me"),
    "Ending subscription immediately revokes an existing authenticated merchant session");
  expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/end",
    "POST",{revision:8,reason:"Duplicate end must not mutate"}),409,
    "Repeated subscription end is rejected");
  const again=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription/assign",
    "POST",{planId:monthsPlan.id,revision:8,reason:"Restore QA access with newly assigned plan"}),200,
    "Ended subscription may be restarted with explicit new assignment");
  assert.equal(again.platformRevision,9);
  expect(await login(member,"/api/auth/login",createInput.adminEmail,ownerPw),200,
    "Merchant regains access after new manual subscription assignment");
  const finalSubscription=expect(await call(platform,"/api/platform/tenants/"+created.id+"/subscription"),200,
    "Current subscription metadata agrees with the final tenant authorization deadline");
  assert.equal(finalSubscription.accessExpiresAtUtc,finalSubscription.subscription.expiresAtUtc);
  const audits=expect(await call(platform,"/api/platform/audits?tenantId="+created.id),200,
    "Platform audit trail retains before/after and actor/reason for this Tenant");
  assert(audits.items.some(x=>x.action==="TenantAccessChanged"&&x.beforeJson.includes("2027")));
  assert(audits.items.some(x=>x.action==="TenantActiveChanged"));
  assert(audits.items.some(x=>x.action==="ManualSubscriptionRenewed"));
  assert(audits.items.some(x=>x.action==="ManualSubscriptionEnded"));
  assert(!JSON.stringify(audits.items).includes(created.invitationToken));
  expect(await call(platform,"/api/platform/auth/logout","POST"),204,
    "SuperAdmin can revoke separate platform cookie via logout");
  passDenied(await call(platform,"/api/platform/auth/me"),"Platform logout invalidates further administrative access");
  expect(await call(member,"/api/auth/me"),200,"Merchant session remains independent of platform logout");
  console.log("PLATFORM_SUPERADMIN_PASS_COUNT="+count);
  console.log("PLATFORM_QA_FIXTURE="+file);
}catch(error){
  console.error("PLATFORM_SUPERADMIN_TEST_FAILED",error);
  console.error("PLATFORM_QA_FIXTURE="+file);
  process.exitCode=1;
}
