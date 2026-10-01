import { randomUUID } from 'node:crypto';
import type { Actor } from './access';
import type { Raffle, Entry } from './model';
export interface AuditEvent {
  at: number; kind: string; actor: Actor; description: string;
  number?: number; before?: Entry; after?: Entry; version?: number;
  changes?: { field: string; before: string; after: string }[];
}
export function auditEvent(actor: Actor, kind: string, description: string, extras: Partial<AuditEvent> = {}) {
  const at = Date.now();
  const id = `${at}_${randomUUID()}`;
  return { id, event: { ...extras, at, kind, description, actor: { uid: actor.uid, name: actor.name, email: actor.email } } as AuditEvent };
}
export function auditedUpdate(id: string, raffle: Raffle, eventId: string, event: AuditEvent) {
  raffle.version = (raffle.version || 0) + 1;
  raffle.lastEventId = eventId;
  event.version = raffle.version;
  return { [`raffles/${id}`]: raffle, [`raffleHistory/${id}/${eventId}`]: event };
}
