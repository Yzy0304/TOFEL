import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const cards=JSON.parse(await readFile(new URL('../data/cards.json',import.meta.url),'utf8'));
test('218 distinct complete cards cover the four required modules',()=>{
 assert.equal(cards.length,218);assert.equal(new Set(cards.map(c=>c.id)).size,218);
 const expected={email:62,discussion:60,repeat:36,interview:60};
 for(const [module,count]of Object.entries(expected))assert.equal(cards.filter(c=>c.module===module).length,count);
 for(const card of cards){for(const field of ['id','module','domain','skill','phrase','meaning','example','note','source'])assert.equal(typeof card[field],'string',`${card.id}.${field}`);assert.ok(card.example.length>20);assert.ok(!card.source.includes('官方答案'));}
});
test('writing covers varied domains and scene repetition covers nine settings',()=>{
 assert.ok(new Set(cards.filter(c=>c.module==='discussion').map(c=>c.domain)).size>=15);
 assert.equal(new Set(cards.filter(c=>c.module==='repeat').map(c=>c.domain)).size,9);
});

for(const card of cards){
 test(`${card.id}: example contains the target phrase for cloze practice`,()=>{
  assert.ok(card.example.toLowerCase().includes(card.phrase.toLowerCase()),`${card.id}: example must contain "${card.phrase}"`);
 });
}


test('Interview covers twelve topics with five usable question-and-answer cards each',()=>{
 const interview=cards.filter(c=>c.module==='interview');
 const topics=['学习','运动','工作','科技','旅行','社交','成长','社区','时间管理','校园生活','环境','消费决策'];
 assert.deepEqual([...new Set(interview.map(c=>c.domain))].sort(),[...topics].sort());
 for(const topic of topics) assert.equal(interview.filter(c=>c.domain===topic).length,5,topic);
 assert.equal(new Set(interview.map(c=>c.question)).size,60);
 for(const card of interview){
  assert.ok(card.question.endsWith('?'),card.id);
  assert.ok(card.modelAnswer.toLowerCase().includes(card.phrase.toLowerCase()),card.id);
  const words=card.modelAnswer.trim().split(/\s+/).length;
  assert.ok(words>=45&&words<=95,`${card.id}: ${words} words`);
  assert.ok(card.note.includes('搭配')&&card.note.includes('展开'),card.id);
  assert.match(card.source,/原创/);
 }
});
