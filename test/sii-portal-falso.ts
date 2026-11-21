// Portal del SII falso, a nivel HTTP, para probar la sesión y los flujos de folios sin tocar el SII.
// Registra cada solicitud y detecta solicitudes concurrentes dentro de una misma sesión.
import type { Http, RespuestaHttp } from '../server/sii-portal/index.ts';
import { generarCaf } from './sii-apoyo.ts';

export interface Solicitud { metodo: string; ruta: string; cuerpo: string }

export interface OpcionesFalso {
  /** Respuesta del login: abre sesión, límite de sesiones (720) o certificado no habilitado. */
  login?: 'ok' | 'limite' | 'no_habilitado';
  /** Rangos reobtenibles por tipo (los más recientes primero). */
  rangos?: Record<number, { desde: number; hasta: number; fecha: string }[]>;
  /** Texto del bloqueo del timbraje; sin él, el timbraje autoriza hasta `maxAutor`. */
  bloqueo?: string;
  maxAutor?: number;
  /** `AAAA-MM-DD`, como la entrega la app de www2c. */
  fechaResolucion?: string;
  /**
   * `dos_pasos`: la API de la app de www2c responde 428 (verificación en dos pasos) en `obtenerEmpresa`.
   * `sin_sesion`: la app no reconoce ninguna sesión (401 a todo `/app/`).
   */
  app?: 'dos_pasos' | 'sin_sesion';
}

const pagina = (cuerpo: string) => `<html><head><title>SII</title></head><body>${cuerpo}</body></html>`;
const oculto = (n: string, v: string | number) => `<input type="hidden" name="${n}" value="${v}">`;
const formRut = (accion: string, extra = '') => pagina(`<form action="/cvc_cgi/dte/${accion}" method="post"><input name="RUT_EMP"><input name="DV_EMP">${extra}<input type="submit" name="ACEPTAR" value="Consultar"></form>`);

export function crearPortalFalso(o: OpcionesFalso = {}) {
  const solicitudes: Solicitud[] = [];
  const validas = new Set<string>();
  /** Sesiones que ya pasaron por `/app/session/status` (sin eso la API de la app responde 401). */
  const conEstadoApp = new Set<string>();
  /** Sesiones que maullin acepta pero la app de www2c ya no (responde 401 a todo `/app/`). */
  const rechazadasApp = new Set<string>();
  const enCurso = new Map<string, number>();
  let sesiones = 0;
  let concurrencia = 0;

  const responder = (estado: number, cuerpo: string, extra: Partial<RespuestaHttp> = {}): Omit<RespuestaHttp, 'metodo' | 'url'> =>
    ({ estado, ubicacion: null, setCookie: [], tipoContenido: 'text/html', cuerpo, ...extra });

  /** App nueva de www2c: la SPA y su API JSON, con la secuencia y las cabeceras XHR que exige. */
  function manejarApp(url: URL, id: string, xhr: boolean): Omit<RespuestaHttp, 'metodo' | 'url'> {
    const json = (estado: number, valor: unknown) => responder(estado, JSON.stringify(valor), { tipoContenido: 'application/json' });
    if (!xhr || rechazadasApp.has(id) || o.app === 'sin_sesion') return responder(401, '');
    if (url.pathname === '/app/session/status') {
      conEstadoApp.add(id);
      return json(200, { seconds: 5999, userAuthType: 'CT' });
    }
    if (!conEstadoApp.has(id)) return responder(401, '');
    const [rut = '', dv = ''] = (url.pathname.split('/')[4] ?? '').split('-');
    switch (url.pathname.split('/').pop()) {
      case 'esUsuarioAdministrador': return json(200, true);
      case 'obtenerEmpresa':
        if (o.app === 'dos_pasos') return json(428, { mensaje: 'Debe completar la verificacion en dos pasos' });
        return json(200, { rut: Number(rut), dv, fechaResolucion: o.fechaResolucion ?? '2026-10-07', resolucion: '0', fechaAutorizacion: '2026-10-07' });
      case 'obtenerContribuyente': return json(200, { rut: Number(rut), dv, razonSocial: 'Comercial de Prueba SpA', nombres: null });
      default: return responder(404, '');
    }
  }

  function manejar(metodo: string, url: URL, cookie: string, cuerpo: string, xhr: boolean): Omit<RespuestaHttp, 'metodo' | 'url'> {
    const ruta = url.pathname;
    const campos = new URLSearchParams(cuerpo);
    if (url.host === 'zeusr.sii.cl') return responder(200, pagina('Ingreso'), { setCookie: ['TS01=balanceador; Path=/'] });
    if (url.host === 'herculesr.sii.cl') {
      if (o.login === 'limite') return responder(200, pagina(`<script>alert('Usted ha superado el maximo de sesiones autenticadas en el sitio web del SII. El codigo de este mensaje es 01.01.215.500.720.27');</script>`));
      if (o.login === 'no_habilitado') return responder(200, pagina(`<script>alert('Debe Cambiar clave. Codigo 01.01.215.500.473');</script>`));
      const id = `s${++sesiones}`;
      validas.add(id);
      return responder(200, pagina(`<script>setCookie('NETSCAPE_LIVEWIRE.locexp','1');</script>`), { setCookie: [`NETSCAPE_LIVEWIRE.sesion=${id}; Path=/`, 'NETSCAPE_LIVEWIRE.rut=11111111; Path=/'] });
    }
    const id = /NETSCAPE_LIVEWIRE\.sesion=(\w+)/.exec(cookie)?.[1];
    if (url.host === 'www2c.sii.cl') {
      if (url.pathname === '/sii-muyd-inter/') return responder(200, pagina('<div id="app"></div>'));
      return id && validas.has(id) ? manejarApp(url, id, xhr) : responder(401, '');
    }
    if (!id || !validas.has(id)) return responder(302, '', { ubicacion: `https://zeusr.sii.cl/cgi_AUT2000/autInicioDTE.cgi?referencia=${url}` });
    const pag = ruta.split('/').pop();
    switch (pag) {
      case 'ce_consulta_muestra_e': return responder(200, pagina(`<table><tr><td>Datos del Contribuyente Rut</td><td>${campos.get('RUT_EMP')}-${campos.get('DV_EMP')}</td></tr><tr><td>Nombre o Raz&oacute;n Social</td><td>Comercial de Prueba SpA</td></tr><tr><td>Direcci&oacute;n de la Empresa</td><td>CALLE FALSA 123, Comuna SANTIAGO</td></tr><tr><td>461000</td><td>VENTA AL POR MAYOR</td><td>Afecta</td></tr></table>`));
      case 'rf_reobtencion1_folios': return responder(200, formRut('rf_reobtencion2_folios', `${oculto('PAGINA', 1)}<select name="COD_DOCTO"><option value="33">33</option></select>`));
      case 'rf_reobtencion2_folios': {
        const tipo = Number(campos.get('COD_DOCTO'));
        const filas = (o.rangos?.[tipo] ?? []).map(r => {
          const [a, m, d] = r.fecha.split('-');
          return `<form action="/cvc_cgi/dte/rf_reobtencion3_folios" method="post">${oculto('RUT_EMP', campos.get('RUT_EMP') ?? '')}${oculto('DV_EMP', campos.get('DV_EMP') ?? '')}${oculto('COD_DOCTO', tipo)}${oculto('FOLIO_INI', r.desde)}${oculto('FOLIO_FIN', r.hasta)}${oculto('CANT_DOCTOS', r.hasta - r.desde + 1)}${oculto('ANO', a!)}${oculto('MES', m!)}${oculto('DIA', d!)}<input type="button" name="MOD" value="Reobtener"></form>`;
        });
        return responder(200, pagina(filas.length ? filas.join('') : 'No registra timbrajes para el documento'));
      }
      case 'rf_reobtencion3_folios': return responder(200, pagina(`<form action="/cvc_cgi/dte/rf_genera_folio" method="post">${oculto('COD_DOCTO', campos.get('COD_DOCTO') ?? '')}${oculto('FOLIO_INI', campos.get('FOLIO_INI') ?? '')}${oculto('FOLIO_FIN', campos.get('FOLIO_FIN') ?? '')}</form>`));
      case 'rf_genera_folio':
      case 'of_genera_folio': {
        const destino = pag === 'rf_genera_folio' ? 'rf_genera_archivo' : 'of_genera_archivo';
        return responder(200, pagina(`<form action="/cvc_cgi/dte/${destino}" method="post">${oculto('COD_DOCTO', campos.get('COD_DOCTO') ?? '')}${oculto('FOLIO_INI', campos.get('FOLIO_INI') ?? '1')}${oculto('FOLIO_FIN', campos.get('FOLIO_FIN') ?? campos.get('CANT_DOCTOS') ?? '1')}</form>`));
      }
      case 'rf_genera_archivo':
      case 'of_genera_archivo': {
        const tipo = Number(campos.get('COD_DOCTO'));
        const { bytes } = generarCaf(tipo, { desde: Number(campos.get('FOLIO_INI')), hasta: Number(campos.get('FOLIO_FIN')) });
        return responder(200, bytes.toString('latin1'));
      }
      case 'of_solicita_folios': return responder(200, formRut('of_solicita_folios_dcto'));
      case 'of_solicita_folios_dcto':
        if (o.bloqueo) return responder(200, pagina(`SOLICITUD DE TIMBRAJE ELECTRONICO ${o.bloqueo}<script>form.COD_DOCTO.value='-1'</script>`));
        return responder(200, pagina(`<form action="/cvc_cgi/dte/of_confirma_folio" method="post">${oculto('RUT_EMP', campos.get('RUT_EMP') ?? '')}${oculto('DV_EMP', campos.get('DV_EMP') ?? '')}${oculto('COD_DOCTO', campos.get('COD_DOCTO') ?? '')}${oculto('MAX_AUTOR', o.maxAutor ?? 10)}${oculto('FOLIOS_DISP', 0)}<input name="CANT_DOCTOS"></form>`));
      case 'of_confirma_folio': return responder(200, pagina(`<form action="/cvc_cgi/dte/of_genera_folio" method="post">${oculto('COD_DOCTO', campos.get('COD_DOCTO') ?? '')}${oculto('FOLIO_INI', 901)}${oculto('FOLIO_FIN', 900 + Number(campos.get('CANT_DOCTOS')))}</form>`));
      default: return responder(302, '', { ubicacion: 'https://www.sii.cl/custom_pages/Error404.html' });
    }
  }

  const http: Http = async p => {
    const url = new URL(p.url);
    const cookie = p.cabeceras.find(([n]) => n === 'cookie')?.[1] ?? '';
    solicitudes.push({ metodo: p.metodo, ruta: `${url.host}${url.pathname}`, cuerpo: p.cuerpo ?? '' });
    const clave = /NETSCAPE_LIVEWIRE\.sesion=(\w+)/.exec(cookie)?.[1] ?? '';
    enCurso.set(clave, (enCurso.get(clave) ?? 0) + 1);
    if (clave && (enCurso.get(clave) ?? 0) > 1) concurrencia++;
    try {
      await new Promise(r => setTimeout(r, 2));
      const xhr = p.cabeceras.some(([n, v]) => n === 'sec-fetch-mode' && v === 'cors')
        && p.cabeceras.some(([n, v]) => n === 'X-SII-SESSION-USER-AUTH-TYPE' && v === 'CT');
      return { metodo: p.metodo, url: p.url, ...manejar(p.metodo, url, cookie, p.cuerpo ?? '', xhr) };
    } finally {
      enCurso.set(clave, (enCurso.get(clave) ?? 1) - 1);
    }
  };

  return {
    http,
    solicitudes,
    logins: () => solicitudes.filter(s => s.ruta === 'herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi').length,
    /** Solicitudes que se cruzaron dentro de una misma sesión. */
    concurrentes: () => concurrencia,
    /** El SII olvida todas las sesiones (vencen). */
    vencerSesiones: () => validas.clear(),
    /** La app de www2c deja de reconocer las sesiones (responde 401), aunque maullin las siga aceptando. */
    vencerSesionesApp: () => { for (const id of validas) rechazadasApp.add(id); },
    opciones: o,
  };
}

/** Reloj controlado: esperar avanza el tiempo sin dormir. */
export function crearRelojFalso(inicio = Date.UTC(2026, 10, 21, 15)) {
  let ahora = inicio;
  return { ahora: () => ahora, esperar: async (ms: number) => { ahora += ms; }, avanzar: (ms: number) => { ahora += ms; } };
}
