# Emitir sin esperar la subida al SII

Fecha: 2026-11-22 07:57
Autor: Luciano (con agente)

## Contexto
Al facturar la compra en grupo (y al emitir guías y notas de crédito), el adaptador del SII reservaba los folios,
armaba y firmaba el sobre, lo SUBÍA a maullin y recién entonces devolvía: la red guardaba los documentos, generaba el
PDF y avisaba por WhatsApp después de la subida. Con maullin lento, el botón "Facturar" quedaba esperando varios
segundos o hasta el corte, que en una demo en vivo se ve como la app pegada. El PDF y el timbre no dependen del SII:
salen del XML firmado con el CAF.

## Decisión
1. El módulo SII separa armar de subir: cada `emitir*` tiene su `preparar*` (`server/sii/index.ts`), que devuelve los
   documentos armados, firmados y timbrados, el sobre, y `subir()`, la única subida de ese sobre.
2. El adaptador (`server/red/sii-real.ts`) reserva los folios como antes (en orden, en su cola), prepara, deja cada
   folio en el estado nuevo `enviando` y devuelve al instante con su representación impresa. La red guarda el
   documento con `estadoSii: 'enviando'` ("enviando al SII"), emite `documento.emitido`, el PDF y el enlace ya sirven y
   el aviso por WhatsApp sale enseguida.
3. La subida corre en segundo plano en una fila propia, una a la vez y en el orden de emisión (un sobre por lote, como
   antes). No va en la misma fila de las emisiones para que la emisión siguiente (por ejemplo, las guías del reparto)
   no espere a que maullin responda la anterior. Su resultado queda en cada folio y se avisa a la red, que emite
   `documento.actualizado` en vivo: `recibido` (con su track id, y después el veredicto de siempre), `rechazado`,
   `incierto` (corte de red) o `fallido` (no llegó a subir, por ejemplo sin token).
4. Reglas que no cambian: nunca se reintenta solo un envío, nunca se reenvía un folio vivo (`enviando` cuenta como
   vivo), nunca se anula. Un `incierto` se revisa con `consultarDocumento` (QueryEstDte) y lo decide una persona.
5. Reinicio a mitad: la subida vive en el proceso. Un folio que quedó `enviando` sin subida en curso pasa a `incierto`
   al volver a tocar esa orden, y la red, al arrancar, deja en `incierto` todo documento que quedó "enviando al SII".
6. Si la subida responde antes de que la red alcance a guardar el documento, su estado espera y se aplica al guardarlo.

## Consecuencias
- Medido con el SII falso y una subida de 4 s: 40 facturas firmadas y con PDF en 4 ms; la subida termina 4 s después en
  segundo plano. Con el SII real la firma XML de un lote grande suma tiempo de CPU, pero ya no depende de la red.
- Un rechazo del sobre ya no aparece como error al apretar "Facturar": llega en vivo como "rechazado por el SII" en el
  documento, y el log guarda la respuesta completa del SII.
- `SiiReal.subidasTerminadas()` espera las subidas en curso (para tests y scripts; la red no la necesita).
