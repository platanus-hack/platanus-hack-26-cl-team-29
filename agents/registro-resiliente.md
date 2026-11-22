# registro-resiliente
Actualizado: 2026-11-22 07:51

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/red/dominio.ts (consultarRut con tope de espera, registro declarado y confirmación después), server/red/rutas-web.ts (/acceso/rut y tope por IP)
- shared/rut.ts (RUT_SIN_CONFIRMAR), shared/red.ts (evento negocio.actualizado), server/agente/mensajes.ts (usa la constante)
- client/src/canal/Acceso.tsx y tipos.ts, server/index.ts (SII_CONSULTA_RUT=falsa), scripts/carga.ts

## Hecho
- Si el SII no responde en 6 s, el comprador entra con lo declarado y se confirma a los 30 s, 2 min y 10 min.
- `npm run carga`: 60 compradores sin errores; tope por IP de /acceso/* subido a 600/min.

## Bloqueos

## Pedidos a otros
- @javier-whatsapp: el mensaje cuando el SII no confirma el RUT ahora es la constante `RUT_SIN_CONFIRMAR` de `shared/rut.ts` ("No pudimos confirmar tu RUT con el SII ahora."), reexportada desde `server/agente/mensajes.ts`.
