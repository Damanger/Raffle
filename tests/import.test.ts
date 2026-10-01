import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { readTicketFiles, consolidateTicketSheets, MAX_FILE_BYTES } from '../src/lib/ticket-import';
import { createRaffle, AppError } from '../src/lib/model';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP5sAAAAASUVORK5CYII=';
const config = {title:'Rifa de prueba',ticketCount:10,prizes:[{name:'Premio',image:png}]};
const csv = (name:string,text:string) => new File([text],name,{type:'text/csv'});
function excel(name:string, sheets:Record<string,unknown[][]>, type:'xlsx'|'biff8' = 'xlsx') {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName,rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),sheetName);
  return new File([new Uint8Array(XLSX.write(workbook,{type:'array',bookType:type}))],name);
}

test('several CSVs combine with leading title rows, accents and delimiter variations',async()=>{
  const result = await readTicketFiles([
    csv('Ana.csv','\uFEFF,Rifa especial,,\r\n,,,\r\n,Nº DE BOLETO,NOMBRE,TELEFONO\r\n,1,"María, López",00123\r\n,2,,\r\n'),
    csv('Luis.csv','sep=;\r\nNúmero;Comprador;Contacto;Vendedor\r\n003;José;131-B;Luis\r\n4;;;Luis\r\n'),
    csv('Datos.csv','Boleto\tNombre\tTeléfono\n5\t\t\n'),
  ]);
  assert.equal(result.tickets.length,5);assert.equal(result.maxNumber,5);assert.equal(result.sold,2);
  assert.equal(result.tickets[0].buyer,'María, López');assert.equal(result.tickets[0].contact,'00123');
  assert.equal(result.tickets[2].seller,'Luis');assert.equal(result.tickets[2].contact,'131-B');
});
test('legacy Windows CSV encodings preserve accented buyer names and UTF-16 headers',async()=>{
  const latin = Buffer.from('Boleto;Nombre;Telefono\n1;Jos\xe9;00123','latin1');
  const unicode = Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('Número,Nombre\n2,María','utf16le')]);
  const result = await readTicketFiles([new File([latin],'latin.csv'),new File([unicode],'unicode.csv')]);
  assert.equal(result.tickets[0].buyer,'José');assert.equal(result.tickets[1].buyer,'María');
});
test('XLSX reads every ticket worksheet and reports an unrelated sheet without executing formulas',async()=>{
  const result = await readTicketFiles([excel('datos.xlsx',{
    Resumen:[['Comentarios'],['Esta hoja no contiene boletos']],
    Ana:[['Rifa de ejemplo'],[],['Boleto','Nombre','Teléfono'],[1,'Ana','00123'],[2,'','']],
    Luis:[['Número','Comprador','Contacto','Vendedor'],[3,'Luis','555','Pedro'],[4,'','','']],
  })]);
  assert.equal(result.tickets.length,4);assert.equal(result.sold,2);assert.equal(result.sheets.length,2);
  assert.equal(result.skippedSheets.length,1);assert.match(result.skippedSheets[0],/Resumen/);
  assert.equal(result.tickets[0].contact,'00123');
});
test('legacy XLS and mixed XLS/CSV imports preserve ticket IDs',async()=>{
  const result = await readTicketFiles([excel('antiguo.xls',{Boletos:[['Boleto','Nombre'],[1,'Ana'],[2,'']]},'biff8'),csv('mas.csv','Numero,Nombre\n3,Luis')]);
  assert.deepEqual(result.tickets.map(t=>t.number),[1,2,3]);assert.equal(result.sold,2);
});
test('Excel formats retain leading zeros in contacts',async()=>{
  const sheet = XLSX.utils.aoa_to_sheet([['Boleto','Nombre','Telefono'],[1,'Ana',123]]);
  sheet.C2.z = '00000';
  const workbook = XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'Boletos');
  const file = new File([new Uint8Array(XLSX.write(workbook,{type:'array',bookType:'xlsx'}))],'formato.xlsx');
  const result = await readTicketFiles([file]);assert.equal(result.tickets[0].contact,'00123');
});
test('duplicates across files and worksheets are rejected without overwriting a buyer',async()=>{
  await assert.rejects(()=>readTicketFiles([csv('a.csv','Boleto,Nombre\n1,Ana'),csv('b.csv','Boleto,Nombre\n001,Luis')]),/repetido/);
  await assert.rejects(()=>readTicketFiles([excel('duplicados.xlsx',{A:[['Boleto','Nombre'],[1,'Ana']],B:[['Numero','Nombre'],[1,'Luis']]})]),/repetido/);
});
test('malformed numbers, missing headings, orphan contacts and inconsistent states are rejected',async()=>{
  for (const number of ['0','5001','1.5','no','no es número']) await assert.rejects(()=>readTicketFiles([csv('bad.csv',`Boleto,Nombre\n${number},Ana`)]),/entero|entre/);
  await assert.rejects(()=>readTicketFiles([csv('sin.csv','Nombre,Telefono\nAna,555')]),/columna/);
  await assert.rejects(()=>readTicketFiles([csv('contacto.csv','Boleto,Nombre,Telefono\n1,,555')]),/falta el nombre/);
  await assert.rejects(()=>readTicketFiles([csv('estado.csv','Boleto,Nombre,Estado\n1,Ana,Disponible')]),/no coinciden/);
  await assert.rejects(()=>readTicketFiles([csv('estado.csv','Boleto,Nombre,Estado\n1,,Comprado')]),/no coinciden/);
  await assert.rejects(()=>readTicketFiles([csv('estado.csv','Boleto,Nombre,Estado\n1,Ana,Reservado')]),/estado desconocido/);
  const good = await readTicketFiles([csv('estados.csv','Boleto,Nombre,Estado\n1,Ana,Comprado\n2,,Disponible')]);assert.equal(good.sold,1);
});
test('file type, byte limits, corrupt Excel and excessive rows are validated',async()=>{
  await assert.rejects(()=>readTicketFiles([csv('datos.txt','Boleto\n1')]),/CSV, XLSX o XLS/);
  await assert.rejects(()=>readTicketFiles([csv('vacio.csv','')]),/contenido/);
  await assert.rejects(()=>readTicketFiles([new File([new Uint8Array(MAX_FILE_BYTES+1)],'large.csv')]),/5 MB/);
  await assert.rejects(()=>readTicketFiles([csv('falso.xlsx','Boleto\n1')]),/Excel válido/);
  await assert.rejects(()=>readTicketFiles(Array.from({length:51},(_,i)=>csv(`${i}.csv`,'Boleto\n1'))),/50 archivos/);
  await assert.rejects(()=>readTicketFiles([csv('rows.csv','Boleto\n'+'\n'.repeat(10001))]),/demasiadas filas/);
});
test('partial ranges remain unchanged and repeated headers do not lose a buyer named Número',()=>{
  const result = consolidateTicketSheets([{name:'Datos',rows:[['Boleto','Nombre'],['004','Número'],['Boleto','Nombre'],['8','Luis']]}]);
  assert.deepEqual(result.tickets.map(t=>t.number),[4,8]);assert.equal(result.tickets[0].buyer,'Número');assert.equal(result.maxNumber,8);
  const r = createRaffle({...config,importedTickets:result.tickets},'owner','Organizador');
  assert.deepEqual(Object.keys(r.public.sold),['4','8']);assert.equal(r.public.ticketCount,10);assert.equal(r.public.sold[1],undefined);
});
test('server rejects forged imports and stores buyers only in private entries',()=>{
  const blank = createRaffle(config,'owner','Organizador');assert.deepEqual(blank.public.sold,{});assert.equal(blank.entries,undefined);
  const tickets = [{number:1,buyer:' Ana ',contact:' 00123 ',seller:' Luis '},{number:2,buyer:'',contact:'',seller:''}];
  const r = createRaffle({...config,importedTickets:tickets},'owner','Organizador');
  assert.equal(r.entries?.[1].buyer,'Ana');assert.equal(r.entries?.[1].contact,'00123');assert.equal(r.entries?.[1].seller,'Luis');
  assert.equal(r.public.sold[1],1);assert.equal(r.public.sold[2],undefined);assert.equal('importedTickets' in r.public,false);
  assert.equal(JSON.stringify(r.public).includes('00123'),false);
  for (const input of [null,[],{},[...tickets,tickets[0]],[{...tickets[0],number:'1'}],[{...tickets[0],number:11}],[{...tickets[0],buyer:''}],[{...tickets[0],contact:123}],[{...tickets[0],seller:'a'.repeat(121)}]]) assert.throws(()=>createRaffle({...config,importedTickets:input},'owner','Ana'),AppError);
});
test('the 24 supplied ticket tables import into a new raffle with 720 tickets and 319 private buyers',()=>{
  const seed = JSON.parse(readFileSync('data/private/buffet.json','utf8'));
  const tables = seed.report.files.map((file:{file:string})=>{
    const seller = file.file.replace(/^Rifa Entradas al Buffet - /,'').replace(/\.csv$/,'').trim();
    return {name:file.file,rows:[['','Rifa 6 Entradas a un Buffet y mas','',''],['','','',''],['','Nº DE BOLETO','NOMBRE','TELEFONO'],...seed.tickets.filter((t:{seller:string})=>t.seller === seller).map((t:{number:number;buyer:string;contact:string})=>['',t.number,t.buyer,t.contact])]};
  });
  const imported = consolidateTicketSheets(tables);assert.equal(imported.tickets.length,720);assert.equal(imported.maxNumber,720);assert.equal(imported.sold,319);
  const r = createRaffle({...config,ticketCount:720,importedTickets:imported.tickets},'owner','Mixtecánicos');
  assert.equal(Object.keys(r.public.sold).length,319);assert.equal(Object.keys(r.entries!).length,319);assert.equal(r.public.ticketCount-Object.keys(r.public.sold).length,401);
});
