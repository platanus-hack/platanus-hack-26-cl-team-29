// "Trae a tu vecino": cada comprador tiene un código de invitación propio (al azar, nunca sacado de su teléfono ni de su
// RUT) que comparte como enlace web (/unirse?ref=<código>) o como enlace wa.me al bot con el código ya escrito.
//   se suma por primera vez a una compra --> el bot le ofrece su invitación (una vez por compra)
//   escribe "invitar" --> el bot se la vuelve a dar (con límite por teléfono)
//   llega alguien con un código --> queda invitado por ese negocio; al sumarse, a quien invitó le llega un WhatsApp
//                                   y /red muestra "X invitó a Y" (`invitacion.sumada`, solo nombres)
// Decisión: docs/decisiones/20261121-1614-trae-a-tu-vecino.md
import { randomInt } from 'node:crypto';
import { lineaInvitacion, mensajeAlBotConCodigo, rutaInvitacion, textoInvitacion } from '../../shared/avisos.ts';
import { dinero } from '../../shared/formato.ts';
import { enlaceWhatsapp } from '../../shared/telefono.ts';
import { MENSAJE_LIMITE } from '../../shared/texto.ts';
import { crearLimitador } from '../limite.ts';
import type { Envios, Log } from '../agente/envios.ts';
import { enmascarar } from '../agente/envios.ts';
import type { LicitacionVista, Negocio, TipoEventoRed } from '../red/tipos.ts';
import type { AlmacenContactos, Contacto } from './almacen.ts';
import { claveDe, ronda } from './almacen.ts';

/** Letras sin las que se confunden (I, O): 24^8 códigos posibles. */
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LARGO_CODIGO = 8;
const CODIGO_EN_TEXTO = new RegExp(`\\b[${LETRAS}]{${LARGO_CODIGO}}\\b`, 'g');

export const ofrecerInvitacion = (texto: string) =>
  `Trae a tu vecino: cada negocio que se suma baja el precio para todos. Reenvía este mensaje a otro negocio:\n\n${texto}`;
export const sumoConTuInvitacion = (invitado: string, producto: string, precio: number, bajo: boolean) =>
  `${invitado} se sumó con tu invitación: el precio de ${producto} ${bajo ? 'bajó a' : 'va en'} ${dinero(precio)}.`;

/** Lo que la web necesita para compartir: el texto lo arma el navegador con su propio origen. */
export interface InvitacionWeb {
  codigo: string;
  nombre: string;
  ruta: string;
  whatsapp: string | null;
}

/** Una invitación que ya sumó a alguien, para dibujar quién invitó a quién (solo nombres e ids de negocio). */
export interface InvitacionPublica {
  invita: string;
  invitado: string;
  en: string;
  invitaId?: string;
  invitadoId?: string;
}

export interface OpcionesVecinos {
  almacen: AlmacenContactos;
  actualizar(id: string, cambiar: (c: Contacto) => Contacto): Promise<Contacto>;
  envios: Envios;
  negocios(): readonly Negocio[];
  emitir(tipo: TipoEventoRed, datos: Record<string, unknown>): void;
  /** Número del bot (solo dígitos) para el enlace wa.me, y la URL pública para el enlace web; cualquiera puede faltar. */
  whatsappNumero: string | null;
  urlPublica: string | null;
  log: Log;
  reloj: () => Date;
}

export function crearVecinos(o: OpcionesVecinos) {
  // Pedir la invitación por WhatsApp crea un código si no hay: 5 por teléfono cada 10 minutos.
  const cabe = crearLimitador(5, 10 * 60_000);

  function nuevoCodigo(): string {
    const usados = new Set(o.almacen.todos().map(c => c.codigo));
    for (;;) {
      const codigo = Array.from({ length: LARGO_CODIGO }, () => LETRAS[randomInt(LETRAS.length)]).join('');
      if (!usados.has(codigo)) return codigo;
    }
  }

  async function conCodigo(id: string): Promise<Contacto> {
    return o.actualizar(id, c => (c.codigo ? c : { ...c, codigo: nuevoCodigo() }));
  }

  const whatsappDe = (codigo: string) => enlaceWhatsapp(o.whatsappNumero, mensajeAlBotConCodigo(codigo)) || null;

  /** El mensaje del bot con la invitación lista para reenviar. */
  function mensajeDeInvitacion(c: Contacto): string {
    const web = o.urlPublica ? `${o.urlPublica.replace(/\/$/, '')}${rutaInvitacion(c.codigo!)}` : null;
    return ofrecerInvitacion(textoInvitacion({ nombre: c.nombre, web, whatsapp: whatsappDe(c.codigo!) }));
  }

  const porCodigo = (codigo: string) => o.almacen.todos().find(c => c.codigo === codigo) ?? null;

  /** Deja al contacto `id` invitado por el dueño del código (si es de otro y aún no tenía quién lo invitara). */
  async function invitadoPor(id: string, codigo: string, datos: Partial<Contacto> = {}): Promise<boolean> {
    const quien = porCodigo(codigo);
    if (!quien || quien.id === id) return false;
    await o.actualizar(id, c => ({ ...c, ...datos, invitadoPor: c.invitadoPor ?? quien.id }));
    return true;
  }

  const idNegocio = (contactoId: string) => o.negocios().find(n => claveDe(n) === contactoId)?.id;

  return {
    /** Un mensaje de WhatsApp con un código de invitación válido de otro negocio. */
    async llegoConCodigo(id: string, telefono: string, texto: string): Promise<boolean> {
      for (const posible of texto.toUpperCase().match(CODIGO_EN_TEXTO) ?? []) {
        if (await invitadoPor(id, posible, { telefono })) {
          o.log.info(`[vecinos] ${enmascarar(telefono)} llegó con una invitación`);
          return true;
        }
      }
      return false;
    },

    /** "invitar" por WhatsApp: su invitación, si es un comprador registrado. */
    async pedirPorWhatsapp(id: string, telefono: string): Promise<string | null> {
      if (!o.almacen.buscar(id)?.registrado) return null;
      if (!cabe(id)) return MENSAJE_LIMITE;
      o.log.info(`[vecinos] ${enmascarar(telefono)} pidió su invitación`);
      return mensajeDeInvitacion(await conCodigo(id));
    },

    async paraLaWeb(n: Negocio): Promise<InvitacionWeb | null> {
      const id = claveDe(n);
      if (!id) return null;
      const c = await conCodigo(id);
      return { codigo: c.codigo!, nombre: c.nombre || n.nombre, ruta: rutaInvitacion(c.codigo!), whatsapp: whatsappDe(c.codigo!) };
    },

    /** Entró por la web con `?ref=`: queda invitado. */
    async invitadoEnLaWeb(n: Negocio, codigo: string): Promise<boolean> {
      const id = claveDe(n);
      return id ? invitadoPor(id, codigo.trim().toUpperCase(), { nombre: n.nombre, ...(n.rut ? { registrado: true } : {}) }) : false;
    },

    /**
     * Se sumó a la compra `l`: si llegó invitado, se le cuenta a quien lo invitó (una sola vez) y se avisa en público;
     * y a él se le ofrece su propia invitación (una vez por compra).
     */
    async alSumarse(n: Negocio, l: LicitacionVista) {
      const id = claveDe(n);
      const c = id ? o.almacen.buscar(id) : null;
      if (!id || !c) return;
      const quien = c.invitadoPor && !c.invitacionContada ? o.almacen.buscar(c.invitadoPor) : null;
      if (quien) {
        await o.actualizar(id, x => ({ ...x, invitacionContada: o.reloj().toISOString() }));
        const participante = l.participantes.find(p => p.negocioId === n.id);
        const p = l.productos.find(x => x.id === participante?.items[0]?.productoId) ?? l.productos[0]!;
        if (quien.telefono && !quien.sinAvisos) {
          await o.envios.enviar(quien.telefono, sumoConTuInvitacion(n.nombre, p.nombre, p.precioActual, p.precioActual < p.precioSolo), 'invitación sumada');
        }
        const invitaId = idNegocio(quien.id);
        o.emitir('invitacion.sumada', { licitacionId: l.id, invita: quien.nombre, invitado: n.nombre, invitadoId: n.id, ...(invitaId ? { invitaId } : {}) });
        o.log.info(`[vecinos] ${lineaInvitacion(quien.nombre, n.nombre)}`);
      }
      // Ya no se ofrece invitar por WhatsApp al sumarse (era spam): se invita desde la web o escribiendo "invitar".
    },

    /** Quién invitó a quién (las que ya sumaron a alguien), con los ids de negocio de la red actual si existen. */
    invitaciones(): InvitacionPublica[] {
      const contactos = o.almacen.todos();
      return contactos.flatMap(c => {
        const quien = c.invitadoPor && c.invitacionContada ? contactos.find(x => x.id === c.invitadoPor) : undefined;
        if (!quien) return [];
        const invitaId = idNegocio(quien.id), invitadoId = idNegocio(c.id);
        return [{ invita: quien.nombre, invitado: c.nombre, en: c.invitacionContada!, ...(invitaId ? { invitaId } : {}), ...(invitadoId ? { invitadoId } : {}) }];
      }).sort((a, b) => a.en.localeCompare(b.en));
    },
  };
}

export type Vecinos = ReturnType<typeof crearVecinos>;
