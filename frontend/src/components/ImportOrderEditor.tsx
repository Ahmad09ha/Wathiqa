"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ClipboardList, Plus, Save, Trash2, Info, FilePlus2 } from "lucide-react";
import ImportShell from "@/components/ImportShell";
import ImportLogisticsPanel from "@/components/ImportLogisticsPanel";
import ImportDocumentsPanel from "@/components/ImportDocumentsPanel";
import ImportPaymentPanel from "@/components/ImportPaymentPanel";
import ImportTrackingPanel from "@/components/ImportTrackingPanel";
import {documentPreviewUrl,listDocuments,uploadPrivateDocument,DocumentType,BusinessDocument} from "@/lib/documentsApi";
import { useToast } from "@/components/ToastProvider";
import { fetchImportCompanies, fetchOrder, importApi, ImportCompany, CurrentImportUser, OrderInputItem, PurchaseOrder, SaveOrderInput } from "@/lib/importApi";

type LocalLine = OrderInputItem & {localKey:string};
const commonTerms = ["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"];
const currencies = ["USD","EUR","CNY","TRY"];
function todayLocal() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}
function newLine():LocalLine {
  return {localKey:crypto.randomUUID(),productType:"POY",brand:"",denier:"",luster:"SD",grade:"AA",colorType:"Raw White",
    quantity:1,quantityUnit:"KG",unitPrice:1,priceUnit:"KG",hsCode:""};
}
function emptyForm():SaveOrderInput {
  return {supplierId:"",customerId:null,supplierRef:"",proformaInvoiceNumber:"",
    contractNumber:"",contractDate:null,metadataEdited:true,orderDate:todayLocal(),incoterm:"FOB",
    loadingPort:"",dischargePort:"",currency:"USD",notes:"",items:[],revision:null};
}
function OrderForm({orderId,canManagePayments,user,documentWorkspace=false}:{orderId?:string;canManagePayments:boolean;user:CurrentImportUser;documentWorkspace?:boolean}) {
  const router = useRouter();
  const {notify} = useToast();
  const [form,setForm] = useState<SaveOrderInput>(()=>({...emptyForm(),items:[newLine()]}));
  const [lines,setLines] = useState<LocalLine[]>(()=>[newLine()]);
  const [companies,setCompanies] = useState<ImportCompany[]>([]);
  const [current,setCurrent] = useState<PurchaseOrder|null>(null);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [dirty,setDirty] = useState(false);
  const [activeTab,setActiveTab] = useState("info");
  const [sourceFile,setSourceFile] = useState<File|null>(null);
  const [sourceUrl,setSourceUrl] = useState<string|null>(null);
  const [storedDocs,setStoredDocs] = useState<BusinessDocument[]>([]);
  const [viewDoc,setViewDoc] = useState("");
  const [sourceType,setSourceType] = useState<DocumentType>("Contract");
  const [uploading,setUploading] = useState(false);
  const isEditing = Boolean(orderId);

  useEffect(()=>{
    if(!sourceFile){setSourceUrl(null);return;}
    const url=URL.createObjectURL(sourceFile);
    setSourceUrl(url);
    return()=>URL.revokeObjectURL(url);
  },[sourceFile]);
  useEffect(()=>{
    if(!orderId||!documentWorkspace)return;
    let live=true;
    listDocuments({orderId},1,100).then(result=>{
      if(!live)return;
      setStoredDocs(result.items);
      setViewDoc(prev=>result.items.some(d=>d.id===prev)?prev:result.items[0]?.id||"");
    }).catch(error=>notify({kind:"error",title:"تعذّر تحميل ملفات الطلب",description:(error as Error).message}));
    return()=>{live=false;};
  },[orderId,documentWorkspace,notify]);

  function chooseSource(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0]||null;
    if(file&&(!/\.(pdf|png|jpe?g)$/i.test(file.name)||file.size>25*1024*1024||file.size===0)){
      notify({kind:"error",title:"ملف غير مدعوم",description:"المتاح حالياً PDF أو JPG أو PNG حتى 25 MB، مع فحص الملف على السيرفر."});
      event.target.value="";return;
    }
    setSourceFile(file);
  }
  async function uploadSource(order:string){
    if(!sourceFile)return;
    setUploading(true);
    try{
      const result=await uploadPrivateDocument(sourceFile,sourceType,{orderId:order},"الملف المرجعي لإدخال بيانات الاستيراد");
      setSourceFile(null);setViewDoc(result.document.id);
      if(orderId){
        const documents=await listDocuments({orderId},1,100);
        setStoredDocs(documents.items);
      }
      notify({kind:"success",title:"تم حفظ الملف بأمان وربطه بالطلب"});
    }finally{setUploading(false);}
  }

  function adoptOrder(order:PurchaseOrder){
    setCurrent(order);
    setForm({
      supplierId:order.supplierId,customerId:order.customerId,
      supplierRef:order.supplierRef,proformaInvoiceNumber:order.proformaInvoiceNumber||order.supplierRef,
      contractNumber:order.contractNumber||"",contractDate:order.contractDate,
      metadataEdited:true,
      orderDate:order.orderDate,incoterm:order.incoterm,
      loadingPort:order.loadingPort,dischargePort:order.dischargePort,
      currency:order.currency,notes:order.notes,revision:order.revision,items:[]
    });
    setLines(order.items.map(item=>({
      localKey:item.id,id:item.id,productType:item.productType,brand:item.brand||"",denier:item.denier,
      luster:item.luster,grade:item.grade,colorType:item.colorType,
      quantity:item.quantityKg,quantityUnit:"KG",
      unitPrice:item.unitPrice,priceUnit:item.priceUnit,hsCode:item.hsCode
    })));
    setDirty(false);
  }

  useEffect(()=>{
    let cancelled=false;
    Promise.all([fetchImportCompanies(),orderId?fetchOrder(orderId):Promise.resolve(null)])
      .then(([list,order])=>{
        if(cancelled)return;
        setCompanies(list);
        if(order) {
          adoptOrder(order);
        } else setLines([newLine()]);
      })
      .catch(error=>notify({kind:"error",title:"تعذّر تحميل بيانات الطلب",description:(error as Error).message}))
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[orderId,notify]);

  useEffect(()=>{
    const warning = (event:BeforeUnloadEvent)=>{
      if(dirty){event.preventDefault();event.returnValue="";}
    };
    window.addEventListener("beforeunload",warning);
    return()=>window.removeEventListener("beforeunload",warning);
  },[dirty]);

  function setField<K extends keyof SaveOrderInput>(key:K,value:SaveOrderInput[K]){
    setForm(prev=>({...prev,[key]:value}));setDirty(true);
  }
  function setLineField<K extends keyof OrderInputItem>(key:string,field:K,value:OrderInputItem[K]){
    setLines(prev=>prev.map(row=>row.localKey===key?{...row,[field]:value}:row));
    setDirty(true);
  }
  async function save(event:FormEvent){
    event.preventDefault();
    if(saving)return;
    if(!canManagePayments){
      notify({kind:"error",title:"لا تملك صلاحية تعديل الأسعار",description:"اطلب من مدير الشركة صلاحية CanManagePayments."});
      return;
    }
    if(!form.supplierId){
      notify({kind:"error",title:"اختر مورّداً",description:"يجب إضافة مورّد قبل حفظ طلب الشراء."});return;
    }
    if(lines.length===0){
      notify({kind:"error",title:"أضف بنداً",description:"طلب الشراء يحتاج بنداً واحداً على الأقل."});return;
    }
    if(lines.some(row=>!row.productType.trim()||!(row.quantity>0)||!(row.unitPrice>0))){
      notify({kind:"error",title:"راجع بيانات البنود",description:"نوع الخيط والكمية والسعر مطلوبة لكل بند."});return;
    }
    setSaving(true);
    try{
      const items:OrderInputItem[] = lines.map(({localKey:ignored,...row})=>{
        void ignored;return row;
      });
      const result=await importApi<PurchaseOrder>(orderId?"/api/orders/"+orderId:"/api/orders",{
        method:orderId?"PUT":"POST",
        body:JSON.stringify({...form,items})
      });
      adoptOrder(result);
      if(documentWorkspace&&sourceFile){
        try{await uploadSource(result.id);}
        catch(error){notify({kind:"error",title:"تم حفظ الطلب لكن تعذّر إرفاق الملف",description:(error as Error).message});}
      }
      notify({kind:"success",title:isEditing?"تم حفظ تعديلات الطلب":"تم إنشاء طلب الشراء",description:"رقم الطلب: "+result.number});
      router.push("/import/orders/"+result.id+(documentWorkspace?"?mode=file":""));
      router.refresh();
    }catch(error){
      notify({kind:"error",title:"تعذّر حفظ طلب الشراء",description:(error as Error).message});
    }finally{setSaving(false);}
  }

  const suppliers=companies.filter(x=>x.type==="Supplier");
  const customers=companies.filter(x=>x.type==="Customer");
  const tabs=[["info","معلومات الطلبية / العقد"],["payments","دفوعات"],
    ["bl","بوليصة الشحن B/L"],["customs","تخليص جمركي"],["tracking","تتبع الشحنة"]];
  const selectedDoc=storedDocs.find(d=>d.id===viewDoc);
  const previewUrl=sourceUrl||(selectedDoc?documentPreviewUrl(selectedDoc.id):null);
  const previewName=sourceFile?.name||selectedDoc?.originalFileName||"";
  return <>
    <div className="im-order-editor-head">
      <Link href="/import/orders" className="im-order-back"><ArrowRight size={17}/> جميع الطلبات</Link>
      {orderId&&<Link href={"/import/orders/"+orderId+(documentWorkspace?"":"?mode=file")}
        className="btn btn-outline">{documentWorkspace?"فتح شاشة الإدخال العادية":"فتح الملف والتبويبات"}</Link>}
       {current&&<span className="im-pill">{current.status==="Draft"?"مسودة":current.status==="Closed"?"مغلق إدارياً":"ملغى"} · إصدار {current.revision}</span>}
    </div>
    <div className={documentWorkspace?"im-file-workspace":"im-file-default"}>
      {documentWorkspace&&<aside className="im-file-preview">
        <div className="im-file-preview-head"><strong>الملف المرجعي</strong><small>لا يتم استخراج بيانات تلقائياً</small></div>
        <label className="im-file-picker"><FilePlus2 size={19}/> اختيار ملف PDF أو صورة
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={chooseSource}/>
        </label>
        {sourceFile&&<div className="im-file-upload-row">
          <strong dir="auto">{sourceFile.name}</strong>
          <select aria-label="نوع المستند" value={sourceType} onChange={e=>setSourceType(e.target.value as DocumentType)}>
            <option value="Contract">عقد</option><option value="Proforma">فاتورة أولية PI</option>
            <option value="CommercialInvoice">فاتورة تجارية</option>
            <option value="BillOfLading">بوليصة شحن</option><option value="Other">مستند آخر</option>
          </select>
          {orderId&&<button className="btn primary" type="button" disabled={uploading} onClick={()=>void uploadSource(orderId).catch(e=>notify({kind:"error",title:"فشل رفع الملف",description:(e as Error).message}))}>
            {uploading?"جارٍ الرفع...":"حفظ الملف بالطلب"}</button>}
        </div>}
        {!sourceFile&&storedDocs.length>0&&<label className="im-file-doc-picker">ملفات الطلب المحفوظة
          <select value={viewDoc} onChange={e=>setViewDoc(e.target.value)}>
            {storedDocs.map(d=><option key={d.id} value={d.id}>{d.originalFileName}</option>)}
          </select></label>}
        {previewUrl?<div className="im-file-preview-frame" data-lenis-prevent>
          {(sourceFile?.type==="application/pdf"||(!sourceFile&&selectedDoc?.contentType==="application/pdf"))
            ?<iframe title={"معاينة "+previewName} src={previewUrl}/>:
              <img src={previewUrl} alt={"معاينة "+previewName} />}
        </div>:<div className="im-file-placeholder"><FilePlus2 size={30}/><strong>اختر مستنداً لعرضه هنا</strong>
          <p>المستند على اليسار والحقول على اليمين، ويمكن الرجوع إليه أثناء إدخال البيانات.</p></div>}
        <p className="im-file-hint">الملفات تحفظ في التخزين الخاص بالشركة بعد إنشاء الطلب أو حفظ الإرفاق. لا يُعتبر عرض الملف وحده حفظاً.</p>
      </aside>}
      <div className={documentWorkspace?"im-file-workspace-main":"im-file-default-main"}>
        {documentWorkspace&&<div className="im-file-tabs" role="tablist" aria-label="أقسام ملف الاستيراد">
          {tabs.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={activeTab===key}
            className={activeTab===key?"active":""} onClick={()=>setActiveTab(key)}>{label}</button>)}
        </div>}
        {documentWorkspace&&!orderId&&activeTab!=="info"&&<div className="im-info-strip"><Info size={18}/><p>املأ معلومات الطلبية واضغط «إنشاء طلب الشراء» أولاً لتفعيل هذا التبويب وحفظ بياناته على الطلب نفسه.</p></div>}
        {documentWorkspace&&orderId&&activeTab==="payments"&&current&&<ImportPaymentPanel orderId={orderId} supplierId={current.supplierId}
          user={user} disabled={dirty} onChanged={async()=>{adoptOrder(await fetchOrder(orderId));}}/>}
        {documentWorkspace&&orderId&&(activeTab==="bl"||activeTab==="customs")&&current&&<ImportLogisticsPanel
          view={activeTab==="bl"?"bl":"customs"} orderId={orderId} disabled={dirty} onChanged={async()=>{adoptOrder(await fetchOrder(orderId));}}/>}
        {documentWorkspace&&orderId&&activeTab==="tracking"&&<ImportTrackingPanel orderId={orderId} disabled={dirty}/>}
        {documentWorkspace&&orderId&&current&&["payments","bl","customs"].includes(activeTab)&&
          <details className="im-file-docs-disclosure">
            <summary>مرفقات هذا التبويب — رفع وربط الإيصالات والبوالص والبيانات الجمركية</summary>
            <ImportDocumentsPanel orderId={orderId} user={user}/>
          </details>}
    {documentWorkspace&&activeTab!=="info"?null:loading ? <div className="im-empty">جارٍ تحضير بيانات الطلب...</div> :
      isEditing&&!current ? <div className="im-empty"><ClipboardList size={30}/><strong>الطلب غير متاح</strong><Link href="/import/orders" className="btn btn-outline">العودة للقائمة</Link></div> :
      !isEditing&&!canManagePayments ?
        <div className="im-info-strip"><Info size={20}/><div><strong>إنشاء طلب شراء يحتاج صلاحية مالية</strong>
          <p>يمكنك مشاهدة طلبات الشركة وبنودها، لكن إدخال أسعار جديدة يحتاج CanManagePayments من مدير الشركة.</p>
          <Link href="/import/orders" className="im-order-helper">العودة إلى الطلبات</Link>
        </div></div> :
      current&&current.status!=="Draft"?
        <div className="im-info-strip"><Info size={20}/><div><strong>الطلب غير قابل للتعديل</strong><p>هذه الشاشة تدعم تعديل المسودات فقط.</p></div></div> :
      <form onSubmit={event=>void save(event)} className="im-order-editor">
        {!canManagePayments&&<div className="im-info-strip"><Info size={20}/><div>
          <strong>تصفح فقط — لا تملك صلاحية تعديل الأسعار</strong>
          <p>طلب الشراء متاح للقراءة. التعديل أو الحذف يحتاج CanManagePayments.</p>
        </div></div>}
        <fieldset className="im-order-readonly-fieldset" disabled={!canManagePayments}>
        <section className="im-order-form-section">
          <div className="im-order-section-title"><span className="im-order-section-no">01</span>
            <div><h2>بيانات طلب الشراء</h2><p>المورّد والتاريخ والموانئ المرجعية للطلب.</p></div></div>
          <div className="im-order-fields">
            <label>المورّد <span className="im-required">*</span>
              <select required value={form.supplierId} onChange={e=>setField("supplierId",e.target.value)}>
                <option value="">اختر المورّد</option>
                {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {suppliers.length===0&&<Link href="/import/companies" className="im-order-helper">ما عندك مورّد؟ أضف واحداً أولاً</Link>}
            </label>
            <label>العميل <small>اختياري</small>
              <select value={form.customerId||""} onChange={e=>setField("customerId",e.target.value||null)}>
                <option value="">بدون عميل مرتبط</option>
                {customers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>تاريخ الطلب <span className="im-required">*</span>
              <input required type="date" value={form.orderDate} onChange={e=>setField("orderDate",e.target.value)}/>
            </label>
            <label>مرجع المورّد <small>اختياري</small>
              <input maxLength={120} dir="ltr" placeholder="PI-2026-0001" value={form.supplierRef}
                onChange={e=>setField("supplierRef",e.target.value)}/>
            </label>
            <label>رقم الفاتورة الأولية (PI)
              <input maxLength={120} dir="ltr" placeholder="PI-2026-0001" value={form.proformaInvoiceNumber||""}
                onChange={e=>setField("proformaInvoiceNumber",e.target.value)}/>
            </label>
            <label>رقم العقد
              <input maxLength={120} dir="ltr" placeholder="CONT-2026-001" value={form.contractNumber||""}
                onChange={e=>setField("contractNumber",e.target.value)}/>
            </label>
            <label>تاريخ العقد
              <input type="date" value={form.contractDate||""}
                onChange={e=>setField("contractDate",e.target.value||null)}/>
            </label>
            <label>شروط التسليم (Incoterm)
              <select value={form.incoterm} onChange={e=>setField("incoterm",e.target.value)}>
                {commonTerms.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>عملة الطلب
              <select value={form.currency} onChange={e=>setField("currency",e.target.value)}>
                {currencies.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>ميناء التحميل
              <input maxLength={160} dir="auto" placeholder="Ningbo" value={form.loadingPort}
                onChange={e=>setField("loadingPort",e.target.value)}/>
            </label>
            <label>ميناء الوصول
              <input maxLength={160} dir="auto" placeholder="Latakia" value={form.dischargePort}
                onChange={e=>setField("dischargePort",e.target.value)}/>
            </label>
          </div>
        </section>

        <section className="im-order-form-section">
          <div className="im-order-section-title im-order-items-title">
            <span className="im-order-section-no">02</span>
            <div><h2>بنود الخيوط</h2><p>السعر ممكن يكون لكل كيلوغرام أو طن؛ النظام يخزّن الأوزان بالكيلوغرام.</p></div>
            <button type="button" className="btn btn-outline im-add-line" disabled={lines.length>=100}
              onClick={()=>{setLines(prev=>[...prev,newLine()]);setDirty(true);}}>
              <Plus size={17}/> إضافة بند
            </button>
          </div>
          <div className="im-order-lines">
            {lines.map((line,index)=><div className="im-order-line" key={line.localKey}>
              <div className="im-order-line-top">
                <strong>البند {index+1}</strong>
                <button type="button" className="im-order-line-remove" aria-label={"حذف البند "+(index+1)}
                  disabled={lines.length===1} onClick={()=>{setLines(v=>v.filter(x=>x.localKey!==line.localKey));setDirty(true);}}>
                  <Trash2 size={16}/> حذف البند
                </button>
              </div>
              <div className="im-order-fields im-order-line-fields">
                <label>نوع الخيط <span className="im-required">*</span>
                  <input list="im-fiber-types" required maxLength={80} value={line.productType}
                    onChange={e=>setLineField(line.localKey,"productType",e.target.value)}/>
                </label>
                <label>الماركة / العلامة التجارية
                  <input maxLength={100} dir="auto" value={line.brand||""}
                    onChange={e=>setLineField(line.localKey,"brand",e.target.value)}/>
                </label>
                <label>Denier / Filament
                  <input maxLength={80} dir="ltr" placeholder="150/48" value={line.denier}
                    onChange={e=>setLineField(line.localKey,"denier",e.target.value)}/>
                </label>
                <label>اللمعان
                  <input list="im-luster-types" maxLength={80} dir="ltr" value={line.luster}
                    onChange={e=>setLineField(line.localKey,"luster",e.target.value)}/>
                </label>
                <label>الجودة
                  <input list="im-grades" maxLength={80} dir="ltr" value={line.grade}
                    onChange={e=>setLineField(line.localKey,"grade",e.target.value)}/>
                </label>
                <label>اللون
                  <input maxLength={100} dir="auto" value={line.colorType}
                    onChange={e=>setLineField(line.localKey,"colorType",e.target.value)}/>
                </label>
                <label>رمز HS
                  <input maxLength={30} dir="ltr" placeholder="540246" value={line.hsCode}
                    onChange={e=>setLineField(line.localKey,"hsCode",e.target.value)}/>
                </label>
              </div>
              <div className="im-order-pricing">
                <label>الكمية <span className="im-required">*</span>
                  <input required type="number" min="0.001" step="any" value={line.quantity}
                    onChange={e=>setLineField(line.localKey,"quantity",Number(e.target.value))}/>
                </label>
                <label>وحدة الكمية
                  <select value={line.quantityUnit} onChange={e=>setLineField(line.localKey,"quantityUnit",e.target.value as "KG"|"TON")}>
                    <option value="KG">كيلوغرام (KG)</option><option value="TON">طن (TON)</option>
                  </select>
                </label>
                <label>سعر الوحدة <span className="im-required">*</span>
                  <input required type="number" min="0.0001" step="0.0001" value={line.unitPrice}
                    onChange={e=>setLineField(line.localKey,"unitPrice",Number(e.target.value))}/>
                </label>
                <label>سعر لكل
                  <select value={line.priceUnit} onChange={e=>setLineField(line.localKey,"priceUnit",e.target.value as "KG"|"TON")}>
                    <option value="KG">كيلوغرام (KG)</option><option value="TON">طن (TON)</option>
                  </select>
                </label>
              </div>
            </div>)}
          </div>
          <datalist id="im-fiber-types"><option value="POY"/><option value="DTY"/><option value="FDY"/><option value="ITY"/><option value="ATY"/></datalist>
          <datalist id="im-luster-types"><option value="SD"/><option value="FD"/><option value="Bright"/></datalist>
          <datalist id="im-grades"><option value="AA"/><option value="A"/><option value="B"/></datalist>
          <div className="im-order-total-note">
            <Info size={19}/>
            <span>يحسب السيرفر الإجمالي النهائي عند الحفظ، مع تقريب قيم البنود إلى خانتين عشريتين.</span>
            {current&&<strong dir="ltr">{new Intl.NumberFormat("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}).format(current.totalAmount)} {current.currency}</strong>}
          </div>
        </section>

        <section className="im-order-form-section">
          <div className="im-order-section-title">
            <span className="im-order-section-no">03</span>
            <div><h2>ملاحظات الطلب</h2><p>تفاصيل إضافية للاحتفاظ بها مع المسودة.</p></div>
          </div>
          <label className="im-order-notes"><span>ملاحظات</span>
            <textarea rows={4} maxLength={3000} value={form.notes} placeholder="أي معلومات إضافية عن شروط الطلب أو التواصل مع المورّد..."
              onChange={e=>setField("notes",e.target.value)}/>
          </label>
        </section>
        </fieldset>

        <div className="im-order-footer">
          <div><strong>{current?current.number:"مسودة جديدة"}</strong>
            <p>{dirty?"عندك تغييرات غير محفوظة.":"سيحفظ النظام طلب الشراء مع بنوده في عملية واحدة."}</p>
          </div>
          <div className="im-order-footer-buttons">
            <Link href="/import/orders" className="btn btn-outline">رجوع للقائمة</Link>
            {canManagePayments&&<button type="submit" disabled={saving} className="btn primary"><Save size={17}/>{saving?"جارٍ الحفظ...":isEditing?"حفظ التعديلات":"إنشاء طلب الشراء"}</button>}
          </div>
        </div>
        </form>}
    {documentWorkspace&&orderId&&activeTab==="info"&&<ImportDocumentsPanel orderId={orderId} user={user}/>}
    {!documentWorkspace&&orderId&&current&&<ImportLogisticsPanel orderId={orderId} disabled={dirty}
      onChanged={async()=>{adoptOrder(await fetchOrder(orderId));}}/>}
    {!documentWorkspace&&orderId&&current&&<ImportPaymentPanel orderId={orderId} supplierId={current.supplierId}
      user={user} disabled={dirty} onChanged={async()=>{adoptOrder(await fetchOrder(orderId));}}/>}
    {!documentWorkspace&&orderId&&current&&<ImportDocumentsPanel orderId={orderId} user={user}/>}
      </div>
    </div>
  </>;
}
export default function OrderEditor({orderId,documentWorkspace=false}:{orderId?:string;documentWorkspace?:boolean}) {
  return <ImportShell section="orders" title={orderId?"تفاصيل طلب الشراء":"طلب شراء جديد"}
    description={orderId?"مراجعة البنود وتعديل المسودة.":"تسجيل طلب جديد بمواصفات الخيوط وأسعارها."}>
    {user=> <OrderForm orderId={orderId} canManagePayments={user.canManagePayments} user={user} documentWorkspace={documentWorkspace}/>}
  </ImportShell>;
}
