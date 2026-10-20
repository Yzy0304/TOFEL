import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
let auth={},provider={},server={};
for(const [path,target] of [['../local/auth.mjs',auth],['../local/provider.mjs',provider],['../server.mjs',server]])try{Object.assign(target,await import(path));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const now=Date.parse('2026-10-19T04:00:00Z');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'};
function token(claims={}){const h=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');const p=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'user1',nonce:'n1',exp:now/1000+60,iat:now/1000,...claims})).toString('base64url');return `${h}.${p}.${sign('RSA-SHA256',Buffer.from(`${h}.${p}`),privateKey).toString('base64url')}`;}
test('local service exports auth, stream and server boundaries',()=>{assert.equal(typeof auth.ChatGPTAuth,'function');assert.equal(typeof auth.verifyIdToken,'function');assert.equal(typeof provider.readResponseStream,'function');assert.equal(typeof server.createLocalServer,'function');});
test('ID tokens require a valid signature, issued-client audience, expiry and pending nonce',()=>{
 const options={jwks:{keys:[jwk]},clientId:'oaiapp_test',nonce:'n1',now};assert.equal(auth.verifyIdToken(token(),options).sub,'user1');
 for(const claims of [{iss:'https://evil.invalid'},{aud:'other'},{nonce:'bad'},{exp:now/1000-1},{sub:''}])assert.throws(()=>auth.verifyIdToken(token(claims),options));
 const damaged=token().split('.');damaged[1]=Buffer.from(JSON.stringify({sub:'attacker'})).toString('base64url');assert.throws(()=>auth.verifyIdToken(damaged.join('.'),options));
});
function stream(events){return new Response(new ReadableStream({start(c){const text=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('');const bytes=new TextEncoder().encode(text);c.enqueue(bytes.slice(0,17));c.enqueue(bytes.slice(17));c.close();}}));}
test('Responses streams require completed inference and reject interrupted or late-limit failures',async()=>{
 const delta={type:'response.output_text.delta',delta:'{"ok":true}'};
 assert.equal(await provider.readResponseStream(stream([delta,{type:'response.completed',response:{output:[]}}])),'{"ok":true}');
 await assert.rejects(provider.readResponseStream(stream([delta])));
 await assert.rejects(provider.readResponseStream(stream([delta,{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])));
 await assert.rejects(provider.readResponseStream(stream([{type:'response.incomplete'}])));
});
test('local HTTP API blocks foreign origins, hidden files and unauthorized assessment',async t=>{
 const fakeAuth={status:()=>({authenticated:false,accounts:[],activeAccount:null}),initialize:async()=>{},close:async()=>{}};
 const app=await server.createLocalServer({auth:fakeAuth,port:0});await app.listen();t.after(()=>app.close());const base=app.origin;
 assert.equal((await fetch(base+'/api/status')).status,200);
 assert.equal((await fetch(base+'/.git/config')).status,404);
 assert.equal((await fetch(base+'/local/auth.mjs')).status,404);
 assert.equal((await fetch(base+'/server.mjs')).status,404);
 assert.equal((await fetch(base+'/api/assess',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json','x-toefl-client':'1'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/assess',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/assess',{method:'POST',headers:{origin:base,'content-type':'application/json','x-toefl-client':'1'},body:JSON.stringify({cardId:'email-001',mode:'recall',answer:'Please help me register.'})})).status,401);
});

test('subscription registration uses PKCE and validated scopes, protects storage, and serializes refresh',async t=>{
 const {mkdtemp,rm,readFile,stat}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'toefl-auth-'));let time=now,refreshCalls=0,pkce;
 const fakeFetch=async(url,options={})=>{
  if(url.endsWith('/.well-known/openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/keys',revocation_endpoint:'https://auth.openai.com/revoke'});
  if(url.endsWith('/keys'))return Response.json({keys:[jwk]});
  if(url.endsWith('/oauth/token')){
   const form=new URLSearchParams(options.body);
   assert.equal(form.get('client_id'),'oaiapp_test');assert.equal(form.get('resource'),'https://api.openai.com/v1');
   if(form.get('grant_type')==='refresh_token'){refreshCalls++;await new Promise(resolve=>setTimeout(resolve,10));return Response.json({access_token:'renewed',refresh_token:'rotated',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'});}
   assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),pkce);
   return Response.json({access_token:'first',refresh_token:'refresh1',id_token:token({nonce:nonce,exp:now/1000+3600}),token_type:'Bearer',expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'});
  }
  return new Response('',{status:503});
 };
 const connection=new auth.ChatGPTAuth({dataDir:dir,fetchImpl:fakeFetch,now:()=>time});await connection.initialize();t.after(async()=>{await connection.close();await rm(dir,{recursive:true,force:true});});
 const url=new URL(connection.beginLogin('http://127.0.0.1:4173'));const nonce=url.searchParams.get('nonce');pkce=url.searchParams.get('code_challenge');
 assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('agent_name_hint'),'TOEFL Card Studio');
 await connection.completeLogin(new URLSearchParams({state:url.searchParams.get('state'),client_id:'oaiapp_test',code:'test-code'}));
 assert.equal(connection.status().authenticated,true);assert.equal((await stat(join(dir,'accounts.json'))).mode&0o777,0o600);
 assert.ok(!JSON.stringify(connection.status()).includes('first'));assert.ok(!JSON.stringify(connection.status()).includes('refresh1'));
 await assert.rejects(connection.completeLogin(new URLSearchParams({state:url.searchParams.get('state'),client_id:'oaiapp_test',code:'test-code'})));
 const returning=new URL(connection.beginLogin('http://127.0.0.1:4173','oaiapp_test'));assert.equal(returning.searchParams.get('client_id'),'oaiapp_test');assert.equal(returning.searchParams.get('agent_name_hint'),null);assert.equal(returning.searchParams.get('ext_agent_host_id'),url.searchParams.get('ext_agent_host_id'));
 time+=3600000;assert.deepEqual(await Promise.all([connection.accessToken(),connection.accessToken()]),['renewed','renewed']);assert.equal(refreshCalls,1);
 const stored=JSON.parse(await readFile(join(dir,'accounts.json'),'utf8'));assert.equal(stored.accounts[0].refreshToken,'rotated');
 const logout=await connection.logout();assert.equal(logout.remoteRevoked,false);assert.equal(connection.status().authenticated,false);await assert.rejects(connection.accessToken());
});

function memoryAuth(){
 const connection=new auth.ChatGPTAuth({now:()=>now});connection.save=async()=>{};
 connection.store.accounts=['A','B'].map(clientId=>({clientId,subject:clientId,label:clientId,accessToken:clientId+'-old',refreshToken:clientId+'-refresh',expiresAt:now-1,scopes:['resource.invoke','chatgpt.tokens.use.direct']}));
 connection.store.activeClientId='A';return connection;
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const refreshed=id=>({access_token:id+'-new',refresh_token:id+'-rotated',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'});
test('refreshes remain isolated when the selected account changes',async()=>{
 const connection=memoryAuth(),gate=deferred(),started=deferred();
 connection.tokenRequest=async form=>{if(form.client_id==='A'){started.resolve();await gate.promise;}return refreshed(form.client_id);};
 const first=connection.accessToken();await started.promise;await connection.select('B');const second=connection.accessToken();gate.resolve();
 assert.deepEqual(await Promise.all([first,second]),['A-new','B-new']);
});
test('logout invalidates outstanding refreshes and never restores credentials',async()=>{
 const connection=memoryAuth(),gate=deferred(),started=deferred();connection.metadata=async()=>({});
 connection.tokenRequest=async()=>{started.resolve();await gate.promise;return refreshed('A');};
 const pending=connection.accessToken();const rejected=assert.rejects(pending);await started.promise;await connection.logout();
 assert.equal(connection.status().authenticated,false);gate.resolve();await rejected;assert.equal(connection.status().authenticated,false);
 assert.equal(connection.active().refreshToken,undefined);
});
test('inference keeps the account selected when the request started',async()=>{
 let id='A';const used=[];const gate=deferred(),started=deferred();
 const connection={status:()=>({activeAccount:{id}}),accessToken:async(accountId=id)=>accountId+'-token'};
 const subject=new provider.ChatGPTProvider(connection,{fetchImpl:async(url,options)=>{
  used.push(options.headers.authorization);
  if(url.endsWith('/models')){started.resolve();await gate.promise;return Response.json({models:[{visibility:'list',slug:'test-model',display_name:'Test'}]});}
  return stream([{type:'response.output_text.delta',delta:JSON.stringify({category:'correct',taskMatch:true,explanation:'表达正确。',correctedAnswer:'Hello.',naturalAnswer:'',issues:[],tags:[]})},{type:'response.completed',response:{output:[]}}]);
 }});
 const pending=subject.assess({id:'e1',module:'email',phrase:'Hello',meaning:'你好',example:'Hello.'},'recall','Hello.',null);
 await started.promise;id='B';gate.resolve();await pending;
 assert.deepEqual(used,['Bearer A-token','Bearer A-token']);
});

test('logout invalidates an authorization-code exchange already in flight',async()=>{
 const connection=memoryAuth(),gate=deferred(),started=deferred();connection.metadata=async()=>({});connection.keys=async()=>({keys:[jwk]});
 const url=new URL(connection.beginLogin('http://127.0.0.1:4173','A'));
 connection.tokenRequest=async()=>{started.resolve();await gate.promise;return {...refreshed('A'),id_token:token({aud:'A',sub:'A',nonce:url.searchParams.get('nonce')})};};
 const pending=connection.completeLogin(new URLSearchParams({state:url.searchParams.get('state'),code:'test'}));const rejected=assert.rejects(pending);
 await started.promise;await connection.logout();gate.resolve();await rejected;assert.equal(connection.status().authenticated,false);
});
