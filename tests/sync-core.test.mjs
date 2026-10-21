import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,recordReview,recordAssessment} from '../core.js';
import * as sync from '../sync-core.js';
const ids=['email-001','email-002'];
const t=Date.parse('2026-10-20T03:00:00Z');
const event=(id,type,data={},at=t)=>({id,type,at,...data});
const correct={category:'correct',taskMatch:true,explanation:'正确',correctedAnswer:'hello',naturalAnswer:'',issues:[],tags:[]};
const attempt=id=>({attemptId:id,cardId:ids[0],mode:'recall',answer:'hello',independent:true,source:'model',result:correct});
test('sync exports document primitives',()=>{assert.equal(typeof sync.createDocument,'function');});
test('union is idempotent, commutative and retains offline work',async()=>{
 const a=await sync.createDocument(createState(),ids,t),b=structuredClone(a);
 a.events.push(event('review_a','review',{cardId:ids[0],rating:'good',transfer:false}));
 b.events.push(event('review_b','review',{cardId:ids[1],rating:'again',transfer:false},t+10));
 const merged=sync.mergeDocuments(a,b,ids);
 assert.deepEqual(merged,sync.mergeDocuments(b,a,ids));
 assert.deepEqual(merged,sync.mergeDocuments(merged,a,ids));
 const state=sync.materialize(merged,ids);assert.equal(Object.keys(state.cards).length,2);assert.equal(state.days['2026-10-20'].attempts,2);
});
test('two devices cannot count two independent successes on same day',async()=>{
 const d=await sync.createDocument(createState(),ids,t);
 d.events.push(event('a','assessment',{attempt:attempt('one')},t),event('b','assessment',{attempt:attempt('two')},t+100));
 const s=sync.materialize(d,ids);assert.equal(s.cards[ids[0]].assessment.attempts,1);assert.equal(s.assessmentHistory[1].usedForMastery,false);
});
test('earlier hint on another device disqualifies later assessment',async()=>{
 const d=await sync.createDocument(createState(),ids,t);
 d.events.push(event('h','hint',{cardId:ids[0]},t),event('a','assessment',{attempt:attempt('one')},t+10));
 assert.equal(sync.materialize(d,ids).assessmentHistory[0].usedForMastery,false);
});
test('day timers are merged by per-device maximum, not duplicated',async()=>{
 const a=await sync.createDocument(createState(),ids,t),b=structuredClone(a);
 a.events.push(event('timer_a','time',{seconds:20}));b.events.push(event('timer_a','time',{seconds:30}),event('timer_b','time',{seconds:15}));
 assert.equal(sync.materialize(sync.mergeDocuments(a,b,ids),ids).days['2026-10-20'].seconds,45);
});
test('legacy migration preserves records and new activity adds to them',async()=>{
 const old=recordReview(createState(),ids[0],'good',t-1000);
 const d=await sync.createDocument(old,ids,t);
 d.events.push(event('new','review',{cardId:ids[1],rating:'good',transfer:false},t+10));
 assert.equal(sync.materialize(d,ids).days['2026-10-20'].attempts,2);
 const other=await sync.createDocument(old,ids,t+20);
 const merged=sync.mergeDocuments(d,other,ids);assert.equal(merged.bases.length,1);assert.equal(sync.materialize(merged,ids).days['2026-10-20'].attempts,2);
});
test('legacy overlap is conservative and originals retained',async()=>{
 const old=recordReview(createState(),ids[0],'good',t-100);
 const newer=recordReview(old,ids[1],'good',t-50);
 const a=await sync.createDocument(old,ids,t),b=await sync.createDocument(newer,ids,t+10);
 const merged=sync.mergeDocuments(a,b,ids);assert.equal(merged.bases.length,2);assert.equal(sync.materialize(merged,ids).days['2026-10-20'].attempts,2);
});
test('invalid records and conflicting event identities are rejected',async()=>{
 const a=await sync.createDocument(createState(),ids,t),b=structuredClone(a);
 a.events.push(event('a','review',{cardId:ids[0],rating:'good',transfer:false}));
 b.events.push(event('a','review',{cardId:ids[1],rating:'good',transfer:false}));
 assert.throws(()=>sync.mergeDocuments(a,b,ids),/冲突/);
 b.events=[event('b','review',{cardId:'unknown',rating:'good',transfer:false})];assert.throws(()=>sync.materialize(b,ids));
});
test('same-day repeated self review cannot invent stable recall',async()=>{
 const d=await sync.createDocument(createState(),ids,t);
 d.events.push(event('a','review',{cardId:ids[0],rating:'good',transfer:false},t),event('b','review',{cardId:ids[0],rating:'good',transfer:false},t+10));
 const s=sync.materialize(d,ids);assert.equal(s.cards[ids[0]].correctDates.length,1);
});
test('later legacy import does not revert an explicit settings change',async()=>{
 const d=await sync.createDocument(createState(),ids,t);
 d.events.push(event('settings','settings',{settings:{newLimit:4}},t+1));
 const old=recordReview(createState(),ids[0],'good',t-1),b=await sync.createDocument(old,ids,t+2);
 assert.equal(sync.materialize(sync.mergeDocuments(d,b,ids),ids).settings.newLimit,4);
});
test('an empty new device does not reset the migrated device settings',async()=>{
 const state=recordReview(createState(),ids[0],'good',t-1);state.settings.newLimit=4;
 const a=await sync.createDocument(state,ids,t),b=await sync.createDocument(createState(),ids,t+10);
 assert.equal(sync.materialize(sync.mergeDocuments(a,b,ids),ids).settings.newLimit,4);
});
