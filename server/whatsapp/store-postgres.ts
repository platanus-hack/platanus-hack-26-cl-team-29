import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { MessageStatus, StoredMessage } from './types.ts';
import type { Contact, WhatsAppStore } from './store.ts';

// Las tablas se crean al arrancar, igual que las de server/red. Prefijo whatsapp_: son de este módulo.
const SCHEMA = `
create table if not exists whatsapp_contacts (
  phone text primary key,
  name text,
  last_inbound_at timestamptz,
  last_template_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists whatsapp_messages (
  id text primary key,
  wamid text unique,
  direction text not null check (direction in ('in', 'out')),
  phone text not null,
  text text not null default '',
  payload jsonb,
  status text not null,
  error text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists whatsapp_messages_phone_created on whatsapp_messages (phone, created_at);
`;

/** Mismo orden que `advances` en store.ts, para no retroceder un estado dentro de SQL. */
const PROGRESS = `array['held','sending','sent','delivered','read']`;

interface MessageRow {
  id: string; wamid: string | null; direction: 'in' | 'out'; phone: string; text: string;
  payload: unknown; status: MessageStatus; error: string | null; source: string | null; created_at: Date;
}

const toMessage = (r: MessageRow): StoredMessage => ({
  id: r.id, wamid: r.wamid, direction: r.direction, phone: r.phone, text: r.text,
  payload: r.payload, status: r.status, error: r.error, source: r.source, createdAt: r.created_at,
});

export async function createPostgresStore(db: pg.Pool): Promise<WhatsAppStore> {
  await db.query(SCHEMA);

  return {
    async recordInbound(message) {
      const inserted = await db.query(
        `insert into whatsapp_messages (id, wamid, direction, phone, text, payload, status, created_at)
         values ($1, $2, 'in', $3, $4, $5, 'received', $6)
         on conflict (wamid) do nothing`,
        [randomUUID(), message.id, message.from, message.text, JSON.stringify(message.content), message.sentAt],
      );
      if (inserted.rowCount === 0) return false;
      await db.query(
        `insert into whatsapp_contacts (phone, name, last_inbound_at) values ($1, $2, $3)
         on conflict (phone) do update set
           name = coalesce(excluded.name, whatsapp_contacts.name),
           last_inbound_at = greatest(excluded.last_inbound_at, whatsapp_contacts.last_inbound_at)`,
        [message.from, message.contactName, message.sentAt],
      );
      return true;
    },

    async createOutbound(input) {
      const { rows } = await db.query<MessageRow>(
        `insert into whatsapp_messages (id, direction, phone, text, payload, status, source)
         values ($1, 'out', $2, $3, $4, $5, $6) returning *`,
        [randomUUID(), input.phone, input.text, JSON.stringify(input.payload), input.status, input.source],
      );
      return toMessage(rows[0]!);
    },

    async updateOutbound(id, patch) {
      await db.query(
        `update whatsapp_messages set status = $2,
           wamid = case when $3::boolean then $4 else wamid end,
           error = case when $5::boolean then $6 else error end,
           updated_at = now()
         where id = $1`,
        [id, patch.status, patch.wamid !== undefined, patch.wamid ?? null, patch.error !== undefined, patch.error ?? null],
      );
    },

    async updateStatusByWamid(wamid, status, error) {
      await db.query(
        `update whatsapp_messages set status = $2, error = $3, updated_at = now()
         where wamid = $1 and direction = 'out'
           and ($2 = 'failed' or array_position(${PROGRESS}, $2) > coalesce(array_position(${PROGRESS}, status), 0))`,
        [wamid, status, error],
      );
    },

    async heldFor(phone) {
      const { rows } = await db.query<MessageRow>(
        `select * from whatsapp_messages where phone = $1 and status = 'held' order by created_at, id`,
        [phone],
      );
      return rows.map(toMessage);
    },

    async contact(phone) {
      const { rows } = await db.query(`select * from whatsapp_contacts where phone = $1`, [phone]);
      const r = rows[0];
      return r ? ({ phone: r.phone, name: r.name, lastInboundAt: r.last_inbound_at, lastTemplateAt: r.last_template_at } satisfies Contact) : null;
    },

    async markTemplateSent(phone, at) {
      await db.query(
        `insert into whatsapp_contacts (phone, last_template_at) values ($1, $2)
         on conflict (phone) do update set last_template_at = excluded.last_template_at`,
        [phone, at],
      );
    },

    async history(phone, limit) {
      const { rows } = await db.query<MessageRow>(
        `select * from (select * from whatsapp_messages where phone = $1 order by created_at desc limit $2) m
         order by created_at`,
        [phone, limit],
      );
      return rows.map(toMessage);
    },
  };
}
