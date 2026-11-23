// Visible user-facing ShipsGo labels. Provider codes remain unchanged in the
// API/database. Port aliases are curated; unknown proper nouns are preserved.
const shipmentStatuses:Record<string,string>={
  PLANNED:"مخطط", IN_TRANSIT:"قيد الإبحار", ARRIVED:"وصلت الباخرة",
  DELIVERED:"تم التسليم", COMPLETED:"مكتملة", PENDING:"بانتظار المعلومات",
  NEW:"جديدة — بانتظار معالجة مزوّد التتبع",
  INPROGRESS:"شركة الشحن لم تُصدر بيانات بعد",
  BOOKED:"محجوزة", LOADED:"تم تحميل الحاوية",
  SAILING:"في البحر", DISCHARGED:"تم تفريغ الحاوية",
  UNTRACKED:"لا تتوفر معلومات تتبع",
  GTIN:"دخول بوابة الميناء", GTOT:"خروج بوابة الميناء",
  EMSH:"تسليم الحاوية الفارغة للشاحن", EMRT:"إعادة الحاوية الفارغة",
  GATE_IN:"دخول بوابة الميناء",GATE_OUT:"خروج بوابة الميناء",
  EMPTY_RETURN:"إعادة الحاوية الفارغة",EMPTY_SHIPPER:"الحاوية الفارغة لدى الشاحن",
  UNKNOWN:"غير معروفة",NOT_ASSIGNED:"لم تُخصّص بعد",
};
const eventNames:Record<string,string>={
  EMSH:"تسليم الحاوية الفارغة للشاحن",
  GTIN:"دخول الحاوية إلى الميناء",
  LOAD:"تحميل الحاوية على الباخرة",
  DEPA:"مغادرة الباخرة",
  ARRV:"وصول الباخرة",
  DISC:"تفريغ الحاوية من الباخرة",
  GTOT:"خروج الحاوية من الميناء",
  EMRT:"إعادة الحاوية الفارغة",
};
const portAliases:Record<string,string>={
  ZHAPU:"تشابو", CNZPU:"تشابو",
  ISKENDERUN:"إسكندرون", TRISK:"إسكندرون",
  SHANGHAI:"شنغهاي", CNSHA:"شنغهاي",
  NINGBO:"نينغبو", CNNGB:"نينغبو",
  SINGAPORE:"سنغافورة", SGSIN:"سنغافورة",
  BARCELONA:"برشلونة", ESBCN:"برشلونة",
  CASABLANCA:"الدار البيضاء", MACAS:"الدار البيضاء",
  MERSIN:"مرسين", TRMER:"مرسين",
  JEBEL_ALI:"جبل علي", AEJEA:"جبل علي",
  PORT_SAID:"بورسعيد", EGPSD:"بورسعيد",
  JEDDAH:"جدة", SAJED:"جدة",
  IZMIT:"إزميت", TRIZT:"إزميت",
  AMBARLI:"أمبرلي", TRAMB:"أمبرلي",
  LATTAKIA:"اللاذقية", SYLTK:"اللاذقية",
};
export const arabicShipmentStatus=(code:string|null|undefined)=>{
  const key=(code||"").trim().toUpperCase().replaceAll(" ","_");
  return shipmentStatuses[key]||code||"غير معروف";
};
export const arabicEvent=(code:string|null|undefined,description?:string|null)=>{
  const key=(code||"").trim().toUpperCase();
  if(eventNames[key])return eventNames[key];
  // A legacy provider may only supply a description.
  const text=(description||"").trim().toUpperCase().replaceAll(" ","_");
  if(shipmentStatuses[text])return shipmentStatuses[text];
  return code?"حدث بحري غير مصنّف ("+code+")":"حدث بحري غير مصنّف";
};
export const arabicPort=(name?:string|null,code?:string|null)=>{
  const key=(name||"").trim().toUpperCase().replace(/[\s-]+/g,"_");
  return portAliases[(code||"").trim().toUpperCase()]||
    portAliases[key]||name||"غير متوفر";
};
export const arabicMapPhase=(phase:string)=>{
  if(phase==="PAST")return "جزء مكتمل من الرحلة";
  if(phase==="CURRENT")return "الجزء الحالي من الرحلة";
  return "المسار المتوقع";
};
export const arabicContainerType=(code:string|null|undefined)=>{
  const key=(code||"").trim().toUpperCase();
  const types:Record<string,string>={
    GP:"حاوية عادية",DC:"حاوية جافة",HC:"حاوية مرتفعة",
    RF:"حاوية مبردة",RE:"حاوية مبردة",OT:"مفتوحة السقف",
    FR:"مسطحة",TK:"حاوية صهريج",
  };
  return types[key]||code||"نوع غير محدد";
};
