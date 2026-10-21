import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,extname} from 'node:path';
import {ChatGPTAuth,ServiceError} from './local/auth.mjs';
import {ChatGPTProvider} from './local/provider.mjs';
import {assessmentRequest,referenceAssessment} from './assessment.js';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const ASSETS=new Set(['index.html','styles.css','app.js','core.js','session.js','sync-core.js','sync-client.js','sync-auth.js','sync-ui.js','sync-config.js','docs/sync.md','assessment.js','assessment-ui.js','favicon.svg','data/cards.json','docs/handbook.md','docs/study-plan.md','docs/assessment.md']);
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.md':'text/plain'};
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const bytes of req){text+=bytes;if(Buffer.byteLength(text)>16000)throw new ServiceError('提交内容过大。',413);}try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw new ServiceError('请求格式无效。');}}
export async function createLocalServer({port=4173,auth=new ChatGPTAuth(),provider,root=ROOT}={}){
 await auth.initialize();provider??=new ChatGPTProvider(auth);const cards=JSON.parse(await readFile(join(root,'data/cards.json'),'utf8'));let origin,busy=false;
 const http=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');res.setHeader('x-frame-options','DENY');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://yrdxfkjjbttdkvnshpsq.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   if(req.headers.host!==new URL(origin).host)throw new ServiceError('请使用本机服务提供的地址。',403);
   const url=new URL(req.url,origin),path=url.pathname;
   if(req.headers.origin&&req.headers.origin!==origin)throw new ServiceError('不接受其他网站的请求。',403);
   if(req.method==='POST'&&(req.headers['x-toefl-client']!=='1'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json')))throw new ServiceError('请从本机学习页面提交。',403);
   if(req.method==='GET'&&path==='/api/status')return json(res,200,{available:true,...auth.status()});
   if(req.method==='GET'&&path==='/api/models')return json(res,200,{models:await provider.models()});
   if(req.method==='POST'&&path==='/api/auth/start'){const data=await body(req);return json(res,200,{url:auth.beginLogin(origin,data.accountId??null)});}
   if(req.method==='POST'&&path==='/api/auth/select'){const data=await body(req);await auth.select(data.accountId);return json(res,200,auth.status());}
   if(req.method==='POST'&&path==='/api/auth/logout')return json(res,200,await auth.logout());
   if(req.method==='GET'&&path==='/auth/callback'){
    await auth.completeLogin(url.searchParams);res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<!doctype html><meta charset="utf-8"><title>ChatGPT 已连接</title><h1>ChatGPT 订阅已连接</h1><p>可以关闭这个窗口，返回词境学习设置，点击刷新连接状态。</p><a href="/">返回词境</a>');
   }
   if(req.method==='POST'&&path==='/api/assess'){
    const data=await body(req);if(Object.keys(data).some(k=>!['cardId','mode','answer','model'].includes(k)))throw new ServiceError('请求字段无效。');
    const card=cards.find(c=>c.id===data.cardId);assessmentRequest(card,data.mode,data.answer);
    const exact=referenceAssessment(card,data.mode,data.answer);if(exact)return json(res,200,{result:exact,source:'reference'});
    if(!auth.status().authenticated)throw new ServiceError('请先在本机学习设置中连接 ChatGPT 订阅。',401);
    if(busy)throw new ServiceError('正在评判另一条答案，请稍后重试。',409);
    busy=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),60000);const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
    try{const outcome=await provider.assess(card,data.mode,data.answer,data.model,controller.signal);if(!res.destroyed)json(res,200,outcome);}finally{clearTimeout(timeout);res.off('close',abort);busy=false;}
    return;
   }
   if(req.method==='GET'){
    const asset=path==='/'?'index.html':path.slice(1);
    if(ASSETS.has(asset)){const content=await readFile(join(root,asset));res.writeHead(200,{'content-type':(MIME[extname(asset)]??'application/octet-stream')+'; charset=utf-8'});return res.end(content);}
   }
   json(res,404,{error:'未找到此页面或接口。'});
  }catch(error){if(res.destroyed||res.writableEnded)return;json(res,error instanceof ServiceError?error.status:error instanceof TypeError?400:502,{error:error instanceof ServiceError||error instanceof TypeError?error.message:'连接暂不可用，请重试；本次不记录成绩。'});}
 });
 return {get origin(){return origin;},async listen(){try{await new Promise((resolve,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+http.address().port;return origin;}catch(e){await auth.close();throw e;}},async close(){http.closeIdleConnections();await new Promise(resolve=>http.close(resolve));await auth.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const app=await createLocalServer({port:Number(process.env.TOEFL_PORT??4173)});console.log('词境本机服务：'+await app.listen());console.log('在学习设置中点击 Continue with ChatGPT 完成订阅授权。');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.close().finally(()=>process.exit(0));});}
 catch(error){console.error(error instanceof ServiceError?error.message:'本机服务未启动，请检查端口或本地授权文件权限。');process.exitCode=1;}
}
