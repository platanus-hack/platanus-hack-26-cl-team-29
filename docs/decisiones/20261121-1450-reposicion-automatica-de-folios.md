# Reposición automática de folios y el panel como única configuración del SII

Fecha: 2026-11-21 14:50
Autor: agente autocaf

## Contexto
Cada factura consume un folio de un CAF. Con pocos folios, el cierre de una compra conjunta podía quedarse a medias
(se reservaban folios hasta agotar el rango y el lote fallaba con folios quemados), y conseguir más folios era a mano.
Además el SII real se podía configurar de dos formas (panel o variables `SII_*`), con un receptor de respaldo que
facturaba a un RUT inventado cuando el comprador no había dado el suyo.

## Decisión
**Reglas del SII que seguimos** (aprendidas en la operación de certificación; el timbraje del portal no tiene
documentación oficial, se sostienen por observación):

1. Orden de remedios: usar lo que hay, **reobtener** rangos ya autorizados (no gasta cupo) y solo después **pedir**
   folios nuevos. **Anular no existe en esta app**: es irreversible, pesa seis meses contra el cupo y no destraba un
   bloqueo; no hay código para hacerlo.
2. Folios timbrados y sin usar son lo que hace que el SII racione (`MAX_AUTOR` bajo) o bloquee el timbraje ("NO SE
   AUTORIZA TIMBRAJE", advertencia de folios suficientes). Por eso nunca se pide más de lo que falta, ni por
   adelantado, ni más que el tope publicado, que se relee justo antes de pedir.
3. El listado de reobtención mezcla rangos usados, anulados y libres, y dentro de un rango el uso no va en orden: ni
   el último folio ni una bisección dicen si queda alguno libre. Se pregunta al SII folio por folio (QueryEstDte). Los
   libres están en los rangos más nuevos, así que se recorre del más nuevo (folio más alto) al más viejo, y un rango
   sin libres se recuerda (`barridos`) para no volver a preguntarlo: un folio recibido o anulado nunca vuelve a quedar
   libre. Los rangos vencidos (33 y 61 vencen a los 6 meses de su `FA`, también reobtenidos) se saltan.
4. Un rechazo del timbraje se respeta: se guarda una espera (60 min, el doble en cada fallo seguido, tope 1 día; 15
   min si fue una falla de red; la del límite de sesiones 720 la fija el portal) y nadie toca el SII antes.
5. Un CAF recién timbrado tarda en propagarse en el SII (DTE-3-602 si se emite de inmediato): antes de facturar con
   uno pedido en el momento se esperan 30 s.
6. Todo pasa por `server/sii-portal` (una sesión por huella de certificado, en serie, 1 solicitud por segundo).

**Política** (`shared/folios.ts`, pura): mínimo de facturas libres `max(10, demanda + 5)`, con demanda = negocios en
la compra conjunta abierta; guías y notas de crédito 5, y solo si la empresa ya tiene CAF de ese tipo. Decide
`nada`, `esperar`, `reobtener`, `pedir` (lo que falta, con tope) o `sin_cupo`.

**Disparadores** (`server/conexion-sii/reposicion.ts`):
- Antes de facturar la compra cerrada: cada comprador con RUT verificado y folios para todos; si faltan, se repone y
  se espera hasta 60 s. Si aun así no alcanzan, falla con `sin_folios` y el texto del SII **antes de reservar ningún
  folio**: nunca sale un lote a medias. `sii-real.ts` repite la comprobación de folios como red de seguridad.
- Después de cada emisión, en segundo plano, si quedaron bajo el mínimo.
- "Traer más folios" en el panel: la misma reposición (lo que falta para el mínimo o un lote del tamaño del piso).

**Varios rangos por tipo**: la conexión guarda una lista de CAF por tipo (cada uno con su primer libre conocido) y
`server/red/folios.ts` toma el siguiente folio rango por rango, el de folios más bajos primero, después del mayor
ya tomado dentro de cada rango. La tabla `sii_folios` sigue impidiendo repetir un folio.

**Sin variables `SII_*` en el servidor**: la conexión del panel es la única configuración; sin ella, el SII falso.
Solo `SII_LLAVE_CIFRADO` viene del entorno. Un comprador sin RUT verificado no se factura (se le pide el RUT). Los
scripts de `scripts/` leen sus credenciales de un `.env` local al correrlos.

Medido el 2026-11-21 (una sola lectura del listado de reobtención del 33 por `server/sii-portal`, sin reobtener ni
pedir): 15 filas en 2,4 s, del rango más nuevo al más viejo; la mayoría de 1 folio (el SII reobtiene de a uno), y el
más nuevo es el del CAF que ya usa la conexión. Por eso la reposición excluye los rangos que se cruzan con CAF
guardados y suma rangos chicos hasta cubrir lo que falta (tope de 10 reobtenciones y 60 consultas por corrida).

## Consecuencias
- Evento `sii.folios` (`AvisoFolios`: tipo, libres, mínimo, estado, repuestos; sin RUT ni textos del SII) por
  `red:evento`; el panel muestra "Folios de factura: N libres" con su estado y el texto del SII cuando lo hay.
- Error nuevo `sin_folios` (409) en la red.
- Reemplaza en lo que corresponde a "Conectar mi SII desde el panel" (respaldo por variables, receptor de respaldo,
  un CAF por tipo) y a "Folios de la red en el SII" (rango leído de `SII_CAF_<tipo>_BASE64`).
