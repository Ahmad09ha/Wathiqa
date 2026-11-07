"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Building2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import ImportShell from "@/components/ImportShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";
import { fetchImportCompaniesPage, importApi, ImportCompany } from "@/lib/importApi";

const types: Record<string, string> = {
  Supplier: "مورّد", Customer: "عميل", Broker: "مخلّص جمركي",
  ShippingLine: "شركة شحن", Forwarder: "وكيل شحن", Other: "جهة أخرى"
};
type CompanyDetails = Pick<ImportCompany, "nameEn" | "country" | "city" | "address" |
  "contactName" | "phone" | "email" | "taxNo" | "defaultCurrency" | "notes">;
const emptyDetails: CompanyDetails = {nameEn:"",country:"",city:"",address:"",
  contactName:"",phone:"",email:"",taxNo:"",defaultCurrency:"",notes:""};
const companyFields: {key:keyof Omit<CompanyDetails,"defaultCurrency"|"notes">;
  label:string;max:number;type?:string}[] = [
  {key:"nameEn",label:"الاسم التجاري بالإنجليزية",max:180},
  {key:"country",label:"الدولة",max:100},
  {key:"city",label:"المدينة",max:100},
  {key:"address",label:"العنوان",max:500},
  {key:"contactName",label:"الشخص المسؤول",max:160},
  {key:"phone",label:"رقم الهاتف",max:45,type:"tel"},
  {key:"email",label:"البريد الإلكتروني",max:254,type:"email"},
  {key:"taxNo",label:"الرقم الضريبي",max:80}
];
function CompaniesContent() {
  const { notify } = useToast();
  const [items, setItems] = useState<ImportCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const latestRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("Supplier");
  const [details, setDetails] = useState<CompanyDetails>(emptyDetails);
  const [editing, setEditing] = useState<ImportCompany | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ImportCompany | null>(null);

  const load = useCallback(async () => {
    const current = ++latestRequest.current;
    const params = new URLSearchParams({page:String(page),pageSize:"20"});
    if (appliedQuery) params.set("search",appliedQuery);
    if (filterType) params.set("type",filterType);
    setLoading(true);
    try {
      const result = await fetchImportCompaniesPage(params);
      if (current !== latestRequest.current) return;
      setItems(result.items);setTotal(result.total);
      if (page > 1 && !result.items.length && result.total > 0)
        setPage(Math.max(1,Math.ceil(result.total/20)));
    } catch (error) {
      if (current === latestRequest.current)
        notify({kind:"error",title:"تعذّر تحميل الشركات",description:(error as Error).message});
    } finally { if (current === latestRequest.current) setLoading(false); }
  }, [notify,appliedQuery,filterType,page]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer=window.setTimeout(()=>{setAppliedQuery(query.trim());setPage(1);},300);
    return ()=>window.clearTimeout(timer);
  },[query]);

  function openCreate(){
    setEditing(null);setName("");setType("Supplier");setDetails(emptyDetails);setAdding(true);
  }
  function openEdit(item:ImportCompany){
    setEditing(item);setName(item.name);setType(item.type);
    setDetails({nameEn:item.nameEn,country:item.country,city:item.city,
      address:item.address,contactName:item.contactName,phone:item.phone,
      email:item.email,taxNo:item.taxNo,defaultCurrency:item.defaultCurrency,notes:item.notes});
    setAdding(true);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const savedName=name.trim();
      await importApi("/api/companies"+(editing?"/"+editing.id:""),
        {method:editing?"PUT":"POST",body:JSON.stringify({name:savedName,type,...details})});
      setAdding(false);setEditing(null);setName("");setDetails(emptyDetails);
      // A newly created company may be beyond page 1 in a large directory.
      // Show the saved entry by name instead of misleadingly leaving it unseen.
      setQuery(savedName);setAppliedQuery(savedName);setFilterType("");setPage(1);
      await load();
      notify({kind:"success",title:editing?"تم تحديث بيانات الجهة":"تمت إضافة الجهة",
        description:"البيانات محفوظة ضمن مساحة شركتك فقط."});
    } catch (error) {
      notify({kind:"error",title:editing?"تعذّر تحديث الجهة":"تعذّرت الإضافة",description:(error as Error).message});
    } finally { setSaving(false); }
  }
  async function remove() {
    if (!deleting || saving) return;
    setSaving(true);
    try {
      await importApi("/api/companies/" + deleting.id, {method:"DELETE"});
      setDeleting(null); await load();
      notify({kind:"success",title:"تمت إزالة الجهة من الدليل"});
    } catch (error) {
      notify({kind:"error",title:"تعذّر الحذف",description:(error as Error).message});
    } finally { setSaving(false); }
  }
  const totalPages=Math.max(1,Math.ceil(total/20));
  return (
    <>
      <div className="im-section-header">
        <div><small>الدليل التجاري</small><h2>الجهات والشركات</h2>
          <p>الموردون والشركات المرتبطة بعمليات الاستيراد.</p>
        </div>
        <button type="button" className="btn primary" onClick={openCreate}><Plus size={17}/> إضافة جهة</button>
      </div>
      {adding && <form className="im-add-form" onSubmit={event => void create(event)}>
        <div className="im-add-form-header"><strong>{editing?"تعديل بيانات الجهة":"إضافة جهة جديدة"}</strong>
          <p>الحقول الإضافية اختيارية ومحفوظة ضمن مساحة شركتك. البيانات البنكية غير متاحة في هذه المرحلة.</p></div>
        <div className="im-form-row">
          <label>اسم الجهة<input required minLength={2} maxLength={180} dir="auto" placeholder="مثلاً: مورّد الخيوط"
            value={name} onChange={event => setName(event.target.value)}/></label>
          <label>نوع الجهة<select value={type} onChange={event => setType(event.target.value)}>
            {Object.entries(types).map(([key,text]) => <option value={key} key={key}>{text}</option>)}
          </select></label>
        </div>
        <div className="im-form-row im-company-extra-fields">
          {companyFields.map(field=><label key={field.key}>{field.label}
            <input type={field.type||"text"} dir="auto" maxLength={field.max}
              value={details[field.key]}
              onChange={event=>setDetails(value=>({...value,[field.key]:event.target.value}))}/>
          </label>)}
          <label>العملة الافتراضية للجهة
            <select value={details.defaultCurrency} onChange={event=>setDetails(value=>({...value,defaultCurrency:event.target.value}))}>
              <option value="">غير محددة</option><option value="USD">USD</option><option value="EUR">EUR</option>
            </select>
          </label>
          <label className="im-company-notes">ملاحظات
            <textarea dir="auto" maxLength={2000} rows={3} value={details.notes}
              onChange={event=>setDetails(value=>({...value,notes:event.target.value}))}/>
          </label>
        </div>
        <div className="im-company-form-actions">
          <button type="submit" className="btn primary" disabled={saving}>{saving?"جارٍ الحفظ...":editing?"حفظ التعديلات":"حفظ الجهة"}</button>
          <button type="button" className="btn btn-outline" disabled={saving} onClick={() => {setAdding(false);setEditing(null);}}>إلغاء</button>
        </div>
      </form>}
      <div className="im-table-shell">
        <div className="im-table-toolbar">
          <div className="im-search"><Search size={18}/><input aria-label="البحث عن جهة" placeholder="ابحث عن اسم الجهة أو اسم التواصل"
            value={query} onChange={event => setQuery(event.target.value)}/></div>
          <select className="im-company-filter-type" aria-label="تصفية الجهات حسب النوع" value={filterType}
            onChange={event=>{setFilterType(event.target.value);setPage(1);}}>
            <option value="">جميع أنواع الجهات</option>
            {Object.entries(types).map(([key,value])=><option key={key} value={key}>{value}</option>)}
          </select>
        </div>
        {loading ? <div className="im-empty">جارٍ تحميل دليل الجهات...</div> :
          items.length === 0 ? <div className="im-empty"><Building2 size={30}/><strong>{query||filterType?"لا توجد نتائج مطابقة":"لا توجد جهات مضافة بعد"}</strong><p>يمكنك إضافة مورّد أو تعديل البحث.</p></div> :
          <div className="im-table-scroll" data-lenis-prevent>
            <table className="im-table">
              <thead><tr><th>الجهة</th><th>النوع</th><th>تاريخ الإضافة</th><th>الإجراءات</th></tr></thead>
              <tbody>{items.map(item => <tr key={item.id}>
                <td><div className="im-table-company"><span><Building2 size={19}/></span><strong dir="auto">{item.name}</strong></div></td>
                <td><span className="im-pill">{types[item.type] || item.type}</span></td>
                <td>{new Date(item.createdAtUtc).toLocaleDateString("ar-SY-u-nu-latn")}</td>
                <td><div className="im-company-table-actions">
                  <button type="button" className="im-table-edit" title="تعديل الجهة" aria-label={"تعديل " + item.name} onClick={() => openEdit(item)}><Pencil size={17}/></button>
                  <button type="button" className="im-table-delete" title="حذف الجهة" aria-label={"حذف " + item.name} onClick={() => setDeleting(item)}><Trash2 size={17}/></button>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>}
        <div className="im-order-pagination im-company-pagination">
          <span>الصفحة {page} من {totalPages}</span>
          <div>
            <button type="button" className="btn btn-outline" disabled={loading||page<=1}
              onClick={()=>setPage(value=>Math.max(1,value-1))}>السابق</button>
            <button type="button" className="btn btn-outline" disabled={loading||page>=totalPages}
              onClick={()=>setPage(value=>Math.min(totalPages,value+1))}>التالي</button>
          </div>
        </div>
      </div>
      <ConfirmDialog open={Boolean(deleting)} title="حذف هذه الجهة؟"
        description="سيتم إخفاؤها من الدليل. لا يمكن التراجع عن هذا الإجراء من الواجهة."
        pending={saving} onCancel={() => setDeleting(null)} onConfirm={() => void remove()}/>
    </>
  );
}
export default function ImportCompaniesPage() {
  return <ImportShell section="companies" title="الجهات والشركات" description="إدارة الجهات التجارية الخاصة بشركتك.">
    {() => <CompaniesContent />}
  </ImportShell>;
}
