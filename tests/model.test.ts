import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AppError, validateCreation, sellTicket, drawRaffle, type Raffle } from '../src/lib/model.ts';
import { parseCsv, consolidate } from '../src/lib/csv.mjs';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP5sAAAAASUVORK5CYII=';
const creation = () => ({ title:'Rifa de prueba',ticketCount:10,prizes:[{name:'Premio',image:png}] });
const raffle = (): Raffle => ({public:{...creation(),ownerId:'owner',organizer:'Ana',createdAt:1,sold:{}}});

test('creation rejects invalid counts, empty prizes and forged image MIME',()=>{
  assert.equal(validateCreation(creation()).ticketCount,10);
  for(const count of [0,-1,1.5,5001,'10',null]) assert.throws(()=>validateCreation({...creation(),ticketCount:count}),AppError);
  assert.throws(()=>validateCreation({...creation(),prizes:[]}),AppError);
  assert.throws(()=>validateCreation({...creation(),prizes:[{name:'Fake',image:'data:image/png;base64,PHNjcmlwdD4='}]}),AppError);
  assert.throws(()=>validateCreation({...creation(),prizes:[{name:'SVG',image:'data:image/svg+xml;base64,PHN2Zz4='}]}),AppError);
});
test('selling preserves buyer privately and rejects double sales and out-of-range tickets',()=>{
  const r = sellTicket(raffle(),{number:1,buyer:' Ana ',contact:' 555 '});
  assert.equal(r.public.sold['1'],1);assert.equal(r.entries?.['1'].buyer,'Ana');
  assert.equal(JSON.stringify(r.public).includes('555'),false);
  assert.throws(()=>sellTicket(r,{number:1,buyer:'Otra',contact:''}),AppError);
  for(const number of [0,11,1.3,'2'])assert.throws(()=>sellTicket(r,{number,buyer:'Ana'}),AppError);
  assert.throws(()=>sellTicket(r,{number:2,buyer:'   '}),AppError);
});
test('drawing only selects sold numbers and freezes further sales and draws',()=>{
  const r = sellTicket(raffle(),{number:7,buyer:'Ana'});
  drawRaffle(r); assert.equal(r.public.result?.number,7);assert.equal(r.public.result?.eligibleCount,1);
  assert.throws(()=>drawRaffle(r),AppError);assert.throws(()=>sellTicket(r,{number:2,buyer:'Ana'}),AppError);
  assert.throws(()=>drawRaffle(raffle()),AppError);
});
test('draw eligibility ignores invalid ticket IDs and counts unique sold numbers',()=>{
  const r = raffle(); r.public.sold = {'2':2,'9':9,'500':500,'0':0,'x':999};
  drawRaffle(r);assert.ok([2,9].includes(r.public.result!.number));assert.equal(r.public.result?.eligibleCount,2);
});
test('CSV parser preserves accents, quoted commas, escaped quotes, CRLF and leading zeros in contacts',()=>{
  const rows = parseCsv('\uFEFF,Nº DE BOLETO,NOMBRE,TELEFONO\r\n,1,"María, \"\"M\"\"",00123\r\n,2,,\r\n');
  const result = consolidate([{name:'Rifa Entradas al Buffet - Ana.csv',rows}]);
  assert.equal(result.tickets[0].buyer,'María, "M"');assert.equal(result.tickets[0].contact,'00123');assert.equal(result.tickets[1].buyer,'');
  assert.throws(()=>parseCsv('"sin cierre'));
});
test('CSV import rejects conflicting IDs, missing sequences and orphan contacts',()=>{
  const sheet = (body:string)=>({name:'Ana.csv',rows:parseCsv(`,Nº DE BOLETO,NOMBRE,TELEFONO\n${body}`)});
  assert.throws(()=>consolidate([sheet(',1,A,\n,1,B,')]),/duplicado/);
  assert.throws(()=>consolidate([sheet(',2,A,')]),/secuencia/);
  assert.throws(()=>consolidate([sheet(',1,,123')]),/Contacto/);
});
test('24 original CSVs reconcile with public import without leaking buyer data',()=>{
  const privateSeed = JSON.parse(readFileSync('data/private/buffet.json','utf8'));
  const publicSeed = JSON.parse(readFileSync('data/reference/buffet-public.json','utf8'));
  assert.equal(privateSeed.report.files.length,24);assert.equal(privateSeed.tickets.length,720);
  assert.deepEqual(publicSeed.sold,privateSeed.tickets.filter((t:{buyer:string})=>t.buyer).map((t:{number:number})=>t.number));
  assert.equal(publicSeed.sold.length,319);assert.equal(publicSeed.report.available,401);
  assert.equal(JSON.stringify(publicSeed).includes(privateSeed.tickets[0].contact),false);
});
