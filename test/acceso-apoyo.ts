import assert from 'node:assert/strict';
import { telefonoParaWhatsapp } from '../shared/telefono.ts';

// Para los tests de las rutas web: un WhatsApp de prueba que guarda el último código y cómo entrar con él.

type Respuesta = { status: number; cuerpo: Record<string, any> };
type Post = (ruta: string, body: unknown) => Promise<Respuesta>;

export type Buzon = ReturnType<typeof buzonDeCodigos>;

/** `enviarCodigo` para `crearRutasRed`: guarda el último código mandado a cada teléfono. */
export function buzonDeCodigos() {
  const codigos = new Map<string, string>();
  return {
    enviarCodigo: async (telefono: string, texto: string) => {
      codigos.set(telefono, /\*(\d{6})\*/.exec(texto)?.[1] ?? '');
      return 'enviado' as const;
    },
    ultimo: (telefono: string) => codigos.get(telefonoParaWhatsapp(telefono) ?? '') ?? '',
  };
}

/** Entra como la persona: pide el código, lo lee del WhatsApp y entra (con nombre y RUT si el número es nuevo). */
export async function entrarConCodigo(post: Post, buzon: Buzon, telefono: string, datos: Record<string, unknown> = {}): Promise<Respuesta> {
  assert.equal((await post('/acceso/codigo', { telefono })).status, 200);
  return post('/acceso/entrar', { telefono, codigo: buzon.ultimo(telefono), ...datos });
}

/** El token de la sesión, exigiendo que haya entrado. */
export async function tokenConCodigo(post: Post, buzon: Buzon, telefono: string, datos: Record<string, unknown> = {}): Promise<string> {
  const r = await entrarConCodigo(post, buzon, telefono, datos);
  assert.equal(r.status, 201, JSON.stringify(r.cuerpo));
  return r.cuerpo.token;
}
