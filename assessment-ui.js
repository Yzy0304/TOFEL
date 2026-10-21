import {CATEGORIES,referenceAssessment,validateAssessment} from './assessment.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const local=()=>location.protocol==='http:'&&location.hostname==='127.0.0.1';
const MODEL_KEY='toefl-assessment-model';
function chosenModel(){try{return localStorage.getItem(MODEL_KEY)||'';}catch{return '';}}
async function api(path,{signal,body}={}){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','x-toefl-client':'1'},body:body===undefined?undefined:JSON.stringify(body),signal:signal??AbortSignal.timeout(20000)});
 let data;try{data=await response.json();}catch{throw Error('当前地址没有本机 AI 服务，请从学习设置打开本机版。');}
 if(!response.ok)throw Error(data.error||'服务暂不可用，请重试；本次不记录成绩。');return data;
}
function highlighted(answer,issues){let offset=0,html='';for(const issue of issues){html+=esc(answer.slice(offset,issue.start))+`<mark>${esc(answer.slice(issue.start,issue.end))||'〔缺少内容〕'}</mark>`;offset=issue.end;}return html+esc(answer.slice(offset));}
export function feedbackMarkup(record){
 const {result,answer}=record,match=result.taskMatch,category=match?result.category:'task-mismatch';
 return `<div class="assessment-feedback assessment-${category}"><strong class="assessment-verdict">${match?CATEGORIES[result.category]:'题意不符，未计为掌握'}</strong>${!match?`<p>语言判断：${esc(CATEGORIES[result.category])}。仍需回答卡片要求的含义或复现原句。</p>`:''}<p class="assessment-original">${highlighted(answer,result.issues)}</p><p>${esc(result.explanation)}</p>${result.issues.length?`<ul>${result.issues.map(i=>`<li><strong>${esc(i.original)||'缺少内容'} → ${esc(i.replacement)||'删除'}</strong>：${esc(i.explanation)}</li>`).join('')}</ul>`:''}<p><strong>最小修改：</strong>${esc(result.correctedAnswer)}</p>${result.naturalAnswer?`<p><strong>可选自然表达：</strong>${esc(result.naturalAnswer)}</p>`:''}<p class="source-note">${record.source==='reference'?'参考表达匹配校验':'ChatGPT 模型评判'} · ${record.usedForMastery?'已记录本次独立作答，按结果安排复习。':'纠错练习／当天重复练习，不计入掌握证据。'}</p></div>`;
}
export function assessmentMarkup(){return '<section id="assessment-panel" class="assessment-panel" aria-live="polite"><button class="button" id="assess-answer">提交评判</button><p class="source-note">先独立输入再提交。会分别检查语法、表达自然度和题意；不确定或连接失败时不记录成绩。</p><div id="assessment-feedback"></div></section>';}
export function bindAssessmentUI(root,options){
 let controller=null,active=true,busy=false,committed=false;
 const widget={get busy(){return busy;},get committed(){return committed;},cancel(){active=false;controller?.abort();}};
 async function submit(){
  if(busy||!active||!options.stillCurrent())return;
  if(!options.canSubmit()){options.notify('请先点击继续学习，再提交评判。');return;}
  const answer=options.getAnswer();if(!answer.trim()||answer.length>2000){options.notify('请输入 1–2000 个字符的英文答案。');return;}
  const independent=options.isIndependent(),attemptId=crypto.randomUUID();
  busy=true;controller=new AbortController();const timer=setTimeout(()=>controller.abort(),65000);options.onPause();
  const feedback=root.querySelector('#assessment-feedback');feedback.innerHTML='<p role="status">正在检查表达，等待期间已暂停学习计时…</p>';
  root.querySelector('#assess-answer').disabled=true;
  try{
   let outcome;const exact=referenceAssessment(options.card,options.mode,answer);
   if(exact)outcome={result:exact,source:'reference'};
   else{if(!local())throw Error('不同表达需要 Mac 本机 AI 服务。请在学习设置中打开本机版；也可以先查看答案并自行标记。');outcome=await api('/api/assess',{signal:controller.signal,body:{cardId:options.card.id,mode:options.mode,answer,model:chosenModel()||undefined}});}
   if(!active||controller.signal.aborted||!options.stillCurrent())return;
   const result=validateAssessment(outcome.result,answer);
   const record=options.onCommit({attemptId,cardId:options.card.id,mode:options.mode,answer,independent,result,source:outcome.source});
   committed=true;options.onHint();
   feedback.innerHTML=feedbackMarkup(record)+'<div class="study-actions"><button class="button" id="assessment-next">保存并下一张</button><button class="button secondary" id="assessment-retry">修改后再练</button></div>';
   root.querySelector('#assessment-next').onclick=()=>{if(active&&options.stillCurrent())options.onNext();};
   root.querySelector('#assessment-retry').onclick=()=>{if(!active||!options.stillCurrent())return;feedback.innerHTML='<p class="source-note">已看过反馈，再次提交只记录为纠错练习，不提高独立掌握记录。</p>';root.querySelector('#assess-answer').disabled=false;options.onRetry();};
  }catch(error){if(active&&options.stillCurrent()){feedback.innerHTML=`<p class="notice">${esc(error.name==='AbortError'?'评判超时或已取消，请重试；本次不记录成绩。':error.message)}</p>`;root.querySelector('#assess-answer').disabled=false;}}
  finally{clearTimeout(timer);busy=false;if(active)options.onSettled();}
 }
 root.querySelector('#assess-answer').onclick=submit;
 return widget;
}
export function assessmentProgressMarkup(stats){
 const a=stats.assessment;const ratio=a.attempts?Math.round(a.correct/a.attempts*100):0;
 return `<section class="panel full-width"><h3>独立作答证据</h3><div class="assessment-stats"><span>完全正确 <strong>${a.correct}/${a.attempts}</strong></span><span>独立正确率 <strong>${ratio}%</strong></span><span>语法待加强 <strong>${a.grammarErrors}</strong></span><span>表达待加强 <strong>${a.unnatural}</strong></span><span>题意不符 <strong>${a.taskErrors}</strong></span><span>经作答验证稳定 <strong>${a.stable} 张</strong></span></div><p class="source-note">只统计当天首次、未看答案的独立作答。两次不同日期的连续独立正确才计为经作答验证稳定；原来的自评记录单独保留。题意不符可能同时伴随语言问题。文字评判不评发音或给托福分数。</p>${a.history.length?`<h3>最近的答案与反馈</h3>${a.history.map(record=>`<details class="assessment-history"><summary>${esc(record.cardId)} · ${new Date(record.at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})} · ${record.result.taskMatch?CATEGORIES[record.result.category]:'题意不符'}${record.usedForMastery?'':' · 纠错／重复练习'}</summary>${feedbackMarkup(record)}</details>`).join('')}`:'<p class="tip">提交第一条独立答案后，这里会出现可核对的作答记录。</p>'}</section>`;
}
export async function mountAssessmentSettings(root){
 if(!local()){root.innerHTML='<h3>答案评判与 ChatGPT 订阅</h3><p class="tip">当前为在线卡片版：可校验与参考表达相同的答案。要判断其他表达，请在 Mac 启动仓库中的“启动词境.command”，使用本机 AI 版。</p><a class="button secondary" href="http://127.0.0.1:4173/" target="_blank" rel="noopener noreferrer">打开 Mac 本机版</a><p class="source-note">手机支持卡片、复述、参考匹配与备份合并；在上方登录同一同步邮箱后，学习记录会跨设备同步。</p>';return;}
 root.innerHTML='<h3>答案评判与 ChatGPT 订阅</h3><p>正在读取本机连接状态…</p>';
 try{
  const status=await api('/api/status');if(root.isConnected===false)return;
  let models=[],modelError='';
  if(status.authenticated)try{models=(await api('/api/models')).models;}catch(error){modelError=error.message;}
  if(root.isConnected===false)return;
  const saved=chosenModel(),selected=models.some(m=>m.id===saved)?saved:models[0]?.id;
  if(selected)try{localStorage.setItem(MODEL_KEY,selected);}catch{}
  root.innerHTML=`<h3>答案评判与 ChatGPT 订阅</h3><p>${status.authenticated?'已连接：'+esc(status.activeAccount.label):'尚未连接订阅。与参考表达相同的答案可先在本地校验。'}</p><p class="tip">提交时会将本条答案和卡片语境发送给 OpenAI，用于判断语法、自然度与题意，并返回中文反馈。使用你授权的订阅额度，受账户限额约束；不会自动改用付费 API Key。登录凭据只保存在此 Mac。</p><label for="assessment-account">ChatGPT 账户</label><select id="assessment-account"><option value="">新增账户</option>${status.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===status.activeAccount?.id?'selected':''}>${esc(a.label)}</option>`).join('')}</select>${models.length?`<label for="assessment-model">评判模型（来自当前账户可用列表）</label><select id="assessment-model">${models.map(m=>`<option value="${esc(m.id)}" ${m.id===selected?'selected':''}>${esc(m.name)}</option>`).join('')}</select>`:''}${modelError?`<p class="notice">${esc(modelError)}</p>`:''}<div class="study-actions"><button class="button" id="assessment-login">Continue with ChatGPT</button><button class="button secondary" id="assessment-refresh">刷新连接状态</button>${status.authenticated?'<button class="button secondary" id="assessment-logout">断开当前账户</button>':''}</div><div id="assessment-auth-message" role="status"></div><p class="source-note">首次登录会打开官方授权页，请核对“TOEFL Card Studio”及允许的订阅用量。<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">查看 ChatGPT 用量与应用权限</a> · <a href="./docs/assessment.md" target="_blank" rel="noopener">评判规则与研究参考</a></p>`;
  root.querySelector('#assessment-refresh').onclick=()=>mountAssessmentSettings(root);
  root.querySelector('#assessment-model')?.addEventListener('change',event=>{try{localStorage.setItem(MODEL_KEY,event.target.value);}catch{}});
  root.querySelector('#assessment-account').onchange=async event=>{if(!event.target.value)return;try{await api('/api/auth/select',{body:{accountId:event.target.value}});await mountAssessmentSettings(root);}catch(error){root.querySelector('#assessment-auth-message').textContent=error.message;}};
  root.querySelector('#assessment-login').onclick=async()=>{
   const message=root.querySelector('#assessment-auth-message');message.textContent='正在准备官方授权…';
   try{const data=await api('/api/auth/start',{body:{accountId:root.querySelector('#assessment-account').value||null}});const url=new URL(data.url);if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw Error('授权地址校验失败。');message.innerHTML=`<p>请在官方页面完成授权，然后回到此处刷新连接状态。</p><a class="button" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">Continue with ChatGPT</a>`;}catch(error){message.textContent=error.message;}
  };
  root.querySelector('#assessment-logout')?.addEventListener('click',async()=>{try{const result=await api('/api/auth/logout',{body:{}});await mountAssessmentSettings(root);if(!result.remoteRevoked)root.querySelector('#assessment-auth-message').textContent='本机已断开，但远程撤销未确认。请在 ChatGPT 设置中断开此应用。';}catch(error){root.querySelector('#assessment-auth-message').textContent=error.message;}});
 }catch(error){if(root.isConnected!==false)root.innerHTML=`<h3>答案评判连接</h3><p class="notice">${esc(error.message)}</p><p>请确认正在使用 Mac 本机服务。</p>`;}
}
