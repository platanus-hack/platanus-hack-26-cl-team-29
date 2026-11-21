import { randomUUID } from 'node:crypto';
import type { InboundMessage, MessageStatus, StoredMessage } from './types.ts';

export interface Contact {
  readonly phone: string;
  readonly name: string | null;
  readonly lastInboundAt: Date | null;
  readonly lastTemplateAt: Date | null;
}

export interface NewOutbound {
  readonly phone: string;
  readonly text: string;
  readonly payload: unknown;
  readonly source: string | null;
  readonly status: MessageStatus;
}

/**
 * Persistencia del módulo: contactos y mensajes (entrantes y salientes).
 * Dos implementaciones: memoria (tests, o sin DATABASE_URL) y Postgres.
 */
export interface WhatsAppStore {
  /** Guarda el entrante y actualiza el contacto. `false` si ese wamid ya se había guardado. */
  recordInbound(message: InboundMessage): Promise<boolean>;
  createOutbound(message: NewOutbound): Promise<StoredMessage>;
  updateOutbound(id: string, patch: { status: MessageStatus; wamid?: string | null; error?: string | null }): Promise<void>;
  /** Estado que reporta WhatsApp (entregado, leído…). Nunca retrocede: un "entregado" tardío no pisa un "leído". */
  updateStatusByWamid(wamid: string, status: MessageStatus, error: string | null): Promise<void>;
  /** Salientes retenidos por la ventana de 24 h, del más antiguo al más nuevo. */
  heldFor(phone: string): Promise<StoredMessage[]>;
  contact(phone: string): Promise<Contact | null>;
  markTemplateSent(phone: string, at: Date): Promise<void>;
  /** Los últimos `limit` mensajes con ese teléfono, del más antiguo al más nuevo. */
  history(phone: string, limit: number): Promise<StoredMessage[]>;
}

/** Orden de avance de un saliente. `failed` siempre se aplica. */
const PROGRESS: readonly MessageStatus[] = ['held', 'sending', 'sent', 'delivered', 'read'];

export function advances(current: MessageStatus, next: MessageStatus): boolean {
  return next === 'failed' || PROGRESS.indexOf(next) > PROGRESS.indexOf(current);
}

export function createMemoryStore(): WhatsAppStore {
  const messages: StoredMessage[] = [];
  const contacts = new Map<string, Contact>();
  const replace = (id: string, patch: Partial<StoredMessage>) => {
    const i = messages.findIndex(m => m.id === id);
    if (i >= 0) messages[i] = { ...messages[i]!, ...patch };
  };

  return {
    async recordInbound(message) {
      if (messages.some(m => m.wamid === message.id)) return false;
      messages.push({
        id: randomUUID(), wamid: message.id, direction: 'in', phone: message.from, text: message.text,
        status: 'received', error: null, source: null, payload: message.content, createdAt: message.sentAt,
      });
      const previous = contacts.get(message.from);
      contacts.set(message.from, {
        phone: message.from,
        name: message.contactName ?? previous?.name ?? null,
        lastInboundAt: message.sentAt,
        lastTemplateAt: previous?.lastTemplateAt ?? null,
      });
      return true;
    },
    async createOutbound(input) {
      const stored: StoredMessage = { id: randomUUID(), wamid: null, direction: 'out', error: null, createdAt: new Date(), ...input };
      messages.push(stored);
      return stored;
    },
    async updateOutbound(id, patch) {
      replace(id, patch);
    },
    async updateStatusByWamid(wamid, status, error) {
      const found = messages.find(m => m.wamid === wamid && m.direction === 'out');
      if (found && advances(found.status, status)) replace(found.id, { status, error });
    },
    async heldFor(phone) {
      return messages.filter(m => m.phone === phone && m.status === 'held');
    },
    async contact(phone) {
      return contacts.get(phone) ?? null;
    },
    async markTemplateSent(phone, at) {
      const previous = contacts.get(phone);
      contacts.set(phone, { phone, name: previous?.name ?? null, lastInboundAt: previous?.lastInboundAt ?? null, lastTemplateAt: at });
    },
    async history(phone, limit) {
      return messages.filter(m => m.phone === phone).slice(-limit);
    },
  };
}
