/**
 * Offline Wikidata (CC0) Arabic port-name snapshot generator.
 *
 * At development time only: download a SPARQL JSON response for P1937
 * (UN/LOCODE) + Arabic label and run:
 *   node scripts/build-arabic-port-index.mjs .local/wikidata-*.json
 *
 * Do not download/copy the UNECE UN/LOCODE bulk directory into this commercial
 * project: its redistribution terms differ from Wikidata's CC0 data.
 *
 * No runtime requests to Wikidata. The generated snapshot is committed with
 * its source and can be regenerated independently.
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.dirname(fileURLToPath(import.meta.url));
const input=process.argv.slice(2);
if(!input.length){
  process.stderr.write("Usage: node scripts/build-arabic-port-index.mjs INPUT.json [...]\n");
  process.exit(2);
}
const candidates=new Map();
let rows=0;
for(const filename of input){
  const json=JSON.parse(fs.readFileSync(filename,"utf8"));
  const records=json?.results?.bindings;
  if(!Array.isArray(records))throw new Error("Expected Wikidata SPARQL JSON bindings in "+filename);
  rows+=records.length;
  for(const item of records){
    const code=String(item?.locode?.value||"").trim().toUpperCase();
    const label=String(item?.ar?.value||"").trim();
    // Standard five-character UN/LOCODE. A single ambiguous code is dropped.
    if(!/^[A-Z]{2}[A-Z0-9]{3}$/.test(code)||
       !/[\u0621-\u064A]/u.test(label)||
       label.length>90||/[\x00-\x1F<>]/.test(label))continue;
    let labels=candidates.get(code);
    if(!labels){labels=new Set();candidates.set(code,labels);}
    labels.add(label);
  }
}
const entries=[...candidates.entries()].filter(([,set])=>set.size===1)
  .map(([code,labels])=>[code,[...labels][0]])
  .sort((a,b)=>a[0].localeCompare(b[0],"en"));
const result=Object.fromEntries(entries);
const output=path.resolve(root,"../src/lib/portArabicWikidata.json");
fs.writeFileSync(output,JSON.stringify(result,null,2)+"\n","utf8");
console.log("WIKIDATA_PORT_INDEX rows="+rows+" unique="+entries.length+
  " ambiguous_omitted="+([ ...candidates.values()].filter(set=>set.size>1).length));
console.log("WIKIDATA_PORT_INDEX OUTPUT="+output);
