export const AUTH_KEY='toefl-cloud-auth-v1';
export class CloudAuth{
 constructor(config,storage,fetcher=fetch){this.config=config;this.storage=storage;this.fetcher=fetcher;this.session=null;this.generation=0;this.refreshing=null;}
 async request(path,{method='GET',body,token}={}){
  const fetcher=this.fetcher;const response=await fetcher(this.config.url+path,{method,headers:{apikey:this.config.key,'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{throw Error('云端返回格式无效，请稍后重试。');}
  if(!response.ok){const error=new Error(String(data?.msg??data?.message??data?.error_description??'云同步请求失败，请重新登录或稍后重试。').slice(0,300));error.status=response.status;throw error;}return data;
 }
 save(data,epoch){
  if(epoch!==this.generation)throw Error('登录操作已取消。');
  if(!data||typeof data.access_token!=='string'||typeof data.refresh_token!=='string'||typeof data.user?.id!=='string'||!Number.isFinite(data.expires_in))throw Error('登录响应不完整，请重试。');
  const session={access_token:data.access_token,refresh_token:data.refresh_token,user:{id:data.user.id,email:data.user.email??''},expires_at:Date.now()+data.expires_in*1000};
  this.storage.setItem(AUTH_KEY,JSON.stringify(session));this.session=session;return session.user;
 }
 async sendCode(email,redirect){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('请输入有效邮箱。');await this.request('/auth/v1/otp'+(redirect?'?redirect_to='+encodeURIComponent(redirect):''),{method:'POST',body:{email,create_user:true}});}
 async verify(email,token){if(!/^\d{6,10}$/.test(token))throw Error('请输入邮件中的验证码。');const epoch=this.generation;const data=await this.request('/auth/v1/verify',{method:'POST',body:{email,token,type:'email'}});return this.save(data,epoch);}
 async consumeCallback(hash){
  const params=new URLSearchParams(hash.replace(/^#/,''));
  if(params.has('error_description'))throw Error(params.get('error_description').slice(0,300));
  const access_token=params.get('access_token'),refresh_token=params.get('refresh_token'),expires_in=Number(params.get('expires_in'));
  if(!access_token||!refresh_token||!Number.isFinite(expires_in)||expires_in<=0)throw Error('登录链接不完整或已过期，请重新发送。');
  const epoch=this.generation;const user=await this.request('/auth/v1/user',{token:access_token});
  return this.save({access_token,refresh_token,expires_in,user},epoch);
 }
 async restore(){
  const raw=this.storage.getItem(AUTH_KEY);if(!raw)return null;
  const data=JSON.parse(raw);if(typeof data.access_token!=='string'||typeof data.refresh_token!=='string'||typeof data.user?.id!=='string'||!Number.isFinite(data.expires_at))throw Error('云同步登录存档无法读取，请退出后重新登录。');
  this.session=data;const epoch=this.generation;const token=await this.token();const user=await this.request('/auth/v1/user',{token});
  if(epoch!==this.generation)throw Error('登录操作已取消。');if(user?.id!==this.session.user.id)throw Error('登录账号验证失败。');return user;
 }
 async token(){
  if(!this.session)throw Error('请先登录云同步。');
  if(this.session.expires_at>Date.now()+60000)return this.session.access_token;
  if(!this.refreshing){const epoch=this.generation,refresh=this.session.refresh_token,owner=this.session.user.id;this.refreshing=this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refresh}}).then(data=>{if(data?.user?.id!==owner)throw Error('刷新后的账号不一致，请重新登录。');return this.save(data,epoch);}).finally(()=>{this.refreshing=null;});}
  await this.refreshing;return this.session.access_token;
 }
 async logout(){
  const token=this.session?.access_token;this.generation++;this.session=null;this.storage.removeItem(AUTH_KEY);
  if(token)try{await this.request('/auth/v1/logout?scope=local',{method:'POST',token});}catch{/* Local session is already removed. */}
 }
 transport(userId){return {
  read:async()=>{const token=await this.token();const rows=await this.request('/rest/v1/toefl_progress?select=revision,document&user_id=eq.'+encodeURIComponent(userId),{token});if(!Array.isArray(rows)||rows.length>1)throw Error('同步数据响应无效。');return rows[0]??{revision:0,document:null};},
  write:async(revision,document)=>{const token=await this.token();const result=await this.request('/rest/v1/rpc/save_toefl_progress',{method:'POST',token,body:{expected_revision:revision,new_document:document}});if(typeof result!=='boolean')throw Error('云端未确认保存，请重试。');return result;}
 };}
}
