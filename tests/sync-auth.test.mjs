import test from 'node:test';
import assert from 'node:assert/strict';
import * as auth from '../sync-auth.js';
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const config={url:'https://example.supabase.co',key:'sb_publishable_example'};
test('Auth transport exists',()=>assert.equal(typeof auth.CloudAuth,'function'));
test('OTP sends only email and public key; useful failure returned',async()=>{
 let sent;const a=new auth.CloudAuth(config,memory(),async(url,options)=>{sent={url,options};return new Response(JSON.stringify({msg:'Email address not authorized'}),{status:400});});
 await assert.rejects(a.sendCode('learner@example.com'),/Email address not authorized/);
 assert.equal(JSON.parse(sent.options.body).email,'learner@example.com');assert.equal(sent.options.headers.apikey,config.key);
});
test('unverified or malformed session is never saved',async()=>{
 const s=memory(),a=new auth.CloudAuth(config,s,async()=>new Response(JSON.stringify({access_token:'x'}),{status:200}));
 await assert.rejects(a.verify('a@example.com','123456'));assert.equal(a.session,null);
});
test('verification response cannot re-login after logout',async()=>{
 let release;const a=new auth.CloudAuth(config,memory(),async()=>new Promise(r=>{release=r;}));const pending=a.verify('a@example.com','123456');await a.logout();release(new Response(JSON.stringify({access_token:'a',refresh_token:'r',expires_in:3600,user:{id:'a',email:'a@example.com'}})));await assert.rejects(pending,/登录/);assert.equal(a.session,null);
});
test('email sign-in binds redirect URL and validates callback with Auth before storing',async()=>{
 const sent=[],s=memory();const a=new auth.CloudAuth(config,s,async(url,options)=>{sent.push({url,options});return new Response(JSON.stringify(url.includes('/user')?{id:'user-a',email:'a@example.com'}:{}));});
 await a.sendCode('a@example.com','https://yzy0304.github.io/TOFEL/');assert.ok(sent[0].url.includes('redirect_to='));
 await a.consumeCallback('#access_token=token&refresh_token=refresh&expires_in=3600&type=magiclink');assert.equal(a.session.user.id,'user-a');
});
test('failed callback verification does not save session',async()=>{const a=new auth.CloudAuth(config,memory(),async()=>new Response('{}',{status:401}));await assert.rejects(a.consumeCallback('#access_token=bad&refresh_token=bad&expires_in=3600'));assert.equal(a.session,null);});
test('browser fetch is invoked without a class receiver',async()=>{
 const a=new auth.CloudAuth(config,memory(),async function(){assert.equal(this,undefined);return new Response('{}');});await a.sendCode('a@example.com');
});
test('refresh cannot silently switch the account receiving progress',async()=>{
 const a=new auth.CloudAuth(config,memory(),async()=>new Response(JSON.stringify({access_token:'other',refresh_token:'other-r',expires_in:3600,user:{id:'user-b'}})));
 a.session={access_token:'a',refresh_token:'r',expires_at:0,user:{id:'user-a'}};
 await assert.rejects(a.token(),/账号/);assert.equal(a.session.user.id,'user-a');
});
