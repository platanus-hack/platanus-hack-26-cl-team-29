// Prueba de humo contra el SII de CERTIFICACIÓN (maullin y ws2): emite una factura 33 con referencia a una orden
// de compra, la sube, consulta su estado hasta que el SII la procese y, con --rfp, registra un reclamo por falta
// parcial como receptor. Imprime las respuestas del SII completas. Lee todo de variables de entorno.
//
//   node --env-file=.env scripts/sii-humo.ts --folio 12 [--oc OC-123] [--rfp]
//
// El folio debe estar dentro del CAF de SII_CAF_33_BASE64 y no haberse usado antes.
import { crearSii, ErrorSii, type ResultadoEmision, type Sii } from '../server/sii/index.ts';

const args = process.argv.slice(2);
const flag = (nombre: string): string | undefined => {
  const i = args.indexOf(`--${nombre}`);
  return i === -1 ? undefined : args[i + 1];
};
const folio = Number(flag('folio'));
if (!Number.isSafeInteger(folio) || folio <= 0) {
  console.error('Uso: node --env-file=.env scripts/sii-humo.ts --folio <n> [--oc <id>] [--rfp]');
  process.exit(2);
}
const env = process.env;
const faltan = ['SII_RUT_RECEPTOR', 'SII_RECEPTOR_RAZON_SOCIAL', 'SII_RECEPTOR_GIRO', 'SII_RECEPTOR_DIRECCION', 'SII_RECEPTOR_COMUNA']
  .filter(n => !env[n]);
if (faltan.length > 0) {
  console.error(`Faltan variables de entorno: ${faltan.join(', ')}`);
  process.exit(2);
}

/** Estados de QueryEstUp en que el SII todavía no termina de procesar el sobre. */
const EN_PROCESO = new Set(['REC', 'SOK', 'CRT', 'FOK', 'PDR', 'PRD', 'LSO']);
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));
const titulo = (texto: string) => console.log(`\n=== ${texto}`);

async function main(sii: Sii): Promise<void> {
  if (sii.modo !== 'certificacion') throw new Error('Falta SII_PFX_BASE64: la prueba de humo no corre en modo falso.');
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());

  titulo(`Emitiendo factura 33 folio ${folio} de ${sii.rutEmisor} a ${env.SII_RUT_RECEPTOR}`);
  const emision: ResultadoEmision = await sii.emitirFactura({
    folio,
    receptor: {
      rut: env.SII_RUT_RECEPTOR ?? '',
      razonSocial: env.SII_RECEPTOR_RAZON_SOCIAL ?? '',
      giro: env.SII_RECEPTOR_GIRO ?? '',
      direccion: env.SII_RECEPTOR_DIRECCION ?? '',
      comuna: env.SII_RECEPTOR_COMUNA ?? '',
    },
    items: [
      { nombre: 'Producto de prueba A', cantidad: 10, precioUnitario: 1500, unidad: 'UN' },
      { nombre: 'Producto de prueba B', cantidad: 3, precioUnitario: 2990, unidad: 'UN' },
    ],
    ordenCompra: { folio: flag('oc') ?? `OC-HUMO-${folio}`, fecha: hoy },
  });
  console.log(JSON.stringify(emision.documento, null, 2));
  console.log(`Sobre: ${emision.sobreXml.length} caracteres`);
  titulo(`Subida: ${emision.envio.estado}`);
  console.log(emision.envio.estado === 'incierto' ? emision.envio.error : emision.envio.respuesta);

  const consulta = {
    tipo: 33, folio, fechaEmision: emision.documento.fechaEmision,
    montoTotal: emision.documento.montoTotal, rutReceptor: emision.documento.rutReceptor,
  };
  if (emision.envio.estado === 'incierto') {
    titulo('Corte de red: se consulta el folio antes de cualquier reenvío (FAU = no llegó)');
    console.log((await sii.estadoDocumento(consulta)).respuesta);
    return;
  }
  if (emision.envio.estado === 'rechazado') return;

  const { trackId } = emision.envio;
  for (let intento = 1; intento <= 30; intento++) {
    const estado = await sii.estadoEnvio(trackId);
    titulo(`Estado del envío ${trackId} (intento ${intento}): ${estado.codigo} ${estado.glosa ?? ''}`);
    console.log(estado.respuesta);
    if (!EN_PROCESO.has(estado.codigo) && !/^-\d+$/.test(estado.codigo)) break;
    await esperar(10_000);
  }

  titulo('Estado del documento (QueryEstDte)');
  console.log((await sii.estadoDocumento(consulta)).respuesta);

  if (args.includes('--rfp')) {
    // El titular del certificado debe estar autorizado en la empresa receptora.
    const documento = { rutEmisor: sii.rutEmisor, tipo: 33, folio };
    titulo('Receptor: reclamo por falta parcial (RFP)');
    console.log(JSON.stringify(await sii.registrarAccionReceptor(documento, 'RFP'), null, 2));
    titulo('Eventos del documento');
    console.log(JSON.stringify(await sii.eventosDocumento(documento), null, 2));
  }
}

try {
  await main(crearSii());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof ErrorSii) console.error(`Respuesta del SII:\n${error.respuesta}`);
  process.exitCode = 1;
}
