// Envíos masivos de la sala: muchos teléfonos a la vez sin saturar WhatsApp ni a las personas.
//  - Concurrencia acotada: a lo más `concurrencia` envíos en vuelo (el módulo de WhatsApp ya reintenta cada uno).
//  - Difusión con freno por teléfono: nunca más de una difusión cada `minimoDifusionMs` a la misma persona.
//    Si llega otra antes, se guarda solo la última y sale cuando se cumple el plazo.
import type { WhatsApp } from '../whatsapp/index.ts';

export type Log = Pick<Console, 'info' | 'warn' | 'error'>;

/** "***678": nunca un teléfono completo en los logs. */
export function enmascarar(telefono: string): string {
  return `***${telefono.replace(/\D/g, '').slice(-3)}`;
}

/** Solo dígitos y los últimos 9 (móvil chileno), igual que la red: "+56 9 1234 5678" y "56912345678" coinciden. */
export const claveTelefono = (telefono: string) => telefono.replace(/\D/g, '').slice(-9);

export function crearLimitador(maximo: number) {
  let enVuelo = 0;
  const espera: (() => void)[] = [];
  return async function limitar<T>(tarea: () => Promise<T>): Promise<T> {
    if (enVuelo >= maximo) await new Promise<void>(listo => espera.push(listo));
    enVuelo++;
    try {
      return await tarea();
    } finally {
      enVuelo--;
      espera.shift()?.();
    }
  };
}

export interface OpcionesEnvios {
  readonly concurrencia: number;
  readonly minimoDifusionMs: number;
  readonly log: Log;
}

/** Un adjunto por enlace (p. ej. el PDF de la factura). */
export interface DocumentoAdjunto {
  readonly link: string;
  readonly filename: string;
  readonly caption?: string;
}

/** WhatsApp para envíos: `sendDocument` es opcional, solo si el módulo lo ofrece. */
export type WhatsAppDeEnvios = Pick<WhatsApp, 'sendText'> & {
  sendDocument?(to: string, documento: DocumentoAdjunto): ReturnType<WhatsApp['sendText']>;
};

export interface Envios {
  /** Envío directo (respuesta o aviso puntual), con la concurrencia acotada. */
  enviar(telefono: string, texto: string, motivo: string): Promise<boolean>;
  /** Adjunto con la concurrencia acotada; false si WhatsApp no envía documentos o falló. */
  enviarDocumento(telefono: string, documento: DocumentoAdjunto, motivo: string): Promise<boolean>;
  /** Difusión a muchos: respeta el freno por teléfono y se queda con el último texto. */
  difundir(telefonos: Iterable<string>, texto: string, motivo: string): Promise<void>;
  detener(): void;
}

export function crearEnvios(whatsapp: WhatsAppDeEnvios, opciones: OpcionesEnvios): Envios {
  const limitar = crearLimitador(opciones.concurrencia);
  const ultimaDifusion = new Map<string, number>();
  const diferidas = new Map<string, { texto: string; motivo: string; timer: ReturnType<typeof setTimeout> }>();

  async function enviar(telefono: string, texto: string, motivo: string): Promise<boolean> {
    return entregar(telefono, motivo, () => whatsapp.sendText(telefono, texto));
  }

  async function entregar(telefono: string, motivo: string, envio: () => ReturnType<WhatsApp['sendText']>): Promise<boolean> {
    try {
      const r = await limitar(envio);
      if (!r.ok) opciones.log.warn(`[sala] ${motivo} a ${enmascarar(telefono)} falló: ${r.error}`);
      return r.ok;
    } catch (error) {
      opciones.log.error(`[sala] ${motivo} a ${enmascarar(telefono)} lanzó: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  function difundirA(telefono: string, texto: string, motivo: string): Promise<boolean> | null {
    const clave = claveTelefono(telefono);
    const ahora = Date.now();
    const libreEn = (ultimaDifusion.get(clave) ?? -Infinity) + opciones.minimoDifusionMs;
    const pendiente = diferidas.get(clave);
    if (ahora >= libreEn && !pendiente) {
      ultimaDifusion.set(clave, ahora);
      return enviar(telefono, texto, motivo);
    }
    if (pendiente) {
      pendiente.texto = texto; // solo importa el último
      pendiente.motivo = motivo;
      return null;
    }
    const timer = setTimeout(() => {
      const d = diferidas.get(clave);
      diferidas.delete(clave);
      if (!d) return;
      ultimaDifusion.set(clave, Date.now());
      void enviar(telefono, d.texto, d.motivo);
    }, libreEn - ahora);
    timer.unref?.();
    diferidas.set(clave, { texto, motivo, timer });
    return null;
  }

  return {
    enviar,
    async enviarDocumento(telefono, documento, motivo) {
      const { sendDocument } = whatsapp;
      if (!sendDocument) return false;
      return entregar(telefono, motivo, () => sendDocument.call(whatsapp, telefono, documento));
    },
    async difundir(telefonos, texto, motivo) {
      const unicos = new Map<string, string>();
      for (const t of telefonos) unicos.set(claveTelefono(t), t);
      const envios = [...unicos.values()].map(t => difundirA(t, texto, motivo)).filter(p => p !== null);
      const resultados = await Promise.all(envios);
      opciones.log.info(`[sala] ${motivo}: ${resultados.filter(Boolean).length}/${unicos.size} enviados ahora, ${diferidas.size} en espera`);
    },
    detener() {
      for (const d of diferidas.values()) clearTimeout(d.timer);
      diferidas.clear();
    },
  };
}
