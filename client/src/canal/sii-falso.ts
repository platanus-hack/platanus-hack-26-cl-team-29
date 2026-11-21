// "Conectar mi SII" sin backend: el mismo contrato en memoria, con datos ficticios. No abre el certificado (el navegador
// no lo necesita): solo exige un archivo y una clave. Del CAF lee tipo, emisor y rango, y simula la búsqueda del
// primer folio libre (un folio cada 200 ms). La conexión automática se simula paso a paso, con la resolución sin
// entregar (como el portal de certificación hoy) para mostrar el camino manual.

import { validarRut } from '../../../shared/rut.ts';
import { ErrorCanal, type CanalApi } from './api.ts';
import type { CafSii, EstadoConexionSii, PasoSii } from './tipos.ts';

type MetodosSii = Pick<CanalApi, 'siiEstado' | 'siiCertificado' | 'siiAutomatico' | 'siiConsultarEmpresa' | 'siiGuardarEmpresa' | 'siiCaf' | 'siiFolio' | 'siiDesconectar'>;

const vacia = (): EstadoConexionSii => ({
  conectado: false, respaldoVariables: false, puedeGuardar: true, titular: null, venceEl: null,
  rutEmisor: null, empresa: null, origenEmpresa: null, resolucion: null, cafs: [], automatico: null, sesionPersistente: false,
});

const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const exigir = (cumple: boolean, mensaje: string) => { if (!cumple) throw new ErrorCanal(mensaje); };

export function crearConexionSiiFalsa(verificar: (token: string) => void): MetodosSii {
  let c = vacia();
  const copia = () => {
    c.conectado = !!(c.titular && c.empresa && c.resolucion && c.cafs.some(f => f.tipo === 33 && f.primerLibre !== null));
    return structuredClone(c);
  };

  function buscar(caf: CafSii) {
    // Ficticio: los 3 primeros folios del rango ya están usados.
    const libre = Math.min(caf.hasta, caf.desde + 3);
    const total = Math.min(caf.hasta, libre + 2) - caf.desde + 1;
    caf.escaneando = true;
    caf.progreso = { revisados: 0, folio: caf.desde, total: caf.hasta - caf.desde + 1 };
    const paso = () => {
      if (!c.cafs.includes(caf) || !caf.escaneando || !caf.progreso) return;
      caf.progreso.revisados++;
      caf.progreso.folio = caf.desde + caf.progreso.revisados - 1;
      if (caf.progreso.revisados >= total) {
        caf.escaneando = false;
        caf.primerLibre = libre;
        caf.libres = caf.hasta - libre + 1;
        return;
      }
      setTimeout(paso, 200);
    };
    setTimeout(paso, 200);
  }

  /** Pasos ficticios con la misma forma que el servidor: cada uno tarda un poco. */
  function automatico(rut: string) {
    const pasos: PasoSii[] = (['empresa', 'resolucion', 'caf_33', 'caf_52', 'caf_61'] as const).map(id => ({ id, estado: 'pendiente', detalle: null, mensajeSii: null }));
    c.automatico = { activo: true, pasos };
    const resultados: Record<PasoSii['id'], () => void> = {
      empresa: () => {
        c.rutEmisor = rut;
        c.empresa = { razonSocial: 'Papelera del Centro SpA', giro: 'Venta al por mayor de artículos de papelería', acteco: 464903, direccion: 'Avenida de Prueba 1234', comuna: 'Santiago' };
        c.origenEmpresa = 'sii';
        Object.assign(pasos[0]!, { estado: 'listo', detalle: 'Papelera del Centro SpA' });
      },
      resolucion: () => Object.assign(pasos[1]!, { estado: 'error', detalle: 'El SII no entregó la resolución. Escríbela en "Tu empresa".' }),
      caf_33: () => cafFicticio(2, 33, 'Reobtenido', 5139, 5162),
      caf_52: () => cafFicticio(3, 52, 'Reobtenido', 2744, 2793),
      caf_61: () => cafFicticio(4, 61, 'Pedido al SII', 901, 905),
    };
    const cafFicticio = (i: number, tipo: CafSii['tipo'], origen: string, desde: number, hasta: number) => {
      const caf: CafSii = { tipo, desde, hasta, fa: new Date().toISOString().slice(0, 10), primerLibre: null, libres: null, escaneando: false, progreso: null, error: null };
      c.cafs = [...c.cafs.filter(f => f.tipo !== tipo), caf].sort((a, b) => a.tipo - b.tipo);
      buscar(caf);
      Object.assign(pasos[i]!, { estado: 'listo', detalle: `${origen}: folios ${desde} a ${hasta}.` });
    };
    pasos.forEach((p, i) => setTimeout(() => {
      p.estado = 'en_curso';
      setTimeout(() => {
        resultados[p.id]();
        if (i === pasos.length - 1 && c.automatico) c.automatico.activo = false;
      }, 500);
    }, i * 700));
  }

  return {
    async siiEstado(token) {
      verificar(token);
      return copia();
    },

    async siiCertificado(token, pfxBase64, clave, rutEmisor) {
      verificar(token);
      await espera(400);
      exigir(!!pfxBase64, 'Sube el archivo .pfx de tu certificado digital.');
      exigir(!!clave, 'Escribe la clave de tu certificado.');
      c.titular = '11111111-1';
      c.venceEl = new Date(Date.now() + 300 * 86_400_000).toISOString();
      automatico(validarRut(rutEmisor) ?? c.titular);
      return copia();
    },

    async siiAutomatico(token, rutEmisor) {
      verificar(token);
      exigir(!!c.titular, 'Primero sube tu certificado digital.');
      if (!c.automatico?.activo) automatico(validarRut(rutEmisor) ?? c.rutEmisor ?? c.titular!);
      return copia();
    },

    async siiConsultarEmpresa(token, rutEmisor) {
      verificar(token);
      await espera(800);
      const rut = validarRut(rutEmisor);
      exigir(!!rut, 'El RUT de la empresa no es válido. Escríbelo con guion y dígito verificador, por ejemplo 76123456-7.');
      exigir(!!c.titular, 'Primero sube tu certificado digital.');
      return {
        rut: rut!, razonSocial: 'Papelera del Centro SpA', giro: 'Venta al por mayor de artículos de papelería', acteco: 464903,
        direccion: 'Avenida de Prueba 1234', comuna: 'Santiago', ciudad: 'Santiago',
        actividades: [{ codigo: 464903, descripcion: 'Venta al por mayor de artículos de papelería' }],
      };
    },

    async siiGuardarEmpresa(token, d) {
      verificar(token);
      await espera(300);
      const rut = validarRut(d.rutEmisor);
      exigir(!!rut, 'El RUT de la empresa no es válido.');
      exigir(!!c.titular, 'Primero sube tu certificado digital.');
      exigir(/^\d{6}$/.test(d.acteco), 'El código de actividad económica tiene 6 dígitos.');
      exigir(!!(d.razonSocial && d.giro && d.direccion && d.comuna), 'Completa razón social, giro, dirección y comuna.');
      exigir(/^\d{4}-\d{2}-\d{2}$/.test(d.fchResol), 'La fecha de resolución va como AAAA-MM-DD.');
      if (c.rutEmisor && c.rutEmisor !== rut) c.cafs = [];
      c.rutEmisor = rut;
      c.empresa = { razonSocial: d.razonSocial, giro: d.giro, acteco: Number(d.acteco), direccion: d.direccion, comuna: d.comuna, ...(d.ciudad ? { ciudad: d.ciudad } : {}) };
      c.origenEmpresa = d.origen;
      c.resolucion = { fecha: d.fchResol, numero: d.nroResol, origen: 'manual', rechazada: false };
      return copia();
    },

    async siiCaf(token, xmlBase64) {
      verificar(token);
      await espera(400);
      exigir(!!c.rutEmisor, 'Primero guarda los datos de tu empresa.');
      let xml = '';
      try { xml = atob(xmlBase64); } catch { /* se valida abajo */ }
      const valor = (etiqueta: string) => new RegExp(`<${etiqueta}>\\s*([^<]+?)\\s*</${etiqueta}>`).exec(xml)?.[1] ?? '';
      const tipo = Number(valor('TD')) as CafSii['tipo'];
      exigir(!!tipo && !!valor('D') && !!valor('H'), 'El archivo no es un CAF válido.');
      exigir([33, 52, 61].includes(tipo), `El CAF es del tipo ${tipo}; la red usa factura (33), guía (52) y nota de crédito (61).`);
      exigir(validarRut(valor('RE')) === c.rutEmisor, `El CAF es de la empresa ${valor('RE')}, no de ${c.rutEmisor}.`);
      const caf: CafSii = {
        tipo, desde: Number(valor('D')), hasta: Number(valor('H')), fa: valor('FA'),
        primerLibre: null, libres: null, escaneando: false, progreso: null, error: null,
      };
      c.cafs = [...c.cafs.filter(f => f.tipo !== tipo), caf].sort((a, b) => a.tipo - b.tipo);
      buscar(caf);
      return { estado: copia(), avisos: [] };
    },

    async siiFolio(token, tipo, folio) {
      verificar(token);
      const caf = c.cafs.find(f => f.tipo === tipo);
      exigir(!!caf, 'No hay CAF de ese tipo.');
      const minimo = Math.max(caf!.desde, caf!.primerLibre ?? 0);
      exigir(Number.isInteger(folio) && folio >= minimo && folio <= caf!.hasta, `El folio debe estar entre ${minimo} y ${caf!.hasta}: nunca se vuelve a un folio anterior.`);
      Object.assign(caf!, { escaneando: false, progreso: null, primerLibre: folio, libres: caf!.hasta - folio + 1 });
      return copia();
    },

    async siiDesconectar(token) {
      verificar(token);
      c = vacia();
      return copia();
    },
  };
}
