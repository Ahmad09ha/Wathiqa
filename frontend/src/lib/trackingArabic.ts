// Visible user-facing ShipsGo labels. Provider codes remain unchanged in the
// API/database. Port names resolve offline: country-qualified UN/LOCODE first,
// then CC0 Wikidata's Arabic labels, then curated name aliases. Unknown Latin
// words receive APPROXIMATE phonetic rendering with the original preserved.
import wikidataPorts from "./portArabicWikidata.json";
import {portArabicByCode, commonPortArabic} from "./portArabicOverrides";
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
type LocalizedPort = {
  arabic:string;
  official:string;
  confidence:"verified"|"approximate"|"unavailable";
};

const normalizePortName=(name:string)=>name.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/[^A-Z0-9]+/g,"_").replace(/^_+|_+$/g,"");

const englishWords:Record<string,string>={
  PORT:"ميناء",HARBOUR:"ميناء",HARBOR:"ميناء",
  TERMINAL:"محطة",CONTAINER:"حاويات",CONTAINERS:"حاويات",
  NORTH:"الشمالي",SOUTH:"الجنوبي",EAST:"الشرقي",WEST:"الغربي",
  INTERNATIONAL:"الدولي",NEW:"الجديد",OLD:"القديم",
};

const letterPairs:Record<string,string>={
  TCH:"تش",SCH:"ش",SH:"ش",CH:"تش",KH:"خ",GH:"غ",
  PH:"ف",TH:"ث",DH:"ذ",CK:"ك",QU:"كو",NG:"نغ",
  EE:"ي",OO:"و",OU:"و",AY:"اي",AI:"اي",EI:"اي",
  AU:"او",OI:"وي",EA:"ي",IE:"ي",IA:"يا",IO:"يو",
};
const latinLetters:Record<string,string>={
  A:"ا",B:"ب",C:"ك",D:"د",E:"ي",F:"ف",G:"غ",
  H:"ه",I:"ي",J:"ج",K:"ك",L:"ل",M:"م",N:"ن",
  O:"و",P:"ب",Q:"ق",R:"ر",S:"س",T:"ت",U:"و",
  V:"ف",W:"و",X:"كس",Y:"ي",Z:"ز",
};

/** Approximate display only, never used as an authoritative port identity. */
export const transliteratePortName=(input:string):string=>{
  const ascii=input.normalize("NFKD").replace(/[\u0300-\u036f]/g,"");
  return ascii.split(/([^A-Za-z0-9]+)/).map(token=>{
    if(!/^[A-Za-z]+$/.test(token))return token;
    const word=token.toUpperCase();
    if(englishWords[word])return englishWords[word];
    let arabic="";
    for(let i=0;i<word.length;){
      const tri=word.slice(i,i+3),pair=word.slice(i,i+2);
      if(letterPairs[tri]){arabic+=letterPairs[tri];i+=3;}
      else if(letterPairs[pair]){arabic+=letterPairs[pair];i+=2;}
      else{arabic+=latinLetters[word[i]]||word[i];i++;}
    }
    return arabic;
  }).join("").replace(/\s+/g," ").trim();
};

/**
 * Verified means a code-matched Arabic name or human-reviewed/country-safe
 * alias. When unknown, show an explicitly approximate transliteration; always
 * keep the official name available for customer confirmation and export.
 */
export const localizePort=(name?:string|null,code?:string|null):LocalizedPort=>{
  const official=(name||"").trim();
  const portCode=(code||"").trim().toUpperCase();
  if(portCode&&Object.hasOwn(portArabicByCode,portCode))
    return {arabic:portArabicByCode[portCode],official,confidence:"verified"};
  if(portCode&&Object.hasOwn(wikidataPorts,portCode))
    return {arabic:(wikidataPorts as Record<string,string>)[portCode],official,confidence:"verified"};
  if(official&&/[\u0621-\u064A]/.test(official))
    return {arabic:official,official,confidence:"verified"};
  if(official){
    const alias=commonPortArabic[normalizePortName(official)];
    // If the carrier supplied an UN/LOCODE, verify the country prefix before
    // using a name alias. Two places can have identical names.
    if(alias&&(!portCode||!alias.country||portCode.startsWith(alias.country)))
      return {arabic:alias.ar,official,confidence:"verified"};
    const approximate=transliteratePortName(official);
    if(/[\u0621-\u064A]/.test(approximate))
      return {arabic:approximate,official,confidence:"approximate"};
    return {arabic:official,official,confidence:"approximate"};
  }
  return {arabic:"غير متوفر",official,confidence:"unavailable"};
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
export const arabicPort=(name?:string|null,code?:string|null)=>
  localizePort(name,code).arabic;
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
