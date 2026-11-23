// Run after Windows/Rider editing. UTF-8 BOM breaks #! for Linux executable
// scripts; CRLF can break sh options and Dockerfile backslash continuations.
// This intentionally touches ONLY the release bundle and the two VPS scripts.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const files=[
  '.dockerignore','.gitattributes',
  'deploy/import/.env.example','deploy/import/compose.yml',
  'deploy/import/Dockerfile.api','deploy/import/Dockerfile.web',
  'deploy/import/Dockerfile.backup',
  'deploy/import/api-entrypoint.sh','deploy/import/backup-entrypoint.sh',
  'deploy/import/release-preflight.sh','deploy/import/smoke-public.sh',
  'deploy/import/validate-compose-structure.sh',
  'scripts/vps/backup-import.sh','scripts/vps/restore-rehearsal.sh'
];
for(const file of files){
  if(!existsSync(file))throw Error('Missing expected release file: '+file);
  const before=readFileSync(file,'utf8');
  const normalized=before.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  if(before!==normalized){writeFileSync(file,normalized,'utf8');console.log('NORMALIZED '+file)}
}
console.log('WATHIQA_RELEASE_TEXT_ENCODING=PASS');
