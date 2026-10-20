import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,recordReview,progressCounts,validateImport,dayKey} from '../core.js';
import * as core from '../core.js';
let api={};try{api=await import('../assessment.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const now=Date.parse('2026-10-19T04:00:00Z'),DAY=86400000;
const card={id:'e1',module:'email',domain:'教育',phrase:'look forward to hearing from you',meaning:'期待收到你的回复',example:'I look forward to hearing from you.'};
const answer='I look forward to hear from you.';
const result={category:'grammar_error',taskMatch:true,explanation:'to 在这个搭配中是介词，后接动名词。',correctedAnswer:'I look forward to hearing from you.',naturalAnswer:'',issues:[{start:18,end:22,original:'hear',replacement:'hearing',explanation:'改用动名词。',kind:'grammar'}],tags:['verb_form']};
const good={category:'correct',taskMatch:true,explanation:'语法和搭配正确，含义符合要求。',correctedAnswer:card.example,naturalAnswer:'',issues:[],tags:[]};
const input=(id='a1',resultOverride=result)=>({attemptId:id,cardId:card.id,mode:'recall',answer,independent:true,result:resultOverride,source:'model'});
test('assessment module exports its contract',()=>{for(const name of ['validateAssessment','assessmentRequest','referenceAssessment','assessmentRating'])assert.equal(typeof api[name],'function',name);assert.equal(typeof core.recordAssessment,'function');});
test('grammar feedback validates exact error spans and rejects false edits',()=>{
 assert.deepEqual(api.validateAssessment(result,answer),result);
 for(const changed of [{category:'maybe'},{taskMatch:'true'},{issues:[{...result.issues[0],start:0}]},{issues:[]},{explanation:''},{category:'correct'}])assert.throws(()=>api.validateAssessment({...result,...changed},answer));
 assert.throws(()=>api.validateAssessment({...result,unknown:true},answer));
});
test('reference match is explicit and empty or different answers are not silently accepted',()=>{
 const exact=api.referenceAssessment(card,'recall','LOOK FORWARD TO HEARING FROM YOU!');assert.equal(exact.category,'correct');
 assert.equal(api.referenceAssessment(card,'recall',answer),null);assert.equal(api.referenceAssessment(card,'recall',''),null);
 assert.throws(()=>api.assessmentRequest(card,'recall','   '));
 assert.equal(api.assessmentRating({...good,taskMatch:false}),'again');
 assert.equal(api.assessmentRating({...good,category:'unnatural'}),'hard');
});
test('cloze request supplies the reconstructed sentence and repeat forbids paraphrase',()=>{
 const request=api.assessmentRequest(card,'cloze','look forward to hearing from you');
 assert.ok(request.context.includes('I look forward to hearing from you.'));
 const repeat=api.assessmentRequest({...card,module:'repeat'},'listen','I am waiting for your reply.');
 assert.match(repeat.instructions,/exact|verbatim/i);assert.ok(repeat.context.includes(card.example));
});
test('first independent grammar error updates due state; same-day correction cannot create mastery',()=>{
 let state=core.recordAssessment(createState(),input(),now);assert.equal(state.cards.e1.weak,true);assert.equal(state.cards.e1.assessment.grammarErrors,1);
 const corrected=core.recordAssessment(state,{...input('a2',good),answer:card.example},now+1000);
 assert.equal(corrected.assessmentHistory.at(-1).usedForMastery,false);assert.equal(corrected.cards.e1.assessment.correct,0);
 assert.deepEqual(corrected.days,state.days);assert.deepEqual(core.recordAssessment(corrected,input('a2',good),now+2000),corrected);
});
test('two independent correct dates establish verified mastery; later error resets it',()=>{
 let state=core.recordAssessment(createState(),{...input('a1',good),answer:card.example},now);
 assert.equal(progressCounts(state,[card],now).assessment.stable,0);
 state=core.recordAssessment(state,{...input('a2',good),answer:card.example},now+DAY);
 assert.equal(progressCounts(state,[card],now+DAY).assessment.stable,1);
 state=core.recordAssessment(state,input('a3'),now+2*DAY);
 assert.equal(progressCounts(state,[card],now+2*DAY).assessment.stable,0);
});
test('hints and previous manual practice do not count as independent evidence',()=>{
 const hinted=core.recordAssessment(createState(),{...input(),independent:false},now);assert.deepEqual(hinted.cards,{});assert.equal(hinted.assessmentHistory[0].usedForMastery,false);
 const manual=recordReview(createState(),'e1','good',now);
 const checked=core.recordAssessment(manual,{...input('a2',good),answer:card.example},now+1000);assert.equal(checked.cards.e1.assessment,undefined);
});
test('meaning mismatch prevents mastery even when language is correct',()=>{
 const state=core.recordAssessment(createState(),{...input('a1',{...good,taskMatch:false}),answer:card.example},now);
 assert.equal(state.cards.e1.assessment.taskErrors,1);assert.equal(state.cards.e1.assessment.correct,0);assert.equal(state.cards.e1.weak,true);
});
test('assessment backup roundtrips and rejects unknown cards, malformed ranges and false counters',()=>{
 const state=core.recordAssessment(createState(),input(),now);
 assert.deepEqual(validateImport(state,['e1']),state);
 const changed=structuredClone(state);changed.assessmentHistory[0].result.issues[0].start=99;assert.throws(()=>validateImport(changed,['e1']));
 const unknown=structuredClone(state);unknown.assessmentHistory[0].cardId='unknown';assert.throws(()=>validateImport(unknown,['e1']));
 const bad=structuredClone(state);bad.cards.e1.assessment.correct=99;assert.throws(()=>validateImport(bad,['e1']));
 assert.deepEqual(validateImport(createState(),['e1']),createState());
});

test('same-day answer exposure survives new sessions and backup without becoming mastery',()=>{
 assert.equal(typeof core.recordHint,'function');
 const state=core.recordHint(createState(),'e1',now);assert.deepEqual(state.cards,{});assert.equal(state.days[dayKey(now)].attempts,0);
 assert.deepEqual(core.recordHint(state,'e1',now),state);const restored=validateImport(state,['e1']);assert.deepEqual(restored,state);
 const checked=core.recordAssessment(restored,{...input('seen',good),answer:card.example},now+1000);
 assert.equal(checked.assessmentHistory.at(-1).usedForMastery,false);assert.deepEqual(checked.cards,{});
 const tomorrow=core.recordAssessment(checked,{...input('fresh',good),answer:card.example},now+DAY);
 assert.equal(tomorrow.assessmentHistory.at(-1).usedForMastery,true);
 const bad=structuredClone(state);bad.days[dayKey(now)].hintIds=['unknown'];assert.throws(()=>validateImport(bad,['e1']));
});
