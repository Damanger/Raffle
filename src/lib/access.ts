import type { RafflePublic } from './model';
export interface Actor { uid: string; name: string; email: string }
export interface AdminGrant { email: string; invitedBy: string; invitedAt: number }
export type Admins = Record<string, AdminGrant>;
export function normalizeEmail(input: unknown) {
  if (typeof input !== 'string') throw new Error('Escribe un correo válido.');
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email)) throw new Error('Escribe un correo válido, por ejemplo nombre@gmail.com.');
  return email;
}
export const emailKey = (email: string) => normalizeEmail(email).replace(/\./g, ',');
export function canManage(raffle: RafflePublic, user: (Actor & { emailVerified?: boolean }) | null, admins: Admins = {}) {
  if (!user) return false;
  if (raffle.ownerId === user.uid) return true;
  if (!user.emailVerified || !user.email) return false;
  try { return admins[emailKey(user.email)]?.email === normalizeEmail(user.email); } catch { return false; }
}
