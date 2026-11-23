"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {CalendarClock,ShieldCheck} from "lucide-react";
import {useToast} from "@/components/ToastProvider";
import {getManualPlans,getTenantManualSubscription,ManualPlan,platformApi,
  TenantManualSubscription} from "@/lib/platformApi";

type Action="assign"|"renew"|"end";
const shownDate=(raw:string|null)=>raw?new Date(raw).toLocaleDateString("ar-SY-u-nu-latn",{timeZone:"UTC"}):"بلا انتهاء";

export default function ManualSubscriptionControls({tenantId,onChanged}:{tenantId:string,onChanged:()=>Promise<void>}){
  const {notify}=useToast();
  const [current,setCurrent]=useState<TenantManualSubscription|null>(null);
  const [plans,setPlans]=useState<ManualPlan[]>([]);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [action,setAction]=useState<Action>("assign");
  const [selectedPlan,setSelectedPlan]=useState("");
  const [reason,setReason]=useState("");const [confirmed,setConfirmed]=useState(false);
  const load=useCallback(async()=>{
    try{const [details,catalog]=await Promise.all([
      getTenantManualSubscription(tenantId),getManualPlans()]);
      setCurrent(details);setPlans(catalog);
      setSelectedPlan(existing=>existing||catalog.find(p=>p.isActive)?.id||"");
    }catch(error){notify({kind:"error",title:"تعذّر تحميل اشتراك الشركة",description:(error as Error).message});}
    finally{setLoading(false);}
  },[tenantId,notify]);
  useEffect(()=>{void load();},[load]);
  async function save(e:FormEvent){
    e.preventDefault();if(busy||!current)return;
    if(action==="end"&&!confirmed)return;
    setBusy(true);
    try{
      const path="/tenants/"+encodeURIComponent(tenantId)+"/subscription/"+action;
      const payload={revision:current.platformRevision,reason:reason.trim(),
        ...(action==="assign"?{planId:selectedPlan}:{})};
      await platformApi(path,{method:"POST",body:JSON.stringify(payload)});
      setReason("");setConfirmed(false);setAction("assign");
      await Promise.all([load(),onChanged()]);
      notify({kind:"success",title:action==="assign"?"تم ربط الاشتراك يدوياً":
        action==="renew"?"تم تجديد الاشتراك":"تم إنهاء الاشتراك",
        description:"تم تحديث وصول التاجر وحفظ السبب والتغيير في سجل الإدارة."});
    }catch(error){notify({kind:"error",title:"تعذّر تحديث الاشتراك",description:(error as Error).message});}
    finally{setBusy(false);}
  }
  const sub=current?.subscription;
  const hasActiveSubscription=current?.hasSubscription&&sub?.endedAtUtc===null;
  const canRenew=hasActiveSubscription&&sub?.durationMonths!==null&&
    plans.some(p=>p.id===sub?.planId&&p.isActive);
  const activePlans=plans.filter(p=>p.isActive);
  return <section className="pc-panel pc-form-panel"><div className="pc-panel-heading"><div>
      <h3><CalendarClock size={19}/> الاشتراك اليدوي</h3>
      <p>ربط وتجديد وإنهاء الاشتراك من SuperAdmin، بلا أسعار أو دفع.</p>
    </div></div>
    {loading&&!current?<p className="pc-empty">جارٍ تحميل الاشتراك...</p>:<div className="pc-stack">
      <div className="pc-subscription-status">
        <span>{sub?sub.endedAtUtc?"اشتراك منتهٍ يدوياً":"الباقة الحالية":"حساب قديم بدون باقة"}</span>
        <strong dir="auto">{sub?.planName??"صلاحية موجودة بدون اشتراك مربوط"}</strong>
        <small>تاريخ الوصول: {shownDate(current?.accessExpiresAtUtc??null)} · حد البوالص: {sub?.maxTrackedBills??0}</small>
      </div>
      {!sub&&<p className="pc-subscription-hint">هذا التاجر محتفظ بصلاحيته السابقة. ربطه بباقة سيبدأ مدة جديدة من لحظة التعيين، ولن يتم تحويل حسابه تلقائياً.</p>}
      {sub&&<p className="pc-subscription-hint">بداية الفترة: {shownDate(sub.startedAtUtc)} · {sub.durationMonths===null?"مدة غير محدودة":sub.durationMonths+" شهر"}. التجديد لا يحصل تلقائياً.</p>}
      <div className="pc-subscription-actions" role="group" aria-label="إجراءات الاشتراك">
        <button type="button" className={action==="assign"?"selected":""}
          onClick={()=>{setAction("assign");setConfirmed(false);}}>تعيين / تغيير باقة</button>
        {hasActiveSubscription&&<button type="button" disabled={!canRenew}
          title={!canRenew?"التجديد يحتاج باقة محددة الأشهر ومتاحة":""}
          className={action==="renew"?"selected":""}
          onClick={()=>{setAction("renew");setConfirmed(false);}}>تجديد المدة</button>}
        {hasActiveSubscription&&<button type="button" className={action==="end"?"selected":""}
          onClick={()=>{setAction("end");setConfirmed(false);}}>إنهاء الاشتراك</button>}
      </div>
      <form className="pc-stack pc-subscription-form" onSubmit={e=>void save(e)}>
        {action==="assign"&&<>
          <label>اختر الباقة<select required value={selectedPlan}
            onChange={e=>setSelectedPlan(e.target.value)}>
            <option value="">اختر باقة متاحة</option>
            {activePlans.map(plan=><option key={plan.id} value={plan.id}>
              {plan.name} — {plan.durationMonths===null?"بلا انتهاء":plan.durationMonths+" شهر"} — {plan.maxTrackedBills} بوليصة
            </option>)}
          </select></label>
          <p className="pc-subscription-hint">التعيين أو التغيير يستبدل تاريخ الوصول الحالي بمدة الباقة الجديدة بدءاً من اليوم. لا يغيّر حالة إيقاف الشركة.</p>
          {!activePlans.length&&<Link href="/platform/plans" className="pc-link">أنشئ باقة أولاً</Link>}
        </>}
        {action==="renew"&&<p className="pc-subscription-hint">التجديد يضيف مدة الباقة إلى تاريخ الانتهاء الحالي إن كان مستقبلياً، أو من اليوم إذا انتهى. لا يمكن تمديد باقة غير محدودة.</p>}
        {action==="end"&&<>
          <p className="pc-subscription-hint pc-subscription-caution">إنهاء الاشتراك يوقف وصول جميع أعضاء هذه الشركة فوراً بدون حذف طلباتهم أو مستنداتهم. يمكن تعيين باقة جديدة لاحقاً.</p>
          <label className="pc-acknowledge"><input type="checkbox" checked={confirmed}
            onChange={e=>setConfirmed(e.target.checked)}/> أؤكد أني أريد إنهاء وصول هذه الشركة الآن.</label>
        </>}
        <label>السبب (يُحفظ في سجل التدقيق)
          <textarea required minLength={8} maxLength={1000} rows={2}
            value={reason} onChange={e=>setReason(e.target.value)}
            placeholder="سبب واضح يشرح إجراء الاشتراك"/></label>
        <button type="submit" className={action==="end"?"pc-action-button danger":"pc-primary"}
          disabled={busy||!current||(action==="assign"&&!selectedPlan)||(action==="renew"&&!canRenew)||(action==="end"&&!confirmed)}>
          <ShieldCheck size={16}/>{busy?"جارٍ الحفظ...":action==="assign"?"تأكيد ربط الباقة":
            action==="renew"?"تجديد الاشتراك يدوياً":"تأكيد إنهاء الاشتراك"}
        </button>
      </form>
    </div>}
  </section>;
}
