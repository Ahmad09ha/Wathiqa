"use client";

import {FormEvent,useCallback,useEffect,useState} from "react";
import {Anchor,ExternalLink,MapPin,RefreshCw,Ship,ShipWheel} from "lucide-react";
import {useToast} from "@/components/ToastProvider";
import {listShipments,Shipment} from "@/lib/logisticsApi";
import {listTracking,registerTracking,refreshTracking,TrackingReference} from "@/lib/trackingApi";

const date=(value:string|null|undefined)=>{
  if(!value)return "غير متوفر";
  const parsed=new Date(value.length===10?value+"T00:00:00":value);
  return Number.isNaN(parsed.getTime())?value:parsed.toLocaleString("ar-SY-u-nu-latn");
};
const statusLabel=(code:string)=>{
  const names:Record<string,string>={PLANNED:"مخطط",IN_TRANSIT:"في البحر",
    ARRIVED:"وصل",DELIVERED:"تم التسليم",COMPLETED:"مكتمل",PENDING:"بانتظار بيانات"};
  return names[code.toUpperCase()]||code||"غير معروف";
};

export default function ImportTrackingPanel({orderId,disabled=false}:{
  orderId:string;disabled?:boolean;
}){
  const {notify}=useToast();
  const [shipments,setShipments]=useState<Shipment[]>([]);
  const [shipmentId,setShipmentId]=useState("");
  const [references,setReferences]=useState<TrackingReference[]>([]);
  const [configured,setConfigured]=useState(false);
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
      setQuota(result.quota);
      setReferences(result.records);
      setSelectedId(prev=>result.records.some(r=>r.id===prev)?prev:result.records[0]?.id||"");
    }catch(e){notify({kind:"error",title:"تعذّر تحميل التتبع",description:(e as Error).message});}
  },[shipmentId,notify]);
  useEffect(()=>{void loadTracking();},[loadTracking]);
  const shipment=shipments.find(x=>x.id===shipmentId);
  const current=references.find(x=>x.id===selectedId);
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
  const snapshot=current?.snapshot;
  const position=snapshot?.latitude!=null&&snapshot.longitude!=null
    ? {lat:snapshot.latitude,lng:snapshot.longitude}:null;
  const mapsLink=position
    ?"https://www.openstreetmap.org/?mlat="+position.lat+"&mlon="+position.lng+
      "#map=7/"+position.lat+"/"+position.lng
    :null;
  const etaElapsed=Boolean(snapshot?.eta&&!snapshot.actualArrival&&
    snapshot.eta<new Date().toISOString().slice(0,10));
  const embedMap=position
    ?"https://www.openstreetmap.org/export/embed.html?bbox="+
      [position.lng-2,position.lat-1.5,position.lng+2,position.lat+1.5].join("%2C")+
      "&layer=mapnik&marker="+position.lat+"%2C"+position.lng:null;
  return <section className="im-track" aria-label="تتبع الشحنة">
    <div className="im-logistics-heading">
      <div><span className="im-eyebrow">تتبع بحري / بيانات شركة الشحن</span>
        <h2><Ship size={21}/> تتبع الشحنة</h2>
        <p>التتبع المباشر عبر ShipsGo. تُحسب كل بوليصة مفعّلة مرة واحدة ضمن باقتك، حتى لو تحتوي على عدة حاويات.</p>
      </div>
      <button type="button" className="btn btn-outline" onClick={()=>void loadTracking()} disabled={busy}>
        <RefreshCw size={16}/> إعادة تحميل المحفوظ</button>
    </div>
    {loading?<div className="im-empty">جارٍ تحميل بيانات الشحن...</div>:
      shipments.length===0?<div className="im-info-strip"><Anchor size={19}/><p>سجّل بوليصة شحن أولاً من تبويب البوليصة، ثم أضف رقم التتبع هنا.</p></div>:
      <>
        <div className="im-track-form">
          <label>البوليصة المرتبطة
            <select value={shipmentId} onChange={e=>{setShipmentId(e.target.value);setSelectedId("");}}>
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
              <input required dir="ltr" maxLength={90} value={number}
                placeholder={type==="CT"?"MSCU1234567":shipment?.blNumber||"B/L"}
                onChange={e=>setNumber(e.target.value)}/></label>
            {type==="CT"&&shipment&&shipment.containers.length>0&&<label>اختيار حاوية مسجلة
              <select value="" onChange={e=>setNumber(e.target.value)}>
                <option value="">اختر من حاويات البوليصة</option>
                {shipment.containers.map(c=><option key={c.id} value={c.number}>{c.number}</option>)}
              </select></label>}
            <label>شركة الشحن في ShipsGo <small>الاسم المطابق لقائمة ShipsGo، أو اتركه فارغاً لاستخدام OTHERS</small>
              <input dir="ltr" maxLength={80} placeholder="MSC" value={carrier}
                onChange={e=>setCarrier(e.target.value)}/></label>
            <button type="submit" className="btn primary" disabled={busy||disabled||!number.trim()}>
              حفظ رقم التتبع</button>
          </form>
        </div>
        {!configured&&<div className="im-info-strip">
          <ShipWheel size={19}/><p>خدمة التتبع المباشر غير مفعّلة على السيرفر بعد. يمكنك حفظ أرقام التتبع، لكن لن تظهر معلومات البحر أو موقع الباخرة حتى يتم ضبط API Key.</p>
        </div>}
        {references.length===0?<div className="im-logistics-empty">لم تُضف مراجع تتبع لهذه البوليصة بعد.</div>:<>
          <div className="im-logistics-tabs" role="tablist" aria-label="مراجع التتبع">
            {references.map(r=><button key={r.id} type="button" role="tab"
              aria-selected={r.id===selectedId} className={"im-logistics-tab "+(r.id===selectedId?"active":"")}
              onClick={()=>setSelectedId(r.id)}>
              <span dir="ltr">{r.referenceNumber}</span>
              <small>{r.referenceType==="CT"?"حاوية":"بوليصة"} · {r.lastSyncedAtUtc?"بيانات محفوظة":"لم تتم المزامنة"}</small>
            </button>)}
          </div>
          {current&&<div className="im-track-result">
            <div className="im-logistics-details-toolbar">
              <span>آخر نتيجة معتمدة من المزوّد</span>
              <button type="button" className="btn primary" disabled={!configured||busy||disabled}
                onClick={()=>void refresh()}><RefreshCw size={16}/>{busy?"جارٍ الاستعلام...":"تحديث من شركة الشحن"}</button>
            </div>
            {current.lastErrorCode&&<p className="im-track-warning">آخر محاولة لم تنجح ({current.lastErrorCode}). تبقى آخر بيانات محفوظة متاحة.</p>}
            <p className="im-track-source">آخر مزامنة: {date(current.lastSyncedAtUtc)}. حالة التتبع والموقع ليست بديلاً عن وثائق الشحن الرسمية.</p>
            {etaElapsed&&<p className="im-track-warning">تجاوز موعد الوصول المتوقع ETA ولم يؤكد مزوّد التتبع الوصول الفعلي. راجع شركة الشحن؛ قد تكون بيانات المزوّد متأخرة.</p>}
            {snapshot?<><div className="im-logistics-meta">
              <div><small>الحالة</small><strong>{statusLabel(snapshot.status)}</strong></div>
              <div><small>شركة الشحن</small><strong>{snapshot.carrierName||snapshot.carrierCode||current.carrierCode||"غير متوفرة"}</strong></div>
              <div><small>الباخرة</small><strong>{snapshot.vessel||"غير متوفرة"}</strong></div>
              <div><small>الرحلة</small><strong dir="ltr">{snapshot.voyage||"غير متوفرة"}</strong></div>
              <div><small>ETD</small><strong>{date(snapshot.etd)}</strong></div>
              <div><small>ETA المحدّثة</small><strong>{date(snapshot.eta)}</strong></div>
              <div><small>الوصول الفعلي</small><strong>{date(snapshot.actualArrival)}</strong></div>
              <div><small>تحديث الموقع</small><strong>{date(snapshot.positionUpdatedAt)}</strong></div>
            </div>
            <div className="im-track-map">
              <div><MapPin size={19}/><strong>موقع الباخرة</strong></div>
              {mapsLink?<><p dir="ltr">{position?.lat.toFixed(5)}, {position?.lng.toFixed(5)}</p>
                {embedMap&&<iframe className="im-track-map-frame" title="موقع الباخرة وفق بيانات التتبع"
                  loading="lazy" referrerPolicy="no-referrer" src={embedMap}/>}
                <a href={mapsLink} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
                  <ExternalLink size={16}/> عرض الموقع على الخريطة</a></>:
                <p>المزوّد لم يُرسل إحداثيات حالية لهذه الباخرة.</p>}
            </div>
            <div className="im-logistics-subhead"><div><Anchor size={19}/><strong>سجل أحداث الرحلة</strong></div></div>
            {snapshot.events.length===0?<div className="im-logistics-empty">لا توجد أحداث مُعادة من المزوّد.</div>:
              <div className="im-track-events">
                {snapshot.events.map((event,index)=><div key={index} className="im-track-event">
                  <span className="im-track-dot"/>
                  <div><strong>{event.description||event.eventCode}</strong>
                    <p>{[event.location,event.containerNumber,event.vessel,event.voyage].filter(Boolean).join(" · ")}</p>
                  </div>
                  <small>{date(event.date)} · {event.actual?"فعلي":"متوقع"}</small>
                </div>)}
              </div>}
            </>:<div className="im-logistics-empty">لم تُجلب بيانات من المزوّد بعد. اختر تحديث من شركة الشحن عند تفعيل الخدمة.</div>}
          </div>}
        </>}
      </>}
  </section>;
}
