import {createState,dayKey,recordReview,recordHint,recordAssessment,validateImport} from './core.js';
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const copy=value=>structuredClone(value);
const union=(a=[],b=[])=>[...new Set([...a,...b])].sort();
const fail=()=>{throw new TypeError('同步记录格式无效，原记录未覆盖。');};
const time=n=>{if(!Number.isFinite(n)||n<Date.UTC(2000,0,1)||n>Date.UTC(2100,0,1))fail();};
const id=s=>{if(typeof s!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(s))fail();};
const emptyDay=()=>({seconds:0,newIds:[],reviewIds:[],attempts:0,correct:0,completed:false});
export async function createDocument(state,ids,at=Date.now()){
 const base=validateImport(state,ids);time(at);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(base)));
 const key=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const active=Object.keys(base.days).length||Object.keys(base.cards).length||base.assessmentHistory?.length||canonical(base.settings)!==canonical(createState().settings);
 return {version:1,bases:active?[{id:key,at,state:base}]:[],events:[],settings:base.settings};
}
function apply(state,e){
 switch(e.type){
  case 'review': return recordReview(state,e.cardId,e.rating,e.at,{transfer:e.transfer});
  case 'hint': return recordHint(state,e.cardId,e.at);
  case 'assessment': return recordAssessment(state,e.attempt,e.at);
  case 'time': {const s=copy(state),d=s.days[dayKey(e.at)]??=emptyDay();d.seconds=Math.min(86400,d.seconds+e.seconds);return s;}
  case 'complete': {const s=copy(state),d=s.days[dayKey(e.at)]??=emptyDay();if(d.attempts)d.completed=true;return s;}
  case 'settings': {const s=copy(state);s.settings={...s.settings,...e.settings};return s;}
  default: fail();
 }
}
function validateEvent(e,ids){
 if(!e||typeof e!=='object'||Array.isArray(e))fail();id(e.id);time(e.at);
 const fields={review:['cardId','rating','transfer'],hint:['cardId'],assessment:['attempt'],time:['seconds'],complete:[],settings:['settings']}[e.type];
 if(!fields||Object.keys(e).some(k=>!['id','at','type',...fields].includes(k)))fail();
 if(['review','hint'].includes(e.type)&&!ids.includes(e.cardId))fail();
 if(e.type==='review'&&typeof e.transfer!=='boolean')fail();
 if(e.type==='time'&&(!Number.isFinite(e.seconds)||e.seconds<0||e.seconds>86400))fail();
 // Existing import validation checks assessment fields, card identities and limits.
 validateImport(apply(createState(),e),ids);
 return copy(e);
}
export function validateDocument(d,ids){
 if(!d||d.version!==1||Object.keys(d).some(k=>!['version','bases','events','settings'].includes(k))||!Array.isArray(d.bases)||!Array.isArray(d.events)||d.bases.length>100||d.events.length>50000)fail();
 const settings=validateImport({...createState(),settings:d.settings},ids).settings;
 const bases=d.bases.map(b=>{if(!b||Object.keys(b).some(k=>!['id','at','state'].includes(k)))fail();id(b.id);time(b.at);return {id:b.id,at:b.at,state:validateImport(b.state,ids)};});
 const events=d.events.map(e=>validateEvent(e,ids));
 if(new Set(bases.map(b=>b.id)).size!==bases.length||new Set(events.map(e=>e.id)).size!==events.length)fail();
 return {version:1,bases,events,settings};
}
export function mergeDocuments(a,b,ids){
 a=validateDocument(a,ids);b=validateDocument(b,ids);
 const bases=new Map(a.bases.map(x=>[x.id,x]));
 for(const x of b.bases){const prev=bases.get(x.id);if(prev&&canonical(prev.state)!==canonical(x.state))throw Error('旧存档编号冲突');bases.set(x.id,prev?{...prev,at:Math.min(prev.at,x.at)}:x);}
 const events=new Map(a.events.map(x=>[x.id,x]));
 for(const x of b.events){const prev=events.get(x.id);if(prev&&canonical(prev)!==canonical(x)){
   if(prev.type==='time'&&x.type==='time'&&prev.at===x.at){events.set(x.id,{...prev,seconds:Math.max(prev.seconds,x.seconds)});continue;}
   throw Error('学习事件编号冲突，已停止合并。');
  }events.set(x.id,x);}
 const latestBase=[...bases.values()].sort((x,y)=>x.at-y.at||x.id.localeCompare(y.id)).at(-1);
 const settings=latestBase?latestBase.state.settings:(canonical(a.settings)<canonical(b.settings)?a.settings:b.settings);
 const result={version:1,bases:[...bases.values()].sort((x,y)=>x.id.localeCompare(y.id)),events:[...events.values()].sort((x,y)=>x.at-y.at||x.id.localeCompare(y.id)),settings};
 return validateDocument(result,ids);
}
function mergeLegacy(a,b,ids){
 const out=copy(a);
 for(const [key,card] of Object.entries(b.cards)){
  const old=out.cards[key];if(!old){out.cards[key]=copy(card);continue;}
  const latest=card.lastReviewedAt>old.lastReviewedAt||(card.lastReviewedAt===old.lastReviewedAt&&canonical(card)>canonical(old))?card:old;
  out.cards[key]={...copy(latest),introducedAt:Math.min(old.introducedAt,card.introducedAt),correctDates:union(old.correctDates,card.correctDates)};
  const transferred=Math.max(old.transferAt??0,card.transferAt??0);if(transferred)out.cards[key].transferAt=transferred;
 }
 for(const [date,d] of Object.entries(b.days)){
  const old=out.days[date]??emptyDay();out.days[date]={seconds:Math.max(old.seconds,d.seconds),attempts:Math.max(old.attempts,d.attempts),correct:Math.max(old.correct,d.correct),completed:old.completed||d.completed,newIds:union(old.newIds,d.newIds),reviewIds:union(old.reviewIds,d.reviewIds),hintIds:union(old.hintIds,d.hintIds)};
 }
 const history=new Map();for(const h of [...(a.assessmentHistory??[]),...(b.assessmentHistory??[])]){
  const prev=history.get(h.attemptId);if(prev&&canonical(prev)!==canonical(h)){
   // The same observation can have been counted on one device before a hint arrived.
   const p={...prev,usedForMastery:false},q={...h,usedForMastery:false};if(canonical(p)!==canonical(q))throw Error('评判记录冲突');history.set(h.attemptId,p);
  }else history.set(h.attemptId,copy(h));
 }
 out.assessmentHistory=[...history.values()].sort((x,y)=>x.at-y.at||x.attemptId.localeCompare(y.attemptId)).slice(-200);
 return validateImport(out,ids);
}
export function materialize(document,ids){
 const d=validateDocument(document,ids);let legacy=createState(),early=createState();
 const cutoff=Math.max(0,...d.bases.map(b=>b.at));
 for(const b of d.bases.sort((x,y)=>x.at-y.at||x.id.localeCompare(y.id)))legacy=mergeLegacy(legacy,b.state,ids);
 const sorted=[...d.events].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
 for(const e of sorted.filter(e=>e.at<=cutoff))early=apply(early,e);
 let result=mergeLegacy(legacy,early,ids);result.settings=d.settings;
 // Older snapshots lack event identities. Only observations after all migration
 // snapshots can be added exactly; overlapping history remains a lower bound.
 for(const e of sorted.filter(e=>e.at>cutoff))result=apply(result,e);
 // Settings remain explicit user choices even when importing a later old snapshot.
 for(const e of sorted.filter(e=>e.type==='settings'))result=apply(result,e);
 return validateImport(result,ids);
}
