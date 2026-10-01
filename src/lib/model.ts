import { randomInt } from 'node:crypto';
import type { ImportedTicket } from './ticket-import';
import { eligibleNumbers, type DrawProgress } from './draw';
import { normalizeWhatsApp } from './whatsapp';
import type { Actor } from './access';

export interface Prize { name: string; image: string }
export interface RafflePublic {
  title: string; ownerId: string; organizer: string; createdAt: number;
  ticketCount: number; prizes: Prize[]; sold: Record<string, number>;
  result?: { number: number; drawnAt: number; eligibleCount: number };
  draw?: DrawProgress;
  winnerNames?: Record<string, string>;
  cover?: string;
  whatsapp?: string;
}
export interface Entry { buyer: string; contact: string; seller?: string; soldAt: number; modifiedBy?: Actor; modifiedAt?: number }
export interface Raffle { public: RafflePublic; entries?: Record<string, Entry>; version?: number; lastEventId?: string }

export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function validateImage(image: unknown): string {
  if (typeof image !== 'string' || image.length > 700000 || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new AppError('La imagen debe ser PNG, JPEG o WebP de menos de 500 KB.');
  const content = Buffer.from(image.split(',')[1], 'base64');
  const isPng = content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isJpeg = content[0] === 255 && content[1] === 216 && content[2] === 255;
  const isWebp = content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP';
  const mime = image.slice(5, image.indexOf(';'));
  if (!((mime === 'image/png' && isPng) || (mime === 'image/jpeg' && isJpeg) || (mime === 'image/webp' && isWebp))) throw new AppError('El contenido de la imagen no coincide con su formato.');
  return image;
}

export function validateRaffleDetails(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Formulario inválido.');
  const body = input as Record<string, unknown>;
  const cover = body.cover === undefined || body.cover === '' ? '' : validateImage(body.cover);
  let whatsapp: string;
  try { whatsapp = normalizeWhatsApp(body.whatsapp); }
  catch (error) { throw new AppError((error as Error).message); }
  return { ...(cover ? { cover } : {}), ...(whatsapp ? { whatsapp } : {}) };
}

export function configureRaffle(raffle: Raffle, input: unknown) {
  if (raffle.public.draw || raffle.public.result) throw new AppError('La configuración quedó cerrada al iniciar el sorteo.', 409);
  const details = validateRaffleDetails(input);
  const body = input as Record<string, unknown>;
  const extra = body.title !== undefined || body.prizes !== undefined ? validateCreation({ title: body.title ?? raffle.public.title, ticketCount: raffle.public.ticketCount, prizes: body.prizes ?? raffle.public.prizes, ...details }) : null;
  delete raffle.public.cover; delete raffle.public.whatsapp;
  Object.assign(raffle.public, details);
  if (extra) { raffle.public.title = extra.title; raffle.public.prizes = extra.prizes; }
  return raffle;
}
export function validateCreation(input: unknown) {
  if (!input || typeof input !== 'object') throw new AppError('Formulario inválido.');
  const body = input as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const ticketCount = body.ticketCount;
  if (title.length < 3 || title.length > 100) throw new AppError('El título debe tener entre 3 y 100 caracteres.');
  if (!Number.isInteger(ticketCount) || Number(ticketCount) < 1 || Number(ticketCount) > 5000) throw new AppError('Elige entre 1 y 5,000 boletos.');
  if (!Array.isArray(body.prizes) || body.prizes.length < 1 || body.prizes.length > 6) throw new AppError('Agrega de 1 a 6 imágenes de premios.');
  const prizes: Prize[] = body.prizes.map(prize => {
    if (!prize || typeof prize !== 'object') throw new AppError('Premio inválido.');
    const { name, image } = prize;
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new AppError('Agrega un nombre a cada premio (máximo 80 caracteres).');
    return { name: name.trim(), image: validateImage(image) };
  });
  return { title, ticketCount: Number(ticketCount), prizes, ...validateRaffleDetails(body) };
}

export function validateImportedTickets(input: unknown, ticketCount: number): ImportedTicket[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length < 1 || input.length > 5000) throw new AppError('La importación debe contener entre 1 y 5,000 boletos.');
  const seen = new Set<number>();
  return input.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('Boleto importado inválido.');
    const ticket = raw as Record<string, unknown>;
    const number = ticket.number;
    if (!Number.isInteger(number) || Number(number) < 1 || Number(number) > ticketCount) throw new AppError('La cantidad de boletos debe incluir todos los números importados, desde el 1.');
    if (seen.has(Number(number))) throw new AppError(`El boleto #${number} está repetido en la importación.`);
    seen.add(Number(number));
    const readText = (key: string, max: number) => {
      if (ticket[key] === undefined) return '';
      if (typeof ticket[key] !== 'string' || (ticket[key] as string).length > max) throw new AppError(`El campo ${key} del boleto #${number} no es válido.`);
      return (ticket[key] as string).trim();
    };
    const buyer = readText('buyer',120);
    const contact = readText('contact',80);
    const seller = readText('seller',120);
    if (contact && !buyer) throw new AppError(`El boleto #${number} tiene contacto pero no tiene comprador.`);
    return { number: Number(number), buyer, contact, seller };
  });
}

export function createRaffle(input: unknown, ownerId: string, organizer: string): Raffle {
  const config = validateCreation(input);
  const tickets = validateImportedTickets((input as Record<string,unknown>).importedTickets, config.ticketCount);
  const now = Date.now();
  const raffle: Raffle = { public: { ...config, ownerId, organizer, createdAt: now, sold: {} } };
  for (const ticket of tickets) {
    if (!ticket.buyer) continue;
    raffle.public.sold[ticket.number] = ticket.number;
    raffle.entries ||= {};
    raffle.entries[ticket.number] = { buyer: ticket.buyer, contact: ticket.contact, soldAt: now, ...(ticket.seller ? { seller: ticket.seller } : {}) };
  }
  return raffle;
}

export function sellTicket(raffle: Raffle, input: unknown, actor?: Actor) {
  if (raffle.public.result || raffle.public.draw) throw new AppError('Las ventas están cerradas porque el sorteo ya comenzó.', 409);
  const body = input as Record<string, unknown> | null;
  const number = body?.number;
  if (!Number.isInteger(number) || Number(number) < 1 || Number(number) > raffle.public.ticketCount) throw new AppError('Número de boleto inválido.');
  const buyer = typeof body?.buyer === 'string' ? body.buyer.trim() : '';
  const contact = typeof body?.contact === 'string' ? body.contact.trim() : '';
  const seller = typeof body?.seller === 'string' ? body.seller.trim() : '';
  if (!buyer || buyer.length > 120 || contact.length > 80 || seller.length > 120) throw new AppError('Agrega un nombre válido (máximo 120 caracteres).');
  if (raffle.public.sold?.[String(number)]) throw new AppError('Este boleto ya fue vendido.', 409);
  raffle.public.sold ||= {};
  raffle.entries ||= {};
  raffle.public.sold[String(number)] = Number(number);
  raffle.entries[String(number)] = { buyer, contact, ...(seller ? { seller } : {}), soldAt: Date.now(), ...(actor ? { modifiedBy: { ...actor }, modifiedAt: Date.now() } : {}) };
  return raffle;
}

export function editTicket(raffle: Raffle, input: unknown, actor: Actor) {
  if (raffle.public.draw || raffle.public.result) throw new AppError('Los boletos quedaron cerrados al iniciar el sorteo.', 409);
  const body = input as Record<string, unknown> | null;
  const number = body?.number;
  if (!Number.isInteger(number) || Number(number) < 1 || Number(number) > raffle.public.ticketCount) throw new AppError('Número de boleto inválido.');
  const previous = raffle.entries?.[String(number)];
  if (!previous || !raffle.public.sold?.[String(number)]) throw new AppError('Este boleto ya cambió. Actualiza para consultar sus datos.', 409);
  if (body?.available === true) {
    delete raffle.public.sold[String(number)]; delete raffle.entries![String(number)];
    return raffle;
  }
  const buyer = typeof body?.buyer === 'string' ? body.buyer.trim() : '';
  const contact = typeof body?.contact === 'string' ? body.contact.trim() : '';
  const seller = typeof body?.seller === 'string' ? body.seller.trim() : '';
  if (!buyer || buyer.length > 120 || contact.length > 80 || seller.length > 120) throw new AppError('Revisa el nombre, contacto y vendedor del comprador.');
  raffle.entries![String(number)] = { buyer, contact, ...(seller ? { seller } : {}), soldAt: previous.soldAt, modifiedBy: { ...actor }, modifiedAt: Date.now() };
  return raffle;
}

export function drawRaffle(raffle: Raffle, input: unknown = {}) {
  if (raffle.public.result) throw new AppError('El resultado ya está registrado.', 409);
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const progress = raffle.public.draw;
  if (body.expectedRound !== undefined && body.expectedRound !== (progress?.round || 0)) throw new AppError('El sorteo avanzó en otra ventana. Actualiza antes de continuar.', 409);
  const eligible = eligibleNumbers(raffle.public);
  if (!eligible.length) throw new AppError('Registra al menos un boleto vendido para sortear.');
  const winnerCount = progress?.winnerCount ?? (progress ? 1 : body.winnerCount === undefined ? 1 : body.winnerCount);
  if (!Number.isInteger(winnerCount) || Number(winnerCount) < 1 || Number(winnerCount) > (progress?.initialCount || eligible.length)) throw new AppError('Elige una cantidad de ganadores entre 1 y el número de boletos comprados.');
  const totalSpins = progress?.totalSpins ?? (body.spins === undefined ? winnerCount : body.spins);
  if (!Number.isInteger(totalSpins) || Number(totalSpins) < Number(winnerCount) || Number(totalSpins) > (progress?.initialCount || eligible.length)) throw new AppError('Los giros deben dejar un boleto diferente para cada ganador.');
  if (progress && body.spins !== undefined && body.spins !== progress.totalSpins) throw new AppError('La cantidad de giros ya quedó fijada al comenzar el sorteo.', 409);
  if (progress && body.winnerCount !== undefined && body.winnerCount !== winnerCount) throw new AppError('La cantidad de ganadores ya quedó fijada al comenzar el sorteo.', 409);
  if (progress && progress.round >= progress.totalSpins) throw new AppError('El sorteo ya terminó.', 409);
  const number = eligible[randomInt(eligible.length)];
  const now = Date.now();
  const draw: DrawProgress = {
    totalSpins: Number(totalSpins), initialCount: progress?.initialCount || eligible.length,
    startedAt: progress?.startedAt || now, round: (progress?.round || 0) + 1,
    lastNumber: number, history: progress ? `${progress.history},${number}` : String(number),
    winnerCount: Number(winnerCount),
  };
  raffle.public.draw = draw;
  if (draw.round > draw.totalSpins - Number(winnerCount)) {
    const buyer = raffle.entries?.[String(number)]?.buyer;
    if (buyer) {
      raffle.public.winnerNames ||= {};
      raffle.public.winnerNames[String(number)] = buyer;
    }
  }
  if (draw.round === draw.totalSpins) raffle.public.result = { number, drawnAt: now, eligibleCount: draw.initialCount };
  return raffle;
}
