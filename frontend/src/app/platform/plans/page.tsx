"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import {CalendarClock,Plus,Tags} from "lucide-react";
import PlatformShell from "@/components/PlatformShell";
import {useToast} from "@/components/ToastProvider";
import {getManualPlans,ManualPlan,platformApi} from "@/lib/platformApi";

function PlansManagement(){
  const {notify}=useToast();
  const [plans,setPlans]=useState<ManualPlan[]>([]);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);
  const [open,setOpen]=useState(false);
  const [name,setName]=useState("");const [code,setCode]=useState("");
  const [months,setMonths]=useState("3");const [reason,setReason]=useState("");
  const [trackedBills,setTrackedBills]=useState("0");
  const [switchPlan,setSwitchPlan]=useState<ManualPlan|null>(null);
  const [switchReason,setSwitchReason]=useState("");
  const load=useCallback(async()=>{
    try{setPlans(await getManualPlans());}
    catch(error){notify({kind:"error",title:"تعذّر تحميل الباقات",description:(error as Error).message});}
    finally{setLoading(false);}
  },[notify]);useEffect(()=>{void load();},[load]);
  async function create(e:FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);
    try{await platformApi("/plans",{method:"POST",body:JSON.stringify({
      code:code.trim().toLowerCase(),name:name.trim(),
      durationMonths:months==="unlimited"?null:Number(months),
      maxTrackedBills:Number(trackedBills),reason:reason.trim()})});
      setName("");setCode("");setMonths("3");setTrackedBills("0");setReason("");setOpen(false);
      await load();notify({kind:"success",title:"تم إنشاء الباقة",description:"مدتها ثابتة ولا تحتوي على سعر أو دفع."});
    }catch(error){notify({kind:"error",title:"تعذّر إضافة الباقة",description:(error as Error).message});}
    finally{setBusy(false);}
  }
  async function changeActive(e:FormEvent){
    e.preventDefault();if(busy||!switchPlan)return;setBusy(true);
    try{await platformApi("/plans/"+switchPlan.id+"/active",{method:"POST",
      body:JSON.stringify({isActive:!switchPlan.isActive,reason:switchReason.trim()})});
      setSwitchPlan(null);setSwitchReason("");await load();
      notify({kind:"success",title:"تم تحديث حالة الباقة",
        description:"إيقاف الباقة يمنع تعيينها وتجديدها، ولا يقطع وصول المشتركين الحاليين تلقائياً."});
    }catch(error){notify({kind:"error",title:"تعذّر تعديل الباقة",description:(error as Error).message});}
    finally{setBusy(false);}
  }
  return <>
    <section className="pc-panel"><div className="pc-panel-heading"><div>
      <h3><Tags size={19}/> باقات المنصة</h3>
       <p>حدّد مدة الباقة وعدد البوالص التي يسمح للتاجر بتفعيل تتبّعها. لا يوجد دفع إلكتروني.</p>
    </div><button className="pc-primary" type="button" onClick={()=>setOpen(v=>!v)}>
      <Plus size={16}/> إضافة باقة</button></div>
      {open&&<form className="pc-form-grid pc-plan-new" onSubmit={e=>void create(e)}>
        <label>اسم الباقة<input required minLength={2} maxLength={120} value={name}
          onChange={e=>setName(e.target.value)} placeholder="مثلاً: اشتراك 3 أشهر"/></label>
        <label>المعرّف الفني<input required dir="ltr" minLength={3} maxLength={48}
          pattern="[a-z0-9][a-z0-9-]*" value={code}
          onChange={e=>setCode(e.target.value.toLowerCase())} placeholder="quarterly"/></label>
        <label>مدة الاشتراك<select value={months} onChange={e=>setMonths(e.target.value)}>
          <option value="1">شهر واحد</option><option value="3">3 أشهر</option>
          <option value="6">6 أشهر</option><option value="12">سنة</option>
          <option value="24">سنتان</option><option value="36">3 سنوات</option>
          <option value="unlimited">بلا انتهاء</option>
        </select></label>
        <label>عدد بوالص الشحن المسموح تتبّعها خلال الاشتراك
          <input type="number" required min={0} max={100000} step={1}
            value={trackedBills} onChange={e=>setTrackedBills(e.target.value)}/>
          <small>الصفر = التتبع المباشر غير متاح. التجديد يبدأ رصيداً جديداً.</small>
        </label>
        <label className="pc-field-wide">سبب إضافة الباقة<textarea required minLength={8}
          maxLength={1000} rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <div className="pc-form-actions"><button className="pc-primary" type="submit" disabled={busy}>حفظ الباقة</button>
          <button className="pc-secondary" type="button" onClick={()=>setOpen(false)}>إلغاء</button></div>
      </form>}
      <div className="pc-table-wrap"><table className="pc-table"><thead><tr>
         <th>الباقة</th><th>المدة</th><th>حدّ البوالص</th><th>الاشتراكات الحالية</th><th>الحالة</th><th></th>
      </tr></thead><tbody>{plans.map(plan=><tr key={plan.id}>
        <td><strong dir="auto">{plan.name}</strong><small dir="ltr">{plan.code}</small></td>
         <td>{plan.durationMonths===null?"بلا انتهاء":plan.durationMonths+" شهر"}</td>
         <td>{plan.maxTrackedBills}</td>
        <td>{plan.tenantCount}</td>
        <td><span className={"pc-status "+(plan.isActive?"active":"paused")}>{plan.isActive?"متاحة":"موقوفة"}</span></td>
        <td><button className="pc-text-action" type="button" disabled={busy}
          onClick={()=>{setSwitchPlan(plan);setSwitchReason("");}}>
          {plan.isActive?"إيقاف الباقة":"إعادة إتاحتها"}</button></td>
      </tr>)}</tbody></table></div>
      {loading&&<p className="pc-empty">جارٍ تحميل الباقات...</p>}
      {!loading&&!plans.length&&<p className="pc-empty">لا يوجد باقات بعد. أنشئ أول باقة لتبدأ بإدارة الاشتراكات يدوياً.</p>}
      {switchPlan&&<form className="pc-inline-confirm" onSubmit={e=>void changeActive(e)}>
        <strong>{switchPlan.isActive?"إيقاف إتاحة":"إعادة إتاحة"} باقة {switchPlan.name}</strong>
        <label>سبب القرار<input required minLength={8} maxLength={1000} value={switchReason}
          onChange={e=>setSwitchReason(e.target.value)} placeholder="اكتب سبباً واضحاً لعملية الإدارة"/></label>
        <button type="submit" className="pc-primary" disabled={busy}>تأكيد التغيير</button>
        <button type="button" className="pc-secondary" onClick={()=>setSwitchPlan(null)}>إلغاء</button>
      </form>}
    </section>
    <div className="pc-note"><CalendarClock size={18}/><p>
      مدة الباقة لا تتغيّر بعد إنشائها للحفاظ على دقة السجل القديم. إذا احتجت مدة جديدة أنشئ باقة أخرى؛ التغيير لا يجدد اشتراكات التجار تلقائياً.
    </p></div>
  </>;
}
export default function Page(){return <PlatformShell title="باقات الاشتراك" description="باقات زمنية يدوية بدون أسعار أو مدفوعات.">
  {()=> <PlansManagement/>}</PlatformShell>;}
