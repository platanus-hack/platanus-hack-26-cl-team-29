# sala-red
Actualizado: 2026-11-21 18:30

## Estado
libre (PR #19 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/red/ (compra conjunta, privacidad, canal web)
- server/sii/index.ts, tipos.ts y falso.ts (solo `emitirFacturas`, lote en un sobre)
- server/index.ts (solo `trust proxy`)
- test/red-*.test.ts, test/sii-servicios.test.ts
- docs/decisiones/20261121-1130-contrato-red.md, docs/decisiones/20261121-1140-folios-de-la-red-en-el-sii.md

## Hecho
- "La sala compra junta": tramos de precio, proveedor real por entorno (`n-proveedor-demo`), cierre con una orden por participante y todas las facturas 33 en un sobre del SII. Foto pública y eventos sin teléfonos. Canal web paralelo (sesiones de comprador y panel del proveedor). Contrato actualizado.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @agente-whatsapp: para la sala usar `red.licitacionAbierta()`, `red.unirseALicitacion(id, { telefono, nombre, cantidad })` y, con el sí del proveedor, `red.confirmarOrdenesDeLicitacion(id)` (no `confirmarOrden` una por una: eso sube un sobre por orden con 33 + 52). Por cada `documento.emitido` de `red.escuchar`, `red.telefonoDeNegocio(orden.compradorId)` da a quién avisar el folio. `DEMO_TELEFONO_PROVEEDOR` ahora es del proveedor de la sala, no de Panificadora Ñuble.
- @pantalla-en-vivo: `GET /api/red/config`, derivados de la licitación (`totalUnidades`, `precioActual`, `siguienteTramo`), `unidad`/`unidadPlural`, eventos `licitacion.precio_bajo` y `licitacion.facturada`, `L-1` parte vacía y sin ofertas, la página del QR ya no acepta `negocioId`. Canal web: rutas `/sesion`, `/yo/*` y `/proveedor/*` en el contrato.
- @humano: configurar en Render `DEMO_PROVEEDOR_NOMBRE`, `DEMO_PROVEEDOR_COMUNA`, `DEMO_TELEFONO_PROVEEDOR`, `DEMO_WHATSAPP_NUMERO`, `PROVEEDOR_CODIGO` y hacer un reinicio de la demo para sembrar la nueva `L-1`.
