// WP-09: scanner EXIT-CODE PIPELINE contract, not real antivirus detection.
// Uses an isolated test-only API port + private storage root.
// QA source is a harmless PDF with markers checked by a fake scanner binary.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync,writeFileSync,readdirSync} from "node:fs";
import {join} from "node:path";

const root=process.cwd(),local=join(root,".local");
const accounts=JSON.parse(readFileSync(join(local,"import-demo-accounts.json"),"utf8").replace(/^\uFEFF/,""));
const base="http://127.0.0.1:5096";
const run="WP07_QA_"+randomUUID().replaceAll("-","").slice(0,9);
const fixture={run,orders:[],companies:[],shipments:[],containers:[],documents:[],requirements:[],waivers:[]};
const fixturePath=join(local,"documents-qa-fixtures-"+run+".json");
const save=()=>writeFileSync(fixturePath,JSON.stringify(fixture,null,2));
const track=(kind,tenant,id)=>{fixture[kind].push({tenant,id});save()};
let passed=0;
const pass=x=>{console.log("PASS "+x);passed++};
async function call(session,path,method="GET",body){
 const headers={Accept:"application/json"};
 if(session){
  headers.Cookie=Object.entries(session.cookies).map(([k,v])=>k+"="+v).join("; ");
  if(!["GET","HEAD"].includes(method))headers["X-Wathiqa-CSRF"]=session.csrf;
 }
 if(body!==undefined&&!(body instanceof FormData))headers["Content-Type"]="application/json";
 const response=await fetch(base+path,{method,headers,redirect:"manual",
   body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(session)for(const c of response.headers.getSetCookie?.()||[]){
  const m=c.match(/^([^=;]+)=([^;]*)/);
  if(m)session.cookies[m[1]]=m[2];
 }
 let data=null;
 if(response.status!==204){
  const raw=await response.text();
  try{data=JSON.parse(raw)}catch{data=raw}
 }
 return {status:response.status,data};
}
function expect(response,status,label){
 assert.equal(response.status,status,label+": "+JSON.stringify(response.data).slice(0,500));
 pass(label);return response.data;
}
async function login(slug){
 const account=accounts.find(x=>x.slug===slug);
 assert(account,"Missing demo credentials "+slug);
 const session={cookies:{},csrf:""};
 session.csrf=expect(await call(session,"/api/auth/csrf"),200,"CSRF token for "+slug).token;
 expect(await call(session,"/api/auth/login","POST",
   {email:account.email,password:account.password}),200,"Login "+slug);
 session.csrf=(await call(session,"/api/auth/csrf")).data.token;
 return session;
}
function purchase(supplierId){
 return {supplierId,customerId:null,supplierRef:run,orderDate:"2026-11-07",
   incoterm:"FOB",loadingPort:"Ningbo",dischargePort:"Latakia",currency:"USD",
   notes:"WP09 disposable antivirus exit-code test",revision:null,
   items:[{productType:"POY",denier:"150/48",luster:"SD",grade:"AA",
     colorType:"White",quantity:1000,quantityUnit:"KG",unitPrice:1.5,priceUnit:"KG",hsCode:"540246"}]};
}
function pdfPayload(orderId,marker){
 const contents="%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"+marker+"\n";
 const form=new FormData();
 form.append("file",new Blob([Buffer.from(contents,"utf8")],{type:"application/pdf"}),
   "qa-wp09.pdf");
 form.append("type","CommercialInvoice");
 form.append("orderId",orderId);
 form.append("notes","QA malware scanner process status test");
 return form;
}
try{
 save();
 const anonymous=await call(null,"/api/documents");
 expect(anonymous,401,"Protected documents reject anonymous calls");
 const a=await login("demo-a"),b=await login("demo-b");
 const supplier=expect(await call(a,"/api/companies","POST",
  {name:run+" Antivirus QA Supplier",type:"Supplier"}),201,"QA supplier");
 track("companies","A",supplier.id);
 const order=expect(await call(a,"/api/orders","POST",purchase(supplier.id)),201,
  "QA order scoped to Tenant A");
 track("orders","A",order.id);
 const clean=expect(await call(a,"/api/documents","POST",
  pdfPayload(order.id,"QA_SAFE_MARKER")),201,"Clean scanner exit 0 creates private file");
 track("documents","A",clean.document.id);
 assert.equal(clean.document.scanStatus,"Clean");
 pass("Only scanner-confirmed Clean status is stored in database");
 const listed=expect(await call(a,"/api/documents?orderId="+order.id),200,
  "Clean file appears in scoped order document registry");
 assert.equal(listed.total,1);
 assert.equal(listed.items[0].scanStatus,"Clean");
 expect(await call(b,"/api/documents/"+clean.document.id),404,
  "Different merchant cannot access scanner-tested document");
 expect(await call(a,"/api/documents","POST",
  pdfPayload(order.id,"QA_MALWARE_MARKER")),400,"Scanner exit 1 rejects alleged infected file");
 const flagged=await call(a,"/api/documents?orderId="+order.id);
 assert.equal(flagged.data.total,1);
 pass("Malware-rejected upload creates no StoredDocument DB row");
 const unavail=expect(await call(a,"/api/documents","POST",
  pdfPayload(order.id,"QA_SCAN_FAILURE")),503,
  "Scanner exit 2 fails closed with temporary server error");
 assert.equal(unavail.error,"scanner_unavailable");
 const afterError=await call(a,"/api/documents?orderId="+order.id);
 assert.equal(afterError.data.total,1);
 pass("Scanner error creates no document or link");
 const corrupt=new FormData();
 corrupt.append("file",new Blob([Buffer.from("BAD_SIGNATURE\n")],
    {type:"application/pdf"}),"qa-wp09-invalid.pdf");
 corrupt.append("type","CommercialInvoice");
 corrupt.append("orderId",order.id);
 expect(await call(a,"/api/documents","POST",corrupt),400,
  "Invalid PDF signature rejected before scanning");
 const tenantDir=join(local,"wp09-scanner-private",String(clean.document.tenantId??""));
 // Inspect only the isolated test root. No external files or folders touched.
 const rootEntries=readdirSync(join(local,"wp09-scanner-private"),{withFileTypes:true});
 const savedFiles=rootEntries.filter(x=>x.isDirectory())
  .flatMap(x=>readdirSync(join(local,"wp09-scanner-private",x.name)));
 assert.equal(savedFiles.length,1,"Expected exactly one saved blob and zero .pending files");
 pass("Infected/errored uploads leave neither pending nor finalized orphan files");
 console.log("WP09_SCANNER_CONTRACT_PASS_COUNT="+passed);
 console.log("WP09_SCANNER_FIXTURE="+fixturePath);
}catch(error){
 console.error("WP09_SCANNER_TEST_FAILED",error);
 console.error("WP09_SCANNER_FIXTURE="+fixturePath);
 process.exitCode=1;
}
