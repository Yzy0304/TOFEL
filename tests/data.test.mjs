import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const cards=JSON.parse(await readFile(new URL('../data/cards.json',import.meta.url),'utf8'));
test('182 distinct complete cards cover the four required modules',()=>{
 assert.equal(cards.length,182);assert.equal(new Set(cards.map(c=>c.id)).size,182);
 const expected={email:62,discussion:60,repeat:36,interview:24};
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
