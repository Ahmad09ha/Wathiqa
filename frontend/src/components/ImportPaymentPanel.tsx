"use client";

import {FormEvent,useCallback,useEffect,useRef,useState} from "react";
import {AlertTriangle,CheckCircle2,FileText,RefreshCw,Wallet} from "lucide-react";
import {useToast} from "@/components/ToastProvider";
import {CurrentImportUser,fetchImportCompanyOptions,ImportCompanyOption} from "@/lib/importApi";
import {BusinessDocument,listDocuments} from "@/lib/documentsApi";
import {FinanceAction,financeWrite,getOrderFinance,OrderFinance} from "@/lib/paymentsApi";
import {hasFeature} from "@/lib/featurePermissions";

const actions: {key:FinanceAction;label:string}[] = [
  {key:"schedule",label:"استحقاق مخطط"},
  {key:"transfer",label:"تسجيل حوالة فعلية"},
  {key:"expense",label:"تسجيل مصروف"},
  {key:"allocation",label:"تسوية مصروف"},
  {key:"correct",label:"تصحيح قيد حوالة"},
  {key:"return",label:"استرداد بنكي فعلي"},
  {key:"close",label:"إغلاق إداري استثنائي"},
  {key:"cancel",label:"إلغاء مسودة خالية"}
];
type FormDataState={
  amount:string;kind:string;date:string;notes:string;
  beneficiaryId:string;method:string;reference:string;bankOrExchangeName:string;proofDocumentId:string;
  category:string;description:string;expenseId:string;transferId:string;reason:string;
};
function defaultForm(supplierId:string):FormDataState{
  return{amount:"",kind:"Advance",date:new Date().toISOString().slice(0,10),
    notes:"",beneficiaryId:supplierId,method:"BankTransfer",reference:"",
    bankOrExchangeName:"",
    proofDocumentId:"",category:"Other",description:"",expenseId:"",transferId:"",reason:""};
}
const currencyAmount=(amount:number,currency:string)=>
  new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount)+" "+currency;
const dateLabel=(value:string)=>new Date(value+"T00:00:00").toLocaleDateString("ar-SY-u-nu-latn");
const paymentStatuses:Record<string,string>={Paid:"مدفوع للبضاعة",Unpaid:"لم يسدّد",PartiallyPaid:"سداد جزئي"};
const scheduleKinds:Record<string,string>={Advance:"دفعة مقدمة",Balance:"دفعة نهائية",Other:"دفعة أخرى"};
const categoryLabels:Record<string,string>={Freight:"شحن",Customs:"تخليص",Insurance:"تأمين",Other:"مصروف آخر"};

export default function ImportPaymentPanel({orderId,supplierId,user,disabled,onChanged}:{
  orderId:string;supplierId:string;user:CurrentImportUser;disabled:boolean;
  onChanged:()=>Promise<void>;
}){
  const {notify}=useToast();
  const [financial,setFinancial]=useState<OrderFinance|null>(null);
  const [documents,setDocuments]=useState<BusinessDocument[]>([]);
  const [companies,setCompanies]=useState<ImportCompanyOption[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [action,setAction]=useState<FinanceAction>("schedule");
  const [form,setForm]=useState<FormDataState>(()=>defaultForm(supplierId));
  // One logical submission retains its key across a transport-failure retry.
  // Changing fields or operation generates a fresh logical submission.
  const pendingKey=useRef<string|null>(null);
  const load=useCallback(async()=>{
    try{
      const [finance,docPage,parties]=await Promise.all([
         getOrderFinance(orderId),
         hasFeature(user,"documents.view")?listDocuments({orderId},1,100):Promise.resolve({items:[]}),
         fetchImportCompanyOptions()
      ]);
      setFinancial(finance);setDocuments(docPage.items);setCompanies(parties);
    }catch(error){
      notify({kind:"error",title:"تعذّر تحميل الدفعات",description:(error as Error).message});
    }finally{setLoading(false);}
  },[orderId,notify,user]);
  useEffect(()=>{void load();},[load]);
  function change<K extends keyof FormDataState>(key:K,value:FormDataState[K]){
    pendingKey.current=null;setForm(x=>({...x,[key]:value}));
  }
  function pick(action:FinanceAction){
    pendingKey.current=null;setAction(action);setForm(defaultForm(supplierId));
  }
  const money=financial?.currency||"USD";
  const activeTransfers=(financial?.transfers||[]).filter(x=>x.state==="Active");
  const paymentProofs=documents.filter(d=>d.type==="PaymentProof"&&
    d.links.some(l=>l.orderId===orderId));
  const expenseProofs=documents.filter(d=>d.links.some(l=>l.orderId===orderId));
  const canWrite=user.canManagePayments;
  const canClose=user.role==="Admin"&&financial?.status==="Draft";
  const availableActions=actions.filter(x=>
    (x.key==="close"||x.key==="cancel")?canClose:canWrite);

  async function submit(event:FormEvent){
    event.preventDefault();
    if(!financial||busy||disabled)return;
    if((action==="close"||action==="cancel")&&user.role!=="Admin")return;
    if((action!=="close"&&action!=="cancel")&&!canWrite)return;
    if(["allocation","correct","return"].includes(action)&&!form.transferId){
      notify({kind:"error",title:"اختر الحوالة",description:"يجب اختيار حوالة من نفس طلب الشراء."});return;
    }
    const amount=Number(form.amount);
    const revision=financial.revision;
    const key=pendingKey.current||crypto.randomUUID();
    pendingKey.current=key;
    let input:Record<string,unknown>={revision,idempotencyKey:key};
    if(action==="schedule")input={...input,kind:form.kind,amount,dueDate:form.date,notes:form.notes};
    if(action==="transfer")input={...input,amount,transferDate:form.date,
       beneficiaryCompanyId:form.beneficiaryId,method:form.method,reference:form.reference,
       bankOrExchangeName:form.bankOrExchangeName,
      proofDocumentId:form.proofDocumentId};
    if(action==="expense")input={...input,amount,category:form.category,
      payeeCompanyId:form.beneficiaryId,description:form.description,
      evidenceDocumentId:form.proofDocumentId};
    if(action==="allocation")input={...input,transferId:form.transferId,amount};
    if(action==="correct")input={...input,amount,transferDate:form.date,
       method:form.method,reference:form.reference,proofDocumentId:form.proofDocumentId,
       bankOrExchangeName:form.bankOrExchangeName,reason:form.reason};
    if(action==="return")input={...input,amount,returnDate:form.date,
      bankReference:form.reference,proofDocumentId:form.proofDocumentId,reason:form.reason};
    if(action==="close"||action==="cancel")input={revision,reason:form.reason};
    setBusy(true);
    try{
      await financeWrite(orderId,action,input,form.transferId,form.expenseId);
      pendingKey.current=null;
      notify({kind:"success",title:"تم حفظ العملية",description:
        "تم تحديث السجل على مستوى هذا الطلب فقط، مع حفظ أثر العملية للمراجعة."});
      setForm(defaultForm(supplierId));
      await load();
      await onChanged();
    }catch(error){
      notify({kind:"error",title:"تعذّر حفظ العملية المالية",description:(error as Error).message});
      // Intentionally retain pendingKey for a safe retry of the SAME payload.
    }finally{setBusy(false);}
  }

  return <section className="im-finance" aria-label="الحوالات والمحاسبة">
    <div className="im-finance-header">
      <div><span className="im-eyebrow">المالية / نفس طلب الشراء</span>
        <h2><Wallet size={22}/> الحوالات والتسويات</h2>
        <p>لا تُحتسب خطة الدفع حوالة فعلية. كل مبلغ ومستند وتصحيح يبقى مربوطاً بهذا الطلب وعملته.</p>
      </div>
      <button type="button" className="btn btn-outline" disabled={loading||busy}
        onClick={()=>void load()}><RefreshCw size={15}/> تحديث</button>
    </div>
    {loading&&!financial?<div className="im-empty">جارٍ تحميل الوضع المالي للطلب...</div>:!financial?
      <div className="im-empty">لم يمكن عرض السجل المالي. حاول التحديث.</div>:<>
      {financial.closedWithExceptions&&<div className="im-finance-alert">
        <AlertTriangle size={21}/><div><strong>مغلق إدارياً مع استثناءات — ليس تسوية مالية</strong>
          <p>{financial.closureReason||"تبقى الالتزامات والفروقات ظاهرة كما كانت."}</p></div>
      </div>}
      {financial.unresolvedDifference>0&&<div className="im-finance-alert" role="alert">
        <AlertTriangle size={21}/><div>
          <strong>فرق محاسبي غير مسوّى: <span dir="ltr">{currencyAmount(financial.unresolvedDifference,money)}</span></strong>
          <p>هذا الفرق يبقى حصراً على {financial.number}، وليس رصيداً للمورّد أو لأي طلب آخر.
            تسجيل مصروف وحده لا يعني سداده.</p>
          {canWrite&&<button type="button" className="btn btn-outline"
            onClick={()=>pick("allocation")}>مراجعة الفرق وتسويته بمستند</button>}
        </div>
      </div>}
      {financial.unresolvedDifference===0&&financial.transfers.length>0&&
        <div className="im-finance-success"><CheckCircle2 size={18}/> لا يوجد فرق محاسبي غير مسوّى لهذا الطلب حالياً.</div>}
      <div className="im-table-scroll" data-lenis-prevent>
        <table className="im-table im-finance-table">
          <thead><tr><th>البيان المالي</th><th>القيمة المسجلة</th><th>التفسير</th></tr></thead>
          <tbody>{([
            ["قيمة البضاعة",financial.commercialAmount,"الإجمالي الأصلي من بنود طلب الشراء"],
            ["الحوالات الخارجة",financial.grossOutgoing,"مجموع الحوالات الفعلية النشطة قبل الاسترداد"],
            ["الاستردادات البنكية",financial.actualReturns,"حركات استرجاع فعلية مدعومة بإثبات"],
            ["الصافي المحوّل",financial.grossActiveTransferred,"الحوالات النشطة ناقص الاسترداد"],
            ["المسدّد للبضاعة",financial.appliedCommercial,"لا يشمل المبلغ الزائد أو المصاريف"],
            ["مصاريف مسجلة",financial.recordedOrderExpenses,"قد تكون غير مدفوعة"],
            ["مصاريف مثبت سدادها",financial.appliedExpenses,"مرتبطة بمستفيد الحوالة نفسه"],
            ["فرق غير مسوّى",financial.unresolvedDifference,"يبقى على هذا الطلب ولا ينتقل لمكان آخر"],
            ["المتبقي للبضاعة",financial.commercialRemainingDue,"ليس معناه إغلاق كل الفروقات"]
          ] as [string,number,string][]).map(([label,value,description])=><tr key={label}>
            <td><strong>{label}</strong></td>
            <td dir="ltr" className="im-finance-value">{currencyAmount(value,money)}</td>
            <td>{description}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="im-finance-state">
        <span>حالة البضاعة: <strong>{paymentStatuses[financial.paymentStatus]}</strong></span>
        {financial.isPaymentOverdue&&<span className="im-finance-overdue">استحقاق متأخر وفق تاريخ UTC المسجل</span>}
      </div>
      <div className="im-finance-subsection">
        <h3>الاستحقاقات المخططة</h3>
        {financial.schedules.length===0?<p>لا توجد دفعات مخططة بعد.</p>:<div className="im-table-scroll" data-lenis-prevent>
          <table className="im-table"><thead><tr><th>النوع</th><th>تاريخ الاستحقاق</th><th>المخطط</th><th>المغطّى</th><th>المتبقي</th></tr></thead>
            <tbody>{financial.schedules.map(s=><tr key={s.id}><td>{scheduleKinds[s.kind]||s.kind}</td>
              <td>{dateLabel(s.dueDate)} {s.isOverdue&&<small className="im-finance-overdue">متأخر</small>}</td>
              <td dir="ltr">{currencyAmount(s.amount,money)}</td>
              <td dir="ltr">{currencyAmount(s.covered,money)}</td>
              <td dir="ltr">{currencyAmount(s.remaining,money)}</td></tr>)}</tbody>
          </table></div>}
      </div>
      <div className="im-finance-subsection">
        <h3>الحوالات الفعلية وتاريخ التصحيحات</h3>
        {financial.transfers.length===0?<p>لا توجد حوالات مسجّلة حتى الآن.</p>:<div className="im-table-scroll" data-lenis-prevent>
          <table className="im-table"><thead><tr><th>المستفيد</th><th>التاريخ</th><th>الحوالة</th><th>للبضاعة</th><th>للمصاريف</th><th>المتاح</th><th>الحالة</th></tr></thead>
          <tbody>{financial.transfers.map(t=><tr key={t.id}>
            <td>{t.beneficiarySnapshot}<small dir="ltr">{t.reference||t.id}</small>
              {t.bankOrExchangeName&&<small>{t.bankOrExchangeName}</small>}</td>
            <td>{dateLabel(t.transferDate)}</td>
            <td dir="ltr">{currencyAmount(t.amount,money)}</td>
            <td dir="ltr">{currencyAmount(t.commercialApplied,money)}</td>
            <td dir="ltr">{currencyAmount(t.expenseApplied,money)}</td>
            <td dir="ltr">{currencyAmount(t.available,money)}</td>
            <td>{t.state==="Voided"?"قيد مبطل محفوظ بالتاريخ":"قيد فعّال"}
              {t.replacesTransferId&&<small>بديل مرتبط بقيد سابق</small>}</td>
          </tr>)}</tbody></table></div>}
      </div>
      <div className="im-finance-subsection">
        <h3>مصاريف الطلب</h3>
        {financial.expenses.length===0?<p>لا توجد مصاريف مسجلة.</p>:<div className="im-table-scroll" data-lenis-prevent>
          <table className="im-table"><thead><tr><th>النوع</th><th>المستفيد</th><th>القيمة</th><th>سُدّد فعلياً</th><th>غير مسدّد</th></tr></thead>
          <tbody>{financial.expenses.map(e=><tr key={e.id}>
            <td>{categoryLabels[e.category]||e.category}<small>{e.description}</small></td>
            <td>{e.payeeSnapshot}</td><td dir="ltr">{currencyAmount(e.amount,money)}</td>
            <td dir="ltr">{currencyAmount(e.applied,money)}</td>
            <td dir="ltr">{currencyAmount(e.remaining,money)}</td></tr>)}</tbody></table></div>}
      </div>
      {financial.returns.length>0&&<div className="im-finance-subsection">
        <h3>الاستردادات البنكية المنفصلة</h3>
        <div className="im-table-scroll" data-lenis-prevent><table className="im-table">
          <thead><tr><th>مرجع البنك</th><th>تاريخ الاسترداد</th><th>المبلغ</th><th>السبب</th></tr></thead>
          <tbody>{financial.returns.map(r=><tr key={r.id}>
            <td dir="ltr">{r.bankReference}</td><td>{dateLabel(r.returnDate)}</td>
            <td dir="ltr">{currencyAmount(r.amount,money)}</td><td>{r.reason}</td>
          </tr>)}</tbody></table></div>
      </div>}
      {availableActions.length>0&&<div className="im-finance-workflow">
        <h3>إجراء مالي موثّق</h3>
        <p>كل تسجيل يراجع صلاحياتك في السيرفر، ويُحفظ ضمن هذا الطلب وحده. لا يرسل النظام حوالة إلى بنك؛ هو يسجل الواقعة المستندة إلى الإثبات.</p>
        <div className="im-finance-action-options" role="group" aria-label="نوع الإجراء المالي">
          {availableActions.map(option=><button type="button" key={option.key}
            data-finance-action={option.key}
            className={action===option.key?"active":""} disabled={busy}
            onClick={()=>pick(option.key)}>{option.label}</button>)}
        </div>
        <form onSubmit={event=>void submit(event)} className="im-finance-form">
          {action!=="close"&&action!=="cancel"&&action!=="allocation"&&
            <label>المبلغ ({money})
              <input data-finance-field="amount" required type="number" min="0.01" step="0.01" dir="ltr"
                value={form.amount} onChange={e=>change("amount",e.target.value)}/>
            </label>}
          {action==="allocation"&&<label>المبلغ المطلوب تخصيصه ({money})
            <input data-finance-field="amount" required type="number" min="0.01" step="0.01" dir="ltr"
              value={form.amount} onChange={e=>change("amount",e.target.value)}/></label>}
          {action==="schedule"&&<>
            <label>نوع الدفعة<select value={form.kind} onChange={e=>change("kind",e.target.value)}>
              {Object.entries(scheduleKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>تاريخ الاستحقاق<input data-finance-field="date" type="date" required value={form.date}
              onChange={e=>change("date",e.target.value)}/></label>
            <label>ملاحظات الخطة<input maxLength={500} value={form.notes}
              onChange={e=>change("notes",e.target.value)}/></label>
          </>}
          {(["transfer","correct","return"] as FinanceAction[]).includes(action)&&<>
            <label>{action==="return"?"تاريخ الاسترداد":"تاريخ الحوالة"}
              <input data-finance-field="date" required type="date" value={form.date} onChange={e=>change("date",e.target.value)}/>
            </label>
            {action!=="return"&&<label>طريقة الدفع
              <select value={form.method} onChange={e=>change("method",e.target.value)}>
                 <option value="BankTransfer">حوالة بنكية T/T</option><option value="LC">اعتماد مستندي L/C</option>
                 <option value="ExchangeOffice">شركة صرافة</option>
                <option value="Cash">نقداً</option><option value="Other">أخرى</option>
               </select></label>}
            {action!=="return"&&<label>البنك أو شركة الصرافة المستخدمة
              <input maxLength={180} value={form.bankOrExchangeName}
                onChange={e=>change("bankOrExchangeName",e.target.value)}/>
            </label>}
            <label>{action==="return"?"مرجع الاسترداد البنكي":"مرجع الحوالة"}
              <input data-finance-field="reference" maxLength={160} required={action==="return"} value={form.reference}
                onChange={e=>change("reference",e.target.value)}/>
            </label>
          </>}
          {(action==="transfer"||action==="expense")&&<label>المستفيد من الدفع
            <select data-finance-field="beneficiary" required value={form.beneficiaryId} onChange={e=>change("beneficiaryId",e.target.value)}>
              <option value="">اختر جهة من دليلك</option>
              {companies.map(c=><option key={c.id} value={c.id}>{c.name} — {c.type}</option>)}
            </select>
          </label>}
          {action==="expense"&&<>
            <label>فئة المصروف<select value={form.category} onChange={e=>change("category",e.target.value)}>
              {Object.entries(categoryLabels).map(([key,value])=><option key={key} value={key}>{value}</option>)}
            </select></label>
            <label className="im-finance-wide">وصف المصروف (8 أحرف على الأقل)
              <textarea data-finance-field="description" required minLength={8} maxLength={500} rows={2} value={form.description}
                onChange={e=>change("description",e.target.value)}/>
            </label>
          </>}
          {(["allocation","correct","return"] as FinanceAction[]).includes(action)&&<label>الحوالة المرتبطة بهذا الطلب
            <select data-finance-field="transfer" required value={form.transferId} onChange={e=>change("transferId",e.target.value)}>
              <option value="">اختر حوالة فعّالة</option>
              {activeTransfers.map(t=><option key={t.id} value={t.id}>
                {t.beneficiarySnapshot} — {currencyAmount(t.amount,money)} — متاح {currencyAmount(t.available,money)}
              </option>)}
            </select></label>}
          {action==="allocation"&&<label>المصروف الموثّق من نفس الطلب
            <select data-finance-field="expense" required value={form.expenseId} onChange={e=>change("expenseId",e.target.value)}>
              <option value="">اختر مصروفاً</option>
              {financial.expenses.filter(e=>e.remaining>0).map(e=><option key={e.id} value={e.id}>
                {e.description} — {e.payeeSnapshot} — متبقٍ {currencyAmount(e.remaining,money)}
              </option>)}
            </select></label>}
          {(["transfer","expense","correct","return"] as FinanceAction[]).includes(action)&&<label>
            {action==="expense"?"مستند المصروف":"إثبات الحوالة / الاسترداد"}
            <select data-finance-field="proof" required value={form.proofDocumentId} onChange={e=>change("proofDocumentId",e.target.value)}>
              <option value="">اختر مستنداً مرتبطاً بالطلب</option>
              {(action==="expense"?expenseProofs:paymentProofs).map(d=><option key={d.id} value={d.id}>
                {d.originalFileName} — {d.type}
              </option>)}
            </select>
          </label>}
          {(["correct","return","close","cancel"] as FinanceAction[]).includes(action)&&<label className="im-finance-wide">
            سبب العملية الذي سيبقى في سجل التدقيق (8 أحرف على الأقل)
            <textarea data-finance-field="reason" required minLength={8} maxLength={1000} rows={2}
              value={form.reason} onChange={e=>change("reason",e.target.value)}/>
          </label>}
          <div className="im-finance-form-footer">
            <button type="submit" className="btn primary" disabled={busy||disabled||
              ((["transfer","correct","return"] as FinanceAction[]).includes(action)&&paymentProofs.length===0)||
              (action==="expense"&&expenseProofs.length===0)}>
              {busy?"جارٍ التسجيل...":"حفظ وإثبات الإجراء"}</button>
            {disabled&&<small>احفظ تعديلات طلب الشراء أولاً.</small>}
            {(["transfer","expense","correct","return"] as FinanceAction[]).includes(action)&&
              <small><FileText size={13}/> ارفع المستند المطلوب في قسم «المستندات» أدناه ثم حدّث القائمة هنا.</small>}
          </div>
        </form>
        {action==="correct"&&<p className="im-finance-caution">التصحيح يبطل القيد الحسابي الخاطئ ويحفظ بديله، ولا يمحو حوالة بنكية حدثت فعلياً. حوالة لها مصاريف مسددة أو استرداد تحتاج معالجة منفصلة.</p>}
        {action==="close"&&<p className="im-finance-caution">إغلاق إداري استثنائي فقط؛ يبقى المتبقي والفرق المستحق ظاهرين في التقارير.</p>}
        {action==="cancel"&&<p className="im-finance-caution">الإلغاء مسموح لمسودة لم يسجّل عليها أي دفع أو شحن أو مستندات.</p>}
      </div>}
      {!canWrite&&<div className="im-finance-readonly">يمكنك رؤية مبالغ شركتك، لكن تسجيل الحوالات والمصاريف يحتاج صلاحية CanManagePayments.</div>}
      <p className="im-finance-footnote">حساب التأخير مرتبط بتاريخ UTC حتى اعتماد توقيت عمل خاص بكل تاجر. المبالغ لا تُحوّل بين عملات مختلفة، ولا تُنقل بين طلبات شراء.</p>
    </>}
  </section>;
}
