import {ServiceError} from './auth.mjs';
import {assessmentRequest,validateAssessment,normalizeText} from '../assessment.js';
export async function readResponseStream(response){
 if(!response.body)throw new ServiceError('模型没有返回评判内容。',502);
 const decoder=new TextDecoder();let buffer='',text='',completed=false,total=0;
 for await(const bytes of response.body){
  total+=bytes.length;if(total>500000)throw new ServiceError('评判响应过大，本次不记录成绩。',502);
  buffer+=decoder.decode(bytes,{stream:true});let match;
  while((match=/\r?\n\r?\n/.exec(buffer))){
   const block=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);
   const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
   if(!data||data==='[DONE]')continue;
   let event;try{event=JSON.parse(data);}catch{throw new ServiceError('评判数据格式错误，请重试。',502);}
   if(event.type==='response.output_text.delta'){text+=event.delta??'';if(text.length>30000)throw new ServiceError('评判内容过长，请重试。',502);}
   if(['response.failed','response.incomplete','error'].includes(event.type)){
    const code=event.response?.error?.code??event.error?.code??event.code;
    throw new ServiceError(['subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable'].includes(code)?'订阅额度暂不可用，请在 ChatGPT 用量设置检查或稍后重试。':'模型未完成评判，本次不记录成绩。',502);
   }
   if(event.type==='response.completed'){
    completed=true;
    const output=event.response?.output??[];
    if(output.some(item=>item.content?.some(part=>part.type==='refusal')))throw new ServiceError('模型未能评判此内容。',502);
    const final=output.flatMap(item=>item.content??[]).filter(part=>part.type==='output_text').map(part=>part.text).join('');if(final)text=final;
   }
  }
 }
 if(!completed||!text.trim())throw new ServiceError('连接中断或评判未完成，本次不记录成绩。',502);
 return text;
}
export class ChatGPTProvider{
 constructor(auth,{fetchImpl=fetch}={}){this.auth=auth;this.fetch=fetchImpl;this.catalog=null;}
 async models(id=this.auth.status().activeAccount?.id){
  if(this.catalog?.id===id&&Date.now()-this.catalog.at<60000)return this.catalog.models;
  const token=await this.auth.accessToken(id);
  const r=await this.fetch('https://api.openai.com/v1/models',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok)throw new ServiceError('无法读取此 ChatGPT 账户的可用模型，请重新登录或稍后重试。',r.status===401?401:502);
  const data=await r.json();
  const models=(data.models??[]).filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&typeof m.display_name==='string').map(m=>({id:m.slug,name:m.display_name}));
  if(!models.length)throw new ServiceError('当前账户没有可用于此应用的模型。',401);
  this.catalog={id,at:Date.now(),models};return models;
 }
 async assess(card,mode,answer,model,signal){
  const id=this.auth.status().activeAccount?.id;
  const request=assessmentRequest(card,mode,answer);const models=await this.models(id);
  const selected=model||models[0].id;if(!models.some(m=>m.id===selected))throw new ServiceError('请选择当前账户提供的模型。');
  const token=await this.auth.accessToken(id);
  const r=await this.fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model:selected,instructions:request.instructions,input:[{role:'user',content:request.context}],store:false,stream:true}),signal,redirect:'error'});
  if(!r.ok)throw new ServiceError(r.status===429?'模型请求过多或订阅额度不足，请稍后重试。':r.status===401?'ChatGPT 授权已失效，请重新连接。':'评判服务暂不可用，本次不记录成绩。',r.status===401?401:502);
  let result;try{const raw=JSON.parse(await readResponseStream(r));if(raw.needsReview)throw new ServiceError('模型不能可靠判断这次答案，请核对题目后重试。',422);result=validateAssessment(raw,answer);}catch(e){if(e instanceof ServiceError)throw e;throw new ServiceError('模型评判结果未通过校验，本次不记录成绩。',502);}
  if(['listen','sentence'].includes(mode)&&normalizeText(answer)!==normalizeText(card.example))result.taskMatch=false;
  return {result,source:'model',model:selected};
 }
}
