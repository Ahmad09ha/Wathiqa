"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {Anchor,Building2,Pencil,Plus,Search,Trash2,BookmarkPlus} from "lucide-react";
import ImportShell from "@/components/ImportShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import {useToast} from "@/components/ToastProvider";
import {
  fetchImportCompanies,fetchTenantPorts,createTenantPort,importApi,
  type ImportCompany,type TenantPort
} from "@/lib/importApi";

type Kind="Supplier"|"Customer"|"Port";
const labels:Record<Kind,string>={Supplier:"الموردون",Customer:"العملاء",Port:"الموانئ"};
type Row={id:string|null;name:string;country:string;source:"Catalog"|"History";company?:ImportCompany};

function ReferenceContent(){
  const {notify}=useToast();
  const [kind,setKind]=useState<Kind>("Supplier");
  const [companies,setCompanies]=useState<ImportCompany[]>([]);
  const [ports,setPorts]=useState<TenantPort[]>([]);
  const [filter,setFilter]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [editing,setEditing]=useState<Row|null>(null);
  const [adding,setAdding]=useState(false);
  const [name,setName]=useState("");
  const [country,setCountry]=useState("");
  const [deleting,setDeleting]=useState<Row|null>(null);

  const refresh=useCallback(async()=>{
    setLoading(true);
    try{
      const [parties,portList]=await Promise.all([fetchImportCompanies(),fetchTenantPorts()]);
      setCompanies(parties);setPorts(portList);
    }catch(error){
      notify({kind:"error",title:"تعذّر تحميل البيانات المرجعية",description:(error as Error).message});
    }finally{setLoading(false)}
  },[notify]);
  useEffect(()=>{void refresh()},[refresh]);

  const rows:Row[]=kind==="Port"
    ?ports.map(p=>({id:p.id,name:p.name,country:p.country,source:p.source}))
    :companies.filter(c=>c.type===kind).map(c=>({
      id:c.id,name:c.name,country:c.country,source:"Catalog",company:c
    }));
  const shown=rows.filter(r=>(r.name+" "+r.country).toLocaleLowerCase()
    .includes(filter.trim().toLocaleLowerCase()))
    .sort((a,b)=>a.name.localeCompare(b.name,"ar"));
  function startCreate(row?:Row){
    setEditing(null);setName(row?.name||"");setCountry(row?.country||"");setAdding(true);
  }
  function startEdit(row:Row){
    setEditing(row);setName(row.name);setCountry(row.country);setAdding(true);
  }
  async function submit(event:FormEvent){
    event.preventDefault();if(saving)return;
    setSaving(true);
    try{
      const cleaned=name.trim();
      if(kind==="Port"){
        if(editing?.id){
          await importApi("/api/ports/"+editing.id,{
            method:"PUT",body:JSON.stringify({name:cleaned,country:country.trim()})
          });
        }else await createTenantPort(cleaned,country.trim());
      }else{
        // Preserve optional contact/profile fields during a simple name edit.
        const existing=editing?.company;
        await importApi("/api/companies"+(existing?"/"+existing.id:""),{
          method:existing?"PUT":"POST",
          body:JSON.stringify({
            type:kind,name:cleaned,country:country.trim(),
            nameEn:existing?.nameEn||"",city:existing?.city||"",
            address:existing?.address||"",contactName:existing?.contactName||"",
            phone:existing?.phone||"",email:existing?.email||"",
            taxNo:existing?.taxNo||"",defaultCurrency:existing?.defaultCurrency||"",
            notes:existing?.notes||""
          })
        });
      }
      setAdding(false);setEditing(null);setFilter("");
      await refresh();
      notify({kind:"success",title:editing?"تم تحديث البيانات":"تم الحفظ في دليل الشركة",
        description:"هذه البيانات خاصة بشركتك ويمكن اختيارها عند إنشاء طلبات الشراء."});
    }catch(error){
      notify({kind:"error",title:"تعذّر حفظ البيانات",description:(error as Error).message});
    }finally{setSaving(false)}
  }
  async function remove(){
    if(!deleting?.id||saving)return;
    setSaving(true);
    try{
      const path=kind==="Port"?"/api/ports/":"/api/companies/";
      await importApi(path+deleting.id,{method:"DELETE"});
      setDeleting(null);await refresh();
      notify({kind:"success",title:"تم إخفاء السجل من الدليل",
        description:"الطلبات القديمة تحتفظ ببياناتها المسجلة."});
    }catch(error){
      notify({kind:"error",title:"تعذّر الحذف",description:(error as Error).message});
    }finally{setSaving(false)}
  }
  function switchKind(next:Kind){
    if(saving)return;
    setKind(next);setFilter("");setAdding(false);setEditing(null);setDeleting(null);
  }

  return <div className="im-reference-management">
    <div className="im-section-header">
      <div><small>دليل شركتك المرجعي</small><h2>بيانات طلبات الشراء</h2>
        <p>احفظ الموردين والعملاء والموانئ مرة واحدة، وأعد استخدامها في أي طلب أو ملف جديد.
          لا يمكن لأي تاجر آخر الاطلاع على هذه البيانات.</p>
      </div>
      <button type="button" className="btn primary" onClick={()=>startCreate()}>
        <Plus size={17}/> إضافة {kind==="Supplier"?"مورّد":kind==="Customer"?"عميل":"ميناء"}</button>
    </div>
    <div role="tablist" aria-label="أقسام البيانات المرجعية" className="im-reference-tabs">
      {(["Supplier","Customer","Port"] as Kind[]).map(type=><button key={type}
        type="button" role="tab" aria-selected={kind===type}
        className={kind===type?"active":""} onClick={()=>switchKind(type)}>
        {type==="Port"?<Anchor size={17}/>:<Building2 size={17}/>}
        {labels[type]}
      </button>)}
    </div>
    {adding&&<form className="im-add-form im-reference-edit" onSubmit={e=>void submit(e)}>
      <div className="im-add-form-header"><strong>{editing?"تعديل":"إضافة"} {kind==="Port"?"ميناء":kind==="Supplier"?"مورّد":"عميل"}</strong>
        <p>البيانات تنحفظ في مساحة شركتك فقط، ولن نغيّر أسماء الجهات أو الموانئ الموجودة بالطلبات السابقة.</p></div>
      <div className="im-form-row">
        <label>الاسم <span className="im-required">*</span>
          <input required minLength={2} maxLength={kind==="Port"?160:180} dir="auto"
            value={name} onChange={e=>setName(e.target.value)} placeholder={
              kind==="Port"?"مثلاً Ningbo":kind==="Supplier"?"اسم المورّد":"اسم العميل"}/>
        </label>
        <label>الدولة <small>اختياري</small>
          <input maxLength={100} dir="auto" value={country}
            onChange={e=>setCountry(e.target.value)} placeholder="مثلاً China"/>
        </label>
      </div>
      <div className="im-company-form-actions">
        <button type="submit" className="btn primary" disabled={saving}>
          {saving?"جارٍ الحفظ...":"حفظ في دليل الشركة"}</button>
        <button type="button" className="btn btn-outline" disabled={saving}
          onClick={()=>{setAdding(false);setEditing(null)}}>إلغاء</button>
      </div>
    </form>}
    <div className="im-table-shell">
      <div className="im-table-toolbar">
        <div className="im-search"><Search size={18}/>
          <input aria-label={"بحث في "+labels[kind]}
            placeholder={"ابحث عن "+(kind==="Port"?"ميناء":kind==="Supplier"?"مورّد":"عميل")}
            value={filter} onChange={e=>setFilter(e.target.value)}/>
        </div>
        <span className="im-reference-count">{shown.length} سجل</span>
      </div>
      {loading?<div className="im-empty">جارٍ تحميل {labels[kind]}...</div>:
        !shown.length?<div className="im-empty">
          {kind==="Port"?<Anchor size={28}/>:<Building2 size={28}/>}
          <strong>{filter?"لا توجد نتائج مطابقة":"ما في بيانات محفوظة بعد"}</strong>
          <p>استخدم «إضافة» حتى تظهر البيانات بقوائم الاختيار في طلباتك.</p>
        </div>:<div className="im-table-scroll" data-lenis-prevent>
          <table className="im-table"><thead><tr>
            <th>الاسم</th><th>الدولة</th><th>المصدر</th><th>الإجراءات</th>
          </tr></thead><tbody>{shown.map(row=><tr key={row.id||"history:"+row.name}>
            <td><div className="im-table-company">
              <span>{kind==="Port"?<Anchor size={18}/>:<Building2 size={18}/>}</span>
              <strong dir="auto">{row.name}</strong>
            </div></td>
            <td dir="auto">{row.country||"—"}</td>
            <td>{row.source==="History"?
              <span className="im-pill">مستخدم بطلب سابق</span>:
              <span className="im-pill">محفوظ في الدليل</span>}</td>
            <td><div className="im-company-table-actions">
              {row.source==="History"?<button type="button" className="im-reference-save-history"
                title="حفظ الميناء في دليلك" aria-label={"حفظ "+row.name}
                onClick={()=>startCreate(row)}><BookmarkPlus size={16}/> حفظ بالدليل</button>:<>
                <button type="button" className="im-table-edit"
                  title="تعديل" aria-label={"تعديل "+row.name} onClick={()=>startEdit(row)}>
                  <Pencil size={17}/></button>
                <button type="button" className="im-table-delete" title="حذف"
                  aria-label={"حذف "+row.name} onClick={()=>setDeleting(row)}>
                  <Trash2 size={17}/></button>
              </>}
            </div></td>
          </tr>)}</tbody></table>
        </div>}
    </div>
    <div className="im-info-strip">
      <BookmarkPlus size={19}/><div><strong>الموانئ من الطلبات القديمة</strong>
        <p>أي ميناء سبق استخدامه في طلب شراء ضمن شركتك بيظهر كخيار حتى لو مو محفوظ بالدليل.
          بإمكانك حفظه أو استخدامه مباشرة، ولا تتأثر الطلبات القديمة إذا عدلته أو حذفته.</p>
        <Link href="/import/orders/from-file" className="im-order-helper">إضافة طلب شراء من ملف</Link>
      </div>
    </div>
    <ConfirmDialog open={Boolean(deleting)}
      title={"حذف "+(deleting?.name||"السجل")+"؟"}
      description={kind==="Port"?
        "سيختفي الميناء من الدليل، لكن الطلبات السابقة ستحتفظ باسم الميناء. إذا استخدمته بطلب سابق فقد يظهر ضمن اقتراحات التاريخ.":
        "سيُخفى هذا السجل من الدليل. الجهات المستخدمة في طلبات أو عمليات نشطة لا يمكن حذفها حفاظاً على البيانات."}
      pending={saving} onCancel={()=>setDeleting(null)} onConfirm={()=>void remove()}/>
  </div>;
}

export default function ReferenceDataPage(){
  return <ImportShell section="reference" title="بيانات طلبات الشراء"
    description="إدارة الموردين والعملاء والموانئ الخاصة بمساحة شركتك.">
    {()=> <ReferenceContent/>}
  </ImportShell>;
}
