import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../core.js';
import {mergeDocuments,materialize} from '../sync-core.js';
import * as client from '../sync-client.js';
const ids=['email-001','email-002'];
const at=Date.parse('2026-10-20T03:00:00Z');
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
async function store(storage=memory()){const s=new client.ProgressStore(storage,ids);await s.initialize(createState(),at);return s;}
test('sync client exports store and synchronizer',()=>{assert.equal(typeof client.ProgressStore,'function');assert.equal(typeof client.synchronize,'function');});
test('new events survive reload and repeated timer saves do not multiply time',async()=>{
 const storage=memory(),s=await store(storage);s.record('review',{cardId:ids[0],rating:'good',transfer:false},at+1);s.addTime(3,at+2);s.addTime(2,at+3);
 const restored=await store(storage);assert.equal(restored.state.days['2026-10-20'].seconds,5);assert.equal(restored.state.days['2026-10-20'].attempts,1);
});
test('storage failure leaves the previous in-memory document untouched',async()=>{
 const storage=memory(),s=await store(storage),before=structuredClone(s.document);storage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>s.record('review',{cardId:ids[0],rating:'good',transfer:false},at+1));assert.deepEqual(s.document,before);
});
test('stale browser tab cannot overwrite a newer journal',async()=>{
 const storage=memory(),a=await store(storage),b=await store(storage);a.record('hint',{cardId:ids[0]},at+1);
 assert.throws(()=>b.record('hint',{cardId:ids[1]},at+2),/其他标签/);
});
test('bound records cannot be sent to a different account',async()=>{const s=await store();s.bindOwner('user-a');assert.throws(()=>s.bindOwner('user-b'),/账号/);});
test('CAS conflict retries and includes work created during upload',async()=>{
 const s=await store();s.bindOwner('user-a');s.record('review',{cardId:ids[0],rating:'good',transfer:false},at+1);
 const remote=await store();remote.record('review',{cardId:ids[1],rating:'again',transfer:false},at+2);
 let doc=remote.document,revision=1,calls=0;
 const transport={read:async()=>({document:doc,revision}),write:async(expected,candidate)=>{
  calls++;if(calls===1){revision++;return false;}assert.equal(expected,revision);doc=candidate;revision++;
  if(calls===2)s.record('hint',{cardId:ids[0]},at+3);return true;
 }};
 await client.synchronize(s,transport,()=>true);
 assert.equal(Object.keys(materialize(doc,ids).cards).length,2);assert.ok(doc.events.some(e=>e.type==='hint'));assert.equal(calls,3);
});
test('network failure preserves pending records',async()=>{const s=await store();s.bindOwner('user-a');s.record('hint',{cardId:ids[0]},at+1);const before=structuredClone(s.document);await assert.rejects(client.synchronize(s,{read:async()=>{throw Error('offline');}},()=>true));assert.deepEqual(s.document,before);});
test('logout during request cannot apply returned remote data',async()=>{const s=await store();let active=true;await assert.rejects(client.synchronize(s,{read:async()=>{active=false;return {document:s.document,revision:0};}},()=>active),/登录/);});
test('assessment submission retries use the attempt identity once',async()=>{
 const s=await store(),result={category:'correct',taskMatch:true,explanation:'正确',correctedAnswer:'hello',naturalAnswer:'',issues:[],tags:[]};
 const attempt={attemptId:'same_attempt',cardId:ids[0],mode:'recall',answer:'hello',independent:true,source:'reference',result};
 s.record('assessment',{attempt},at+1);s.record('assessment',{attempt},at+2);
 assert.equal(s.document.events.filter(e=>e.type==='assessment').length,1);
});
test('activity at migration instant is retained as new activity',async()=>{
 const initial=(await import('../core.js')).recordReview(createState(),ids[0],'good',at-1),s=new client.ProgressStore(memory(),ids);await s.initialize(initial,at);
 s.record('review',{cardId:ids[1],rating:'good',transfer:false},at);assert.equal(s.state.days['2026-10-20'].attempts,2);
});
test('exported event backup can be reimported repeatedly without new counts',async()=>{
 const s=await store();s.record('review',{cardId:ids[0],rating:'good',transfer:false},at+1);s.addTime(5,at+2);
 const exported=JSON.parse(JSON.stringify(s.export())),other=await store();other.merge(exported.document);other.merge(exported.document);
 assert.equal(other.state.days['2026-10-20'].attempts,1);assert.equal(other.state.days['2026-10-20'].seconds,5);
 assert.ok(other.storage.getItem('toefl-progress-before-merge-v1'));
});
test('assessment before feedback hint retains credit with a fixed millisecond clock',async()=>{
 const s=await store(),result={category:'correct',taskMatch:true,explanation:'正确',correctedAnswer:'hello',naturalAnswer:'',issues:[],tags:[]};
 s.record('assessment',{attempt:{attemptId:'zzzz',cardId:ids[0],mode:'recall',answer:'hello',independent:true,source:'reference',result}},at+1);
 s.record('hint',{cardId:ids[0]},at+1);
 assert.ok(s.document.events[1].at>s.document.events[0].at);
 assert.equal(s.state.assessmentHistory[0].usedForMastery,true);assert.equal(s.state.cards[ids[0]].assessment.attempts,1);
});
test('completion after a review retains completion with a fixed clock',async()=>{
 const s=await store();s.record('review',{cardId:ids[0],rating:'good',transfer:false},at+1);s.record('complete',{},at+1);
 assert.ok(s.document.events[1].at>s.document.events[0].at);assert.equal(s.state.days['2026-10-20'].completed,true);
});
