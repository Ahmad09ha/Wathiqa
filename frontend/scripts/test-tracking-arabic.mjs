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
console.log("TRACKING_ARABIC_TESTS_PASS");
