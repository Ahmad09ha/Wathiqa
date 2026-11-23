// Explicitly scoped local demo-only cleanup. This script never touches the
// legacy template database, other tenants, non-draft orders or actual payments.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const apply=process.argv.includes("--apply");
const base="http://127.0.0.1:5089";
const accounts=JSON.parse(readFileSync(join(process.cwd(),".local/import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const account=accounts.find(x=>x.slug==="demo-a");
assert(account,"Missing demo-a test account");
const cookies={};
async function request(path,method="GET",body,csrf){
 const headers={Accept:"application/json",Cookie:Object.entries(cookies).map(([k,v])=>k+"="+v).join("; ")};
 if(csrf)headers["X-Wathiqa-CSRF"]=csrf;
 if(body!==undefined)headers["Content-Type"]="application/json";
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 for(const c of response.headers.getSetCookie?.()||[]){
  const m=c.match(/^([^=;]+)=([^;]*)/);
  if(m)cookies[m[1]]=m[2];
 }
 let data=null;
 if(response.status!==204){
  const text=await response.text();
  if(text){try{data=JSON.parse(text)}catch{data=text}}
 }
 return {status:response.status,data};
}
let response=await request("/api/auth/csrf");assert.equal(response.status,200);
const csrf=response.data.token;
response=await request("/api/auth/login","POST",{email:account.email,password:account.password},csrf);
assert.equal(response.status,200,"Local QA login failed");
response=await request("/api/auth/me");
assert.equal(response.status,200);
assert.equal(response.data.slug,"demo-a","Refusing to modify non-QA tenant");
let token=(await request("/api/auth/csrf")).data.token;
const orders=[];
for(let page=1;page<50;page++){
 const params=new URLSearchParams({search:"Browser Orders QA ",page:String(page),pageSize:"100"});
 const listed=await request("/api/orders?"+params);
 assert.equal(listed.status,200);
 orders.push(...listed.data.items.filter(o=>o.supplierNameSnapshot.startsWith("Browser Orders QA ")));
 if(listed.data.items.length<100)break;
}
const companies=(await request("/api/companies")).data.filter(c=>c.name.startsWith("Browser Orders QA "));
const deletable=orders.filter(o=>o.status==="Draft" &&
  o.financialsAvailable===false && o.paidAmount===null);
console.log("QA_CANDIDATES orders="+orders.length+" safeDrafts="+deletable.length+" suppliers="+companies.length);
if(!apply){console.log("DRY_RUN only; pass --apply to soft-delete known QA fixtures");process.exit(0)}
const retained=new Set(orders.filter(o=>!deletable.includes(o)).map(o=>o.supplierId));
let deletedOrders=0,deletedCompanies=0;
for(const order of deletable){
 const result=await request("/api/orders/"+encodeURIComponent(order.id)+"?revision="+order.revision,"DELETE",undefined,token);
 if(result.status!==204)throw Error("Could not clean QA draft "+order.number+" HTTP "+result.status);
 deletedOrders++;
}
for(const company of companies){
 if(retained.has(company.id)){console.log("SKIP company referenced by non-draft order");continue}
 const result=await request("/api/companies/"+encodeURIComponent(company.id),"DELETE",undefined,token);
 if(result.status!==204)throw Error("Could not clean QA supplier "+company.name+" HTTP "+result.status);
 deletedCompanies++;
}
console.log("QA_SOFT_DELETED draftOrders="+deletedOrders+" suppliers="+deletedCompanies);
