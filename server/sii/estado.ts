// Consultas de estado: de un envío por su track id (QueryEstUp) y de un documento por sus datos (QueryEstDte).
import { type Autenticador, esTokenRechazado } from './autenticacion.ts';
import { CABECERAS_SOAP, desescapar, ErrorSii, etiqueta, type Http, sobreSoap, todas, URLS } from './soap.ts';
import type { ConsultaDocumento, ConteoPorTipo, EstadoDocumento, EstadoEnvio } from './tipos.ts';
import { escaparXml, partirRut } from './texto.ts';

async function consultar(http: Http, url: string, cuerpo: string): Promise<{ texto: string; estado: string }> {
  const r = await http({ url, cabeceras: CABECERAS_SOAP, cuerpo });
  const texto = desescapar(r.cuerpo);
  const estado = etiqueta(texto, 'ESTADO');
  if (r.status !== 200 || estado === null) throw new ErrorSii(`Respuesta inesperada del SII (HTTP ${r.status})`, texto);
  return { texto, estado };
}

/**
 * Estado de un envío. Los códigos numéricos negativos (-1 a -14) son errores del servicio de consulta, no rechazos:
 * se devuelven tal cual para que quien llama vuelva a consultar.
 */
export function estadoEnvio(http: Http, autenticador: Autenticador, rutEmisor: string, trackId: string): Promise<EstadoEnvio> {
  const [rut, dv] = partirRut(rutEmisor);
  return autenticador.conToken(async token => {
    const { texto, estado } = await consultar(
      http,
      URLS.estadoEnvio,
      sobreSoap(
        `\n    <getEstUp>\n      <RutEmpresa>${rut}</RutEmpresa>\n      <DvEmpresa>${dv}</DvEmpresa>\n` +
          `      <TrackId>${escaparXml(trackId)}</TrackId>\n      <Token>${escaparXml(token)}</Token>\n    </getEstUp>\n  `,
      ),
    );
    return {
      tokenRechazado: esTokenRechazado(estado),
      valor: { trackId, codigo: estado, glosa: etiqueta(texto, 'GLOSA'), porTipo: conteos(texto), respuesta: texto },
    };
  });
}

function conteos(texto: string): ConteoPorTipo[] {
  const columna = (nombre: string): number[] => todas(texto, nombre).map(Number);
  const [informados, aceptados, rechazados, reparos] = ['INFORMADOS', 'ACEPTADOS', 'RECHAZADOS', 'REPAROS'].map(columna);
  return columna('TIPO_DOCTO').map((tipo, i) => ({
    tipo,
    informados: informados?.[i] ?? 0,
    aceptados: aceptados?.[i] ?? 0,
    rechazados: rechazados?.[i] ?? 0,
    reparos: reparos?.[i] ?? 0,
  }));
}

/** La fecha va `DDMMAAAA`: con formato ISO el SII responde "ERROR INTERNO". Consulta el RUT emisor. */
export function estadoDocumento(
  http: Http,
  autenticador: Autenticador,
  rutEmisor: string,
  c: ConsultaDocumento,
): Promise<EstadoDocumento> {
  const [rut, dv] = partirRut(rutEmisor);
  const [rutRecep, dvRecep] = partirRut(c.rutReceptor);
  const [anio, mes, dia] = c.fechaEmision.split('-');
  return autenticador.conToken(async token => {
    const { texto, estado } = await consultar(
      http,
      URLS.estadoDocumento,
      sobreSoap(
        `\n    <getEstDte>\n      <RutConsultante>${rut}</RutConsultante><DvConsultante>${dv}</DvConsultante>\n` +
          `      <RutCompania>${rut}</RutCompania><DvCompania>${dv}</DvCompania>\n` +
          `      <RutReceptor>${rutRecep}</RutReceptor><DvReceptor>${dvRecep}</DvReceptor>\n` +
          `      <TipoDte>${c.tipo}</TipoDte><FolioDte>${c.folio}</FolioDte>\n` +
          `      <FechaEmisionDte>${dia}${mes}${anio}</FechaEmisionDte><MontoDte>${c.montoTotal}</MontoDte>\n` +
          `      <Token>${escaparXml(token)}</Token>\n    </getEstDte>\n  `,
      ),
    );
    return {
      tokenRechazado: esTokenRechazado(estado),
      valor: {
        codigo: estado,
        glosa: etiqueta(texto, 'GLOSA_ESTADO'),
        codigoError: etiqueta(texto, 'ERR_CODE'),
        glosaError: etiqueta(texto, 'GLOSA_ERR'),
        respuesta: texto,
      },
    };
  });
}
