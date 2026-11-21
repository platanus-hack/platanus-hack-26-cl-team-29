// "Trae a tu vecino" en la web: el botón para compartir la invitación del negocio (Web Share o copiar) y, en /unirse,
// la llegada con `?ref=<código>`, que deja al negocio invitado por quien compartió el enlace.

import { useEffect, useState } from 'react';
import { rutaInvitacion, textoInvitacion } from '../../../shared/avisos.ts';
import { Icono } from './iconos.tsx';
import type { Modo } from './tipos.ts';

interface InvitacionWeb { codigo: string; nombre: string; ruta: string; whatsapp: string | null }

const conSesion = (token: string, cuerpo?: unknown): RequestInit => ({
  method: cuerpo === undefined ? 'GET' : 'POST',
  headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
});

/** Con la red falsa no hay servidor de invitaciones: un código de prueba para ver el botón. */
const invitacionDePrueba = (nombre: string): InvitacionWeb => ({ codigo: 'PRUEBAXX', nombre, ruta: rutaInvitacion('PRUEBAXX'), whatsapp: null });

export function Invitar({ token, modo, nombre }: { token: string; modo: Modo; nombre: string }) {
  const [invitacion, setInvitacion] = useState<InvitacionWeb | null>(null);
  const [copiado, setCopiado] = useState<'' | 'listo' | 'fallo'>('');

  useEffect(() => {
    if (modo === 'falso') return setInvitacion(invitacionDePrueba(nombre));
    let activo = true;
    fetch('/api/avisos/invitacion', conSesion(token))
      .then(r => (r.ok ? r.json() : null))
      .then((i: InvitacionWeb | null) => activo && setInvitacion(i))
      .catch(() => {});
    return () => { activo = false; };
  }, [token, modo, nombre]);

  if (!invitacion) return null;
  const texto = textoInvitacion({ nombre: invitacion.nombre, web: `${location.origin}${invitacion.ruta}`, whatsapp: invitacion.whatsapp });

  async function compartir() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Compra conjunta en Bando', text: texto });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // la persona cerró el menú
      }
    }
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado('listo');
    } catch {
      setCopiado('fallo');
    }
  }

  return (
    <section className="cn-invitar">
      <Icono nombre="grupo" />
      <div>
        <strong>Trae a tu vecino</strong>
        <p>Cada negocio que se suma baja el precio para todos.</p>
        <button type="button" className="boton" onClick={compartir}>Invitar a otro negocio</button>
        {copiado === 'listo' && <p className="cn-invitar-estado" role="status">Invitación copiada. Pégala en un chat.</p>}
        {copiado === 'fallo' && <p className="cn-invitar-estado" role="status">Copia este enlace: {location.origin}{invitacion.ruta}</p>}
      </div>
    </section>
  );
}

/** En /unirse: si llegó con `?ref=<código>`, apenas tiene sesión queda invitado por ese negocio (una vez por pestaña). */
export function useInvitacionRecibida(token: string | null, modo: Modo | undefined) {
  useEffect(() => {
    const ref = new URLSearchParams(location.search).get('ref');
    if (!token || !ref || modo !== 'real') return;
    const clave = `bando.invitacion.${ref}`;
    try {
      if (sessionStorage.getItem(clave)) return;
      sessionStorage.setItem(clave, '1');
    } catch {
      // Sin almacenamiento: se manda igual; el servidor no cuenta dos veces.
    }
    fetch('/api/avisos/invitado', conSesion(token, { ref })).catch(() => {});
  }, [token, modo]);
}
