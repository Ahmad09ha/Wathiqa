"use client";

import {DragEvent,FormEvent,useCallback,useEffect,useMemo,useRef,useState} from "react";
import {Check,FileCheck2,FilePlus2,FileText,Info,Link2,
  Paperclip,Plus,RefreshCw,ShieldAlert,Trash2,UploadCloud,Download,Eye,X} from "lucide-react";
import {useToast} from "@/components/ToastProvider";
import {hasFeature} from "@/lib/featurePermissions";
import ConfirmDialog from "@/components/ConfirmDialog";
import {listShipments,Shipment} from "@/lib/logisticsApi";
import {CurrentImportUser} from "@/lib/importApi";
import {
  addDocumentLinks,approveWaiver,BusinessDocument,deletePrivateDocument,
  documentDownloadUrl,documentPreviewUrl,documentTypeLabel,documentTypes,
  DocumentTargetMode,DocumentTargets,getChecklist,listDocuments,listRequirements,
  DocumentType,DocumentChecklist,putRequirement,revokeWaiver,unlinkDocument,
  uploadPrivateDocument,RequirementRule
} from "@/lib/documentsApi";

type LinkTask={kind:"document"|"link";documentId:string;linkId?:string};
const maxFileBytes=25*1024*1024;
const allowedExtensions=[".pdf",".jpg",".jpeg",".png"];
const stages=["Any","Planned","AtSea","AtPort","PartiallyDelivered","Delivered","NotShipped"];
const statusNames:Record<string,string>={
  not_applicable:"غير مطلوب بالمرحلة الحالية",
  not_required:"غير مطلوب",
  satisfied:"مكتمل",
  missing:"مطلوب وناقص",
  waived:"مستثنى بقرار إداري"
};
const stageNames:Record<string,string>={
 Any:"كل المراحل",NotShipped:"لم يبدأ الشحن",Planned:"مخططة",
 AtSea:"في البحر",AtPort:"في الميناء",
 PartiallyDelivered:"وصل جزء",Delivered:"تم التسليم"
};
function filesize(n:number){
  return n<1024*1024?Math.ceil(n/1024)+" KB":(n/1024/1024).toFixed(2)+" MB";
}
function documentTarget(mode:DocumentTargetMode,orderId:string,shipmentId:string,containerIds:string[]):DocumentTargets|null{
 if(mode==="Order")return {orderId};
 if(mode==="Shipment")return shipmentId?{shipmentId}:null;
 return containerIds.length>0?{containerIds}:null;
}
function TargetPicker({
  mode,setMode,shipmentId,setShipmentId,containerIds,setContainerIds,shipments
}:{
  mode:DocumentTargetMode;setMode:(value:DocumentTargetMode)=>void;
  shipmentId:string;setShipmentId:(id:string)=>void;
  containerIds:string[];setContainerIds:(ids:string[])=>void;
  shipments:Shipment[];
}){
 const containers=shipments.flatMap(s=>s.containers.map(c=>({...c,bl:s.blNumber})));
 function toggle(id:string,checked:boolean){
  setContainerIds(checked?[...containerIds,id]:containerIds.filter(x=>x!==id));
 }
 return <div className="im-doc-target-picker">
   <div className="im-doc-target-modes" role="group" aria-label="جهة ربط المستند">
     {([["Order","طلب الشراء"],["Shipment","بوليصة شحن"],["Container","حاويات محددة"]] as const)
       .map(([value,label])=><button type="button" key={value}
       className={mode===value?"active":""} aria-pressed={mode===value}
       onClick={()=>setMode(value)}>{label}</button>)}
   </div>
   {mode==="Order"&&<p className="im-doc-helper">يرتبط المستند بطلب الشراء الحالي ككل.</p>}
   {mode==="Shipment"&&<label className="im-doc-input-label">اختر البوليصة
     <select value={shipmentId} onChange={e=>setShipmentId(e.target.value)}>
       <option value="">اختر بوليصة الشحن</option>
       {shipments.map(s=><option key={s.id} value={s.id}>{s.blNumber}</option>)}
     </select>
   </label>}
   {mode==="Container"&&<div className="im-doc-container-picks">
     {containers.length===0?<p className="im-doc-helper">أضف الحاويات في قسم الشحن أولاً.</p>:
       containers.map(c=><label key={c.id} className="im-doc-container-choice">
         <input type="checkbox" checked={containerIds.includes(c.id)}
           onChange={e=>toggle(c.id,e.target.checked)}/>
         <span dir="ltr">{c.number}</span><small dir="ltr">{c.bl}</small>
       </label>)}
   </div>}
 </div>;
}
export default function ImportDocumentsPanel({
  orderId,user
}:{orderId:string;user:CurrentImportUser}){
 const {notify}=useToast();
 const canUpload=hasFeature(user,"documents.upload");
 const inputRef=useRef<HTMLInputElement|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [shipments,setShipments]=useState<Shipment[]>([]);
 const [documents,setDocuments]=useState<BusinessDocument[]>([]);
 const [totalDocuments,setTotalDocuments]=useState(0);
 const [loadedPage,setLoadedPage]=useState(1);
 const [loadingMore,setLoadingMore]=useState(false);
 const [rules,setRules]=useState<RequirementRule[]>([]);
 const [file,setFile]=useState<File|null>(null);
 const [dragging,setDragging]=useState(false);
 const [type,setType]=useState<DocumentType>("BillOfLading");
 const [notes,setNotes]=useState("");
 const [mode,setMode]=useState<DocumentTargetMode>("Shipment");
 const [shipmentId,setShipmentId]=useState("");
 const [containerIds,setContainerIds]=useState<string[]>([]);
 const [previewId,setPreviewId]=useState<string|null>(null);
 const [relinkId,setRelinkId]=useState<string|null>(null);
 const [pendingDelete,setPendingDelete]=useState<LinkTask|null>(null);
 const [ruleMode,setRuleMode]=useState<DocumentTargetMode>("Shipment");
 const [ruleTarget,setRuleTarget]=useState("");
 const [checklist,setChecklist]=useState<DocumentChecklist|null>(null);
 const [newRule,setNewRule]=useState({documentType:"BillOfLading" as DocumentType,
    stage:"Any",isRequired:true});
 const [showRuleForm,setShowRuleForm]=useState(false);
 const [waivingId,setWaivingId]=useState<string|null>(null);
 const [waiverReason,setWaiverReason]=useState("");

 const containerOptions=useMemo(()=>shipments.flatMap(s=>
   s.containers.map(c=>({id:c.id,label:c.number+" · "+s.blNumber}))),[shipments]);
 const availableTargets=ruleMode==="Order"?[{id:orderId,label:"طلب الشراء الحالي"}]:
   ruleMode==="Shipment"?shipments.map(s=>({id:s.id,label:s.blNumber})):containerOptions;
 const selectedDocument=documents.find(x=>x.id===previewId)||null;
 const refresh=useCallback(async()=>{
  try{
    const [all,ship,r]=await Promise.all([listDocuments({orderId}),listShipments(orderId),listRequirements()]);
    setDocuments(all.items);
    setTotalDocuments(all.total);
    setLoadedPage(1);
    setShipments(ship);
    setRules(r);
    setShipmentId(previous=>ship.some(x=>x.id===previous)?previous:ship[0]?.id||"");
  }catch(error){
    notify({kind:"error",title:"تعذّر تحميل مستندات الطلب",description:(error as Error).message});
  }finally{setLoading(false)}
 },[orderId,notify]);
 useEffect(()=>{void refresh();},[refresh]);
 async function showMore(){
   if(loadingMore||busy||documents.length>=totalDocuments)return;
   setLoadingMore(true);
   try{
     const page=loadedPage+1;
     const next=await listDocuments({orderId},page,40);
     setDocuments(previous=>{
       const known=new Set(previous.map(x=>x.id));
       return [...previous,...next.items.filter(x=>!known.has(x.id))];
     });
     setTotalDocuments(next.total);
     setLoadedPage(page);
   }catch(error){
     notify({kind:"error",title:"تعذّر تحميل بقية المستندات",description:(error as Error).message});
   }finally{setLoadingMore(false);}
 }

 useEffect(()=>{
  if(ruleMode==="Order")setRuleTarget(orderId);
  else if(ruleMode==="Shipment")setRuleTarget(shipments[0]?.id||"");
  else setRuleTarget(containerOptions[0]?.id||"");
 },[ruleMode,orderId,shipments,containerOptions]);
 const checklistTarget=useMemo(()=>ruleMode==="Order"?{orderId:ruleTarget}:
  ruleMode==="Shipment"?{shipmentId:ruleTarget}:{containerIds:[ruleTarget]},
  [ruleMode,ruleTarget]);
 const reloadChecklist=useCallback(async()=>{
  if(!ruleTarget){setChecklist(null);return;}
  try{setChecklist(await getChecklist(checklistTarget));}
  catch(error){
    setChecklist(null);
    notify({kind:"error",title:"تعذّر تحميل قائمة المستندات",description:(error as Error).message});
  }
 },[checklistTarget,ruleTarget,notify]);
 useEffect(()=>{void reloadChecklist();},[reloadChecklist]);

 function notifyError(title:string,error:unknown){
   notify({kind:"error",title,description:(error as Error).message});
 }
 function setSelectedFile(selected:File|null){
   if(!selected){setFile(null);return;}
   const ext="."+selected.name.split(".").pop()?.toLowerCase();
   if(!allowedExtensions.includes(ext)){
     notify({kind:"error",title:"نوع الملف غير مدعوم",description:"الأنواع المسموحة: PDF أو JPG أو PNG."});return;
   }
   if(selected.size===0||selected.size>maxFileBytes){
     notify({kind:"error",title:"حجم الملف غير صالح",description:"الحد الأقصى للمستند الواحد 25 MB."});return;
   }
   setFile(selected);
 }
 function onDrop(event:DragEvent<HTMLDivElement>){
   event.preventDefault();setDragging(false);
   setSelectedFile(event.dataTransfer.files?.[0]||null);
 }
 function changeDocumentType(next:DocumentType){
   setType(next);
   if(next==="BillOfLading"||next==="PackingList"){
     if(shipments.length)setMode("Shipment");
   } else if(next==="PaymentProof"||next==="Proforma")setMode("Order");
 }
 async function upload(event:FormEvent){
  event.preventDefault();
  if(busy||!file)return;
  const target=documentTarget(mode,orderId,shipmentId,containerIds);
  if(!target){
    notify({kind:"error",title:"حدد جهة ربط المستند",description:"اختر بوليصة أو حاوية واحدة على الأقل."});return;
  }
  setBusy(true);
  try{
    const result=await uploadPrivateDocument(file,type,target,notes);
    setFile(null);setNotes("");
    if(inputRef.current)inputRef.current.value="";
    setPreviewId(result.document.id);
    await refresh();await reloadChecklist();
    notify({kind:"success",title:"تم رفع وربط المستند",description:"الملف محفوظ في تخزين خاص تابع لشركتك."});
    if(result.duplicateInTenant)
      notify({kind:"info",title:"تنبيه: نفس المحتوى مرفوع من قبل",description:"تحقق من المستند السابق؛ تم تسجيل رفع مستقل دون إخفاء النسخة القديمة."});
  }catch(error){notifyError("تعذّر رفع المستند",error);}
  finally{setBusy(false);}
 }
 async function linkExisting(docId:string){
  const target=documentTarget(mode,orderId,shipmentId,containerIds);
  if(!target){
    notify({kind:"error",title:"اختر جهة الربط أولاً"});return;
  }
  setBusy(true);
  try{
    await addDocumentLinks(docId,target);
    setRelinkId(null);
    await refresh();await reloadChecklist();
    notify({kind:"success",title:"تم ربط نفس الملف دون إعادة رفعه"});
  }catch(error){notifyError("تعذّر ربط المستند",error);}
  finally{setBusy(false);}
 }
 async function deleteSelected(){
  if(!pendingDelete||busy)return;
  setBusy(true);
  try{
    if(pendingDelete.kind==="document")await deletePrivateDocument(pendingDelete.documentId);
    else if(pendingDelete.linkId)await unlinkDocument(pendingDelete.linkId);
    if(previewId===pendingDelete.documentId&&pendingDelete.kind==="document")setPreviewId(null);
    setPendingDelete(null);
    await refresh();await reloadChecklist();
    notify({kind:"success",title:"تم حفظ التغيير في سجل المستندات"});
  }catch(error){notifyError("تعذّر حذف الرابط أو المستند",error);}
  finally{setBusy(false);}
 }
 async function saveRule(event:FormEvent){
  event.preventDefault();
  if(busy||user.role!=="Admin")return;
  setBusy(true);
  try{
    await putRequirement({targetType:ruleMode,stage:newRule.stage,
      documentType:newRule.documentType,isRequired:newRule.isRequired});
    await refresh();await reloadChecklist();setShowRuleForm(false);
    notify({kind:"success",title:"تم حفظ قاعدة المستندات المطلوبة"});
  }catch(error){notifyError("تعذّر حفظ المتطلب",error);}
  finally{setBusy(false);}
 }
 async function setWaiver(ruleId:string){
  if(busy||user.role!=="Admin"||waiverReason.trim().length<8)return;
  setBusy(true);
  try{
    await approveWaiver(ruleId,checklistTarget,waiverReason.trim());
    await reloadChecklist();setWaivingId(null);setWaiverReason("");
    notify({kind:"success",title:"تم اعتماد الاستثناء مع السبب"});
  }catch(error){notifyError("تعذّر اعتماد الاستثناء",error);}
  finally{setBusy(false);}
 }
 async function cancelWaiver(waiverId:string){
  if(busy||user.role!=="Admin")return;
  setBusy(true);
  try{
    await revokeWaiver(waiverId);await reloadChecklist();
    notify({kind:"success",title:"تم إلغاء الاستثناء؛ عاد المتطلب للتقييم"});
  }catch(error){notifyError("تعذّر إلغاء الاستثناء",error);}
  finally{setBusy(false);}
 }
 function linkLabels(doc:BusinessDocument){
  return doc.links.map(l=>{
    if(l.orderId)return{...l,label:"طلب الشراء"};
    if(l.shipmentId)return{...l,label:"B/L "+(shipments.find(s=>s.id===l.shipmentId)?.blNumber||"بوليصة")};
    const container=containerOptions.find(c=>c.id===l.containerId);
    return{...l,label:container?.label||"حاوية"};
  });
 }

 return <section className="im-documents" aria-label="مستندات الطلب">
   <div className="im-documents-heading">
     <div><span className="im-eyebrow">أرشيف الطلب / ملفات خاصة</span>
       <h2><Paperclip size={22}/> المستندات والملفات</h2>
       <p>ارفع الملف مرة واحدة، واربطه بالطلب أو بوليصة الشحن أو مجموعة حاويات.</p>
     </div>
     <button type="button" className="btn btn-outline" disabled={busy} onClick={()=>void refresh()}>
       <RefreshCw size={16}/> تحديث
     </button>
   </div>
    {canUpload&&<form className="im-doc-upload" onSubmit={event=>void upload(event)}>
     <div className="im-doc-upload-title">
       <UploadCloud size={20}/><div><strong>رفع مستند جديد</strong><p>PDF / JPG / PNG فقط — حتى 25 MB للملف.</p></div>
     </div>
     <div className={"im-doc-drop "+(dragging?"dragging":"")} role="group"
       onDragOver={e=>{e.preventDefault();setDragging(true);}}
       onDragLeave={e=>{e.preventDefault();setDragging(false);}}
       onDrop={onDrop}>
       <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png"
         aria-label="اختيار ملف المستند" onChange={e=>setSelectedFile(e.target.files?.[0]||null)}/>
       <FilePlus2 size={23}/>
       <strong>{file?file.name:"اسحب الملف هون أو اضغط للاختيار"}</strong>
       <span>{file?filesize(file.size):"النسخة الأصلية تبقى محفوظة بحساب شركتك"}</span>
       {file&&<button type="button" className="im-doc-clear" onClick={()=>{
         setFile(null);if(inputRef.current)inputRef.current.value="";
       }}><X size={15}/> إزالة الاختيار</button>}
     </div>
     <div className="im-doc-input-grid">
       <label className="im-doc-input-label">نوع المستند
         <select value={type} onChange={e=>changeDocumentType(e.target.value as DocumentType)}>
           {documentTypes.map(([v,name])=><option value={v} key={v}>{name}</option>)}
         </select>
       </label>
       <label className="im-doc-input-label">ملاحظات <small>اختياري</small>
         <input value={notes} maxLength={1500} placeholder="ملاحظات عن النسخة..."
           onChange={e=>setNotes(e.target.value)}/>
       </label>
     </div>
     <TargetPicker mode={mode} setMode={setMode} shipmentId={shipmentId} setShipmentId={setShipmentId}
       containerIds={containerIds} setContainerIds={setContainerIds} shipments={shipments}/>
     <div className="im-doc-upload-actions">
       <p><ShieldAlert size={15}/> التحميل والعرض متاحان لأعضاء شركتك المخوّلين فقط.</p>
       <button className="btn primary" type="submit" disabled={!file||busy}>
         <UploadCloud size={17}/>{busy?"جارٍ الحفظ...":"رفع وربط المستند"}
       </button>
     </div>
    </form>}
   <div className="im-doc-existing">
     <div className="im-doc-section-heading">
       <div><FileText size={19}/><h3>ملفات هذا الطلب</h3></div>
       <small>الملفات المربوطة بالطلب وبوالصه وحاوياته</small>
     </div>
     {loading?<div className="im-doc-empty">جارٍ تحميل المستندات...</div>:
       documents.length===0?<div className="im-doc-empty"><FileText size={28}/>
         <strong>ما في مستندات مربوطة بالطلب حتى الآن.</strong>
         <p>ابدأ برفع البوليصة أو الفاتورة أو قائمة التعبئة.</p></div>:
       <div className="im-doc-list">{documents.map(doc=><article className="im-doc-row" key={doc.id}>
         <div className="im-doc-row-main">
           <FileText size={22}/>
           <div><strong dir="auto">{doc.originalFileName}</strong>
             <small>{documentTypeLabel(doc.type)} · {filesize(doc.sizeBytes)} · {new Date(doc.uploadedAtUtc).toLocaleDateString("ar-SY-u-nu-latn")}</small>
           </div>
         </div>
         <div className="im-doc-row-actions">
           <button type="button" className="btn btn-outline" onClick={()=>setPreviewId(
             previous=>previous===doc.id?null:doc.id)}><Eye size={15}/> معاينة</button>
           <a className="btn btn-outline" href={documentDownloadUrl(doc.id)}><Download size={15}/> تنزيل</a>
            {canUpload&&<button type="button" className="im-table-delete" title="حذف المستند" aria-label={"حذف "+doc.originalFileName}
              disabled={busy} onClick={()=>setPendingDelete({kind:"document",documentId:doc.id})}>
              <Trash2 size={16}/></button>}
         </div>
         <div className="im-doc-linked-targets">
           {linkLabels(doc).map(link=><span key={link.id} className="im-doc-link-chip">
             <Link2 size={13}/>{link.label}
              {canUpload&&<button type="button" title="إزالة هذا الربط فقط" aria-label={"إزالة ربط "+link.label}
                onClick={()=>setPendingDelete({kind:"link",documentId:doc.id,linkId:link.id})}><X size={13}/></button>}
           </span>)}
            {canUpload&&<button type="button" className="im-doc-add-link" disabled={busy}
              onClick={()=>setRelinkId(x=>x===doc.id?null:doc.id)}><Plus size={14}/> ربط بجهة أخرى</button>}
         </div>
         {relinkId===doc.id&&<div className="im-doc-relink">
           <p>سيُستخدم نفس الملف المحفوظ، بدون رفع نسخة جديدة.</p>
           <TargetPicker mode={mode} setMode={setMode} shipmentId={shipmentId} setShipmentId={setShipmentId}
             containerIds={containerIds} setContainerIds={setContainerIds} shipments={shipments}/>
           <div className="im-doc-upload-actions">
             <button type="button" disabled={busy} className="btn primary" onClick={()=>void linkExisting(doc.id)}>
               <Link2 size={15}/> تأكيد الربط</button>
             <button type="button" className="btn btn-outline" onClick={()=>setRelinkId(null)}>إلغاء</button>
           </div>
         </div>}
       </article>)}</div>}
     {documents.length>0&&documents.length<totalDocuments&&
       <button type="button" className="btn btn-outline im-doc-load-more"
         disabled={loadingMore||busy} onClick={()=>void showMore()}>
         {loadingMore?"جارٍ التحميل...":"عرض المزيد من المستندات"}
       </button>}
     {selectedDocument&&<div className="im-doc-preview">
       <div className="im-doc-preview-head"><strong>معاينة: {selectedDocument.originalFileName}</strong>
         <button type="button" aria-label="إغلاق المعاينة" onClick={()=>setPreviewId(null)}><X size={18}/></button>
       </div>
       {selectedDocument.contentType==="application/pdf"?
         <iframe title={"معاينة "+selectedDocument.originalFileName}
           referrerPolicy="no-referrer" loading="lazy"
           src={documentPreviewUrl(selectedDocument.id)}/>:
         <div className="im-doc-image-preview">
           {/* This is a same-origin, access-controlled endpoint, not a remote image. */}
           {/* eslint-disable-next-line @next/next/no-img-element */}
           <img src={documentPreviewUrl(selectedDocument.id)} alt={selectedDocument.originalFileName}/>
         </div>}
       <p>إذا ما ظهر عرض PDF بمتصفحك، استخدم زر التنزيل الموجود بجانب الملف.</p>
     </div>}
   </div>
   <div className="im-doc-requirements">
     <div className="im-doc-section-heading">
       <div><FileCheck2 size={19}/><h3>المستندات المطلوبة والمراجعة</h3></div>
       {user.role==="Admin"&&<button type="button" className="btn btn-outline"
         onClick={()=>setShowRuleForm(x=>!x)}><Plus size={15}/> إعداد متطلب</button>}
     </div>
     <p className="im-doc-helper">لا يعتبر النظام أي مستند ناقصاً إلا إذا وضع مدير الشركة قاعدة تُلزمه في المرحلة المعنية.</p>
     <div className="im-doc-checklist-selector">
       <label className="im-doc-input-label">نطاق التحقق
         <select value={ruleMode} onChange={e=>{
           setRuleMode(e.target.value as DocumentTargetMode);
           setNewRule(v=>({...v,stage:"Any"}));
         }}>
           <option value="Order">طلب الشراء</option><option value="Shipment">بوليصة</option>
           <option value="Container">حاوية</option>
         </select>
       </label>
       <label className="im-doc-input-label">السجل
         <select value={ruleTarget} onChange={e=>setRuleTarget(e.target.value)}>
           {availableTargets.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}
         </select>
       </label>
     </div>
     {showRuleForm&&user.role==="Admin"&&<form className="im-doc-rule-form" onSubmit={event=>void saveRule(event)}>
       <label className="im-doc-input-label">نوع المستند
         <select value={newRule.documentType} onChange={e=>setNewRule(v=>({...v,documentType:e.target.value as DocumentType}))}>
           {documentTypes.map(([type,label])=><option key={type} value={type}>{label}</option>)}
         </select>
       </label>
       <label className="im-doc-input-label">المرحلة
         <select value={newRule.stage} onChange={e=>setNewRule(v=>({...v,stage:e.target.value}))}>
           {stages.filter(x=>ruleMode!=="Container"||!["NotShipped","PartiallyDelivered"].includes(x))
             .filter(x=>ruleMode!=="Shipment"||x!=="NotShipped")
             .map(x=><option key={x} value={x}>{stageNames[x]||x}</option>)}
         </select>
       </label>
       <label className="im-doc-rule-check">
         <input type="checkbox" checked={newRule.isRequired}
           onChange={e=>setNewRule(v=>({...v,isRequired:e.target.checked}))}/>
         مستند مطلوب
       </label>
       <button type="submit" className="btn primary" disabled={busy}>حفظ القاعدة</button>
     </form>}
     {!ruleTarget?<div className="im-doc-empty">اختر بوليصة أو حاوية لعرض المتطلبات.</div>:
       !checklist?<div className="im-doc-empty">جارٍ تحميل قائمة المتطلبات...</div>:
       checklist.items.length===0?<div className="im-doc-empty">
         <Check size={22}/><strong>لا توجد قواعد إلزامية محددة لهذا النطاق.</strong>
         <p>لم تُصنّف المستندات على أنها ناقصة تلقائياً.</p>
       </div>:
       <div className="im-doc-checklist">
         <p className="im-doc-helper">المرحلة الحالية: {stageNames[checklist.currentStage]||checklist.currentStage}</p>
         {checklist.items.map(item=><div className="im-doc-check-row" key={item.id}>
           <div><strong>{documentTypeLabel(item.documentType)}</strong>
             <small>{stageNames[item.stage]||item.stage}</small></div>
           <span className={"im-doc-check-status "+item.status}>{statusNames[item.status]}</span>
           {user.role==="Admin"&&item.status==="missing"&&
             <button type="button" className="im-doc-waive-btn"
               onClick={()=>{setWaivingId(x=>x===item.id?null:item.id);setWaiverReason("");}}>
               استثناء مع سبب</button>}
           {user.role==="Admin"&&item.status==="waived"&&item.waiver&&
             <button type="button" className="im-doc-waive-btn" disabled={busy}
               onClick={()=>void cancelWaiver(item.waiver!.id)}>إلغاء الاستثناء</button>}
           {waivingId===item.id&&<div className="im-doc-waiver-form">
             <textarea rows={2} value={waiverReason} maxLength={1000}
               placeholder="اكتب سبب الاستثناء الإداري (8 أحرف على الأقل)..."
               onChange={e=>setWaiverReason(e.target.value)}/>
             <button type="button" className="btn primary" disabled={busy||waiverReason.trim().length<8}
               onClick={()=>void setWaiver(item.id)}>اعتماد الاستثناء</button>
           </div>}
         </div>)}
       </div>}
   </div>
   <ConfirmDialog open={Boolean(pendingDelete)}
     title={pendingDelete?.kind==="link"?"إزالة ربط المستند؟":"حذف المستند من السجل؟"}
     description={pendingDelete?.kind==="link"
       ?"سيُزال ربط هذا الملف بالجهة المحددة فقط، ويبقى موجوداً في الجهات الأخرى."
       :"سيختفي المستند من سجلات الاستخدام وقوائم النواقص، وتبقى النسخة الأصلية محفوظة لإجراءات الاسترجاع والتدقيق."}
     pending={busy} onCancel={()=>setPendingDelete(null)}
     onConfirm={()=>void deleteSelected()}/>
 </section>;
}
