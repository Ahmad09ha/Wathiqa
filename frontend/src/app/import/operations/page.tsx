"use client";

import {Suspense,useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import {ArrowUpLeft,FileWarning,Ship,Clock3,RefreshCw} from "lucide-react";
import ImportShell from "@/components/ImportShell";
import {useToast} from "@/components/ToastProvider";
import {
  ContainerReportPage,MissingDocumentsPage,fetchMissingDocuments,fetchOperationalContainers
} from "@/lib/operationsApi";
import {documentTypeLabel} from "@/lib/documentsApi";

type View="atSea"|"freeTime"|"missing";
const views:ReadonlyArray<{id:View;label:string}>=[
 {id:"atSea",label:"حاويات في البحر"},
 {id:"freeTime",label:"مدة السماح"},
 {id:"missing",label:"مستندات ناقصة"}
];
const date=(value:string|null)=>value?
 new Date(value+"T00:00:00").toLocaleDateString("ar-SY-u-nu-latn"):"—";
const status:Record<string,string>={
 Planned:"مخططة",AtSea:"في البحر",AtPort:"في الميناء",
 Delivered:"تم التسليم",NotShipped:"لم يبدأ",PartiallyDelivered:"وصل جزء",
 NotStarted:"لم يبدأ التخليص",Released:"مفرج عن الكل"
};
function OperationsContent(){
 const {notify}=useToast();
 const router=useRouter();
 const params=useSearchParams();
 const query=params.toString();
 const view:View=params.get("view")==="freeTime"?"freeTime":
   params.get("view")==="missing"?"missing":"atSea";
 const page=Math.max(1,Number(params.get("page"))||1);
 const days=[7,14,30].includes(Number(params.get("days")))?
   Number(params.get("days")):14;
 const [data,setData]=useState<ContainerReportPage|MissingDocumentsPage|null>(null);
 const [loading,setLoading]=useState(true);
 const [refresh,setRefresh]=useState(0);
 const isMissing=view==="missing";
 const requestParams=useMemo(()=>{
  const request=new URLSearchParams({page:String(page),pageSize:"25"});
  if(view==="atSea")request.set("status","AtSea");
  if(view==="freeTime")request.set("freeTimeWindowDays",String(days));
  return request;
 },[page,view,days]);
 const load=useCallback(async()=>{
  setLoading(true);setData(null);
  try{
   const result=isMissing?
     await fetchMissingDocuments(requestParams):
     await fetchOperationalContainers(requestParams);
   setData(result);
  }catch(error){
   notify({kind:"error",title:"تعذّر تحميل متابعة العمليات",description:(error as Error).message});
  }finally{setLoading(false);}
 },[isMissing,requestParams,notify]);
 useEffect(()=>{void load();},[load,refresh]);
 function navigate(nextView:View,nextPage=1,nextDays=days){
  const q=new URLSearchParams({view:nextView});
  if(nextView==="freeTime")q.set("days",String(nextDays));
  if(nextPage>1)q.set("page",String(nextPage));
  router.push("/import/operations?"+q.toString(),{scroll:false});
 }
 const paged=data;
 const totalPages=paged?Math.max(1,Math.ceil(paged.total/paged.pageSize)):1;
 const containerData=!isMissing&&data?data as ContainerReportPage:null;
 const gaps=isMissing&&data?data as MissingDocumentsPage:null;
 return <>
  <div className="im-section-header im-orders-top">
   <div><small>متابعة التشغيل / الشحن والمستندات</small>
    <h2>متابعة عمليات الاستيراد</h2>
    <p>استعلامات مباشرة من الحاويات والبوالص وقواعد المستندات في مساحة شركتك فقط.</p>
   </div>
   <button type="button" className="btn btn-outline" onClick={()=>setRefresh(x=>x+1)}>
    <RefreshCw size={16}/> تحديث
   </button>
  </div>
  <div className="im-ops-tabs" role="group" aria-label="نوع متابعة العمليات">
   {views.map(option=><Link key={option.id}
     className={"im-ops-tab "+(view===option.id?"active":"")}
     href={"/import/operations?view="+option.id}>
     {option.id==="atSea"?<Ship size={17}/>:option.id==="freeTime"?<Clock3 size={17}/>:<FileWarning size={17}/>}
     {option.label}
   </Link>)}
  </div>
  <div className="im-table-shell im-ops-shell">
   <div className="im-ops-descriptor">
    <div>
     <strong>{view==="atSea"?"الحاويات الموجودة في البحر":
       view==="freeTime"?"حاويات قاربت أو تجاوزت فترة السماح":"النواقص حسب قواعد مدير الشركة"}</strong>
     <p>{view==="atSea"?"حاويات مسجلة بحالة AtSea، دون اعتبار كامل الطلب مشحوناً تلقائياً.":
      view==="freeTime"?"تُعرض الحاويات غير المسلّمة التي يقع تاريخ نهاية Free Time لها قبل المهلة المختارة، ويشمل ذلك المتأخرة. يتم الحساب بتوقيت UTC.":
       "المستند يُعتبر ناقصاً فقط إذا كان مطلوباً في مرحلته الحالية، وليس له رابط مباشر صالح أو استثناء إداري. لا توجد متطلبات افتراضية مفروضة."}</p>
    </div>
    {view==="freeTime"&&<label className="im-ops-days">
      مهلة المتابعة
      <select aria-label="عدد أيام متابعة مدة السماح" value={days}
       onChange={e=>navigate("freeTime",1,Number(e.target.value))}>
       <option value={7}>7 أيام</option><option value={14}>14 يوماً</option>
       <option value={30}>30 يوماً</option>
      </select>
    </label>}
   </div>
   {loading?<div className="im-empty">جارٍ تحديث البيانات من الخادم...</div>:
    !data||data.total===0?<div className="im-empty">
     {isMissing?<FileWarning size={29}/>:<Ship size={29}/>}
     <strong>{isMissing?"لا توجد نواقص مسجّلة وفق القواعد الحالية":
      view==="atSea"?"ما في حاويات بحالة في البحر":"لا توجد حاويات غير مسلّمة ضمن مهلة المتابعة"}</strong>
     <p>{isMissing?"إذا لم يحدد المدير قواعد إلزامية، فلن يفترض النظام أن مستنداً ناقص.":
       "يتم التحديث تلقائياً من آخر بيانات الشحن الموثّقة."}</p>
    </div>:<>
     <div className="im-report-result-header">
      <span>النتائج: <strong>{data.total}</strong></span>
      <small>الصفحة {page} من {totalPages}</small>
     </div>
     {containerData&&<div className="im-table-scroll" data-lenis-prevent>
      <table className="im-table im-ops-table">
       <thead><tr><th>الحاوية</th><th>طلب الشراء</th><th>بوليصة B/L</th>
        <th>المورّد</th><th>الحالة</th><th>ETA</th><th>نهاية Free Time</th><th>فتح</th></tr></thead>
       <tbody>{containerData.items.map(c=><tr key={c.id}>
        <td data-label="الحاوية"><strong dir="ltr">{c.number}</strong><small dir="ltr">{c.size}</small></td>
        <td data-label="طلب الشراء"><Link href={"/import/orders/"+c.orderId} className="im-order-ref" dir="ltr">{c.orderNumber}</Link></td>
        <td data-label="بوليصة الشحن"><span dir="ltr">{c.blNumber}</span></td>
        <td data-label="المورّد"><span dir="auto">{c.supplier}</span></td>
        <td data-label="الحالة"><span className="im-pill">{status[c.status]||c.status}</span></td>
        <td data-label="ETA">{date(c.eta)}</td>
        <td data-label="Free Time">{date(c.freeTimeEndDate)}</td>
        <td data-label="فتح"><Link className="im-order-open" href={"/import/orders/"+c.orderId}
         aria-label={"فتح الطلب "+c.orderNumber}><ArrowUpLeft size={18}/></Link></td>
       </tr>)}</tbody>
      </table>
     </div>}
     {gaps&&<div className="im-table-scroll" data-lenis-prevent>
      <table className="im-table im-ops-table">
       <thead><tr><th>طلب الشراء</th><th>الجهة</th><th>المرجع</th>
        <th>نوع المستند الناقص</th><th>المرحلة</th><th>فتح</th></tr></thead>
       <tbody>{gaps.items.map(g=><tr key={g.requirementId+"-"+g.targetId}>
        <td data-label="طلب الشراء"><Link className="im-order-ref"
          href={"/import/orders/"+g.orderId} dir="ltr">{g.orderNumber}</Link></td>
        <td data-label="الجهة">{g.targetType==="Order"?"الطلب":
          g.targetType==="Shipment"?"البوليصة":"الحاوية"}</td>
        <td data-label="المرجع"><span dir="ltr">{g.targetLabel}</span></td>
        <td data-label="نوع المستند"><strong>{documentTypeLabel(g.documentType)}</strong></td>
        <td data-label="المرحلة"><span className="im-pill">{status[g.stage]||g.stage}</span></td>
        <td data-label="فتح"><Link className="im-order-open" href={"/import/orders/"+g.orderId}
         aria-label={"فتح طلب "+g.orderNumber}><ArrowUpLeft size={18}/></Link></td>
       </tr>)}</tbody>
      </table>
     </div>}
     <div className="im-order-pagination">
      <span>الصفحة {page} من {totalPages}</span>
      <div>
       <button type="button" className="btn btn-outline" disabled={page<=1}
        onClick={()=>navigate(view,page-1)}>السابق</button>
       <button type="button" className="btn btn-outline" disabled={page>=totalPages}
        onClick={()=>navigate(view,page+1)}>التالي</button>
      </div>
     </div>
    </>}
  </div>
  <div className="im-info-strip im-ops-finance-note">
   <div><strong>المتابعة المالية القادمة</strong>
    <p>الاستحقاقات، الحوالات، والمتبقي الفعلي لا تُحسب ضمن هذه التقارير حتى تتوفر قيود مالية معتمدة في WP-05.</p>
   </div>
  </div>
 </>;
}
export default function OperationsPage(){
 return <ImportShell section="operations" title="متابعة العمليات"
  description="الحاويات والمستندات والإجراءات التشغيلية تحت المتابعة.">
  {()=> <Suspense fallback={<div className="im-empty">جارٍ تجهيز المتابعة...</div>}>
   <OperationsContent/>
  </Suspense>}
 </ImportShell>;
}
