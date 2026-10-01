// RFC 4180 parser: commas, quoted newlines, escaped quotes and UTF-8 BOM.
export function parseCsv(text, delimiter = ',') {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || !field) quoted = !quoted;
      else throw new Error('Comillas inválidas en CSV.');
    } else if (c === delimiter && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('CSV con comillas sin cerrar.');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function consolidate(sheets) {
  const byNumber = new Map(); const files = [];
  for (const sheet of sheets) {
    const header = sheet.rows.findIndex(row => row.some(cell => /BOLETO/i.test(cell)) && row.some(cell => /^NOMBRE$/i.test(cell.trim())));
    if (header < 0) throw new Error(`Falta encabezado: ${sheet.name}`);
    const columns = sheet.rows[header];
    const numberIndex = columns.findIndex(cell => /BOLETO/i.test(cell));
    const buyerIndex = columns.findIndex(cell => /^NOMBRE$/i.test(cell.trim()));
    const phoneIndex = columns.findIndex(cell => /TELEFONO|TELÉFONO/i.test(cell));
    let count = 0;
    for (const row of sheet.rows.slice(header + 1)) {
      const raw = row[numberIndex]?.trim();
      if (!raw && row.every(cell => !cell.trim())) continue;
      if (!/^\d+$/.test(raw || '')) throw new Error(`Número inválido en ${sheet.name}`);
      const number = Number(raw);
      if (number < 1 || byNumber.has(number)) throw new Error(`Boleto duplicado o inválido: ${number}`);
      const buyer = row[buyerIndex]?.trim() || '';
      const contact = row[phoneIndex]?.trim() || '';
      if (contact && !buyer) throw new Error(`Contacto sin comprador: ${number}`);
      byNumber.set(number, { number, buyer, contact, seller: sheet.name.replace(/^Rifa Entradas al Buffet - /, '').replace(/\.csv$/, '').trim() });
      count++;
    }
    files.push({ file: sheet.name, tickets: count });
  }
  const tickets = [...byNumber.values()].sort((a, b) => a.number - b.number);
  if (!tickets.length || tickets.some((ticket, i) => ticket.number !== i + 1)) throw new Error('Los boletos deben formar una secuencia completa desde 1.');
  return { tickets, report: { files, total: tickets.length } };
}
