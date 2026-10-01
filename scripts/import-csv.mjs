import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parseCsv, consolidate } from '../src/lib/csv.mjs';

const source = resolve(process.argv[2] || 'C:/Users/omarc/Downloads');
const files = (await readdir(source)).filter(name => /^Rifa Entradas al Buffet - .+\.csv$/i.test(name)).sort();
if (files.length !== 24) throw new Error(`Se esperaban 24 archivos; se encontraron ${files.length}.`);
const sheets = await Promise.all(files.map(async name => ({ name, rows: parseCsv(await readFile(resolve(source, name), 'utf8')) })));
const { tickets, report } = consolidate(sheets);
await mkdir('data/private', { recursive: true });
await mkdir('data/reference', { recursive: true });
await writeFile('data/private/buffet.json', JSON.stringify({ tickets, report }, null, 2));
const sold = tickets.filter(ticket => ticket.buyer).map(ticket => ticket.number);
await writeFile('data/reference/buffet-public.json', JSON.stringify({ title: 'Rifa de 6 entradas al buffet y más', ticketCount: tickets.length, sold, report: { files: report.files, total: report.total, sold: sold.length, available: tickets.length - sold.length } }, null, 2));
console.log(JSON.stringify({ source: basename(source), ...report, sold: sold.length, available: tickets.length - sold.length }, null, 2));
