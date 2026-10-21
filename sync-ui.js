import {CloudAuth} from './sync-auth.js';
import {synchronize} from './sync-client.js';
import {syncConfig} from './sync-config.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createSyncUI(store,{storage=localStorage,notify=()=>{},blocked=()=>false}={}){
 const auth=new CloudAuth(syncConfig,storage);let user=null,busy=false,timer=null,mount=null,message='已自动保存到本机；登录后可跨设备同步。',retry=0,epoch=0,unavailable=false;
 function status(text){message=text;document.querySelectorAll('[data-sync-status]').forEach(el=>{el.textContent=text;});}
 async function run(){
  if(!user||busy||blocked()||unavailable)return;
  if(!navigator.onLine){status('离线：已保存到本机，联网后自动同步。');return;}
  clearTimeout(timer);timer=null;busy=true;const generation=epoch,owner=user.id;status('正在同步学习记录…');
  try{await synchronize(store,auth.transport(owner),()=>generation===epoch&&user?.id===owner&&!blocked());if(generation===epoch){retry=0;status('已同步 · '+new Date().toLocaleTimeString('zh-CN'));}}
  catch(error){if(generation===epoch){status('已保存到本机；同步未完成：'+error.message);timer=setTimeout(run,Math.min(60000,5000*2**Math.min(retry++,4)));}}
  finally{busy=false;}
 }
 function changed(){if(!user)return;status(navigator.onLine?'已保存到本机，等待同步…':'离线：已保存到本机，联网后自动同步。');if(!timer)timer=setTimeout(()=>{timer=null;run();},3000);}
 async function accept(next){store.bindOwner(next.id);user=next;epoch++;draw();await run();}
 async function restore(){try{
  const hash=location.hash;
  if(hash.includes('access_token=')||hash.includes('error_description=')){
   history.replaceState(null,'',location.pathname+location.search);
   await accept(await auth.consumeCallback(hash));
  }else{const restored=await auth.restore();if(restored)await accept(restored);}
 }catch(error){status('本机记录已保留；云同步需重新登录：'+error.message);draw();}}
 function draw(){
  if(!mount?.isConnected)return;
  mount.innerHTML=`<h3>多设备学习进度</h3><p class="tip" data-sync-status role="status">${esc(message)}</p>${user?`<p>已登录：${esc(user.email)}</p><div class="study-actions"><button class="button" id="sync-now">立即同步</button><button class="button secondary" id="sync-logout">退出同步账号</button></div>`:`<p class="tip">手机与 Mac 使用同一个邮箱登录。登录后，本机学习记录、作答文字与反馈会合并保存到你的 Supabase 项目；录音和 ChatGPT 凭据不会上传。</p><form id="sync-login-form"><label for="sync-email">同步账号邮箱</label><input class="answer-input" type="email" id="sync-email" autocomplete="email" required placeholder="首次使用请填写 Supabase 账号邮箱"><div class="study-actions"><button class="button" type="submit" id="sync-send">发送登录邮件</button></div></form><p class="source-note">当前使用 Supabase 内置邮件服务，仅项目团队邮箱可接收邮件，发送频率受限。自己的手机和 Mac 使用同一邮箱即可。</p>`}<p class="source-note">退出后仍保留本机记录与账号归属。旧版重叠记录保守合并；新版逐条去重。<a href="./docs/sync.md" target="_blank" rel="noopener">同步与备份说明</a></p>`;
  if(user){mount.querySelector('#sync-now').onclick=run;mount.querySelector('#sync-logout').onclick=async()=>{epoch++;user=null;clearTimeout(timer);timer=null;status('已退出云同步；本机记录已保留。');draw();await auth.logout();};return;}
  const email=()=>mount.querySelector('#sync-email').value.trim();
  mount.querySelector('#sync-login-form').onsubmit=async e=>{
   e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;
   try{await auth.sendCode(email(),location.origin+location.pathname);status('登录邮件已发送。请在这台设备、这个浏览器中打开邮件里的 Sign in 链接，返回后自动合并进度。');}
   catch(error){status('发送失败：'+error.message);}finally{button.disabled=false;}
  };

 }
 window.addEventListener('online',run);document.addEventListener('visibilitychange',()=>{if(!document.hidden)run();});
 window.addEventListener('storage',e=>{if(e.key==='toefl-cloud-auth-v1'){epoch++;user=null;unavailable=true;status('另一标签页更新了登录状态，请刷新后继续同步。');draw();}});
 setInterval(()=>{if(!document.hidden)run();},30000);
 return {mount(element){mount=element;draw();},changed,run,restore,stop(){epoch++;unavailable=true;clearTimeout(timer);status('同步已暂停，请刷新页面读取最新记录。');}};
}
