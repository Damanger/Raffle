import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, get, set, update } from 'firebase/database';
import { createRaffle, sellTicket, editTicket, drawRaffle, configureRaffle, type Raffle } from '../src/lib/model';
import { auditEvent, auditedUpdate } from '../src/lib/audit';
import { emailKey, type Actor } from '../src/lib/access';
import { winnerNumbers, eliminatedNumbers } from '../src/lib/draw';

let env: RulesTestEnvironment;
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP5sAAAAASUVORK5CYII=';
const actor = (uid='ana'): Actor => ({uid,name:uid,email:`${uid}@example.com`});
const signed = (uid='ana', verified=true) => env.authenticatedContext(uid,{email:actor(uid).email,email_verified:verified,firebase:{sign_in_provider:'google.com'}}).database();
const payload = () => createRaffle({title:'Rifa segura',ticketCount:10,prizes:[{name:'Premio',image:png}]},'ana','Ana');
const change = (id:string, raffle:Raffle, uid='ana', kind='raffle.updated') => { const event=auditEvent(actor(uid),kind,'Cambio registrado');return auditedUpdate(id,raffle,event.id,event.event); };
async function create(id:string) { const raffle=payload();await assertSucceeds(update(ref(signed()),{...change(id,raffle),[`users/ana/raffles/${id}`]:true}));return raffle; }
async function invite(id:string,uid='bob') { await assertSucceeds(update(ref(signed()),{[`raffleAdmins/${id}/${emailKey(actor(uid).email)}`]:{email:actor(uid).email,invitedBy:'ana',invitedAt:Date.now()},[`sharedRaffles/${emailKey(actor(uid).email)}/${id}`]:true})); }
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-rifas',database:{host:'127.0.0.1',port:9000,rules:readFileSync('database.rules.json','utf8')}});await env.clearDatabase();});
after(async()=>{await env?.cleanup();});

test('audited creation is atomic; public readers cannot see buyers, admins or history',async()=>{
  const r=await create('privacy');sellTicket(r,{number:1,buyer:'Comprador privado',contact:'555'},actor());
  await assertSucceeds(update(ref(signed()),change('privacy',r)));
  const anon=env.unauthenticatedContext().database();
  await assertSucceeds(get(ref(anon,'raffles/privacy/public')));
  for(const path of ['raffles/privacy','raffles/privacy/entries','raffleAdmins/privacy','raffleHistory/privacy','users/ana/raffles']) await assertFails(get(ref(anon,path)));
  await assertSucceeds(get(ref(signed(),'raffles/privacy/entries')));
  await assertFails(set(ref(signed(),'raffles/unaudited'),payload()));
});
test('email invitation works before first login and shared index is private',async()=>{
  await create('shared');await invite('shared');
  const bob=signed('bob');
  await assertSucceeds(get(ref(bob,'sharedRaffles/bob@example,com')));
  await assertSucceeds(get(ref(bob,'raffles/shared')));
  await assertSucceeds(get(ref(bob,'raffleAdmins/shared')));
  await assertFails(get(ref(signed('charlie'),'raffles/shared')));
  await assertFails(get(ref(signed('bob',false),'raffles/shared')));
  await assertFails(get(ref(signed('charlie'),'sharedRaffles/bob@example,com')));
  await assertSucceeds(get(ref(signed('charlie'),'raffleAdmins/shared/charlie@example,com')));
});
test('co-admins register, correct and release buyers with their own identity; history cannot be overwritten',async()=>{
  const r=await create('edits');await invite('edits');
  sellTicket(r,{number:2,buyer:'María',contact:'555'},actor());
  await assertSucceeds(update(ref(signed()),change('edits',r)));
  editTicket(r,{number:2,buyer:'María corregida',contact:'777'},actor('bob'));
  const patch=change('edits',r,'bob','ticket.edited');
  await assertSucceeds(update(ref(signed('bob')),patch));
  assert.equal((await get(ref(signed('bob'),'raffles/edits/entries/2/modifiedBy/uid'))).val(),'bob');
  const eventPath=Object.keys(patch).find(k=>k.startsWith('raffleHistory/'))!;
  await assertFails(set(ref(signed('bob'),eventPath),null));
  await assertFails(set(ref(signed(),`${eventPath}/description`),'Ocultar cambio'));
  editTicket(r,{number:2,available:true},actor('bob'));
  await assertSucceeds(update(ref(signed('bob')),change('edits',r,'bob','ticket.released')));
  assert.equal((await get(ref(signed(),'raffles/edits/entries/2'))).exists(),false);
});
test('a collaborator preserves untouched buyers attributed to a different administrator',async()=>{
  const r=await create('preserve');await invite('preserve');
  sellTicket(r,{number:1,buyer:'Ana buyer'},actor());await assertSucceeds(update(ref(signed()),change('preserve',r)));
  sellTicket(r,{number:2,buyer:'Bob buyer'},actor('bob'));await assertSucceeds(update(ref(signed('bob')),change('preserve',r,'bob')));
  assert.equal((await get(ref(signed(),'raffles/preserve/entries/1/modifiedBy/uid'))).val(),'ana');
  const forged=structuredClone(r);forged.entries!['2'].modifiedBy=actor();
  await assertFails(update(ref(signed('bob')),change('preserve',forged,'bob')));
});
test('collaborators cannot grant permissions, change ownership, forge audit identity or delete a raffle',async()=>{
  const r=await create('acl');await invite('acl');const bob=signed('bob');
  await assertFails(set(ref(bob,'raffleAdmins/acl/charlie@example,com'),{email:'charlie@example.com',invitedBy:'bob',invitedAt:1}));
  await assertFails(set(ref(bob,'sharedRaffles/charlie@example,com/acl'),true));
  await assertFails(set(ref(bob,'raffles/acl/public/ownerId'),'bob'));
  await assertFails(update(ref(bob),{'raffles/acl':null,'users/ana/raffles/acl':null}));
  const event=auditEvent(actor(),'ticket.edited','Identidad falsa');
  await assertFails(update(ref(bob),auditedUpdate('acl',r,event.id,event.event)));
});
test('revoking access removes shared listing and immediately prevents reads and writes',async()=>{
  const r=await create('revoked');await invite('revoked');
  await assertSucceeds(update(ref(signed()),{'raffleAdmins/revoked/bob@example,com':null,'sharedRaffles/bob@example,com/revoked':null}));
  await assertFails(get(ref(signed('bob'),'raffles/revoked')));
  sellTicket(r,{number:1,buyer:'Revoked'},actor('bob'));await assertFails(update(ref(signed('bob')),change('revoked',r,'bob')));
  assert.equal((await get(ref(signed('bob'),'sharedRaffles/bob@example,com/revoked'))).exists(),false);
});
test('version validation prevents simultaneous writes and unaudited modifications',async()=>{
  const r=await create('race');await invite('race');const a=structuredClone(r),b=structuredClone(r);
  sellTicket(a,{number:1,buyer:'Ana buyer'},actor());sellTicket(b,{number:2,buyer:'Bob buyer'},actor('bob'));
  const results=await Promise.allSettled([update(ref(signed()),change('race',a)),update(ref(signed('bob')),change('race',b,'bob'))]);
  assert.deepEqual(results.map(x=>x.status).sort(),['fulfilled','rejected']);
  await assertFails(set(ref(signed(),'raffles/race/public/title'),'Cambio sin historial'));
});
test('co-admins can configure title and prizes; invalid images and immutable ticket counts are rejected',async()=>{
  const r=await create('settings');await invite('settings');
  configureRaffle(r,{title:'Otro título',prizes:[{name:'Nuevo premio',image:png}],cover:png,whatsapp:'529511234567'});
  const event=auditEvent(actor('bob'),'raffle.updated','Cambió los datos de la rifa',{changes:[{field:'Título',before:'Rifa segura',after:'Otro título'}]});
  await assertSucceeds(update(ref(signed('bob')),auditedUpdate('settings',r,event.id,event.event)));
  const bad=structuredClone(r);bad.public.ticketCount=11;await assertFails(update(ref(signed()),change('settings',bad)));
  const image=structuredClone(r);image.public.prizes[0].image='data:text/html;base64,PHNjcmlwdD4=';await assertFails(update(ref(signed()),change('settings',image)));
});
test('shared draw rounds preserve eliminations and final winner; sales close on first spin',async()=>{
  const r=await create('rounds');await invite('rounds');
  for(const number of [1,2,3])sellTicket(r,{number,buyer:`Buyer ${number}`},actor());await assertSucceeds(update(ref(signed()),change('rounds',r)));
  for(let round=0;round<3;round++){drawRaffle(r,{spins:3,expectedRound:round});await assertSucceeds(update(ref(signed('bob')),change('rounds',r,'bob','raffle.drawn')));}
  assert.equal(r.public.draw?.round,3);assert.equal(new Set(r.public.draw?.history.split(',')).size,3);
  const frozen=structuredClone(r);frozen.public.title='Changed after winner';await assertFails(update(ref(signed()),change('rounds',frozen)));
  await assertFails(set(ref(signed('bob'),'raffles/rounds/public/result'),null));
});
test('owner deletion atomically removes buyers, images, invitations, history and indexes',async()=>{
  await create('delete');await invite('delete');
  await assertFails(set(ref(signed(),'raffles/delete'),null));
  await assertFails(set(ref(signed(),'raffleHistory/delete'),null));
  await assertSucceeds(update(ref(signed()),{'raffles/delete':null,'users/ana/raffles/delete':null,'raffleAdmins/delete':null,'raffleHistory/delete':null,'sharedRaffles/bob@example,com/delete':null}));
  await env.withSecurityRulesDisabled(async context=>{for(const path of ['raffles/delete','raffleAdmins/delete','raffleHistory/delete','users/ana/raffles/delete','sharedRaffles/bob@example,com/delete'])assert.equal((await get(ref(context.database(),path))).exists(),false);});
});
test('legacy raffle can upgrade to audited edits; original 319 imported buyers keep their data',async()=>{
  const legacy=payload();await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),'raffles/legacy'),legacy));
  sellTicket(legacy,{number:1,buyer:'Legacy buyer'},actor());await assertSucceeds(update(ref(signed()),change('legacy',legacy)));
  const tickets=JSON.parse(readFileSync('data/private/buffet.json','utf8')).tickets;
  const imported=createRaffle({title:'Rifa importada',ticketCount:720,prizes:payload().public.prizes,importedTickets:tickets},'ana','Ana');
  for(const entry of Object.values(imported.entries||{})){entry.modifiedBy=actor();entry.modifiedAt=Date.now();}
  await assertSucceeds(update(ref(signed()),change('imported',imported)));
  assert.equal(Object.keys((await get(ref(signed(),'raffles/imported/entries'))).val()).length,319);
});

test('multiple winners persist between spins; changing count, repeating tickets and finishing early are denied',async()=>{
  const r=await create('multi-winners');await invite('multi-winners');
  for(const number of [1,2,3,4])sellTicket(r,{number,buyer:`Buyer ${number}`},actor());
  await assertSucceeds(update(ref(signed()),change('multi-winners',r)));
  drawRaffle(r,{spins:3,winnerCount:2,expectedRound:0});await assertSucceeds(update(ref(signed('bob')),change('multi-winners',r,'bob')));
  const altered=structuredClone(r);altered.public.draw!.winnerCount=1;
  await assertFails(update(ref(signed()),change('multi-winners',altered)));
  const removed=structuredClone(r);delete removed.public.draw!.winnerCount;
  await assertFails(update(ref(signed()),change('multi-winners',removed)));
  const early=structuredClone(r);early.public.result={number:r.public.draw!.lastNumber,drawnAt:1,eligibleCount:4};
  await assertFails(update(ref(signed()),change('multi-winners',early)));
  drawRaffle(r,{expectedRound:1});await assertSucceeds(update(ref(signed()),change('multi-winners',r)));
  assert.equal(winnerNumbers((await get(ref(signed('bob'),'raffles/multi-winners/public'))).val()).length,1);
  const repeated=structuredClone(r);repeated.public.draw!.round++;repeated.public.draw!.history+=`,${repeated.public.draw!.lastNumber}`;repeated.public.result={number:repeated.public.draw!.lastNumber,drawnAt:1,eligibleCount:4};
  await assertFails(update(ref(signed()),change('multi-winners',repeated)));
  drawRaffle(r,{expectedRound:2});await assertSucceeds(update(ref(signed('bob')),change('multi-winners',r,'bob')));
  assert.equal(winnerNumbers(r.public).length,2);assert.equal(eliminatedNumbers(r.public).length,1);assert.ok(r.public.result);
});

test('winning buyer names are public and truthful; eliminated names and private contacts cannot be published',async()=>{
  const r=await create('winner-names');
  for(const number of [1,2,3,4])sellTicket(r,{number,buyer:`Comprador ${number}`,contact:'Teléfono privado',seller:'Vendedor privado'},actor());
  await assertSucceeds(update(ref(signed()),change('winner-names',r)));
  drawRaffle(r,{spins:3,winnerCount:2,expectedRound:0});
  const eliminated=r.public.draw!.lastNumber;
  const badEliminated=structuredClone(r);badEliminated.public.winnerNames={[eliminated]:r.entries![eliminated].buyer};
  await assertFails(update(ref(signed()),change('winner-names',badEliminated)));
  await assertSucceeds(update(ref(signed()),change('winner-names',r)));
  drawRaffle(r,{expectedRound:1});
  const winner=r.public.draw!.lastNumber;
  const forged=structuredClone(r);forged.public.winnerNames![winner]='Nombre falsificado';
  await assertFails(update(ref(signed()),change('winner-names',forged)));
  const extra=structuredClone(r);extra.public.winnerNames![eliminated]=r.entries![eliminated].buyer;
  await assertFails(update(ref(signed()),change('winner-names',extra)));
  await assertSucceeds(update(ref(signed()),change('winner-names',r)));
  const anon=env.unauthenticatedContext().database();
  assert.equal((await get(ref(anon,`raffles/winner-names/public/winnerNames/${winner}`))).val(),r.entries![winner].buyer);
  await assertFails(get(ref(anon,'raffles/winner-names/entries')));
  drawRaffle(r,{expectedRound:2});
  const rewrite=structuredClone(r);rewrite.public.winnerNames![winner]='Cambiar ganador anterior';
  await assertFails(update(ref(signed()),change('winner-names',rewrite)));
  await assertSucceeds(update(ref(signed()),change('winner-names',r)));
  const visible=(await get(ref(anon,'raffles/winner-names/public'))).val();
  assert.deepEqual(Object.keys(visible.winnerNames).filter(key=>visible.winnerNames[key]).sort(),winnerNumbers(r.public).map(String).sort());
  assert.doesNotMatch(JSON.stringify(visible),/Teléfono privado|Vendedor privado|Nombre falsificado/);
});
