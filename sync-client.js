import {createDocument,validateDocument,mergeDocuments,materialize,canonical} from './sync-core.js';
import {dayKey} from './core.js';
export const JOURNAL_KEY='toefl-progress-journal-v1';
export class ProgressStore{
 constructor(storage,ids,onChange=()=>{}){this.storage=storage;this.ids=ids;this.onChange=onChange;this.raw=null;}
 async initialize(state,at=Date.now()){
  this.raw=this.storage.getItem(JOURNAL_KEY);
  if(this.raw){const saved=JSON.parse(this.raw);if(saved.version!==1||typeof saved.device!=='string'||!(saved.owner===null||typeof saved.owner==='string'))throw Error('同步存档无法读取，请先导出原始存档。');this.document=validateDocument(saved.document,this.ids);this.device=saved.device;this.owner=saved.owner;this.state=materialize(this.document,this.ids);}
  else {this.device=crypto.randomUUID();this.owner=null;const d=await createDocument(state,this.ids,at);this.commit(d);}
  return this.state;
 }
 commit(document,owner=this.owner){
  const d=validateDocument(document,this.ids),state=materialize(d,this.ids);
  const raw=JSON.stringify({version:1,device:this.device,owner,document:d});
  if(new TextEncoder().encode(raw).length>4*1024*1024)throw Error('学习日志接近容量限制，请导出备份；本次未覆盖记录。');
  if(this.storage.getItem(JOURNAL_KEY)!==this.raw)throw Error('其他标签页更新了学习记录，请刷新后继续。');
  this.storage.setItem(JOURNAL_KEY,raw);this.raw=raw;this.document=d;this.owner=owner;this.state=state;this.onChange(state);return state;
 }
 bindOwner(owner){if(this.owner&&this.owner!==owner)throw Error('此浏览器记录已绑定另一个账号。请使用原账号登录，或在另一浏览器使用新账号。');this.commit(this.document,owner);}
 record(type,data={},at=Date.now()){
  const eventId=type==='assessment'?data.attempt?.attemptId:crypto.randomUUID();
  if(this.document.events.some(e=>e.id===eventId))return this.state;
  const d=structuredClone(this.document);at=Math.max(at,1+Math.max(0,...d.bases.map(b=>b.at),...d.events.map(e=>e.at)));
  d.events.push({id:eventId,type,at,...data});return this.commit(d);
 }
 addTime(seconds,at=Date.now()){
  const d=structuredClone(this.document),key='time_'+this.device+'_'+dayKey(at).replaceAll('-','');
  const event=d.events.find(e=>e.id===key);
  if(event)event.seconds=Math.min(86400,event.seconds+Math.min(5,Math.max(0,seconds)));
  else d.events.push({id:key,type:'time',at,seconds:Math.min(5,Math.max(0,seconds))});
  return this.commit(d);
 }
 backup(){this.storage.setItem('toefl-progress-before-merge-v1',this.raw);}
 merge(document){const d=mergeDocuments(this.document,document,this.ids);if(canonical(d)===canonical(this.document))return this.state;this.backup();return this.commit(d);}
 export(){return {app:'toefl-card-studio',version:2,exportedAt:new Date().toISOString(),document:this.document};}
}
export async function synchronize(store,transport,isCurrent){
 const check=()=>{if(!isCurrent())throw Error('登录状态已改变，本次同步已停止。');};
 for(let n=0;n<6;n++){
  check();const remote=await transport.read();check();if(remote.document)store.merge(remote.document);
  const snapshot=structuredClone(store.document),signature=canonical(snapshot);
  if(remote.document&&canonical(remote.document)===signature)return;
  const accepted=await transport.write(remote.revision,snapshot);check();
  if(accepted&&canonical(store.document)===signature)return;
 }
 throw Error('其他设备正在更新，已保留本地记录，稍后自动重试。');
}
