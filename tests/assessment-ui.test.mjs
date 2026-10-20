import test from 'node:test';
import assert from 'node:assert/strict';
let ui={};try{ui=await import('../assessment-ui.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const record={answer:'<img src=x onerror=alert(1)>',independent:true,usedForMastery:true,source:'model',cardId:'email-001',at:Date.parse('2026-10-19T04:00:00Z'),result:{category:'correct',taskMatch:false,explanation:'语法成立，但没有回答所问的含义。',correctedAnswer:'A safe sentence.',naturalAnswer:'',issues:[],tags:[]}};
test('feedback escapes learner text and gives meaning mismatch priority over a green correct badge',()=>{
 const html=ui.feedbackMarkup(record);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('题意不符'));assert.ok(!html.includes('assessment-correct'));
});
test('assisted practice is explicitly excluded from mastery claims',()=>{
 const html=ui.feedbackMarkup({...record,usedForMastery:false,independent:false});assert.ok(html.includes('纠错练习'));assert.ok(html.includes('不计入掌握'));
});
