import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
test('Pages copies every locally imported browser module',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const imports=[...app.matchAll(/from ['"]\.\/([^'"]+)['"]/g)].map(m=>m[1]);
 for(const name of ['app.js',...imports]){
  await access(new URL('../'+name,import.meta.url));
  assert.ok(workflow.includes(name),`Deployment omits ${name}`);
 }
});
