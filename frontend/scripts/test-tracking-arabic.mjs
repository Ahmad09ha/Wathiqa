// Offline Arabic UI mapping regression tests. No provider API calls or credits.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=fs.readFileSync(new URL("../src/lib/trackingArabic.ts",import.meta.url),"utf8");
const overridesSource=fs.readFileSync(
  new URL("../src/lib/portArabicOverrides.ts",import.meta.url),"utf8");
const overridesOutput=ts.transpileModule(overridesSource,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
});
const overrides={};
vm.runInNewContext(overridesOutput.outputText,{exports:overrides});
const wikidata=JSON.parse(fs.readFileSync(
  new URL("../src/lib/portArabicWikidata.json",import.meta.url),"utf8"));
const output=ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  reportDiagnostics:true
});
if(output.diagnostics?.length)throw new Error("Arabic translation TypeScript compile failed");
const exports={};
vm.runInNewContext(output.outputText,{exports,require:(id)=>{
  if(id==="./portArabicWikidata.json")return {default:wikidata};
  if(id==="./portArabicOverrides")return overrides;
  throw new Error("Unexpected module import "+id);
}}, {filename:"trackingArabic.compiled.cjs"});
const check=(value,expected,context)=>{
  if(value!==expected)throw new Error(context+": "+String(value)+" !== "+String(expected));
  process.stdout.write("PASS "+context+"\n");
};
check(exports.arabicShipmentStatus("SAILING"),"في البحر","ocean shipment status");
check(exports.arabicShipmentStatus("NEW"),"جديدة — بانتظار معالجة مزوّد التتبع",
  "unprocessed shipment explanation");
check(exports.arabicEvent("DEPA","Departed"),"مغادرة الباخرة","movement event");
check(exports.arabicEvent("DISC","Discharged"),"تفريغ الحاوية من الباخرة",
  "discharge event");
check(exports.arabicPort("ZHAPU","CNZPU"),"تشابو","loading port Zhapu");
check(exports.arabicPort("ISKENDERUN","TRISK"),"إسكندرون",
  "discharge port Iskenderun");
check(exports.arabicPort("SHANGHAI","CNSHA"),"شنغهاي",
  "known Chinese port");
check(exports.arabicPort("ALEXANDRIA"),"الإسكندرية",
  "Alexandria in an ocean event must be translated without a location code");
check(exports.arabicPort("ALEXANDRIA","EGALY"),"الإسكندرية",
  "Alexandria UNLOCODE resolves in Arabic");
check(exports.arabicPort("PORT OF ALEXANDRIA"),"ميناء الإسكندرية",
  "Alexandria provider name variant");
check(exports.arabicContainerType("HC"),"حاوية مرتفعة","container type");
check(exports.arabicMapPhase("CURRENT"),"الجزء الحالي من الرحلة",
  "map legend");
check(exports.localizePort("NHAVA SHEVA","INNSA").confidence,
  "verified","verified code has priority over phonetic fallback");
check(exports.localizePort("SOME REAL PORT NOT YET CURATED").confidence,
  "approximate","unlisted port gets explicitly approximate Arabic display");
check(exports.localizePort("SOME REAL PORT NOT YET CURATED").official,
  "SOME REAL PORT NOT YET CURATED","unknown port keeps official original");
check(exports.localizePort("SHANGHAI","USXXX").confidence,
  "approximate","known city names are not misapplied to a conflicting country");
check(exports.localizePort("SINGAPORE","SGSIN").confidence,
  "verified","Wikidata UNLOCODE lookup works offline");
check(Object.keys(wikidata).length>=900,true,
  "offline Wikidata snapshot covers at least 900 UNLOCODE entries");
const trackingPanel=fs.readFileSync(
  new URL("../src/components/ImportTrackingPanel.tsx",import.meta.url),"utf8");
check(trackingPanel.includes("عرض على ShipsGo"),true,
  "only provider map action label remains");
check(trackingPanel.includes("عرض الموقع على الخريطة")||
  trackingPanel.includes("فتح الموقع على خريطة خارجية")||
  trackingPanel.includes("mapsLink"),false,
  "external OpenStreetMap location action removed");
const mapSource=fs.readFileSync(
  new URL("../src/components/TrackingVoyageMap.tsx",import.meta.url),"utf8");
check(mapSource.includes("attributionControl:false"),true,
  "Leaflet attribution overlay removed from the map artwork");
check(mapSource.includes("www.openstreetmap.org/copyright"),true,
  "OSM copyright credit retained below the map");

const groupedSource=fs.readFileSync(
  new URL("../src/lib/groupOceanEvents.ts",import.meta.url),"utf8");
const groupedOutput=ts.transpileModule(groupedSource,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
});
const grouping={};
vm.runInNewContext(groupedOutput.outputText,{exports:grouping});
const event=(overrides={})=>({
  containerNumber:"CMAU7833791",description:"Arrived",eventCode:"ARRV",
  location:"ISKENDERUN",date:"2026-12-14T12:00:00+03:00",
  actual:false,vessel:"CMA CGM NANSHA",voyage:"NCL0BON19",
  ...overrides,
});
const events=[
  event(),
  event({containerNumber:"TCKU6259957",date:"2026-12-14T09:00:00Z"}),
  event({containerNumber:"CMAU7833791"}), // duplicate per container
  event({eventCode:"DISC",description:"Discharged"}),
  event({eventCode:"DISC",description:"Discharged",containerNumber:"TCKU6259957"}),
  event({actual:true}),
  event({vessel:"OTHER VESSEL"}),
];
const merged=grouping.groupOceanEvents(events);
check(merged.length,4,"7 container movement records are 4 distinct timeline activities");
check(merged[0].containerNumbers.join(","),"CMAU7833791,TCKU6259957",
  "two container IDs kept in one arrival movement with timezone-normalized same instant");
check(merged[1].eventCode,"DISC",
  "arrival and discharge remain separate even at the same place/time");
check(merged[1].containerNumbers.length,2,
  "discharge event retains both containers");
check(merged[2].actual,true,
  "estimated and actual events must never merge");
check(merged[3].vessel,"OTHER VESSEL",
  "different vessels must never merge");
check(events.length,7,"original provider movements are not modified by UI grouping");
console.log("TRACKING_ARABIC_TESTS_PASS");
