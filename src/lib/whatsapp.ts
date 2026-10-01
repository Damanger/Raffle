import type { RafflePublic } from './model';

export function normalizeWhatsApp(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 40 || !/^\+?[\d\s()-]+$/.test(value.trim())) throw new Error('Escribe un número de WhatsApp válido con código de país, por ejemplo +52 951 123 4567.');
  const phone = value.trim().replace(/^\+/, '').replace(/[\s()-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new Error('Incluye el código de país en tu WhatsApp (México: +52), sin ceros iniciales.');
  return phone;
}

export function ticketWhatsAppLink(raffle: RafflePublic, number: number, buyer: string, raffleUrl: string): string {
  if (raffle.draw || raffle.result) throw new Error('Las ventas de esta rifa ya están cerradas.');
  if (!Number.isInteger(number) || number < 1 || number > raffle.ticketCount || raffle.sold?.[String(number)]) throw new Error('Este boleto ya no está disponible. Selecciona otro número.');
  const name = buyer.trim();
  if (!name || name.length > 120) throw new Error('Escribe tu nombre (máximo 120 caracteres).');
  const phone = normalizeWhatsApp(raffle.whatsapp);
  if (!phone) throw new Error('El organizador aún no ha agregado su número de WhatsApp.');
  const link = new URL(`https://wa.me/${phone}`);
  link.searchParams.set('text', `Hola, soy ${name}. Me interesa comprar el boleto #${String(number).padStart(3, '0')} de la rifa «${raffle.title}».\n${raffleUrl}`);
  return link.toString();
}
