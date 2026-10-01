import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { APIContext } from 'astro';
import { ALL } from '../src/pages/api/rifas/[...path].ts';
import type { Raffle } from '../src/lib/model.ts';
import { emailKey, canManage, normalizeEmail } from '../src/lib/access';
import { winnerNumbers } from '../src/lib/draw';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP5sAAAAASUVORK5CYII=';
const fixture=():Raffle=>({public:{title:'Rifa de Ana',ownerId:'ana',organizer:'Ana',createdAt:1,ticketCount:3,prizes:[{name:'Premio',image:png}],sold:{'1':1,'2':2,'3':3}},entries:{'1':{buyer:'Dato privado',contact:'555',soldAt:1}}});
const context=(path:string,method:string,body?:unknown,uid='ana',origin='http://localhost:4321',verified=true)=>{
  const url=new URL(`http://localhost:4321/api/rifas/${path}`);
  return {url,request:new Request(url,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),params:{path:url.pathname.replace('/api/rifas/','')},locals:{token:'mock-token',user:{uid,name:uid,email:`${uid}@example.com`,emailVerified:verified,photo:''}}} as unknown as APIContext;
};
function mockDatabase(t:TestContext,raffle=fixture()) {
  const old=process.env.PUBLIC_FIREBASE_DATABASE_URL,oldOrigin=process.env.APP_ORIGIN;
  process.env.PUBLIC_FIREBASE_DATABASE_URL='https://database.test';process.env.APP_ORIGIN='http://localhost:4321';
  t.after(()=>{if(old===undefined)delete process.env.PUBLIC_FIREBASE_DATABASE_URL;else process.env.PUBLIC_FIREBASE_DATABASE_URL=old;if(oldOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=oldOrigin;});
  const state:Record<string,any>={raffles:{example:raffle},users:{ana:{raffles:{example:true}}},raffleAdmins:{},sharedRaffles:{},raffleHistory:{}};
  const patches:Record<string,any>[]=[];
  function read(path:string){return path.split('/').filter(Boolean).reduce((value,k)=>value?.[k],state)??null;}
  t.mock.method(globalThis,'fetch',async(input:unknown,init:RequestInit={})=>{
    const url=new URL(String(input)),path=url.pathname.slice(1).replace(/\.json$/,'');
    if(init.method==='PATCH'){
      const patch=JSON.parse(String(init.body));patches.push(patch);
      for(const [path,value]of Object.entries(patch)){const keys=path.split('/');let target=state;for(const key of keys.slice(0,-1)){target[key] ||= {};target=target[key];}if(value===null)delete target[keys.at(-1)!];else target[keys.at(-1)!]=value;}
      return new Response('null');
    }
    return new Response(JSON.stringify(read(path)));
  });
  const grant=(uid='bob')=>{const key=emailKey(`${uid}@example.com`);state.raffleAdmins.example ||= {};state.raffleAdmins.example[key]={email:`${uid}@example.com`,invitedBy:'ana',invitedAt:1};state.sharedRaffles[key]={example:true};};
  return {state,patches,grant};
}

test('owner deletion atomically removes the raffle, invitations, history and every index',async t=>{
  const {patches,grant}=mockDatabase(t);grant();
  assert.equal((await ALL(context('example','DELETE'))).status,200);
  assert.deepEqual(patches[0],{'raffles/example':null,'users/ana/raffles/example':null,'raffleAdmins/example':null,'raffleHistory/example':null,'sharedRaffles/bob@example,com/example':null});
});
test('a collaborator or a cross-origin request cannot delete a raffle',async t=>{
  const {patches,grant}=mockDatabase(t);grant();
  assert.equal((await ALL(context('example','DELETE',undefined,'bob'))).status,403);
  assert.equal((await ALL(context('example','DELETE',undefined,'ana','https://attacker.example'))).status,403);assert.equal(patches.length,0);
});
test('draw API persists one elimination per request, audits the actor and rejects a stale round',async t=>{
  const {state,patches,grant}=mockDatabase(t);grant();
  const first=await ALL(context('example/sortear','POST',{spins:2,expectedRound:0},'bob'));assert.equal(first.status,200);
  const elimination=await first.json();assert.equal(elimination.result,null);assert.equal(elimination.draw.round,1);
  assert.equal((await ALL(context('example/sortear','POST',{expectedRound:0},'ana'))).status,409);
  const last=await ALL(context('example/sortear','POST',{expectedRound:1},'ana'));assert.equal(last.status,200);
  const winner=await last.json();assert.equal(winner.draw.round,2);assert.notEqual(winner.result.number,elimination.draw.lastNumber);
  assert.equal(state.raffles.example.version,2);assert.equal(patches.length,2);
  assert.deepEqual(Object.values(state.raffleHistory.example).map((e:any)=>e.actor.uid),['bob','ana']);
});
test('configuration and ticket editing reject stale form versions',async t=>{
  const {patches}=mockDatabase(t);
  assert.equal((await ALL(context('example/configurar','POST',{title:'Nuevo título',expectedVersion:99}))).status,409);
  assert.equal((await ALL(context('example/editar-boleto','POST',{number:1,buyer:'Corrected',expectedVersion:99}))).status,409);assert.equal(patches.length,0);
});
test('a co-admin can correct buyer details, view private history and release a ticket',async t=>{
  const {state,grant}=mockDatabase(t);grant();
  const edited=await ALL(context('example/editar-boleto','POST',{number:1,buyer:'María',contact:'777',seller:'Vendedor',expectedVersion:0,modifiedBy:{uid:'forged'}},'bob'));
  assert.equal(edited.status,200);assert.equal(state.raffles.example.entries['1'].modifiedBy.uid,'bob');
  const history=await ALL(context('example/historial','GET',undefined,'bob'));assert.equal(history.status,200);
  const event=(await history.json()).events[0];assert.equal(event.before.buyer,'Dato privado');assert.equal(event.after.buyer,'María');assert.equal(event.actor.email,'bob@example.com');
  const released=await ALL(context('example/editar-boleto','POST',{number:1,available:true,expectedVersion:1},'bob'));assert.equal(released.status,200);
  assert.equal(state.raffles.example.entries['1'],undefined);assert.equal(state.raffles.example.public.sold['1'],undefined);
  assert.doesNotMatch(JSON.stringify(state.raffles.example.public),/María|777|bob@example.com/);
});
test('email-only invitation and revocation update permissions, listing and history atomically',async t=>{
  const {state,patches}=mockDatabase(t);
  assert.equal((await ALL(context('example/administradores','POST',{email:' BOB@Example.Com '}))).status,200);
  assert.equal(state.raffleAdmins.example['bob@example,com'].email,'bob@example.com');assert.equal(state.sharedRaffles['bob@example,com'].example,true);
  assert.equal(Object.keys(patches[0]).length,3);
  const profile=await ALL(context('','GET',undefined,'bob'));assert.equal((await profile.json()).raffles[0].id,'example');
  assert.equal((await ALL(context('example','GET',undefined,'bob'))).status,200);
  assert.equal((await ALL(context('example/administradores','POST',{email:'charlie@example.com'},'bob'))).status,403);
  assert.equal((await ALL(context('example/administradores','POST',{email:'bob@example.com',remove:true}))).status,200);
  assert.equal((await ALL(context('example','GET',undefined,'bob'))).status,403);assert.deepEqual((await (await ALL(context('','GET',undefined,'bob'))).json()).raffles,[]);
});
test('only verified exact Google email matches grant shared access',async t=>{
  const {grant}=mockDatabase(t);grant();
  assert.equal((await ALL(context('example','GET',undefined,'bob',undefined,false))).status,403);
  assert.equal((await ALL(context('example','GET',undefined,'charlie'))).status,403);
  assert.equal(emailKey(' Nombre.Prueba@Example.COM '),'nombre,prueba@example,com');
  assert.throws(()=>normalizeEmail('bad/#email'));
  assert.equal(canManage(fixture().public,{uid:'bob',name:'Bob',email:'bob@example.com',emailVerified:false},{'bob@example,com':{email:'bob@example.com',invitedBy:'ana',invitedAt:1}}),false);
});
test('shared sales record the verified actor, preserve private buyers and prevent duplicates',async t=>{
  const empty=fixture();empty.public.sold={};delete empty.entries;const {state,grant}=mockDatabase(t,empty);grant();
  assert.equal((await ALL(context('example/configurar','POST',{title:'Rifa editada',prizes:empty.public.prizes,whatsapp:'+52 (951) 123-4567',cover:'',expectedVersion:0},'bob'))).status,200);
  assert.equal(state.raffles.example.public.whatsapp,'529511234567');
  const configured=Object.values(state.raffleHistory.example)[0] as any;assert.equal(configured.changes.find((c:any)=>c.field==='Título').after,'Rifa editada');
  assert.equal((await ALL(context('example/vender','POST',{number:3,buyer:'María',contact:'555',seller:'Juan',actor:{uid:'fake'}},'bob'))).status,200);
  assert.equal(state.raffles.example.entries['3'].modifiedBy.uid,'bob');assert.equal(state.raffles.example.entries['3'].seller,'Juan');
  assert.equal((await ALL(context('example/vender','POST',{number:3,buyer:'Otro'}))).status,409);assert.equal(state.raffles.example.entries['3'].buyer,'María');
});
test('a concurrent Firebase version rejection becomes an actionable conflict',async t=>{
  mockDatabase(t);let saved=fixture();
  t.mock.method(globalThis,'fetch',async(input:unknown,init:RequestInit={})=>{
    if(init.method==='PATCH'){saved.version=1;return new Response('permission denied',{status:403});}
    const path=new URL(String(input)).pathname;
    return new Response(JSON.stringify(path.includes('raffleAdmins')?{}:path.endsWith('/public.json')?saved.public:saved));
  });
  const response=await ALL(context('example/sortear','POST',{spins:2,expectedRound:0}));assert.equal(response.status,409);assert.match((await response.json()).error,/Otro administrador/);
});

test('shared administrators choose multiple winners one by one and audit every winner before finalizing',async t=>{
  const {state,grant}=mockDatabase(t);grant();
  const first=await ALL(context('example/sortear','POST',{spins:3,winnerCount:2,expectedRound:0},'bob'));
  assert.equal(first.status,200);assert.equal((await first.json()).result,null);assert.equal(winnerNumbers(state.raffles.example.public).length,0);
  const changed=await ALL(context('example/sortear','POST',{winnerCount:1,expectedRound:1}));assert.equal(changed.status,409);
  const second=await ALL(context('example/sortear','POST',{expectedRound:1}));assert.equal(second.status,200);assert.equal((await second.json()).result,null);
  const firstWinner=winnerNumbers(state.raffles.example.public)[0];
  assert.equal(Object.values(state.raffleHistory.example).some((e:any)=>e.description.includes('ganador 1')),true);
  const final=await ALL(context('example/sortear','POST',{expectedRound:2},'bob'));assert.equal(final.status,200);assert.ok((await final.json()).result);
  const winners=winnerNumbers(state.raffles.example.public);assert.equal(winners.length,2);assert.equal(winners[0],firstWinner);assert.notEqual(winners[0],winners[1]);
  assert.equal(Object.values(state.raffleHistory.example).some((e:any)=>e.description.includes('ganador 2')),true);
  assert.equal((await ALL(context('example/sortear','POST',{expectedRound:3}))).status,409);
});

test('draw response supplies the actual winner name publicly without returning private buyer records',async t=>{
  const r=fixture();r.public.sold={'1':1};r.entries!['1'].seller='Vendedor privado';
  const {state}=mockDatabase(t,r);
  const response=await ALL(context('example/sortear','POST',{expectedRound:0,winnerNames:{1:'Falso'}}));
  assert.equal(response.status,200);
  const body=await response.json();assert.deepEqual(body.winnerNames,{'1':'Dato privado'});
  assert.deepEqual(state.raffles.example.public.winnerNames,{'1':'Dato privado'});
  assert.doesNotMatch(JSON.stringify(body),/555|Vendedor privado|Falso|contact|seller|entries/);
});
