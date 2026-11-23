// Offline Arabic UI mapping regression tests. No provider API calls or credits.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=fs.readFileSync(new URL("../src/lib/trackingArabic.ts",import.meta.url),"utf8");
const output=ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  reportDiagnostics:true
});
if(output.diagnostics?.length)throw new Error("Arabic translation TypeScript compile failed");
const exports={};
vm.runInNewContext(output.outputText,{exports}, {filename:"trackingArabic.compiled.cjs"});
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
check(exports.arabicPort("SOME REAL PORT NOT YET CURATED"),
  "SOME REAL PORT NOT YET CURATED","unknown proper name is not mistranslated");
console.log("TRACKING_ARABIC_TESTS_PASS");
