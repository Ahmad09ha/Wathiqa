"use client";

import {useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {Activity,ArrowUpLeft,Building2,CalendarClock,CheckCircle2,
  CircleAlert,Container,FileText,HandCoins,Landmark,PackageCheck,
  RefreshCw,Ship,TrendingUp,Users,Wallet,Workflow} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import type {CurrentImportUser} from "@/lib/importApi";
import {useToast} from "@/components/ToastProvider";
import {loadDashboardEvents,loadDashboardOverview,type ActivityCategory,
  type DashboardActivityPage,type DashboardOverview,
  type DashboardPeriod} from "@/lib/dashboardApi";

const periods:{value:DashboardPeriod;label:string}[]=[
  {value:7,label:"آخر 7 أيام"},{value:30,label:"آخر 30 يوماً"},
  {value:90,label:"آخر 90 يوماً"},{value:365,label:"آخر سنة"},
  {value:0,label:"كل الفترات"}
];
const categories:{value:ActivityCategory;label:string}[]=[
  {value:"all",label:"جميع الأحداث"},{value:"orders",label:"الطلبات"},
  {value:"finance",label:"الدفوعات"},{value:"logistics",label:"الشحن والتخليص"},
  {value:"tracking",label:"التتبع"},{value:"documents",label:"المستندات"},
  {value:"companies",label:"الشركات"},{value:"ports",label:"الموانئ"},
  {value:"security",label:"الفريق والصلاحيات"},
  {value:"subscription",label:"الاشتراكات"}
];
const catIcons:Record<ActivityCategory,LucideIcon>={
  all:Activity,orders:FileText,finance:Wallet,logistics:Ship,tracking:TrendingUp,
  documents:FileText,companies:Building2,ports:Ship,security:Users,subscription:Landmark
};
const whole=new Intl.NumberFormat("ar-SY-u-nu-latn",{maximumFractionDigits:0});
const precise=new Intl.NumberFormat("ar-SY-u-nu-latn",{maximumFractionDigits:2});
const n=(v:number)=>whole.format(v);
const money=(v:number)=>precise.format(v);
const when=(v:string)=>new Date(v).toLocaleString("ar-SY-u-nu-latn",{
  dateStyle:"medium",timeStyle:"short"
});
function Metric({name,value,icon:Icon,detail,href,warning}:{
  name:string;value:number|string;icon:LucideIcon;detail?:string;
  href?:string;warning?:boolean;
}){
  const content=<><span className="im-stat-icon"><Icon size={19}/></span>
    <small>{name}</small><strong dir="auto">{typeof value==="number"?n(value):value}</strong>
    {detail&&<span className="im-stat-detail">{detail}</span>}</>;
  const cls="im-stat-card"+(warning?" im-stat-warning":"");
  return href?<Link className={cls} href={href}>{content}</Link>
    :<div className={cls}>{content}</div>;
}
function Group({eyebrow,title,subtitle,children}:{
  eyebrow:string;title:string;subtitle?:string;children:React.ReactNode;
}){
  return <section className="im-dashboard-group">
    <header className="im-dashboard-group-head">
      <small>{eyebrow}</small><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}
    </header>{children}
  </section>;
}
function Bar({label,value,total,variant}:{
  label:string;value:number;total:number;variant:string;
}){
  return <div className="im-dashboard-progress">
    <div><span>{label}</span><strong>{n(value)}</strong></div>
    <div className="im-dashboard-progress-track"><span className={variant}
      style={{width:(total?Math.max(0,Math.min(100,value/total*100)):0)+"%"}}/></div>
  </div>;
}
function Trend({points}:{points:DashboardOverview["trend"]}){
  const max=Math.max(1,...points.map(x=>Math.max(x.orders,x.containers)));
  return <div className="im-dashboard-trend" role="img"
    aria-label="عدد الطلبات والحاويات الجديدة يومياً خلال آخر 14 يوماً">
    <div className="im-dashboard-trend-legend"><span><i className="orders"/>طلبات</span>
      <span><i className="containers"/>حاويات</span></div>
    <div className="im-dashboard-trend-bars">{points.map((x,i)=>
      <div key={x.date} className="im-dashboard-trend-day"
        title={x.date+" · "+x.orders+" طلبات · "+x.containers+" حاويات"}>
        <div><span className="orders" style={{height:Math.max(x.orders?5:2,100*x.orders/max)+"%"}}/>
          <span className="containers" style={{height:Math.max(x.containers?5:2,100*x.containers/max)+"%"}}/></div>
        <small>{i%2===0?x.date.slice(5):"·"}</small>
      </div>)}</div>
  </div>;
}

export default function TenantDashboard({user}:{user:CurrentImportUser}){
  const {notify}=useToast();
  const [days,setDays]=useState<DashboardPeriod>(30);
  const [version,setVersion]=useState(0);
  const [overview,setOverview]=useState<DashboardOverview|null>(null);
  const [loading,setLoading]=useState(true);
  const [overviewError,setOverviewError]=useState("");
  const [category,setCategory]=useState<ActivityCategory>("all");
  const [page,setPage]=useState(1);
  const [events,setEvents]=useState<DashboardActivityPage|null>(null);
  const [eventsLoading,setEventsLoading]=useState(true);
  const [eventsError,setEventsError]=useState("");
  const visibleCategories=useMemo(()=>categories.filter(x=>
    user.role==="Admin"||!["security","subscription"].includes(x.value)),[user.role]);

  useEffect(()=>{
    const ctrl=new AbortController();
    void loadDashboardOverview(days,ctrl.signal).then(result=>{
      if(!ctrl.signal.aborted){setOverview(result);setOverviewError("")}
    }).catch(error=>{
      if(!ctrl.signal.aborted){setOverviewError((error as Error).message);
        notify({kind:"error",title:"تعذّر تحميل الإحصائيات",description:(error as Error).message})}
    }).finally(()=>{if(!ctrl.signal.aborted)setLoading(false)});
    return ()=>ctrl.abort();
  },[days,version,notify]);

  useEffect(()=>{
    const ctrl=new AbortController();
    void loadDashboardEvents(days,category,page,20,ctrl.signal).then(result=>{
      if(!ctrl.signal.aborted){setEvents(result);setEventsError("")}
    }).catch(error=>{
      if(!ctrl.signal.aborted){
        setEvents(null);
        setEventsError((error as Error).message);
      }
    }).finally(()=>{if(!ctrl.signal.aborted)setEventsLoading(false)});
    return ()=>ctrl.abort();
  },[days,category,page,version]);

  function changePeriod(next:DashboardPeriod){
    setDays(next);setPage(1);setEvents(null);setEventsError("");
    setLoading(true);setEventsLoading(true);
  }
  function changeCategory(next:ActivityCategory){
    setCategory(next);setPage(1);setEvents(null);setEventsError("");
    setEventsLoading(true);
  }
  function changePage(next:number){
    setPage(next);setEvents(null);setEventsError("");setEventsLoading(true);
  }
  function refresh(){setVersion(x=>x+1);setLoading(true);setEventsLoading(true)}
  const s=overview;
  const alerts=s?[
    {count:s.containers.freeTimeOverdue,label:"حاويات تجاوزت الأيام المجانية",href:"/import/operations"},
    {count:s.containers.freeTimeCritical,label:"حاويات تنتهي أيامها المجانية خلال 3 أيام",href:"/import/operations"},
    {count:s.shipping.etaOverdue,label:"بوالص تجاوزت ETA المتوقع",href:"/import/orders"},
    {count:s.financial.overdueOrders,label:"طلبات فيها دفعات مستحقة ومتأخرة",href:"/import/orders"}
  ].filter(x=>x.count>0):[];

  return <div className="im-tenant-dashboard">
    <div className="im-dashboard-hero">
      <div><span className="im-eyebrow">لوحة متابعة شركتك · {user.name}</span>
        <h2>كل عمليات الاستيراد. صورة واحدة واضحة.</h2>
        <p>الطلبات والدفوعات والحاويات والتخليص والتتبع في مؤشرات مباشرة من قاعدة البيانات،
          ثم سجل زمني موحّد لكل نشاط موثّق داخل شركتك.</p>
        {s&&<small>آخر قراءة: {when(s.asOfUtc)} · المجاميع من بداية حسابك</small>}
      </div>
      <div className="im-dashboard-actions">
        <label>فترة الأحداث والإضافات الجديدة
          <select value={days} onChange={e=>changePeriod(Number(e.target.value) as DashboardPeriod)}>
            {periods.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select>
        </label>
        <button type="button" onClick={refresh} disabled={loading||eventsLoading}>
          <RefreshCw size={16}/> تحديث</button>
      </div>
    </div>
    {overviewError&&<div role="alert" className="im-dashboard-error"><CircleAlert size={18}/>
      {overviewError}<button type="button" onClick={refresh}>إعادة المحاولة</button></div>}
    {loading&&!s&&<div className="im-dashboard-loading"><RefreshCw size={21}/>جارٍ تحميل مؤشرات الشركة...</div>}
    {s&&<>
      {loading&&<div className="im-dashboard-updating">جارٍ تحديث الأرقام...</div>}
      <Group eyebrow="نظرة عامة" title="حركة الطلبات"
        subtitle="الأرقام الإجمالية تراكمية، بينما المؤشرات الجديدة تتبع الفترة المحددة.">
        <div className="im-dashboard-metrics">
          <Metric icon={FileText} name="كل الطلبات" value={s.orders.total} href="/import/orders"/>
          <Metric icon={Workflow} name="طلبات قيد العمل" value={s.orders.active}/>
          <Metric icon={CheckCircle2} name="طلبات مغلقة" value={s.orders.closed}
            detail={n(s.orders.closedWithExceptions)+" مع استثناء محاسبي"}/>
          <Metric icon={FileText} name="مسودات الطلبات" value={s.orders.draft}/>
          <Metric icon={TrendingUp} name="طلبات جديدة بالفترة" value={s.orders.newInPeriod}/>
          <Metric icon={Container} name="إجمالي المواد المطلوبة" value={money(s.orders.quantityKg/1000)+" طن"}
            detail="من بنود الطلبات الحالية"/>
          <Metric icon={Wallet} name="طلبات مدفوعة جزئياً" value={s.orders.partiallyPaid}/>
          <Metric icon={CalendarClock} name="طلبات بدفعات متأخرة" value={s.financial.overdueOrders}
            warning={s.financial.overdueOrders>0}/>
        </div>
      </Group>
      {alerts.length>0&&<div className="im-dashboard-alerts" role="status">
        <div className="im-dashboard-alert-head"><CircleAlert size={20}/>
          <strong>تنبيهات تحتاج متابعة</strong><span>{n(alerts.length)} مؤشرات</span></div>
        <div className="im-dashboard-alert-list">{alerts.map(x=>
          <Link key={x.label} href={x.href}><b>{n(x.count)}</b>
            <span>{x.label}</span><ArrowUpLeft size={15}/></Link>)}</div>
      </div>}
      <Group eyebrow="المحاسبة" title="الأرصدة والدفوعات حسب العملة"
        subtitle="لا يتم جمع عملات مختلفة في مبلغ واحد. أرصدة البضاعة مستقلة عن المصروفات والحوالات غير المسوّاة.">
        <div className="im-dashboard-metrics im-dashboard-mini">
          <Metric icon={HandCoins} name="الحوالات السارية" value={s.financial.activeTransfers}/>
          <Metric icon={Wallet} name="المصاريف المسجلة" value={s.financial.recordedExpenses}/>
          <Metric icon={RefreshCw} name="عمليات الاسترداد" value={s.financial.returns}/>
          <Metric icon={Landmark} name="طلبات غير مدفوعة" value={s.orders.unpaid}/>
        </div>
        <div className="im-dashboard-money-scroll"><table className="im-dashboard-money">
          <thead><tr><th>العملة</th><th>قيمة الطلبات</th><th>تسوية البضاعة</th>
            <th>المتبقي التجاري</th><th>صافي الحوالات</th><th>المصاريف</th>
            <th>الفرق غير المسوّى</th></tr></thead>
          <tbody>{s.financial.currencies.length?s.financial.currencies.map(c=>
            <tr key={c.currency}><td><strong>{c.currency}</strong></td><td>{money(c.ordered)}</td>
              <td>{money(c.commercialPaid)}</td><td className="im-dashboard-amount">{money(c.remaining)}</td>
              <td>{money(c.netTransferred)}</td><td>{money(c.recordedExpenses)}</td>
              <td className={c.unresolvedTransfers>0?"im-dashboard-amount-warning":""}>
                {money(c.unresolvedTransfers)}</td></tr>
          ):<tr><td colSpan={7} className="im-dashboard-no-results">لا توجد بيانات مالية بعد</td></tr>}</tbody>
        </table></div>
        <p className="im-dashboard-method">المتبقي التجاري = قيمة البضاعة ناقص التسوية التجارية.
          والفرق غير المسوّى = صافي الحوالات ناقص المخصّص للبضاعة والمصاريف.
          هذه أرقام تشغيلية من سجل الدفوعات، وليست رصيد الحساب البنكي.</p>
      </Group>
      <Group eyebrow="الشحن والتخليص" title="الحاويات والبوالص والموانئ">
        <div className="im-dashboard-metrics">
          <Metric icon={Ship} name="بوالص الشحن" value={s.shipping.total} href="/import/operations"/>
          <Metric icon={Container} name="كل الحاويات" value={s.containers.total} href="/import/operations"/>
          <Metric icon={Ship} name="حاويات في البحر" value={s.containers.atSea}/>
          <Metric icon={PackageCheck} name="حاويات مسلّمة" value={s.containers.delivered}/>
          <Metric icon={Container} name="حاويات في الميناء" value={s.containers.atPort}/>
          <Metric icon={CircleAlert} name="أيام مجانية منتهية" value={s.containers.freeTimeOverdue}
            warning={s.containers.freeTimeOverdue>0}/>
          <Metric icon={CalendarClock} name="ETA متأخر" value={s.shipping.etaOverdue}
            warning={s.shipping.etaOverdue>0}/>
          <Metric icon={Ship} name="وصول متوقع خلال 7 أيام" value={s.shipping.etaNextSevenDays}/>
          <Metric icon={FileText} name="ملفات تخليص" value={s.customs.total}/>
          <Metric icon={CheckCircle2} name="تم الإفراج الجمركي" value={s.customs.released}/>
          <Metric icon={Workflow} name="تخليص قيد المعالجة" value={s.customs.processing}/>
          <Metric icon={FileText} name="بوالص لم يصل أصلها" value={s.shipping.originalNotReceived}/>
        </div>
        <div className="im-dashboard-panels">
          <div className="im-dashboard-panel">
            <header><strong>حالات الحاويات</strong><small>{n(s.containers.total)} حاوية</small></header>
            <Bar label="مخططة" value={s.containers.planned} total={s.containers.total} variant="planned"/>
            <Bar label="في البحر" value={s.containers.atSea} total={s.containers.total} variant="sea"/>
            <Bar label="بالميناء" value={s.containers.atPort} total={s.containers.total} variant="port"/>
            <Bar label="تم التسليم" value={s.containers.delivered} total={s.containers.total} variant="delivered"/>
          </div>
          <div className="im-dashboard-panel">
            <header><strong>حركة آخر 14 يوماً</strong><small>طلبات وحاويات جديدة</small></header>
            <Trend points={s.trend}/>
          </div>
        </div>
      </Group>
      <Group eyebrow="المراقبة" title="التتبع والمستندات والشركاء">
        <div className="im-dashboard-metrics">
          <Metric icon={TrendingUp} name="رصيد بوالص ShipsGo" value={s.tracking.remaining}
            detail={n(s.tracking.used)+" من "+n(s.tracking.limit)+" مستخدم"}/>
          <Metric icon={Ship} name="مراجع تتبّع" value={s.tracking.references}/>
          <Metric icon={CheckCircle2} name="مراجع لها تحديث" value={s.tracking.synced}/>
          <Metric icon={CircleAlert} name="أخطاء مزوّد التتبع" value={s.tracking.errors}
            warning={s.tracking.errors>0}/>
          <Metric icon={FileText} name="المستندات المحفوظة" value={s.documents.total}/>
          <Metric icon={FileText} name="مستندات جديدة بالفترة" value={s.documents.newInPeriod}/>
          <Metric icon={Building2} name="جهات تجارية" value={s.companies.total} href="/import/companies"/>
          <Metric icon={Users} name="أعضاء الفريق النشطون" value={s.team.active}
            detail={n(s.team.total)+" إجمالي الحسابات"}/>
        </div>
        <div className="im-dashboard-footnote"><span><b>الباقة:</b> {s.tracking.planName||"لا توجد باقة تتبع فعّالة"}</span>
          <span><b>الموردون:</b> {n(s.companies.suppliers)}</span>
          <span><b>المخلّصون:</b> {n(s.companies.brokers)}</span>
          {user.role==="Admin"&&<span><b>دعوات معلّقة:</b> {n(s.team.pendingInvitations)}</span>}
        </div>
      </Group>
    </>}

    <section className="im-dashboard-activity" aria-label="السجل الزمني لأحداث الشركة">
      <header className="im-dashboard-activity-head"><div>
        <small>سجل موحّد للشركة</small><h2>الأحداث داخل الـ Tenant</h2>
        <p>الأحداث الفعلية الموثّقة، مرتبة من الأحدث مع تاريخ الإجراء واسم منفّذه.</p>
      </div><strong>{n(events?.total??0)} حدث</strong></header>
      <div className="im-dashboard-filters"><label>نوع النشاط
        <select aria-label="فلترة الأحداث" value={category}
          onChange={e=>changeCategory(e.target.value as ActivityCategory)}>
          {visibleCategories.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
        </select></label>
        <span>الفترة: {periods.find(x=>x.value===days)?.label}</span>
      </div>
      {eventsError&&<div role="alert" className="im-dashboard-error">
        <CircleAlert size={18}/>{eventsError}
        <button onClick={refresh} type="button">إعادة المحاولة</button></div>}
      {eventsLoading?<div className="im-dashboard-loading">جارٍ تحميل سجل النشاط...</div>:
      events?.items.length?<div className="im-dashboard-timeline">{events.items.map(item=>{
        const Icon=catIcons[item.category]||Activity;
        return <article className="im-dashboard-event" key={item.id}>
          <span className={"im-dashboard-event-icon category-"+item.category}><Icon size={18}/></span>
          <div className="im-dashboard-event-details">
            <div><strong>{item.title}</strong><small>{categories.find(x=>
              x.value===item.category)?.label||"نشاط"}</small></div>
            <p>{item.subject&&<><span dir="auto">{item.subject}</span><span> · </span></>}
              بواسطة {item.actor}</p>
            <time dateTime={item.occurredAtUtc}>{when(item.occurredAtUtc)}</time>
          </div>
          {item.url&&<Link className="im-dashboard-event-link" href={item.url}
            aria-label={"تفاصيل "+item.title}><ArrowUpLeft size={17}/></Link>}
        </article>;
      })}</div>:<div className="im-dashboard-empty">
        <Activity size={25}/><strong>لا توجد أحداث مطابقة</strong>
        <p>اختر فترة أطول أو نوع نشاط آخر.</p>
      </div>}
      {events&&events.total>0&&<div className="im-dashboard-pages">
        <span>عرض {n((events.page-1)*events.pageSize+1)} إلى {n(Math.min(events.total,events.page*events.pageSize))}
          {" من "}{n(events.total)}</span>
        <div><button type="button" disabled={page<=1||eventsLoading} onClick={()=>changePage(page-1)}>السابق</button>
          <span>صفحة {n(page)}</span>
          <button type="button" disabled={!events.hasMore||eventsLoading} onClick={()=>changePage(page+1)}>التالي</button></div>
      </div>}
      <p className="im-dashboard-method">يعرض السجل البيانات التي كان النظام يسجّلها فعلياً.
        بعض التعديلات القديمة على دليل الشركات لم يكن لها سجل تاريخي مستقل، لذلك لا يمكن استعادتها بأثر رجعي.
        أحداث صلاحيات الموظفين والاشتراك تظهر لمدير الشركة فقط.</p>
    </section>
    {s&&s.orders.total===0&&<div className="im-dashboard-start">
      <strong>مساحة العمل جاهزة</strong><span>ابدأ بإضافة مورد أو إنشاء طلب وستظهر البيانات هنا.</span>
      <Link href="/import/orders/from-file">إنشاء طلب من ملف <ArrowUpLeft size={16}/></Link>
    </div>}
  </div>;
}
