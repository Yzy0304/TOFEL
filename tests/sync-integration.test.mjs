import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('both server and Pages ship all sync modules and allow configured cloud origin',async()=>{
 const server=await read('server.mjs'),workflow=await read('.github/workflows/pages.yml');
 for(const module of ['sync-core.js','sync-client.js','sync-auth.js','sync-ui.js','sync-config.js']){assert.ok(server.includes(module),module);assert.ok(workflow.includes(module),module);}
 assert.ok(server.includes('https://yrdxfkjjbttdkvnshpsq.supabase.co'));
});
test('all progress mutations are routed through durable event logging',async()=>{
 const app=await read('app.js');
 assert.ok(app.includes("changeProgress('review'"));assert.ok(app.includes("changeProgress('assessment'"));assert.ok(app.includes("changeProgress('hint'"));assert.ok(app.includes("changeProgress('complete'"));assert.ok(app.includes('progressStore.addTime'));
 assert.ok(app.includes('progressStore.export()'));assert.ok(app.includes('progressStore.merge('));
 assert.ok(!app.includes('state=recordReview('));assert.ok(!app.includes('state=recordAssessment('));
});
