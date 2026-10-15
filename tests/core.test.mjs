import test from 'node:test';
import assert from 'node:assert/strict';
let core = {};
try { core = await import('../core.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const {createState, dayKey, buildQueue, recordReview, progressCounts, addStudySeconds, makeCloze, normalizeAnswer, validateImport} = core;
const now = Date.parse('2026-10-15T04:00:00Z');
const cards = [
  {id:'e1', module:'email', domain:'教育', phrase:'Could you', example:'COULD YOU help?'},
  {id:'e2', module:'email', domain:'校园'},
  {id:'d1', module:'discussion', domain:'教育'},
  {id:'d2', module:'discussion', domain:'工作'},
  {id:'r1', module:'repeat', domain:'校园'},
  {id:'i1', module:'interview', domain:'生活'},
];
const ids = cards.map(c => c.id);
const freeze = value => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return value; };

test('exports complete public API', () => {
  for (const name of ['createState','dayKey','buildQueue','recordReview','progressCounts','addStudySeconds','makeCloze','normalizeAnswer','validateImport']) assert.equal(typeof core[name], 'function', name);
});
test('fresh state is independent and has expected defaults', () => {
  const a=createState(), b=createState();
  assert.deepEqual(a,{version:1,settings:{dailyMinutes:20,newLimit:4},cards:{},days:{},session:null});
  a.settings.newLimit=2; assert.equal(b.settings.newLimit,4);
});
test('day boundary uses Shanghai rather than host timezone', () => {
  assert.equal(dayKey('2026-10-14T15:59:59Z'),'2026-10-14');
  assert.equal(dayKey(Date.parse('2026-10-14T16:00:00Z')),'2026-10-15');
  assert.throws(() => dayKey('invalid'));
});
test('new queue observes quota and interleaves modules and domains', () => {
  const state=createState(); const q=buildQueue(cards,freeze(state),now);
  assert.equal(q.length,4); assert.ok(new Set(q.map(c=>c.module)).size>=2); assert.ok(new Set(q.map(c=>c.domain)).size>=2);
  assert.deepEqual(buildQueue(cards,state,now),q);
  assert.equal(buildQueue(cards,state,now,{module:'email',domain:'校园'})[0].id,'e2');
  assert.equal(buildQueue(cards,state,now,{limit:0}).length,0);
});
test('Sunday and review-only queues contain no new cards', () => {
  const sunday=Date.parse('2026-10-17T16:00:00Z');
  assert.equal(dayKey(sunday),'2026-10-18');
  assert.deepEqual(buildQueue(cards,createState(),sunday),[]);
  assert.deepEqual(buildQueue(cards,createState(),now,{reviewOnly:true}),[]);
});
test('due queue prioritizes weak then overdue, excludes future cards, then uses remaining new quota', () => {
  let state=createState(); state.settings.newLimit=2;
  state=recordReview(state,'e1','good',now-5*86400000);
  state=recordReview(state,'d1','again',now-25*3600000);
  state=recordReview(state,'r1','good',now);
  const q=buildQueue(cards,state,now);
  assert.deepEqual(q.map(c=>c.id).slice(0,2),['d1','e1']);
  assert.equal(q.length,3); assert.ok(!q.some(c=>c.id==='r1'));
  assert.deepEqual(buildQueue(cards,state,now,{reviewOnly:true}).map(c=>c.id),['d1','e1']);
});
test('review operations clone state, update distinct daily counts and preserve earlier state', () => {
  const state=freeze(createState());
  const first=recordReview(state,'e1','again',now);
  assert.deepEqual(state.cards,{}); assert.equal(first.cards.e1.dueAt,now+600000); assert.equal(first.cards.e1.weak,true);
  const second=recordReview(freeze(first),'e1','good',now+1000,{transfer:true});
  assert.equal(second.cards.e1.streak,1); assert.equal(second.cards.e1.transferAt,now+1000);
  const day=second.days[dayKey(now)];
  assert.deepEqual(day.newIds,['e1']); assert.deepEqual(day.reviewIds,['e1']); assert.equal(day.attempts,2); assert.equal(day.correct,1);
  assert.equal(first.cards.e1.lastRating,'again');
});
test('good reviews follow intervals, record unique dates; hard and again mark weakness', () => {
  let state=createState();
  for (const interval of [1,3,7,14,30,30]) {
    state=recordReview(state,'e1','good',now);
    assert.equal(state.cards.e1.intervalDays,interval); assert.equal(state.cards.e1.dueAt,now+interval*86400000);
  }
  assert.deepEqual(state.cards.e1.correctDates,[dayKey(now)]);
  state=recordReview(state,'e1','hard',now); assert.equal(state.cards.e1.intervalDays,1); assert.equal(state.cards.e1.weak,true);
  state=recordReview(state,'e1','again',now); assert.equal(state.cards.e1.streak,0);
  assert.throws(()=>recordReview(state,'','good',now)); assert.throws(()=>recordReview(state,'e1','great',now));
  assert.throws(()=>recordReview(state,'__proto__','good',now));
});
test('progress stable requires successful reviews on two dates, ignores unknown ids', () => {
  let state=recordReview(createState(),'e1','good',now-86400000);
  state=recordReview(state,'e1','good',now-86400000+1000);
  assert.equal(progressCounts(state,cards,now).stable,0);
  state=recordReview(state,'e1','good',now,{transfer:true});
  state=recordReview(state,'d1','hard',now);
  state=recordReview(state,'unknown','good',now);
  const p=progressCounts(state,cards,now);
  assert.equal(p.learned,2); assert.equal(p.stable,1); assert.equal(p.weak,1); assert.equal(p.transfer,1);
  assert.deepEqual(p.modules.email,{learned:1,total:2});
  assert.equal(p.today.newCards,1); assert.equal(p.today.reviewed,1); assert.equal(p.today.attempts,3); assert.equal(p.today.accuracy,67);
  assert.equal(p.week.length,7); assert.equal(p.week.at(-1).date,dayKey(now));
});
test('study time is immutable and clamps a contribution to five seconds', () => {
  const base=freeze(createState()); const state=addStudySeconds(base,100,now);
  assert.equal(state.days[dayKey(now)].seconds,5); assert.deepEqual(base.days,{});
  assert.equal(addStudySeconds(state,1.5,now).days[dayKey(now)].seconds,6.5);
  for (const value of [-1,NaN,Infinity,'2']) assert.throws(()=>addStudySeconds(state,value,now));
});
test('cloze removes only first case-insensitive literal phrase', () => {
  assert.deepEqual(makeCloze(cards[0]),{before:'',after:' help?',answer:'Could you'});
  assert.deepEqual(makeCloze({phrase:'a+b',example:'Use A+B then a+b.'}),{before:'Use ',after:' then a+b.',answer:'a+b'});
  assert.deepEqual(makeCloze({phrase:'missing',example:'Other'}),{before:'',after:'',answer:'missing'});
});
test('answer normalization keeps internal apostrophes and ignores final punctuation', () => {
  assert.equal(normalizeAnswer('  I’m   ready?!  '),"i'm ready");
  assert.notEqual(normalizeAnswer("can't"),normalizeAnswer('cant'));
});
test('import roundtrip sanitizes envelope and clears session without mutation', () => {
  let state=recordReview(createState(),'e1','good',now,{transfer:true}); state.session={queue:['e1'],index:0};
  const imported=validateImport({app:'toefl-card-studio',version:1,state},ids);
  assert.equal(imported.session,null); assert.ok(state.session); assert.deepEqual(imported.cards,state.cards);
  imported.cards.e1.correctDates.push('2026-10-16'); assert.equal(state.cards.e1.correctDates.length,1);
});
test('invalid imports reject configuration, unknown cards, impossible dates and malformed numeric fields', () => {
  const base=recordReview(createState(),'e1','good',now);
  const mutate=change=>{const data=structuredClone(base);change(data);assert.throws(()=>validateImport(data,ids));};
  mutate(s=>s.version=2); mutate(s=>s.settings.newLimit=7); mutate(s=>s.settings.dailyMinutes=25);
  mutate(s=>s.cards.other=s.cards.e1); mutate(s=>s.cards.e1.dueAt=Infinity); mutate(s=>s.cards.e1.streak=-1);
  mutate(s=>s.cards.e1.correctDates=['2026-02-30']);
  mutate(s=>s.days['2026-02-30']=s.days[dayKey(now)]); mutate(s=>s.days[dayKey(now)].seconds=90000);
  mutate(s=>s.days[dayKey(now)].correct=99); mutate(s=>s.days[dayKey(now)].newIds=['unknown']);
});
test('import rejects prototype payloads and non-plain objects', () => {
  const plain=JSON.stringify(createState());
  const poison=JSON.parse(plain.replace('"cards":{}','"cards":{"__proto__":{"polluted":true}}'));
  assert.throws(()=>validateImport(poison,ids));
  const state=createState();state.session=JSON.parse('{"constructor":{"prototype":{"bad":true}}}');
  assert.throws(()=>validateImport(state,ids));
  const inherited=Object.create({polluted:true}); Object.assign(inherited,createState());
  assert.throws(()=>validateImport(inherited,ids)); assert.equal({}.polluted,undefined);
});

test('weighted new-card rotation includes speaking/listening before writing is exhausted', () => {
  const library=['email','discussion','repeat','interview'].flatMap(module =>
    Array.from({length:6},(_,i)=>({id:`${module}-${i}`,module,domain:i%2?'工作':'教育'})));
  let state=createState();
  const first=buildQueue(library,state,now);
  assert.ok(first.some(card=>['repeat','interview'].includes(card.module)));
  assert.equal(first.filter(card=>['email','discussion'].includes(card.module)).length,3);
  for(const card of first) state=recordReview(state,card.id,'good',now);
  const second=buildQueue(library,state,now+86400000).filter(card=>!state.cards[card.id]);
  assert.ok(second.some(card=>card.module==='interview'));
});

test('same-priority due cards sort by overdue time and filtering precedes limit', () => {
  let state=createState();state.settings.newLimit=0;
  state=recordReview(state,'e1','good',now-3*86400000);
  state=recordReview(state,'d1','good',now-4*86400000);
  state=recordReview(state,'r1','again',now-3600000);
  assert.deepEqual(buildQueue(cards,state,now).map(card=>card.id),['r1','d1','e1']);
  assert.deepEqual(buildQueue(cards,state,now,{module:'email',limit:1}).map(card=>card.id),['e1']);
});

test('imports reject malformed envelope, early timestamps, duplicate ids and non-boolean flags', () => {
  const base=recordReview(createState(),'e1','again',now);
  assert.throws(()=>validateImport({app:'other',version:1,state:base},ids));
  const mutate=change=>{const data=structuredClone(base);change(data);assert.throws(()=>validateImport(data,ids));};
  mutate(s=>s.cards.e1.introducedAt=0);
  mutate(s=>s.cards.e1.dueAt=now-1);
  mutate(s=>s.cards.e1.weak='true');
  mutate(s=>s.days[dayKey(now)].newIds=['e1','e1']);
  mutate(s=>s.days[dayKey(now)].completed=1);
  assert.equal(validateImport(base,ids).cards.e1.intervalDays,10/1440);
});

test('optional exportedAt accepts canonical ISO only within supported timestamp range', () => {
  const envelope={app:'toefl-card-studio',version:1,state:createState()};
  assert.deepEqual(validateImport({...envelope,exportedAt:new Date(now).toISOString()},ids),createState());
  for(const exportedAt of ['invalid text',-5,Infinity,'2026-02-30T04:00:00.000Z','1999-12-31T23:59:59.000Z','2101-01-01T00:00:00.000Z']) {
    assert.throws(()=>validateImport({...envelope,exportedAt},ids),String(exportedAt));
  }
});

test('hard review resets stability streak and retains correct date history', () => {
  let state=recordReview(createState(),'e1','good',now-86400000);
  state=recordReview(state,'e1','good',now);
  assert.equal(progressCounts(state,cards,now).stable,1);
  const history=[...state.cards.e1.correctDates];
  state=recordReview(state,'e1','hard',now+1000);
  assert.equal(state.cards.e1.streak,0);
  assert.deepEqual(state.cards.e1.correctDates,history);
  const progress=progressCounts(state,cards,now+1000);
  assert.equal(progress.weak,1);assert.equal(progress.stable,0);
  state=recordReview(state,'e1','good',now+86400000);
  assert.equal(progressCounts(state,cards,now+86400000).stable,0);
  assert.equal(state.cards.e1.intervalDays,1);
});
