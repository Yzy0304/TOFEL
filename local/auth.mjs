import {randomUUID,randomBytes,createHash,createPublicKey,verify} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,chmod,open,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const AUTH='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export class ServiceError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const random=()=>randomBytes(32).toString('base64url');
export function verifyIdToken(token,{jwks,clientId,nonce,now=Date.now(),expectedSubject}={}){
 try{
  if(typeof token!=='string'||token.length>20000)throw Error();
  const parts=token.split('.');if(parts.length!==3)throw Error();
  const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error();
  const jwk=jwks?.keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(!jwk||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error();
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud],seconds=now/1000;
  if(claims.iss!==AUTH||!aud.includes(clientId)||(aud.length>1&&claims.azp!==clientId)||typeof claims.exp!=='number'||claims.exp<=seconds||typeof claims.iat!=='number'||claims.iat>seconds+60||typeof claims.sub!=='string'||!claims.sub||(nonce!==undefined&&claims.nonce!==nonce)||(expectedSubject&&claims.sub!==expectedSubject))throw Error();
  return claims;
 }catch{throw new ServiceError('ChatGPT 身份校验未通过，请重新登录。',401);}
}
async function atomicJSON(path,value){const temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,path);await chmod(path,0o600);}finally{await unlink(temp).catch(()=>{});}}
export class ChatGPTAuth{
 constructor({dataDir=join(homedir(),'.config','toefl-card-studio'),fetchImpl=fetch,now=Date.now}={}){this.dataDir=dataDir;this.fetch=fetchImpl;this.now=now;this.pending=new Map();this.loginGeneration=0;this.refreshing=new WeakMap();this.generations=new WeakMap();this.saving=Promise.resolve();this.store={hostId:'urn:uuid:'+randomUUID(),activeClientId:null,accounts:[]};}
 async initialize(){
  await mkdir(this.dataDir,{recursive:true,mode:0o700});await chmod(this.dataDir,0o700);
  this.file=join(this.dataDir,'accounts.json');this.lock=join(this.dataDir,'service.lock');
  try{this.handle=await open(this.lock,'wx',0o600);}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   let pid;try{pid=Number(await readFile(this.lock,'utf8'));}catch{}
   if(!Number.isInteger(pid)||pid<1)throw new ServiceError('本地服务锁需要检查，请先关闭其他词境服务。');
   try{process.kill(pid,0);throw new ServiceError('已有词境本地服务在运行，请使用已打开的服务。');}catch(error){if(error.code!=='ESRCH')throw error;}
   await unlink(this.lock);this.handle=await open(this.lock,'wx',0o600);
  }
  await this.handle.writeFile(String(process.pid));
  try{
   try{const saved=JSON.parse(await readFile(this.file,'utf8'));if(typeof saved.hostId!=='string'||!Array.isArray(saved.accounts)||saved.accounts.some(a=>typeof a.clientId!=='string'||typeof a.subject!=='string'))throw Error('invalid');this.store=saved;}
   catch(e){if(e.code!=='ENOENT')throw new ServiceError('本地授权记录无法读取，已保留原文件。请检查 accounts.json。');await this.save();}
  }catch(e){await this.close();throw e;}
 }
 async close(){if(this.handle){await this.handle.close();this.handle=null;await unlink(this.lock).catch(()=>{});}}
 async save(){this.saving=this.saving.catch(()=>{}).then(()=>atomicJSON(this.file,this.store));return this.saving;}
 active(){return this.store.accounts.find(a=>a.clientId===this.store.activeClientId);}
 status(){const account=this.active();return {authenticated:Boolean(account?.accessToken&&account.scopes?.includes('chatgpt.tokens.use.direct')),activeAccount:account?{id:account.clientId,label:account.label}:null,accounts:this.store.accounts.map(a=>({id:a.clientId,label:a.label}))};}
 async metadata(){
  if(this.discovery)return this.discovery;
  const response=await this.fetch(AUTH+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new ServiceError('无法读取 OpenAI 登录配置，请稍后重试。',502);
  const data=await response.json();if(data.issuer!==AUTH)throw new ServiceError('OpenAI 登录配置校验失败。',502);
  for(const key of ['jwks_uri','revocation_endpoint'])if(data[key]){const url=new URL(data[key]);if(url.origin!==AUTH)throw new ServiceError('登录端点校验失败。',502);}
  if(!data.jwks_uri)throw new ServiceError('缺少身份校验配置。',502);this.discovery=data;return data;
 }
 async keys(){const metadata=await this.metadata();const r=await this.fetch(metadata.jwks_uri,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw new ServiceError('无法读取登录验证密钥，请重试。',502);return r.json();}
 beginLogin(callbackOrigin,accountId=null){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(callbackOrigin))throw new ServiceError('登录回调必须使用本机地址。');
  const account=accountId?this.store.accounts.find(a=>a.clientId===accountId):null;if(accountId&&!account)throw new ServiceError('请选择已有账户或新增账户。');
  const state=random(),nonce=random(),verifier=random(),redirectUri=callbackOrigin+'/auth/callback';
  for(const [key,value]of this.pending)if(this.now()-value.createdAt>600000)this.pending.delete(key);
  if(this.pending.size>=5)throw new ServiceError('请先完成已打开的登录窗口。',429);
  this.pending.set(state,{nonce,verifier,redirectUri,account,generation:this.loginGeneration,createdAt:this.now()});
  const url=new URL(AUTH+'/api/accounts/authorize');
  const params={client_id:account?.clientId??'dynamic_agent_client',ext_agent_host_id:this.store.hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
  if(!account)params.agent_name_hint='TOEFL Card Studio';else if(account.idToken)params.id_token_hint=account.idToken;
  for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  return url.href;
 }
 async tokenRequest(form){
  const response=await this.fetch(AUTH+'/api/accounts/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form),signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw new ServiceError('ChatGPT 授权已失效或未获批准，请重新登录。',401);
  const token=await response.json();
  if(typeof token.access_token!=='string'||!token.access_token||typeof token.refresh_token!=='string'||!token.refresh_token||token.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(token.expires_in)||token.expires_in<=0)throw new ServiceError('授权响应不完整，请重新登录。',401);
  return token;
 }
 credentials(token,old={}){
  const scopes=typeof token.scope==='string'?token.scope.split(/\s+/):old.scopes;
  if(!scopes?.includes('chatgpt.tokens.use.direct')||!scopes.includes('resource.invoke'))throw new ServiceError('尚未允许此应用使用 ChatGPT 订阅额度，请重新授权。',401);
  return {accessToken:token.access_token,refreshToken:token.refresh_token,idToken:token.id_token??old.idToken,scopes,expiresAt:this.now()+token.expires_in*1000};
 }
 async completeLogin(query){
  const state=query.get('state'),pending=this.pending.get(state);this.pending.delete(state);
  if(!pending||this.now()-pending.createdAt>600000)throw new ServiceError('登录请求已过期或不匹配，请在设置页重新开始。',401);
  if(query.get('error'))throw new ServiceError('你没有完成订阅授权，当前不会调用模型。',401);
  const supplied=query.get('client_id'),clientId=pending.account?.clientId??supplied;
  if(!clientId||clientId==='dynamic_agent_client'||(pending.account&&supplied&&supplied!==clientId)||!query.get('code'))throw new ServiceError('登录注册未完成，请重新开始。',401);
  const token=await this.tokenRequest({grant_type:'authorization_code',client_id:clientId,code:query.get('code'),code_verifier:pending.verifier,redirect_uri:pending.redirectUri,resource:RESOURCE});
  const claims=verifyIdToken(token.id_token,{jwks:await this.keys(),clientId,nonce:pending.nonce,now:this.now(),expectedSubject:pending.account?.subject});
  if(pending.generation!==this.loginGeneration||(pending.account&&!this.store.accounts.includes(pending.account))){
   await this.revokeToken(token.refresh_token,clientId);
   throw new ServiceError('登录请求已取消，请重新开始。',401);
  }
  const credentials=this.credentials(token);
  const account={clientId,subject:claims.sub,issuer:claims.iss,label:(typeof claims.email==='string'?claims.email:'ChatGPT')+' · '+clientId.slice(-6),...credentials};
  this.store.accounts=this.store.accounts.filter(a=>a.clientId!==clientId);this.store.accounts.push(account);this.store.activeClientId=clientId;await this.save();return this.status();
 }
 async select(clientId){if(!this.store.accounts.some(a=>a.clientId===clientId))throw new ServiceError('账户不存在。');this.store.activeClientId=clientId;await this.save();}
 async accessToken(clientId=this.store.activeClientId){
  const account=this.store.accounts.find(a=>a.clientId===clientId);if(!account?.accessToken||!account.scopes?.includes('chatgpt.tokens.use.direct'))throw new ServiceError('请先在本机学习设置中连接 ChatGPT 订阅。',401);
  if(account.expiresAt>this.now()+60000)return account.accessToken;
  if(!this.refreshing.has(account)){
   const generation=this.generations.get(account)??0;
   const promise=(async()=>{
    const token=await this.tokenRequest({grant_type:'refresh_token',client_id:account.clientId,refresh_token:account.refreshToken,resource:RESOURCE});
    if(token.id_token)verifyIdToken(token.id_token,{jwks:await this.keys(),clientId:account.clientId,now:this.now(),expectedSubject:account.subject});
    if((this.generations.get(account)??0)!==generation||!this.store.accounts.includes(account)){
     await this.revokeToken(token.refresh_token,account.clientId);
     throw new ServiceError('账户授权已结束，请重新提交。',401);
    }
    Object.assign(account,this.credentials(token,account));await this.save();return account.accessToken;
   })().finally(()=>{if(this.refreshing.get(account)===promise)this.refreshing.delete(account);});
   this.refreshing.set(account,promise);
  }
  return this.refreshing.get(account);
 }
 async revokeToken(token,clientId){
  try{const metadata=await this.metadata();if(metadata.revocation_endpoint&&token){const r=await this.fetch(metadata.revocation_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token,token_type_hint:'refresh_token',client_id:clientId}),signal:AbortSignal.timeout(15000),redirect:'error'});return r.status===200;}}catch{}
  return false;
 }
 async logout(){
  this.loginGeneration++;this.pending.clear();
  const account=this.active();if(!account)return {remoteRevoked:true};let remoteRevoked=false;
  this.generations.set(account,(this.generations.get(account)??0)+1);this.refreshing.delete(account);
  const refreshToken=account.refreshToken;
  for(const field of ['accessToken','refreshToken','idToken','expiresAt','scopes'])delete account[field];
  remoteRevoked=await this.revokeToken(refreshToken,account.clientId);
  this.pending.clear();await this.save();return {remoteRevoked};
 }
}
