import {getSchema} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {TableKit} from '@tiptap/extension-table';
const templates=await (await fetch('http://127.0.0.1:5088/api/templates')).json();
const template=await (await fetch('http://127.0.0.1:5088/api/templates/'+templates[0].id)).json();
const content=JSON.parse(template.contentJson);
console.log('JSON nodes:',content.content?.length,'first:',JSON.stringify(content.content?.[0]).slice(0,220));
const schema=getSchema([StarterKit,TableKit]);
console.log('Schema nodes:',Object.keys(schema.nodes).join(','));
try{
 const node=schema.nodeFromJSON(content);
 console.log('Parsed text len:',node.textContent.length,'has price term:',node.textContent.includes('PRICE TERM'));
 console.log('Parsed nodes:',node.childCount,node.firstChild?.type?.name);
}catch(e){console.error('INVALID CONTENT:',e.message);process.exitCode=1}
