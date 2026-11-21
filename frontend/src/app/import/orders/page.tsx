"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpLeft, ClipboardList, FileText, Filter, Plus, Search, Trash2, Ship, Info, RotateCcw, Package, Truck, CheckCircle2, FileCheck2, SlidersHorizontal, ChevronDown, ChevronUp, Clock3, AlertTriangle } from "lucide-react";
import ImportShell from "@/components/ImportShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {Badge} from "@/components/ui/badge";
import { useToast } from "@/components/ToastProvider";
import {
  fetchImportCompanyOptions, fetchOrders, importApi, ImportCompanyOption,
  OrderListItem, OrdersPage as OrdersPageResult
} from "@/lib/importApi";

const amount=(value:number,currency:string)=>
  new Intl.NumberFormat("en-US",{maximumFractionDigits:2,minimumFractionDigits:2}).format(value)+" "+currency;
const quantity=(value:number)=>
  new Intl.NumberFormat("en-US",{maximumFractionDigits:3}).format(value)+" KG";
const arrivalNames:Record<string,string>={
 NotShipped:"لم يبدأ الشحن",Planned:"مخطط",AtSea:"في البحر",
 AtPort:"في الميناء",PartiallyDelivered:"وصل جزء",Delivered:"تم التسليم"
};
const clearanceNames:Record<string,string>={
 NotStarted:"لم يبدأ",InProgress:"قيد التخليص",Partial:"مفرج عن جزء",Released:"مفرج بالكامل"
};
const arrivalOptions=[
 ["","كل حالات الوصول"],["NotShipped","لم يبدأ الشحن"],["Planned","مخطط"],
 ["AtSea","في البحر"],["AtPort","في الميناء"],
 ["PartiallyDelivered","وصل جزء"],["Delivered","تم التسليم"]
];
const clearanceOptions=[
 ["","كل حالات التخليص"],["NotStarted","لم يبدأ"],["InProgress","قيد التخليص"],
 ["Partial","مفرج عن جزء"],["Released","مفرج بالكامل"]
];
type Filters={
  q:string;supplierId:string;currency:string;arrival:string;clearance:string;
  payment:string;overdue:string;status:string;
  from:string;to:string;sort:string;
};
function parseFilters(search:URLSearchParams):Filters {
 return {
  q:search.get("q")||search.get("search")||"",
  supplierId:search.get("supplierId")||"",
  currency:search.get("currency")||"",
  arrival:search.get("arrival")||"",
   clearance:search.get("clearance")||"",
   payment:search.get("payment")||"",
   overdue:search.get("overdue")==="true"?"true":"",
   status:search.get("status")||"",
  from:search.get("from")||"",
  to:search.get("to")||"",
  sort:search.get("sort")||"newest"
 };
}
function OrdersContent({canManagePayments}:{canManagePayments:boolean}){
 const {notify}=useToast();
 const router=useRouter();
 const searchParams=useSearchParams();
 const rawSearch=searchParams.toString();
 const active=useMemo(()=>new URLSearchParams(rawSearch),[rawSearch]);
 const [draft,setDraft]=useState<Filters>(()=>parseFilters(active));
  const [suppliers,setSuppliers]=useState<ImportCompanyOption[]>([]);
 const [data,setData]=useState<OrdersPageResult|null>(null);
 const [loading,setLoading]=useState(true);
 const [refresh,setRefresh]=useState(0);
 const [deleting,setDeleting]=useState<OrderListItem|null>(null);
  const [busy,setBusy]=useState(false);
  const [showAdvanced,setShowAdvanced]=useState(()=>{
    const initial=parseFilters(active);
    return Boolean(initial.currency||initial.clearance||initial.payment||initial.overdue||
      initial.status||initial.from||initial.to||initial.sort!=="newest");
  });
 const page=Math.max(1,Math.min(100000,Number(active.get("page"))||1));
 const filters=useMemo(()=>parseFilters(active),[active]);
 const params=useMemo(()=>{
  const q=new URLSearchParams();
  q.set("page",String(page));q.set("pageSize","25");
  for(const [key,value] of Object.entries(filters))if(value&&!(key==="sort"&&value==="newest"))q.set(key,value);
  return q;
 },[page,filters]);
 const query=params.toString();
 useEffect(()=>{setDraft(parseFilters(new URLSearchParams(rawSearch)));},[rawSearch]);
 const load=useCallback(async()=>{
  setLoading(true);
  try {setData(await fetchOrders(new URLSearchParams(query)));}
  catch(error){notify({kind:"error",title:"تعذّر تحميل طلبات الشراء",description:(error as Error).message});}
  finally{setLoading(false);}
 },[query,notify]);
 useEffect(()=>{void load();},[load,refresh]);
 useEffect(()=>{
   fetchImportCompanyOptions().then(companies=>
   setSuppliers(companies.filter(x=>x.type==="Supplier"))
  ).catch(error=>notify({kind:"error",title:"تعذّر تحميل المورّدين",description:(error as Error).message}));
 },[notify]);
 function update<K extends keyof Filters>(key:K,value:Filters[K]){
  setDraft(prev=>({...prev,[key]:value}));
 }
 function navigate(next:Filters,nextPage=1){
  const q=new URLSearchParams();
  for(const [key,value] of Object.entries(next)){
   if(value&&!(key==="sort"&&value==="newest"))q.set(key,value);
  }
  if(nextPage>1)q.set("page",String(nextPage));
  router.push("/import/orders"+(q.size?"?"+q.toString():""),{scroll:false});
 }
 function apply(event:FormEvent){event.preventDefault();navigate({...draft,q:draft.q.trim()});}
 function reset(){
  const empty=parseFilters(new URLSearchParams());
  setDraft(empty);navigate(empty);
 }
   function quickAtSea(){navigate({...filters,arrival:filters.arrival==="AtSea"?"":"AtSea",clearance:""});}
   function quickOverdue(){navigate({...filters,overdue:filters.overdue==="true"?"":"true",payment:""});}
   function quickDeliveredUnpaid(){
     const enabled=filters.arrival==="Delivered"&&filters.payment==="Outstanding";
     navigate({...filters,arrival:enabled?"":"Delivered",payment:enabled?"":"Outstanding",overdue:""});
   }
 async function deleteDraft(){
  if(!deleting||busy)return;
  setBusy(true);
  try{
   await importApi<void>("/api/orders/"+deleting.id+"?revision="+deleting.revision,{method:"DELETE"});
   notify({kind:"success",title:"تم حذف مسودة الطلب",description:"بقي سجل العملية محفوظاً للمراجعة."});
   setDeleting(null);setRefresh(x=>x+1);
  }catch(error){
   notify({kind:"error",title:"تعذّر حذف المسودة",description:(error as Error).message});
  }finally{setBusy(false);}
 }
  const pages=data?Math.max(1,Math.ceil(data.total/data.pageSize)):1;
  const hasFilters=Object.entries(filters).some(([key,value])=>Boolean(value)&&!(key==="sort"&&value==="newest"));
  const currentItems=data?.items??[];
  const stats=[
    {title:"الطلبات المطابقة",value:data?.total??"—",description:"حسب الفلاتر المختارة",icon:Package,tone:"navy"},
    {title:"في البحر أو الميناء",value:data?currentItems.filter(order=>order.arrivalStatus==="AtSea"||order.arrivalStatus==="AtPort").length:"—",
      description:"ضمن الصفحة الحالية",icon:Truck,tone:"teal"},
    {title:"قيد التخليص",value:data?currentItems.filter(order=>order.clearanceStatus==="InProgress"||order.clearanceStatus==="Partial").length:"—",
      description:"ضمن الصفحة الحالية",icon:FileCheck2,tone:"blue"},
    {title:"تم تسليمها",value:data?currentItems.filter(order=>order.arrivalStatus==="Delivered").length:"—",
      description:"ضمن الصفحة الحالية",icon:CheckCircle2,tone:"green"},
  ];
  const appliedCount=Object.entries(filters).filter(([key,value])=>Boolean(value)&&!(key==="sort"&&value==="newest")).length;
  return <>
   <div className="im-section-header im-orders-top">
    <div><small>إدارة المشتريات</small>
     <p>جميع أوامر الشراء والشحنات وبيانات التخليص في مكان واحد.</p>
   </div>
    {canManagePayments&&<div className="im-order-create-actions">
      <Link className="btn btn-outline" href="/import/orders/from-file"><Plus size={17}/> إدخال من ملف</Link>
      <Link className="btn primary" href="/import/orders/new"><Plus size={17}/> طلب شراء جديد</Link>
    </div>}
   </div>
   <section className="im-orders-stats" aria-label="ملخص الطلبات">
     {stats.map(({title,value,description,icon:Icon,tone})=>
       <Card key={title} className="im-orders-stat gap-0 py-0">
         <span className={"im-orders-stat-icon tone-"+tone}><Icon size={20}/></span>
         <div><span className="im-orders-stat-label">{title}</span>
           <strong dir="auto">{value}</strong>
           <small>{description}</small></div>
       </Card>)}
   </section>
   {!canManagePayments&&<div className="im-info-strip im-order-readonly-notice">
     <Info size={19}/><div><strong>صلاحية الاطلاع فقط</strong>
       <p>يمكنك مشاهدة الأسعار والشحنات، أما إنشاء الطلب وتعديل أسعاره فيحتاج CanManagePayments.</p>
    </div>
  </div>}
   <div className="im-info-strip im-order-finance-pending">
     <Info size={19}/><div><strong>المدفوع والمتبقي حسب السجل المالي الحقيقي</strong>
     <p>الخطة لا تُحسب حوالة؛ المبالغ المعروضة تأتي من تخصيصات الحوالات المسجّلة فعلياً لكل طلب وعملته، والفروقات تبقى داخل الطلب.</p></div>
   </div>
   <div className="im-table-shell im-orders-results">
    <div className="im-orders-filters-heading">
      <div className="im-orders-filter-heading-icon"><SlidersHorizontal size={19}/></div>
      <div><h2>تصفية الطلبات</h2><p>ابحث عن طلب، أو اختر المورّد وحالة الشحن. يمكنك توسيع الخيارات عند الحاجة.</p></div>
      {appliedCount>0&&<Badge variant="secondary" className="im-orders-applied-count">{appliedCount} فلاتر نشطة</Badge>}
    </div>
    <form className="im-table-toolbar im-order-toolbar im-report-filter im-orders-filter-form" onSubmit={apply}>
     <div className="im-orders-filter-main">
       <label className="im-orders-field im-orders-search-field"><span>رقم الطلب أو المورّد أو مرجع الفاتورة</span>
         <span className="im-search"><Search size={18}/>
           <input aria-label="البحث في الطلبات" placeholder="ابحث في طلبات الشراء..."
             value={draft.q} onChange={e=>update("q",e.target.value)}/></span>
       </label>
       <label className="im-orders-field"><span>المورّد</span>
         <select className="im-filter-select" aria-label="فلتر المورّد" value={draft.supplierId}
           onChange={e=>update("supplierId",e.target.value)}>
           <option value="">كل المورّدين</option>
           {suppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
         </select>
       </label>
       <label className="im-orders-field"><span>حالة الوصول</span>
         <select className="im-filter-select" aria-label="فلتر حالة الوصول" value={draft.arrival}
           onChange={e=>update("arrival",e.target.value)}>
           {arrivalOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
         </select>
       </label>
     </div>
     <div className="im-orders-filter-advanced" id="im-orders-advanced-filters" hidden={!showAdvanced}>
       <label className="im-orders-field"><span>العملة</span>
         <select className="im-filter-select" aria-label="فلتر العملة" value={draft.currency}
           onChange={e=>update("currency",e.target.value)}>
           <option value="">كل العملات</option>
           {["USD","EUR","CNY","TRY"].map(x=><option key={x} value={x}>{x}</option>)}
         </select>
       </label>
       <label className="im-orders-field"><span>التخليص الجمركي</span>
         <select className="im-filter-select" aria-label="فلتر التخليص" value={draft.clearance}
           onChange={e=>update("clearance",e.target.value)}>
           {clearanceOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}
         </select>
       </label>
       <label className="im-orders-field"><span>حالة الدفع</span>
         <select className="im-filter-select" aria-label="فلتر حالة الدفع" value={draft.payment}
           onChange={e=>update("payment",e.target.value)}>
           <option value="">كل حالات الدفع</option><option value="Unpaid">غير مدفوع</option>
           <option value="PartiallyPaid">دفع جزئي</option><option value="Paid">مدفوع للبضاعة</option>
           <option value="Outstanding">المتبقي أكبر من صفر</option>
         </select>
       </label>
       <label className="im-orders-field"><span>الاستحقاقات</span>
         <select className="im-filter-select" aria-label="فلتر التأخير المالي" value={draft.overdue}
           onChange={e=>update("overdue",e.target.value)}>
           <option value="">كل الاستحقاقات</option><option value="true">دفعات متأخرة</option>
         </select>
       </label>
       <label className="im-orders-field"><span>حالة الطلب</span>
         <select className="im-filter-select" aria-label="فلتر حالة الطلب" value={draft.status}
           onChange={e=>update("status",e.target.value)}>
           <option value="">كل حالات الطلب</option><option value="Draft">مسودة</option>
           <option value="Closed">مغلق إدارياً</option><option value="Cancelled">ملغى</option>
         </select>
       </label>
       <label className="im-orders-field"><span>من تاريخ</span>
         <input type="date" aria-label="تاريخ الطلب من" value={draft.from} dir="ltr"
           onChange={e=>update("from",e.target.value)}/>
       </label>
       <label className="im-orders-field"><span>إلى تاريخ</span>
         <input type="date" aria-label="تاريخ الطلب إلى" value={draft.to} dir="ltr"
           onChange={e=>update("to",e.target.value)}/>
       </label>
       <label className="im-orders-field"><span>ترتيب النتائج</span>
         <select className="im-filter-select" aria-label="ترتيب النتائج" value={draft.sort}
           onChange={e=>update("sort",e.target.value)}>
           <option value="newest">الأحدث أولاً</option><option value="oldest">الأقدم أولاً</option>
           <option value="totalDesc">الأعلى قيمة</option><option value="totalAsc">الأقل قيمة</option>
           <option value="eta">أقرب ETA مسجّل</option>
         </select>
       </label>
     </div>
     <div className="im-orders-filter-footer">
       <button className="im-orders-advanced-toggle" type="button" aria-expanded={showAdvanced}
         aria-controls="im-orders-advanced-filters" onClick={()=>setShowAdvanced(open=>!open)}>
         <SlidersHorizontal size={16}/>{showAdvanced?"إخفاء الفلاتر المتقدمة":"المزيد من الفلاتر"}
         {showAdvanced?<ChevronUp size={15}/>:<ChevronDown size={15}/>}
       </button>
       <div className="im-report-filter-actions">
         <Button type="button" variant="outline" className="btn btn-outline" onClick={reset}>
           <RotateCcw size={15}/> مسح الفلاتر</Button>
         <Button type="submit" className="btn primary"><Filter size={16}/> تطبيق الفلاتر</Button>
       </div>
     </div>
    </form>
    <div className="im-report-quick">
     <span>فلاتر سريعة</span>
     <button type="button" className={"im-report-quick-option "+(filters.arrival==="AtSea"?"active":"")}
      onClick={quickAtSea}><Ship size={15}/> في البحر</button>
     <Link href="/import/operations?view=freeTime" className="im-report-quick-option"><Clock3 size={15}/> مدة السماح</Link>
     <Link href="/import/operations?view=missing" className="im-report-quick-option"><FileText size={15}/> المستندات الناقصة</Link>
      <button type="button" className={filters.overdue==="true"?"active":""}
        onClick={quickOverdue}><AlertTriangle size={15}/> متأخرة بالدفع</button>
      <button type="button" className={filters.arrival==="Delivered"&&filters.payment==="Outstanding"?"active":""}
        onClick={quickDeliveredUnpaid}><Package size={15}/> وصلت ولم تُسدّد بالكامل</button>
   </div>
   {loading?<div className="im-empty">جارٍ تحميل طلبات الشراء...</div>:
    !data||data.items.length===0?<div className="im-empty">
     <ClipboardList size={33} strokeWidth={1.4}/>
     <strong>{hasFilters?"لا توجد طلبات تطابق هذه الفلاتر":"لم تُضف أي طلبات بعد"}</strong>
     <p>{hasFilters?"غيّر شروط البحث أو امسح الفلاتر.":"أضف مورّداً أولاً، ثم أنشئ طلب الشراء."}</p>
     {hasFilters?<button type="button" className="btn btn-outline" onClick={reset}>إزالة الفلاتر</button>:
      canManagePayments&&<Link href="/import/orders/new" className="btn primary"><Plus size={16}/> طلب جديد</Link>}
    </div>:<>
     <div className="im-report-result-header">
      <span>طلبات مطابقة: <strong>{data.total}</strong></span>
      <small>إجمالي الكميات من بنود الطلب، وETA من بوالص الشحن المسجلة</small>
     </div>
     <div className="im-table-scroll" data-lenis-prevent>
      <table className="im-table im-orders-table im-report-orders-table">
       <thead><tr>
        <th>الطلب</th><th>المورّد</th><th>تاريخ الطلب</th><th>الكمية</th>
        <th>إجمالي الطلب</th><th>المدفوع</th><th>المتبقي</th>
        <th>الوصول</th><th>التخليص</th><th>ETA</th><th>الإجراءات</th>
       </tr></thead>
       <tbody>{data.items.map(order=><tr key={order.id}>
         <td data-label="رقم الطلب"><Link className="im-order-ref" href={"/import/orders/"+order.id} dir="ltr">
          {order.number}<ArrowUpLeft size={15}/></Link>
          {order.supplierRef&&<small className="im-order-subref" dir="auto">{order.supplierRef}</small>}
          {order.closedWithExceptions&&<small className="im-finance-overdue">مغلق إدارياً مع التزامات ظاهرة</small>}
          {order.isPaymentOverdue&&<small className="im-finance-overdue">دفعة متأخرة</small>}
        </td>
        <td data-label="المورّد"><strong className="im-order-supplier" dir="auto">{order.supplierNameSnapshot}</strong></td>
        <td data-label="تاريخ الطلب">{new Date(order.orderDate+"T00:00:00").toLocaleDateString("ar-SY-u-nu-latn")}</td>
        <td data-label="الكمية"><span dir="ltr">{quantity(order.quantityKg)}</span></td>
        <td data-label="إجمالي الطلب"><strong className="im-order-price" dir="ltr">{amount(order.totalAmount,order.currency)}</strong></td>
         <td data-label="المدفوع"><span dir="ltr">{order.paidAmount!==null?amount(order.paidAmount,order.currency):"—"}</span></td>
         <td data-label="المتبقي"><span dir="ltr">{order.remainingAmount!==null?amount(order.remainingAmount,order.currency):"—"}</span>
           {order.unresolvedDifference>0&&<small className="im-finance-overdue">فرق غير مسوّى: {amount(order.unresolvedDifference,order.currency)}</small>}
         </td>
        <td data-label="حالة الوصول">
         <span className="im-pill">{arrivalNames[order.arrivalStatus]||order.arrivalStatus}</span>
         {order.containerCount>0&&<small className="im-report-container-count" dir="ltr">{order.deliveredContainerCount}/{order.containerCount} Delivered</small>}
        </td>
        <td data-label="التخليص"><span className="im-pill">{clearanceNames[order.clearanceStatus]||order.clearanceStatus}</span></td>
        <td data-label="ETA">{order.eta?new Date(order.eta+"T00:00:00").toLocaleDateString("ar-SY-u-nu-latn"):"—"}</td>
         <td data-label="الإجراءات"><div className="im-table-actions">
          <Link href={"/import/orders/"+order.id} className="im-order-open" aria-label={"فتح "+order.number}><ArrowUpLeft size={18}/></Link>
          <Link href={"/import/orders/"+order.id+"?mode=file"} className="im-order-open"
            aria-label={"فتح "+order.number+" مع المستند"} title="فتح الطلب مع الملف والتبويبات"><FileText size={18}/></Link>
         {canManagePayments&&order.status==="Draft"&&<button type="button" className="im-table-delete"
          aria-label={"حذف "+order.number} title="حذف المسودة" onClick={()=>setDeleting(order)}><Trash2 size={16}/></button>}
        </div></td>
       </tr>)}</tbody>
      </table>
     </div>
     <div className="im-order-pagination">
      <span>الصفحة {page} من {pages}</span>
      <div>
       <button type="button" className="btn btn-outline" disabled={page<=1}
        onClick={()=>navigate(filters,page-1)}>السابق</button>
       <button type="button" className="btn btn-outline" disabled={page>=pages}
        onClick={()=>navigate(filters,page+1)}>التالي</button>
      </div>
     </div>
    </>}
  </div>
  {data&&data.summaries.length>0&&<section className="im-report-currencies">
    <div className="im-section-header"><div><small>القيم حسب العملة</small>
     <h3>مجموع الطلبات المطابقة</h3></div></div>
    <div className="im-table-scroll" data-lenis-prevent><table className="im-table">
      <thead><tr><th>العملة</th><th>الطلبات</th><th>قيمة الطلبات</th><th>المدفوع للبضاعة</th><th>المتبقي للبضاعة</th></tr></thead>
     <tbody>{data.summaries.map(s=><tr key={s.currency}>
      <td>{s.currency}</td><td>{s.orderCount}</td>
      <td dir="ltr">{amount(s.totalAmount,s.currency)}</td>
       <td dir="ltr">{s.paidAmount!==null?amount(s.paidAmount,s.currency):"—"}</td>
       <td dir="ltr">{s.remainingAmount!==null?amount(s.remainingAmount,s.currency):"—"}</td>
     </tr>)}</tbody>
    </table></div>
     <p>تُحسب المبالغ من الحوالات الفعلية المخصصة للبضاعة فقط، لكل عملة على حدة. لا تدخل المصاريف أو الفروقات غير المسوّاة ضمن «المدفوع للبضاعة».</p>
  </section>}
  <ConfirmDialog open={Boolean(deleting)} title="حذف مسودة طلب الشراء؟"
   description={"سيُخفى الطلب "+(deleting?.number||"")+" من القائمة، لكن يبقى أثر العملية في سجل التدقيق."}
   pending={busy} onCancel={()=>setDeleting(null)} onConfirm={()=>void deleteDraft()}/>
 </>;
}
export default function OrdersPage(){
 return <ImportShell section="orders" title="طلبات الشراء"
   description="البحث والمشتريات ومتابعة الشحن وفق آخر بيانات محفوظة.">
  {user=><Suspense fallback={<div className="im-empty">جارٍ تحضير الفلاتر...</div>}>
   <OrdersContent canManagePayments={user.canManagePayments}/>
  </Suspense>}
 </ImportShell>;
}
