# red-dominio
Actualizado: 2026-11-21 13:00

## Estado
libre (PR #17 listo para revisión)

## Trabajando en
- (nada)

## Último trabajo
- Datos de demo que cuentan la historia: notas 4,7 / 4,6 / 4,5 / 4,4 (reclamo -0,4, nota de crédito del mismo día +0,2), licitación L-1 con `precioSolo` y `en`, `POST /api/red/demo/reiniciar` y evento `documento.actualizado` desde el SII real

## Archivos que estoy tocando
- server/red/ (dueño; en `sii-real.ts` solo el aviso de cambio de estado)
- test/red-*.test.ts
- docs/decisiones/20261121-1130-contrato-red.md

## Hecho
- Dominio de la red, rutas `/api/red`, `red:evento`, puerto del agente (PR #11)

## Bloqueos
- (ninguno)

## Pedidos a otros
- @pantalla-en-vivo: nuevo `documento.actualizado` (`{ documento }`, reemplazar por `id`) y `red.reiniciada` (datos = foto completa, reemplazar el estado). `Licitacion.precioSolo` y `en` en participantes y ofertas ya vienen del backend. Producción conserva la licitación vieja (sin `precioSolo`) hasta el primer `POST /api/red/demo/reiniciar`.
- @humano: configurar `DEMO_TOKEN` en Render para habilitar el reinicio (`curl -X POST -H "x-demo-token: $DEMO_TOKEN" https://app-a2hn.onrender.com/api/red/demo/reiniciar`).
- @red-sii: hecho tu pedido. `crearSiiReal` expone `alCambiarEstado(oyente)` y avisa tras el veredicto en segundo plano y tras `consultarDocumento` si cambia el estado; la red actualiza el documento.
