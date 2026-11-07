"use client";

import {FormEvent,useCallback,useEffect,useMemo,useState} from "react";
import {
  Anchor,CheckCircle2,Container as ContainerIcon,FileCheck2,Info,
  PackagePlus,Plus,RefreshCw,Ship,Trash2
} from "lucide-react";
import {useToast} from "@/components/ToastProvider";
import ConfirmDialog from "@/components/ConfirmDialog";
import {fetchImportCompanies,ImportCompany} from "@/lib/importApi";
import {
  BlOriginalStatus,BlType,ClearanceStatus,ContainerInput,ContainerStatus,
  CustomsInput,LogisticsContainer,Shipment,ShipmentInput,
  containerNumberFeedback,createContainer,createShipment,deleteContainer,
  listShipments,saveClearance,updateContainer,updateShipment
} from "@/lib/logisticsApi";

const blTypes:Record<BlType,string>={Original:"بوليصة أصلية",TelexRelease:"Telex Release",SeaWaybill:"Sea Waybill"};
const originalStatuses:Record<BlOriginalStatus,string>={
  NotReceived:"الأصل لم يصل",Received:"وصل الأصل",HandedToBroker:"سُلّم للمخلّص"
};
const statuses:Record<ContainerStatus,string>={
  Planned:"مخططة",AtSea:"في البحر",AtPort:"في الميناء",Delivered:"مسلّمة"
};
const clearances:Record<ClearanceStatus,string>={
  NotStarted:"لم يبدأ",MissingDocs:"مستندات ناقصة",UnderInspection:"قيد الكشف",
  FeesPaid:"الرسوم مدفوعة",Released:"تم الإفراج"
};
const statusOrder:ContainerStatus[]=["Planned","AtSea","AtPort","Delivered"];
function initialShipment():ShipmentInput {
  return {blNumber:"",blType:"Original",blOriginalStatus:"NotReceived",
    shippingLineId:null,vessel:"",voyage:"",portOfLoading:"",portOfDischarge:"",
    etd:null,eta:null,freeTimeDays:0,trackingUrl:"",revision:null};
}
function initialContainer():ContainerInput {
  return {number:"",size:"40",sealNumber:"",grossWeightKg:null,netWeightKg:null,
    status:"Planned",acknowledgeInvalidDigit:false,arrivedAtPortDate:null,
    deliveredDate:null,freeTimeEndDate:null,revision:null};
}
function initialClearance():CustomsInput {
  return {brokerId:null,declarationNumber:"",submittedDate:null,releasedDate:null,
    status:"NotStarted",notes:"",revision:null};
}
function dateInput(value:string|null,update:(value:string|null)=>void) {
  return {type:"date" as const,value:value||"",onChange:(e:React.ChangeEvent<HTMLInputElement>)=>update(e.target.value||null)};
}
function labelDate(value:string|null) {
  if(!value)return "—";
  return new Date(value+"T00:00:00").toLocaleDateString("ar-SY-u-nu-latn");
}

export default function ImportLogisticsPanel({
  orderId,disabled,onChanged
}:{
  orderId:string;disabled:boolean;onChanged:()=>Promise<void>;
}){
  const {notify}=useToast();
  const [shipments,setShipments]=useState<Shipment[]>([]);
  const [companies,setCompanies]=useState<ImportCompany[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [addingShipment,setAddingShipment]=useState(false);
  const [editingShipmentId,setEditingShipmentId]=useState<string|null>(null);
  const [shipmentDraft,setShipmentDraft]=useState<ShipmentInput>(initialShipment);
  const [containerEditId,setContainerEditId]=useState<string|null>(null);
  const [containerDraft,setContainerDraft]=useState<ContainerInput>(initialContainer);
  const [showContainerForm,setShowContainerForm]=useState(false);
  const [clearanceDraft,setClearanceDraft]=useState<CustomsInput>(initialClearance);
  const [deleting,setDeleting]=useState<LogisticsContainer|null>(null);
  const reload=useCallback(async()=>{
    try{
      const [list,parties]=await Promise.all([listShipments(orderId),fetchImportCompanies()]);
      setShipments(list);
      setCompanies(parties);
      setSelectedId(prev=>list.some(x=>x.id===prev)?prev:list[0]?.id||null);
    }catch(error){
      notify({kind:"error",title:"تعذّر تحميل بيانات الشحن",description:(error as Error).message});
    }finally{setLoading(false);}
  },[orderId,notify]);
  useEffect(()=>{void reload();},[reload]);

  const selected=useMemo(()=>shipments.find(x=>x.id===selectedId)||null,[shipments,selectedId]);
  useEffect(()=>{
    setClearanceDraft(selected?.clearance?{
      brokerId:selected.clearance.brokerId,
      declarationNumber:selected.clearance.declarationNumber,
      submittedDate:selected.clearance.submittedDate,
      releasedDate:selected.clearance.releasedDate,
      status:selected.clearance.status,notes:selected.clearance.notes,
      revision:selected.clearance.revision
    }:initialClearance());
    setShowContainerForm(false);
    setContainerEditId(null);
    setContainerDraft(initialContainer());
  },[selectedId,selected?.clearance]);

  const lineCompanies=companies.filter(x=>x.type==="ShippingLine");
  const brokers=companies.filter(x=>x.type==="Broker");
  const feedback=containerNumberFeedback(containerDraft.number);
  function blocked(){
    if(disabled){
      notify({kind:"error",title:"عندك تغييرات غير محفوظة بالطلب",description:"احفظ بيانات طلب الشراء أولاً ثم عدّل الشحنات."});
      return true;
    }
    return false;
  }
  async function run<T>(job:()=>Promise<T>,message:string,after?:(value:T)=>void){
    if(saving||blocked())return;
    setSaving(true);
    try{
      const result=await job();
      after?.(result);
      await reload();
      await onChanged();
      notify({kind:"success",title:message});
    }catch(error){
      notify({kind:"error",title:"تعذّر حفظ بيانات الشحن",description:(error as Error).message});
    }finally{setSaving(false);}
  }
  function setShipment<K extends keyof ShipmentInput>(key:K,value:ShipmentInput[K]){
    setShipmentDraft(prev=>({...prev,[key]:value}));
  }
  function setContainer<K extends keyof ContainerInput>(key:K,value:ContainerInput[K]){
    setContainerDraft(prev=>({...prev,[key]:value}));
  }
  function setClearance<K extends keyof CustomsInput>(key:K,value:CustomsInput[K]){
    setClearanceDraft(prev=>({...prev,[key]:value}));
  }
  function editContainer(row:LogisticsContainer){
    if(blocked())return;
    setContainerEditId(row.id);
    setContainerDraft({
      number:row.number,size:row.size,sealNumber:row.sealNumber,
      grossWeightKg:row.grossWeightKg,netWeightKg:row.netWeightKg,
      status:row.status,acknowledgeInvalidDigit:row.invalidDigitAcknowledged,
      arrivedAtPortDate:row.arrivedAtPortDate,deliveredDate:row.deliveredDate,
      freeTimeEndDate:row.freeTimeEndDate,revision:row.revision
    });
    setShowContainerForm(true);
  }
  function newContainer(){
    if(blocked())return;
    setContainerEditId(null);
    setContainerDraft(initialContainer());
    setShowContainerForm(true);
  }
  function cancelContainer(){
    setShowContainerForm(false);setContainerEditId(null);setContainerDraft(initialContainer());
  }
  function saveShipment(event:FormEvent){
    event.preventDefault();
    if(!shipmentDraft.blNumber.trim()){
      notify({kind:"error",title:"رقم البوليصة مطلوب"});return;
    }
    void run(()=>editingShipmentId
      ?updateShipment(editingShipmentId,shipmentDraft)
      :createShipment(orderId,shipmentDraft),
      editingShipmentId?"تم تعديل بيانات البوليصة":"تم تسجيل بوليصة الشحن",s=>{
      setAddingShipment(false);setEditingShipmentId(null);
      setShipmentDraft(initialShipment());setSelectedId(s.id);
    });
  }
  function openShipmentForm(shipment?:Shipment){
    if(blocked())return;
    if(shipment){
      setEditingShipmentId(shipment.id);
      setShipmentDraft({
        blNumber:shipment.blNumber,blType:shipment.blType,
        blOriginalStatus:shipment.blOriginalStatus,
        shippingLineId:shipment.shippingLineId,
        vessel:shipment.vessel,voyage:shipment.voyage,
        portOfLoading:shipment.portOfLoading,portOfDischarge:shipment.portOfDischarge,
        etd:shipment.etd,eta:shipment.eta,freeTimeDays:shipment.freeTimeDays,
        trackingUrl:shipment.trackingUrl,revision:shipment.revision
      });
    }else{
      setEditingShipmentId(null);setShipmentDraft(initialShipment());
    }
    setAddingShipment(true);
  }
  function saveContainer(event:FormEvent){
    event.preventDefault();
    if(!selected)return;
    if(!feedback.formatValid){
      notify({kind:"error",title:"صيغة رقم الحاوية غير صحيحة",description:"4 أحرف يتبعها 7 أرقام. الحرف الرابع U."});
      return;
    }
    if(!feedback.valid&&!containerDraft.acknowledgeInvalidDigit){
      notify({kind:"error",title:"تحذير رقم الحاوية",description:"تحقق من رقم ISO ثم أقرّ بالاستثناء عند الحاجة."});
      return;
    }
    const payload={...containerDraft,number:feedback.number};
    void run(
      ()=>containerEditId?updateContainer(containerEditId,payload):createContainer(selected.id,payload),
      containerEditId?"تم تحديث الحاوية":"تمت إضافة الحاوية",
      ()=>cancelContainer()
    );
  }
  function saveCustoms(event:FormEvent){
    event.preventDefault();
    if(!selected)return;
    void run(()=>saveClearance(selected.id,clearanceDraft),"تم تحديث تخليص البوليصة");
  }
  async function removePlanned(){
    if(!deleting)return;
    const target=deleting;
    await run(()=>deleteContainer(target.id,target.revision),"تم حذف الحاوية المخططة",()=>setDeleting(null));
  }

  return <section className="im-logistics" aria-label="الشحنات والبوالص">
    <div className="im-logistics-heading">
      <div><span className="im-eyebrow">عمليات الشحن / نفس طلب الشراء</span>
        <h2><Ship size={21}/> بوالص الشحن والحاويات</h2>
        <p>كل بوليصة شحن تابعة لهذا الطلب فقط، مع حاوياتها وتخليصها المستقل.</p>
      </div>
      <div className="im-logistics-actions">
        <button type="button" className="btn btn-outline" disabled={saving} onClick={()=>void reload()} title="تحديث بيانات الشحن"><RefreshCw size={16}/> تحديث</button>
        <button type="button" className="btn primary" disabled={saving||disabled}
          onClick={()=>addingShipment&&!editingShipmentId?setAddingShipment(false):openShipmentForm()}>
          <Plus size={17}/> بوليصة جديدة
        </button>
      </div>
    </div>
    {disabled&&<div className="im-info-strip"><Info size={18}/><p>احفظ تعديلات الطلب غير المحفوظة قبل تعديل بيانات الشحن.</p></div>}
    {addingShipment&&<form onSubmit={saveShipment} className="im-logistics-form">
      <div className="im-logistics-form-title"><strong>{editingShipmentId?"تعديل بيانات البوليصة":"تسجيل بوليصة شحن"}</strong><p>البوليصة ستبقى مرتبطة بطلب الشراء الحالي حصراً.</p></div>
      <div className="im-logistics-fields">
        <label>رقم B/L <span className="im-required">*</span>
          <input required dir="ltr" maxLength={90} placeholder="BL-2026-001" value={shipmentDraft.blNumber} onChange={e=>setShipment("blNumber",e.target.value)}/></label>
        <label>نوع البوليصة
          <select value={shipmentDraft.blType} onChange={e=>setShipment("blType",e.target.value as BlType)}>
            {Object.entries(blTypes).map(([key,value])=><option key={key} value={key}>{value}</option>)}
          </select></label>
        <label>حالة أصل البوليصة
          <select value={shipmentDraft.blOriginalStatus} onChange={e=>setShipment("blOriginalStatus",e.target.value as BlOriginalStatus)}>
            {Object.entries(originalStatuses).map(([key,value])=><option key={key} value={key}>{value}</option>)}
          </select></label>
        <label>شركة الشحن
          <select value={shipmentDraft.shippingLineId||""} onChange={e=>setShipment("shippingLineId",e.target.value||null)}>
            <option value="">غير محددة</option>{lineCompanies.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <label>الباخرة
          <input dir="auto" maxLength={140} value={shipmentDraft.vessel} onChange={e=>setShipment("vessel",e.target.value)}/></label>
        <label>رقم الرحلة
          <input dir="ltr" maxLength={80} value={shipmentDraft.voyage} onChange={e=>setShipment("voyage",e.target.value)}/></label>
        <label>ميناء التحميل
          <input dir="auto" maxLength={160} value={shipmentDraft.portOfLoading} onChange={e=>setShipment("portOfLoading",e.target.value)}/></label>
        <label>ميناء التفريغ
          <input dir="auto" maxLength={160} value={shipmentDraft.portOfDischarge} onChange={e=>setShipment("portOfDischarge",e.target.value)}/></label>
        <label>تاريخ المغادرة ETD
          <input {...dateInput(shipmentDraft.etd,v=>setShipment("etd",v))}/></label>
        <label>الوصول المتوقع ETA
          <input {...dateInput(shipmentDraft.eta,v=>setShipment("eta",v))}/></label>
        <label>Free Time بالأيام
          <input type="number" min={0} max={180} value={shipmentDraft.freeTimeDays}
            onChange={e=>setShipment("freeTimeDays",Number(e.target.value))}/></label>
        <label>رابط التتبع HTTPS
          <input type="url" dir="ltr" placeholder="https://..." maxLength={600} value={shipmentDraft.trackingUrl}
            onChange={e=>setShipment("trackingUrl",e.target.value)}/></label>
      </div>
      <div className="im-logistics-form-actions">
        <button type="submit" className="btn primary" disabled={saving||disabled}>{saving?"جارٍ الحفظ...":editingShipmentId?"حفظ تعديل البوليصة":"حفظ البوليصة"}</button>
        <button type="button" className="btn btn-outline" onClick={()=>{
          setAddingShipment(false);setEditingShipmentId(null);setShipmentDraft(initialShipment());
        }}>إلغاء</button>
      </div>
    </form>}
    {loading?<div className="im-empty">جارٍ تحميل الشحنات...</div>:
      shipments.length===0?<div className="im-empty"><Anchor size={30}/><strong>لا توجد بوالص مسجلة لهذا الطلب</strong>
        <p>أضف أول بوليصة حتى تتابع الحاويات ومراحل التخليص.</p></div>:
      <>
        <div className="im-logistics-tabs" role="tablist" aria-label="بوالص الطلب">
          {shipments.map(s=><button type="button" role="tab"
              aria-selected={selected?.id===s.id} className={"im-logistics-tab "+(selected?.id===s.id?"active":"")}
              key={s.id} onClick={()=>setSelectedId(s.id)}>
            <span dir="ltr">{s.blNumber}</span>
            <small>{s.containers.filter(c=>c.status==="Delivered").length}/{s.containers.length} حاويات مسلّمة</small>
          </button>)}
        </div>
        {selected&&<div className="im-logistics-details">
          <div className="im-logistics-details-toolbar">
            <span>تفاصيل بوليصة الشحن المحددة</span>
            <button type="button" className="btn btn-outline" disabled={saving||disabled}
              onClick={()=>openShipmentForm(selected)}>تعديل بيانات البوليصة</button>
          </div>
          <div className="im-logistics-meta">
            <div><small>رقم البوليصة</small><strong dir="ltr">{selected.blNumber}</strong></div>
            <div><small>النوع</small><strong>{blTypes[selected.blType]}</strong></div>
            <div><small>الحالة</small><strong>{originalStatuses[selected.blOriginalStatus]}</strong></div>
            <div><small>شركة الشحن</small><strong dir="auto">{selected.shippingLineSnapshot||"غير محددة"}</strong></div>
            <div><small>المغادرة المتوقعة</small><strong>{labelDate(selected.etd)}</strong></div>
            <div><small>الوصول المتوقع</small><strong>{labelDate(selected.eta)}</strong></div>
            <div><small>الباخرة / الرحلة</small><strong dir="auto">{[selected.vessel,selected.voyage].filter(Boolean).join(" / ")||"—"}</strong></div>
            <div><small>Free Time</small><strong>{selected.freeTimeDays} يوم</strong></div>
          </div>
          <div className="im-logistics-subhead">
            <div><ContainerIcon size={20}/><strong>حاويات هذه البوليصة</strong></div>
            <button type="button" className="btn btn-outline" onClick={newContainer} disabled={saving||disabled}>
              <PackagePlus size={16}/> إضافة حاوية</button>
          </div>
          {selected.containers.length===0?<div className="im-logistics-empty">لم تُضاف حاويات لهذه البوليصة بعد.</div>:
            <div className="im-table-scroll" data-lenis-prevent>
              <table className="im-table im-logistics-table">
                <thead><tr><th>رقم الحاوية</th><th>الحجم</th><th>الحالة</th><th>الوصول</th><th>التسليم</th><th>الإجراءات</th></tr></thead>
                <tbody>{selected.containers.map(c=><tr key={c.id}>
                  <td><strong dir="ltr">{c.number}</strong>{!c.checkDigitValid&&<small className="im-container-warning">رقم التحقق مُستثنى بإقرار</small>}</td>
                  <td>{c.size}</td>
                  <td><span className={"im-pill "+(c.status==="Delivered"?"im-logistics-delivered":"")}>{statuses[c.status]}</span></td>
                  <td>{labelDate(c.arrivedAtPortDate)}</td>
                  <td>{labelDate(c.deliveredDate)}</td>
                  <td><div className="im-table-actions"><button className="im-logistics-edit-btn" type="button"
                    disabled={saving||disabled} onClick={()=>editContainer(c)}>تحديث</button>
                    {c.status==="Planned"&&<button type="button" className="im-table-delete" disabled={saving||disabled}
                      onClick={()=>setDeleting(c)} aria-label={"حذف الحاوية "+c.number} title="حذف المخططة"><Trash2 size={15}/></button>}
                  </div></td>
                </tr>)}</tbody>
              </table>
            </div>}
          {showContainerForm&&<form className="im-logistics-form im-logistics-inner-form" onSubmit={saveContainer}>
            <div className="im-logistics-form-title"><strong>{containerEditId?"تحديث الحاوية":"إضافة حاوية جديدة"}</strong>
              <p>رقم ISO 6346 يُتحقق منه آلياً، والإنذار لا يختفي إلا بإقرار منك.</p></div>
            <div className="im-logistics-fields">
              <label>رقم الحاوية <span className="im-required">*</span>
                <input required maxLength={16} dir="ltr" placeholder="CSQU3054383" value={containerDraft.number}
                  onChange={e=>{setContainer("number",e.target.value);setContainer("acknowledgeInvalidDigit",false);}}/></label>
              <label>الحجم
                <select value={containerDraft.size} onChange={e=>setContainer("size",e.target.value as "20"|"40"|"40HC")}>
                  {["20","40","40HC"].map(t=><option key={t} value={t}>{t}</option>)}
                </select></label>
              <label>رقم الختم
                <input dir="ltr" maxLength={90} value={containerDraft.sealNumber}
                  onChange={e=>setContainer("sealNumber",e.target.value)}/></label>
              <label>الحالة
                <select value={containerDraft.status} onChange={e=>setContainer("status",e.target.value as ContainerStatus)}>
                  {statusOrder.map((s,i)=><option key={s} value={s}
                    disabled={containerEditId?i<statusOrder.indexOf(selected.containers.find(c=>c.id===containerEditId)?.status||"Planned"):false}>{statuses[s]}</option>)}
                </select></label>
              <label>الوزن الإجمالي بالكيلو
                <input type="number" min={0} step=".001" value={containerDraft.grossWeightKg??""}
                  onChange={e=>setContainer("grossWeightKg",e.target.value===""?null:Number(e.target.value))}/></label>
              <label>الوزن الصافي بالكيلو
                <input type="number" min={0} step=".001" value={containerDraft.netWeightKg??""}
                  onChange={e=>setContainer("netWeightKg",e.target.value===""?null:Number(e.target.value))}/></label>
              <label>تاريخ الوصول للميناء
                <input {...dateInput(containerDraft.arrivedAtPortDate,v=>setContainer("arrivedAtPortDate",v))}/></label>
              <label>تاريخ التسليم
                <input {...dateInput(containerDraft.deliveredDate,v=>setContainer("deliveredDate",v))}/></label>
              <label>نهاية Free Time
                <input {...dateInput(containerDraft.freeTimeEndDate,v=>setContainer("freeTimeEndDate",v))}/></label>
            </div>
            {containerDraft.number&&feedback.formatValid&&!feedback.valid&&<div className="im-logistics-check-warning">
              <Info size={20}/><div><strong>تحذير: رقم التحقق ISO 6346 غير مطابق.</strong>
                <p>راجع رقم الحاوية مع بوليصة الشحن، ولا تُكمل إلا إذا كان الاستثناء مقصوداً.</p>
                <label><input type="checkbox" checked={containerDraft.acknowledgeInvalidDigit}
                  onChange={e=>setContainer("acknowledgeInvalidDigit",e.target.checked)}/>
                  أقر بأن الرقم غير مطابق وسأسجل الحاوية رغم التحذير.</label></div>
            </div>}
            {containerDraft.number&&!feedback.formatValid&&<p className="im-logistics-format-warning">يجب إدخال 3 أحرف ثم حرف U ثم 7 أرقام.</p>}
            {containerDraft.number&&feedback.valid&&<p className="im-logistics-valid"><CheckCircle2 size={15}/> رقم التحقق صحيح.</p>}
            <div className="im-logistics-form-actions">
              <button type="submit" className="btn primary" disabled={saving||disabled||!feedback.formatValid||(!feedback.valid&&!containerDraft.acknowledgeInvalidDigit)}>
                {saving?"جارٍ الحفظ...":containerEditId?"حفظ التحديث":"إضافة الحاوية"}</button>
              <button type="button" className="btn btn-outline" onClick={cancelContainer}>إلغاء</button>
            </div>
          </form>}
          <div className="im-logistics-subhead im-logistics-customs-head">
            <div><FileCheck2 size={20}/><strong>التخليص الجمركي لهذه البوليصة</strong></div>
            {selected.clearance&&<span className="im-pill">{clearances[selected.clearance.status]}</span>}
          </div>
          <form className="im-logistics-form im-logistics-inner-form" onSubmit={saveCustoms}>
            <div className="im-logistics-fields">
              <label>المخلّص الجمركي
                <select value={clearanceDraft.brokerId||""} onChange={e=>setClearance("brokerId",e.target.value||null)}>
                  <option value="">غير محدد</option>{brokers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
              <label>حالة التخليص
                <select value={clearanceDraft.status} onChange={e=>setClearance("status",e.target.value as ClearanceStatus)}>
                  {Object.entries(clearances).map(([key,label])=><option value={key} key={key}>{label}</option>)}
                </select></label>
              <label>رقم البيان
                <input dir="ltr" maxLength={120} value={clearanceDraft.declarationNumber}
                  onChange={e=>setClearance("declarationNumber",e.target.value)}/></label>
              <label>تاريخ تقديم البيان
                <input {...dateInput(clearanceDraft.submittedDate,v=>setClearance("submittedDate",v))}/></label>
              <label>تاريخ الإفراج
                <input {...dateInput(clearanceDraft.releasedDate,v=>setClearance("releasedDate",v))}/></label>
              <label className="im-logistics-notes">ملاحظات التخليص
                <textarea rows={2} maxLength={3000} value={clearanceDraft.notes}
                  onChange={e=>setClearance("notes",e.target.value)}/></label>
            </div>
            <div className="im-logistics-form-actions">
              <button type="submit" className="btn primary" disabled={saving||disabled}>
                {saving?"جارٍ الحفظ...":"حفظ حالة التخليص"}</button>
            </div>
          </form>
        </div>}
      </>}
    <ConfirmDialog open={Boolean(deleting)} pending={saving} title="حذف الحاوية المخططة؟"
      description="لن تُحذف حاوية دخلت فعلياً في مراحل الشحن. هذا الإجراء مسموح للمخططة فقط."
      onCancel={()=>setDeleting(null)} onConfirm={()=>void removePlanned()}/>
  </section>;
}
