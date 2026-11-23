"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import {Anchor,ExternalLink,MapPin,RefreshCw,Ship,ShipWheel} from "lucide-react";
import {useToast} from "@/components/ToastProvider";
import {listShipments,Shipment} from "@/lib/logisticsApi";
import {listTracking,listShipsGoCarriers,registerTracking,refreshTracking,reconcileTracking,TrackingReference} from "@/lib/trackingApi";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Badge} from "@/components/ui/badge";
import TrackingVoyageMap from "@/components/TrackingVoyageMap";
import {arabicShipmentStatus,arabicEvent,arabicPort,arabicContainerType,localizePort} from "@/lib/trackingArabic";

const date=(value:string|null|undefined)=>{
  if(!value)return "غير متوفر";
  // ShipsGo's loading/discharge ETA is a date, not an exact arrival hour.
  // Parse the literal calendar date in UTC, avoiding timezone day shifts or
  // misleading midnight timestamps from date-time-only provider values.
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value);
  if(!match)return "تاريخ غير صالح";
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(year<2000||year>2100)return "تاريخ غير صالح";
  const utc=new Date(Date.UTC(year,month-1,day));
  if(utc.getUTCFullYear()!==year||utc.getUTCMonth()!==month-1||
    utc.getUTCDate()!==day)return "تاريخ غير صالح";
  return new Intl.DateTimeFormat("ar-SY-u-nu-latn",{
    day:"numeric",month:"long",year:"numeric",timeZone:"UTC"
  }).format(utc);
};
const dateTime=(value:string|null|undefined)=>{
  if(!value)return "غير متوفر";
  if(/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)){
    const parsed=new Date(value);
    if(!Number.isNaN(parsed.getTime()))
      return parsed.toLocaleString("ar-SY-u-nu-latn",{
        day:"numeric",month:"long",year:"numeric",
        hour:"2-digit",minute:"2-digit"
      });
  }
  // ShipsGo sometimes supplies a timestamp without a timezone; do not
  // quietly convert it as UTC or claim a precise time zone.
  const hour=/[T ](\d{2}):(\d{2})/.exec(value);
  return date(value)+(hour?" · "+hour[1]+":"+hour[2]+" (توقيت المزوّد)":"");
};
const statusLabel=arabicShipmentStatus;
const trackingError=(code:string)=>{
  const messages:Record<string,string>={
    tracking_provider_unavailable:"تعذّر الاتصال بمزوّد التتبع.",
    tracking_provider_timeout:"انتهت مهلة الاتصال بمزوّد التتبع.",
    tracking_provider_no_data:"المزوّد لم يُرسل معلومات عن الشحنة بعد.",
    tracking_provider_invalid_response:"الاستجابة من مزوّد التتبع غير مكتملة أو غير متوقعة.",
    tracking_provider_auth_failed:"صلاحيات الاتصال بمزوّد التتبع بحاجة إلى مراجعة.",
    tracking_provider_rate_limited:"تم بلوغ حد الاستعلامات المسموح مؤقتاً.",
    tracking_provider_no_credits:"رصيد خدمة التتبع غير كافٍ.",
    tracking_provider_ambiguous_registration:"نتيجة تسجيل التتبع غير مؤكدة وتحتاج مراجعة.",
    tracking_provider_invalid_reference:"رقم التتبع أو شركة الشحن غير مقبولين لدى المزوّد.",
    tracking_activation_pending_review:"طلب التتبع السابق معلّق للمراجعة قبل إعادة الإرسال.",
    tracking_v2_not_configured:"التتبع الجديد غير مفعّل على الخادم."
  };
  return messages[code]||"حدثت مشكلة في مزامنة الشحنة، ويمكن مراجعة سجل الخادم لمعرفة التفاصيل.";
};

export default function ImportTrackingPanel({orderId,disabled=false}:{
  orderId:string;disabled?:boolean;
}){
  const {notify}=useToast();
  const [shipments,setShipments]=useState<Shipment[]>([]);
  const [shipmentId,setShipmentId]=useState("");
  const [references,setReferences]=useState<TrackingReference[]>([]);
  const [configured,setConfigured]=useState(false);
  const [v2Configured,setV2Configured]=useState(false);
  const [carriers,setCarriers]=useState<{scac:string;name:string}[]>([]);
  const [quota,setQuota]=useState({limit:0,used:0,remaining:0});
  const [type,setType]=useState<"CT"|"BL">("BL");
  const [number,setNumber]=useState("");
  const [carrier,setCarrier]=useState("");
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [selectedId,setSelectedId]=useState("");
  const loadShipments=useCallback(async()=>{
    try{
      const data=await listShipments(orderId);
      setShipments(data);
      setShipmentId(prev=>data.some(x=>x.id===prev)?prev:data[0]?.id||"");
    }catch(e){notify({kind:"error",title:"تعذّر تحميل البوالص",description:(e as Error).message});}
    finally{setLoading(false);}
  },[orderId,notify]);
  useEffect(()=>{void loadShipments();},[loadShipments]);
  const loadTracking=useCallback(async()=>{
    if(!shipmentId){setReferences([]);return;}
    try{
      const result=await listTracking(shipmentId);
      setConfigured(result.configured);
      setV2Configured(result.v2Configured);
      setQuota(result.quota);
      setReferences(result.records);
      setSelectedId(prev=>result.records.some(r=>r.id===prev)?prev:result.records[0]?.id||"");
    }catch(e){notify({kind:"error",title:"تعذّر تحميل التتبع",description:(e as Error).message});}
  },[shipmentId,notify]);
  useEffect(()=>{void loadTracking();},[loadTracking]);
  useEffect(()=>{
    if(!v2Configured)return;
    let active=true;
    void listShipsGoCarriers().then(data=>{if(active)setCarriers(data);})
      .catch(e=>notify({kind:"error",title:"تعذّر تحميل شركات الشحن",description:(e as Error).message}));
    return()=>{active=false;};
  },[v2Configured,notify]);
  const shipment=shipments.find(x=>x.id===shipmentId);
  const current=references.find(x=>x.id===selectedId);
  useEffect(()=>{setCarrier(current?.carrierCode||"");},
    [selectedId,current?.carrierCode]);
  async function add(event:FormEvent){
    event.preventDefault();
    if(!shipmentId||busy||disabled)return;
    setBusy(true);
    try{
      const created=await registerTracking(shipmentId,{
        referenceType:type,referenceNumber:number.trim(),carrierCode:carrier.trim()
      });
      setSelectedId(created.id);
      setNumber("");await loadTracking();
      notify({kind:"success",title:"تم حفظ رقم التتبع",description:"يمكن الآن طلب بيانات شركة الشحن عندما يكون مزوّد التتبع مفعّلاً."});
    }catch(e){notify({kind:"error",title:"تعذّر إضافة رقم التتبع",description:(e as Error).message});}
    finally{setBusy(false);}
  }
  async function refresh(){
    if(!current||busy||!configured||disabled)return;
    setBusy(true);
    try{
      await refreshTracking(current.id);
      await loadTracking();
      notify({kind:"success",title:"تم تحديث بيانات شركة الشحن"});
    }catch(e){notify({kind:"error",title:"تعذّر جلب التتبع",description:(e as Error).message});}
    finally{setBusy(false);}
  }
  async function correctCarrier(){
    if(!current||busy||disabled||!v2Configured)return;
    setBusy(true);
    try{
      await registerTracking(shipmentId,{referenceType:current.referenceType,
        referenceNumber:current.referenceNumber,carrierCode:carrier});
      await loadTracking();
      notify({kind:"success",title:"تم تحديث شركة الشحن المحفوظة",
        description:"إذا كان التتبع مفعّلاً سابقاً، لن يؤدي التعديل إلى تغيير التسجيل لدى ShipsGo."});
    }catch(e){notify({kind:"error",title:"تعذّر تعديل شركة الشحن",description:(e as Error).message});}
    finally{setBusy(false);}
  }
  async function reconcile(){
    if(!current||busy||disabled||!v2Configured)return;
    setBusy(true);
    try{
      await reconcileTracking(current.id);
      await loadTracking();
      notify({kind:"success",title:"تم استرجاع رقم التتبع من ShipsGo",
        description:"تم البحث بدون طلب إنشاء جديد أو خصم رصيد إضافي. يمكنك الآن تحديث البيانات."});
    }catch(e){notify({kind:"error",title:"تعذّرت استعادة التتبع",description:(e as Error).message});}
    finally{setBusy(false);}
  }
  const snapshot=current?.snapshot;
  const pol=localizePort(snapshot?.portOfLoading,snapshot?.portOfLoadingCode);
  const pod=localizePort(snapshot?.portOfDischarge,snapshot?.portOfDischargeCode);
  const expectedDischarge=snapshot?.eta||snapshot?.etaPredicted||snapshot?.etaInitial;
  const position=snapshot?.latitude!=null&&snapshot.longitude!=null
    ? {lat:snapshot.latitude,lng:snapshot.longitude}:null;
  const etaElapsed=Boolean(snapshot?.eta&&!snapshot.actualArrival&&
    !["ARRIVED","DISCHARGED","DELIVERED","COMPLETED"].includes((snapshot.status||"").toUpperCase())&&
    snapshot.eta<new Date().toISOString().slice(0,10));
  return <section className="im-track" aria-label="تتبع الشحنة">
    <div className="im-logistics-heading">
      <div><span className="im-eyebrow">تتبع بحري / بيانات شركة الشحن</span>
        <h2><Ship size={21}/> تتبع الشحنة</h2>
        <p>التتبع المباشر عبر ShipsGo. تُحسب كل بوليصة مفعّلة مرة واحدة ضمن باقتك، حتى لو تحتوي على عدة حاويات.</p>
      </div>
       <Button type="button" variant="outline" className="btn btn-outline" onClick={()=>void loadTracking()} disabled={busy}>
         <RefreshCw size={16}/> إعادة تحميل المحفوظ</Button>
    </div>
    {loading?<div className="im-empty">جارٍ تحميل بيانات الشحن...</div>:
      shipments.length===0?<div className="im-info-strip"><Anchor size={19}/><p>سجّل بوليصة شحن أولاً من تبويب البوليصة، ثم أضف رقم التتبع هنا.</p></div>:
      <>
        <div className="im-track-form">
          <label>البوليصة المرتبطة
            <select value={shipmentId} onChange={e=>{setShipmentId(e.target.value);setSelectedId("");setCarrier("");setNumber("");}}>
              {shipments.map(s=><option value={s.id} key={s.id}>{s.blNumber}</option>)}
            </select></label>
          <div className="im-info-strip"><ShipWheel size={18}/><p>
            رصيد تتبّع البوالص الحالي: <strong>{quota.used} / {quota.limit}</strong>
            {" · "}المتبقي: <strong>{quota.remaining}</strong>.
            التسجيل مجاني؛ يُحسب الرصيد عند تفعيل التتبّع المباشر لأول مرة.</p></div>
          <form onSubmit={e=>void add(e)} className="im-track-register">
            <label>البحث باستخدام
              <select value={type} onChange={e=>{const v=e.target.value as "CT"|"BL";setType(v);setNumber(v==="BL"?(shipment?.blNumber||""):"");}}>
                <option value="CT">رقم الحاوية</option>
                <option value="BL">رقم البوليصة B/L</option>
              </select>
            </label>
            <label>{type==="CT"?"رقم الحاوية":"رقم البوليصة"}
               <Input required dir="ltr" maxLength={90} value={number}
                 placeholder={type==="CT"?"MSCU1234567":shipment?.blNumber||"B/L"}
                 onChange={e=>setNumber(e.target.value)}/></label>
            {type==="CT"&&shipment&&shipment.containers.length>0&&<label>اختيار حاوية مسجلة
              <select value="" onChange={e=>setNumber(e.target.value)}>
                <option value="">اختر من حاويات البوليصة</option>
                {shipment.containers.map(c=><option key={c.id} value={c.number}>{c.number}</option>)}
              </select></label>}
            <label>شركة الشحن في ShipsGo
              {v2Configured?<select dir="ltr" value={carrier} onChange={e=>setCarrier(e.target.value)}>
                <option value="">اختيار تلقائي من ShipsGo</option>
                {carriers.map(c=><option key={c.scac} value={c.scac}>{c.name} ({c.scac})</option>)}
              </select>:<Input dir="ltr" maxLength={80} placeholder="MSC" value={carrier}
                onChange={e=>setCarrier(e.target.value)}/>}
              <small>{v2Configured?"رمز SCAC الرسمي لشركة الشحن.":"اسم شركة الشحن حسب V1.2."}</small>
            </label>
             <Button type="submit" className="btn primary" disabled={busy||disabled||!number.trim()}>
               حفظ رقم التتبع</Button>
          </form>
        </div>
        {!configured&&<div className="im-info-strip">
          <ShipWheel size={19}/><p>خدمة التتبع المباشر غير مفعّلة على السيرفر بعد. يمكنك حفظ أرقام التتبع، لكن لن تظهر معلومات البحر أو موقع الباخرة حتى يتم ضبط API Key.</p>
        </div>}
        {configured&&!v2Configured&&<div className="im-info-strip">
          <ShipWheel size={19}/><p>تتبّع V2 للشحنات الجديدة يحتاج تفعيل مفتاح V2 على السيرفر. التتبّعات القديمة المسجّلة مسبقاً متاحة للتحديث بمفتاح V1.2.</p>
        </div>}
        {references.length===0?<div className="im-logistics-empty">لم تُضف مراجع تتبع لهذه البوليصة بعد.</div>:<>
          <div className="im-logistics-tabs" role="tablist" aria-label="مراجع التتبع">
            {references.map(r=><button key={r.id} type="button" role="tab"
              aria-selected={r.id===selectedId} className={"im-logistics-tab "+(r.id===selectedId?"active":"")}
              onClick={()=>setSelectedId(r.id)}>
               <Badge variant="secondary" dir="ltr">{r.referenceNumber}</Badge>
              <small>{r.referenceType==="CT"?"حاوية":"بوليصة"} · {r.lastSyncedAtUtc?"بيانات محفوظة":"لم تتم المزامنة"}</small>
            </button>)}
          </div>
          {current&&<div className="im-track-result">
            <div className="im-logistics-details-toolbar">
              <span>آخر نتيجة معتمدة من المزوّد</span>
              {v2Configured&&carrier!==current.carrierCode&&
                <Button type="button" variant="outline" disabled={busy||disabled}
                  onClick={()=>void correctCarrier()}>تعديل شركة الشحن المحفوظة</Button>}
              {v2Configured&&current.lastErrorCode&&!current.lastSyncedAtUtc&&
                <Button type="button" variant="outline" disabled={busy||disabled}
                  onClick={()=>void reconcile()}>فحص طلب التتبع المعلّق دون خصم</Button>}
               <Button type="button" className="btn primary" disabled={!configured||busy||disabled}
                 onClick={()=>void refresh()}><RefreshCw size={16}/>{busy?"جارٍ الاستعلام...":"تحديث من شركة الشحن"}</Button>
            </div>
            {current.lastErrorCode&&<p className="im-track-warning">{trackingError(current.lastErrorCode)} تبقى آخر بيانات محفوظة متاحة.</p>}
            <p className="im-track-source">آخر مزامنة: {dateTime(current.lastSyncedAtUtc)}. حالة التتبع والموقع ليست بديلاً عن وثائق الشحن الرسمية.</p>
            {snapshot&&["NEW","INPROGRESS"].includes(snapshot.status.toUpperCase())&&
              <p className="im-info-strip">آخر رد من شركة التتبع لم يتضمن تفاصيل الرحلة بعد. إذا ظهرت التفاصيل داخل ShipsGo، اضغط «تحديث من شركة الشحن» بعد مرور دقيقة على آخر مزامنة. هذا تحديث قراءة للتسجيل الموجود، وليس طلب تفعيل مدفوعاً جديداً.</p>}
            {etaElapsed&&<p className="im-track-warning">تجاوز موعد الوصول المتوقع ETA ولم يؤكد مزوّد التتبع الوصول الفعلي. راجع شركة الشحن؛ قد تكون بيانات المزوّد متأخرة.</p>}
            {snapshot?<><div className="im-logistics-meta">
              <div><small>الحالة</small><strong>{statusLabel(snapshot.status)}</strong></div>
              <div><small>شركة الشحن</small><strong>{snapshot.carrierName||snapshot.carrierCode||current.carrierCode||"غير متوفرة"}</strong></div>
              <div><small>الباخرة</small><strong>{snapshot.vessel||"غير متوفرة"}</strong></div>
              <div><small>الرحلة</small><strong dir="ltr">{snapshot.voyage||"غير متوفرة"}</strong></div>
              <div><small>تاريخ التحميل على الباخرة</small><strong>{date(snapshot.etd)}</strong></div>
              <div><small>موعد التفريغ المتوقع {snapshot.eta?"بحسب الناقل":snapshot.etaPredicted?"بحسب توقع المزوّد":snapshot.etaInitial?"الأولي":""}</small><strong>{date(expectedDischarge)}</strong>
                <small>تاريخ تقديري وليس ساعة وصول مؤكدة</small></div>
              <div><small>الوصول الفعلي</small><strong>{date(snapshot.actualArrival)}</strong></div>
              <div><small>تحديث الموقع</small><strong>{dateTime(snapshot.positionUpdatedAt)}</strong></div>
              <div><small>ميناء التحميل</small><strong>{pol.arabic}</strong>
                {pol.confidence==="approximate"&&<small>تعريب صوتي تقريبي</small>}
                {(pol.official||snapshot.portOfLoadingCode)&&<small dir="ltr">{[pol.official,snapshot.portOfLoadingCode].filter(Boolean).join(" · ")}</small>}
              </div>
              <div><small>ميناء التفريغ</small><strong>{pod.arabic}</strong>
                {pod.confidence==="approximate"&&<small>تعريب صوتي تقريبي</small>}
                {(pod.official||snapshot.portOfDischargeCode)&&<small dir="ltr">{[pod.official,snapshot.portOfDischargeCode].filter(Boolean).join(" · ")}</small>}
              </div>
              <div><small>تاريخ التحميل الأصلي</small><strong>{date(snapshot.etdInitial)}</strong></div>
              <div><small>تاريخ التفريغ الأصلي المتوقع</small><strong>{date(snapshot.etaInitial)}</strong></div>
              <div><small>توقع ShipsGo الإضافي للتفريغ</small>
                <strong>{snapshot.etaPredicted?date(snapshot.etaPredicted):"لم يصدر توقع إضافي"}</strong></div>
              <div><small>نسبة تقدم الرحلة</small><strong>{snapshot.transitPercentage==null?"غير متوفرة":snapshot.transitPercentage+"%"}</strong></div>
              <div><small>مدة العبور</small><strong>{snapshot.transitTimeDays==null?"غير متوفرة":snapshot.transitTimeDays+" يوم"}</strong></div>
              <div><small>عدد مرات إعادة الشحن (الترانزيت)</small><strong>{snapshot.transshipmentCount??"غير متوفر"}</strong></div>
              <div><small>عدد الحاويات</small><strong>{snapshot.containerCount??"غير متوفر"}</strong></div>
              <div><small>الانبعاثات التقديرية لثاني أكسيد الكربون</small><strong>{snapshot.co2Tons==null?"غير متوفرة":snapshot.co2Tons+" طن"}</strong></div>
              <div><small>آخر تحقق من ShipsGo</small><strong>{dateTime(snapshot.providerCheckedAt)}</strong></div>
            </div>
            <div className="im-track-map">
              <div><MapPin size={19}/><strong>خريطة رحلة الشحنة</strong></div>
              {(position||snapshot.mapSegments?.length||snapshot.mapWaypoints?.length)?
                <TrackingVoyageMap latitude={snapshot.latitude} longitude={snapshot.longitude}
                  waypoints={snapshot.mapWaypoints||[]} segments={snapshot.mapSegments||[]}/>:
                <p>لا توجد بيانات مسار جغرافية بعد من ShipsGo. حدّث الشحنة لعرض خط السير والموانئ إن توفرت.</p>}
              {snapshot.mapWaypoints?.length&&!snapshot.mapSegments?.length?
                <p>المزوّد أعاد مواقع موانئ فقط، بدون خط ملاحة. لذلك نعرض الموانئ ولا نرسم مساراً افتراضياً قد يكون غير صحيح.</p>:null}
              {position?<p>موقع الباخرة المرسل من ShipsGo: <b dir="ltr">{position.lat.toFixed(5)}, {position.lng.toFixed(5)}</b></p>:
                <p>موقع الباخرة الحالي غير متوفر؛ خطوط الرحلة المرسومة إن وجدت هي بيانات المسار من المزوّد وليست موقعاً حيّاً.</p>}
              {snapshot.mapUrl&&<a className="btn btn-outline" href={snapshot.mapUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> عرض على ShipsGo</a>}
            </div>
            {snapshot.containers&&snapshot.containers.length>0&&<>
              <div className="im-logistics-subhead"><div><Ship size={19}/><strong>الحاويات وحالاتها</strong></div></div>
              <div className="im-logistics-meta">
                {snapshot.containers.map((c,i)=><div key={c.number+"-"+i}>
                  <small dir="ltr">{c.number}</small><strong>{statusLabel(c.status)}</strong>
                  <small>{c.size?c.size+" قدم":""} {arabicContainerType(c.type)} · {c.events.length} حركة</small>
                </div>)}
              </div>
            </>}
            <div className="im-logistics-subhead"><div><Anchor size={19}/><strong>سجل أحداث الرحلة</strong></div></div>
            {snapshot.events.length===0?<div className="im-logistics-empty">لا توجد أحداث مُعادة من المزوّد.</div>:
              <div className="im-track-events">
                {snapshot.events.map((event,index)=><div key={index} className="im-track-event">
                  <span className="im-track-dot"/>
                   <div><strong>{arabicEvent(event.eventCode,event.description)}</strong>
                     <p>{[event.location?arabicPort(event.location):null,event.containerNumber,event.vessel,event.voyage].filter(Boolean).join(" · ")}</p>
                  </div>
                  <small>{dateTime(event.date)} · {event.actual?"فعلي":"متوقع"}</small>
                </div>)}
              </div>}
            </>:<div className="im-logistics-empty">لم تُجلب بيانات من المزوّد بعد. اختر تحديث من شركة الشحن عند تفعيل الخدمة.</div>}
          </div>}
        </>}
      </>}
  </section>;
}
