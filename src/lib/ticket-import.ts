import { parseCsv } from './csv.mjs';

export const MAX_TICKETS = 5000;
export const MAX_IMPORT_FILES = 50;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SHEET_ROWS = 10000;

export interface ImportedTicket {
  number: number;
  buyer: string;
  contact: string;
  seller: string;
}
export interface TicketSheet { name: string; rows: unknown[][]; rowOffset?: number }
export interface ImportResult {
  tickets: ImportedTicket[];
  maxNumber: number;
  sold: number;
  sheets: { name: string; tickets: number }[];
  skippedSheets: string[];
}

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const cellText = (cell: unknown) => cell == null ? '' : String(cell).trim();
const aliases = {
  number: ['boleto','boletos','numerodeboleto','numeroboleto','noboleto','ndeboleto','nboleto','nodeboleto','numboleto','numero','num','no','ticket','ticketnumber','number','nrodeboleto','nroboleta','numerodeboleta','boleta','folio'],
  buyer: ['nombre','nombres','comprador','nombrecompleto','nombredelcomprador','nombredelcliente','cliente','participante','buyer','name'],
  contact: ['telefono','telefonocelular','telefonodelcomprador','tel','celular','cel','contacto','phone','contact','whatsapp'],
  seller: ['vendedor','vendedora','responsable','seller'],
  status: ['estado','estatus','status','pagado','comprado','vendido'],
};

function headerColumns(row: unknown[]) {
  const cells = row.map(cell => normalize(cellText(cell)));
  const find = (options: string[]) => cells.findIndex(cell => options.includes(cell));
  return { number: find(aliases.number), buyer: find(aliases.buyer), contact: find(aliases.contact), seller: find(aliases.seller), status: find(aliases.status) };
}
function findHeader(rows: unknown[][]) {
  return rows.findIndex(row => headerColumns(row).number >= 0);
}

export function consolidateTicketSheets(sheets: TicketSheet[]): ImportResult {
  const tickets = new Map<number, ImportedTicket>();
  const sources = new Map<number, string>();
  const reports: ImportResult['sheets'] = [];
  const skippedSheets: string[] = [];
  for (const sheet of sheets) {
    const header = findHeader(sheet.rows);
    if (header < 0) { skippedSheets.push(sheet.name); continue; }
    const columns = headerColumns(sheet.rows[header]);
    let count = 0;
    for (let index = header + 1; index < sheet.rows.length; index++) {
      const row = sheet.rows[index];
      if (row.every(cell => !cellText(cell))) continue;
      // Some workbooks repeat the column headings between ticket blocks.
      const repeatedHeader = headerColumns(row);
      if (repeatedHeader.number === columns.number && (columns.buyer >= 0 ? repeatedHeader.buyer === columns.buyer : normalize(cellText(row[columns.number])) === normalize(cellText(sheet.rows[header][columns.number])))) continue;
      const location = `${sheet.name}, fila ${index + 1 + (sheet.rowOffset || 0)}`;
      const rawNumber = cellText(row[columns.number]);
      if (!/^\d+$/.test(rawNumber)) throw new Error(`${location}: el número de boleto debe ser un entero.`);
      const number = Number(rawNumber);
      if (!Number.isInteger(number) || number < 1 || number > MAX_TICKETS) throw new Error(`${location}: el número debe estar entre 1 y ${MAX_TICKETS.toLocaleString('es-MX')}.`);
      if (tickets.has(number)) throw new Error(`El boleto #${number} está repetido en ${location} y en ${sources.get(number)}. Corrige el duplicado o quita uno de los archivos.`);
      const buyer = cellText(row[columns.buyer]);
      const contact = cellText(row[columns.contact]);
      const seller = cellText(row[columns.seller]);
      if (buyer.length > 120 || contact.length > 80 || seller.length > 120) throw new Error(`${location}: máximo 120 caracteres para nombre o vendedor y 80 para contacto.`);
      if (contact && !buyer) throw new Error(`${location}: hay contacto pero falta el nombre del comprador.`);
      const status = normalize(cellText(row[columns.status]));
      const available = ['disponible','libre','available','no','false','0'];
      const sold = ['comprado','vendido','pagado','ocupado','sold','paid','si','true','1'];
      if (status && !available.includes(status) && !sold.includes(status)) throw new Error(`${location}: estado desconocido. Usa Disponible o Comprado.`);
      if (status && ((sold.includes(status) && !buyer) || (available.includes(status) && !!buyer))) throw new Error(`${location}: el nombre y el estado del boleto no coinciden. Un boleto comprado necesita un nombre; uno disponible debe dejarlo vacío.`);
      tickets.set(number, { number, buyer, contact, seller });
      sources.set(number, location); count++;
      if (tickets.size > MAX_TICKETS) throw new Error(`Puedes importar hasta ${MAX_TICKETS.toLocaleString('es-MX')} boletos.`);
    }
    if (count) reports.push({ name: sheet.name, tickets: count });
    else skippedSheets.push(sheet.name);
  }
  if (!tickets.size) throw new Error('No encontramos boletos. Cada tabla necesita una columna Boleto o Número y al menos una fila con un número.');
  const sorted = [...tickets.values()].sort((a,b) => a.number - b.number);
  return { tickets: sorted, maxNumber: sorted[sorted.length-1].number, sold: sorted.filter(ticket => ticket.buyer).length, sheets: reports, skippedSheets };
}

function decodeCsv(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

function csvRows(text: string) {
  const separator = text.match(/^\uFEFF?sep=([,;\t])\r?\n/i);
  if (separator) return parseCsv(text.slice(separator[0].length), separator[1]);
  for (const delimiter of [',',';','\t']) {
    try { const rows = parseCsv(text, delimiter); if (findHeader(rows) >= 0) return rows; }
    catch { /* A different delimiter may be needed. */ }
  }
  return parseCsv(text);
}

export async function readTicketFiles(files: File[]): Promise<ImportResult> {
  if (!files.length || files.length > MAX_IMPORT_FILES) throw new Error(`Selecciona entre 1 y ${MAX_IMPORT_FILES} archivos.`);
  if (files.reduce((sum,file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('Los archivos no pueden superar 20 MB en total.');
  const sheets: TicketSheet[] = [];
  for (const file of files) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv','xlsx','xls'].includes(extension || '')) throw new Error(`${file.name}: usa archivos CSV, XLSX o XLS.`);
    if (!file.size || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: el archivo debe tener contenido y pesar hasta 5 MB.`);
    const buffer = await file.arrayBuffer();
    if (extension === 'csv') {
      const rows = csvRows(decodeCsv(buffer));
      if (rows.length > MAX_SHEET_ROWS) throw new Error(`${file.name}: demasiadas filas. Usa hasta ${MAX_SHEET_ROWS.toLocaleString('es-MX')} filas por tabla.`);
      if (findHeader(rows) < 0) throw new Error(`${file.name}: no encontramos la columna Boleto o Número.`);
      sheets.push({ name: file.name, rows });
    } else {
      try {
        const bytes = new Uint8Array(buffer);
        const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
        const ole = [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((value,index) => bytes[index] === value);
        if (!zip && !ole) throw new Error('El contenido no es un libro Excel válido.');
        const XLSX = await import('xlsx');
        const book = XLSX.read(buffer, { type: 'array', sheetRows: MAX_SHEET_ROWS + 1, cellFormula: false, cellHTML: false });
        if (book.SheetNames.length > 100) throw new Error('Usa libros con hasta 100 hojas.');
        let ticketSheets = 0;
        for (const name of book.SheetNames) {
          const sheet = book.Sheets[name];
          const fullRange = sheet['!fullref'] || sheet['!ref'];
          if (fullRange) {
            const range = XLSX.utils.decode_range(fullRange);
            if (range.e.r >= MAX_SHEET_ROWS) throw new Error(`La hoja ${name} supera ${MAX_SHEET_ROWS.toLocaleString('es-MX')} filas.`);
            if (range.e.c >= 100) throw new Error(`La hoja ${name} tiene demasiadas columnas. Usa hasta 100 columnas.`);
          }
          const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
          if (findHeader(rows) >= 0) ticketSheets++;
          sheets.push({ name: `${file.name} · ${name}`, rows, rowOffset: sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0 });
        }
        if (!ticketSheets) throw new Error('No encontramos una hoja con la columna Boleto o Número.');
      } catch (error) { throw new Error(`${file.name}: no se pudo leer el Excel. ${(error as Error).message || 'Revisa que no esté dañado ni protegido por contraseña.'}`); }
    }
  }
  return consolidateTicketSheets(sheets);
}
