// Implementación en memoria con respuestas plausibles del SII, para trabajar sin certificado ni CAF.
// Valida la entrada igual que la real (RUT, totales, tipos y acciones), así un error aparece antes de certificar.
import { aDte, calcularTotales, datosImpresos, type EntradaDte } from './dte.ts';
import type { Sii } from './index.ts';
import { resultadoDe, validarReclamo } from './reclamo.ts';
import { timbrarSimulado } from './timbre.ts';
import { normalizarRut } from '../../shared/rut.ts';
import { marcaEnChile } from '../../shared/fecha.ts';
import type { AccionReceptor, DocumentoEmitido, Emisor, EventoReceptor, RespuestaReclamo } from './tipos.ts';

/** RUT de ejemplo, sin dueño real, para cuando no se configura uno. */
const RUT_DE_EJEMPLO = '11111111-1';
const RECLAMOS: readonly AccionReceptor[] = ['RCD', 'RFP', 'RFT'];

/** Datos del emisor que muestra el PDF simulado; quien llama puede reemplazarlos por los de su negocio. */
const EMISOR_SIMULADO: Omit<Emisor, 'rut'> = {
  razonSocial: 'Emisor de prueba', giro: 'Venta de insumos', acteco: 0, direccion: 'Sin informar', comuna: 'Santiago',
};

export function crearSiiFalso(rutEmisor: string = RUT_DE_EJEMPLO): Sii {
  const emisor = normalizarRut(rutEmisor);
  const porTrack = new Map<string, DocumentoEmitido[]>();
  const porFolio = new Map<string, DocumentoEmitido>();
  const eventos = new Map<string, EventoReceptor[]>();
  let ultimoTrack = 1000;
  const clave = (rut: string, tipo: number, folio: number): string => `${normalizarRut(rut)}:${tipo}:${folio}`;
  const respuesta = (codigo: number, descripcion: string): RespuestaReclamo => ({
    codigo, descripcion, resultado: resultadoDe(codigo),
  });

  /** Un sobre con uno o más documentos: un track id para todos. */
  async function emitirLote(entradas: readonly Omit<EntradaDte, 'emisor'>[]) {
    if (entradas.length === 0) throw new Error('El sobre necesita al menos un DTE.');
    const marca = marcaEnChile(new Date());
    const documentos = entradas.map((entrada): DocumentoEmitido => {
      const totales = calcularTotales(entrada.items);
      const ted = timbrarSimulado({
        tipo: entrada.tipo, folio: entrada.folio, fechaEmision: entrada.fechaEmision, rutEmisor: emisor,
        rutReceptor: entrada.receptor.rut, razonSocialReceptor: entrada.receptor.razonSocial, montoTotal: totales.total,
        primerItem: entrada.items[0]?.nombre ?? '', marca,
      });
      const impreso = datosImpresos(
        { ...entrada, emisor: { ...EMISOR_SIMULADO, rut: emisor } },
        { ted, resolucion: { numero: 0, fecha: entrada.fechaEmision }, simulado: true },
      );
      return {
        tipo: entrada.tipo,
        folio: entrada.folio,
        fechaEmision: entrada.fechaEmision,
        rutEmisor: emisor,
        rutReceptor: normalizarRut(entrada.receptor.rut),
        montoNeto: totales.neto,
        iva: totales.iva,
        montoTotal: totales.total,
        impreso,
      };
    });
    const trackId = String(++ultimoTrack);
    porTrack.set(trackId, documentos);
    for (const d of documentos) porFolio.set(clave(emisor, d.tipo, d.folio), d);
    const texto = `<RECEPCIONDTE><STATUS>0</STATUS><TRACKID>${trackId}</TRACKID></RECEPCIONDTE>`;
    return { documentos, envio: { estado: 'recibido' as const, trackId, respuesta: texto }, sobreXml: '' };
  }

  async function emitir(entrada: Omit<EntradaDte, 'emisor'>) {
    const { documentos, envio, sobreXml } = await emitirLote([entrada]);
    return { documento: documentos[0]!, envio, sobreXml };
  }

  return {
    modo: 'falso',
    rutEmisor: emisor,
    emitirFactura: e => emitir(aDte.factura(e)),
    emitirFacturas: entradas => emitirLote(entradas.map(aDte.factura)),
    emitirGuia: e => emitir(aDte.guia(e)),
    emitirNotaCredito: e => emitir(aDte.notaCredito(e)),

    async estadoEnvio(trackId) {
      const lote = porTrack.get(trackId);
      if (!lote) return { trackId, codigo: '-11', glosa: 'TrackId desconocido (implementacion falsa)', porTipo: [], respuesta: '' };
      const tipos = [...new Set(lote.map(d => d.tipo))];
      const porTipo = tipos.map(tipo => {
        const n = lote.filter(d => d.tipo === tipo).length;
        return { tipo, informados: n, aceptados: n, rechazados: 0, reparos: 0 };
      });
      return { trackId, codigo: 'EPR', glosa: 'Envio Procesado', porTipo, respuesta: '' };
    },

    async estadoDocumento(c) {
      const d = porFolio.get(clave(emisor, c.tipo, c.folio));
      if (!d) return { codigo: 'FAU', glosa: 'DTE No Recibido', codigoError: '3', glosaError: 'Documento No Recibido por el SII', respuesta: '' };
      const coincide = d.montoTotal === c.montoTotal && d.fechaEmision === c.fechaEmision && d.rutReceptor === normalizarRut(c.rutReceptor);
      return coincide
        ? { codigo: 'DOK', glosa: 'DTE Recibido', codigoError: '0', glosaError: 'Datos Coinciden con los Registrados', respuesta: '' }
        : { codigo: 'DNK', glosa: 'DTE Recibido', codigoError: '1', glosaError: 'Datos NO Coinciden con los registrados', respuesta: '' };
    },

    async registrarAccionReceptor(documento, accion) {
      validarReclamo(documento, accion);
      const k = clave(documento.rutEmisor, documento.tipo, documento.folio);
      const previos = eventos.get(k) ?? [];
      if (previos.some(e => e.codigo === accion)) return respuesta(7, 'Evento registrado previamente');
      if (RECLAMOS.includes(accion) && previos.some(e => e.codigo === 'ACD')) {
        return respuesta(11, 'No se puede reclamar DTE previamente aceptado');
      }
      const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ');
      eventos.set(k, [...previos, { codigo: accion, descripcion: accion, rutResponsable: emisor, fecha }]);
      return respuesta(0, 'Accion Completada OK');
    },

    async eventosDocumento(documento) {
      validarReclamo(documento);
      const lista = eventos.get(clave(documento.rutEmisor, documento.tipo, documento.folio)) ?? [];
      return lista.length === 0
        ? { ...respuesta(16, 'Documento no presenta eventos de reclamos o acuse de recibo'), eventos: [] }
        : { ...respuesta(15, 'Listado de eventos del documento'), eventos: lista };
    },
  };
}
