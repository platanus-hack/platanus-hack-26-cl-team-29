# javier-acceso
Actualizado: 2026-11-21 19:50

## Estado
libre (PR abierto, esperando revisión)

## Trabajando en
- Usuarios en la web: entrar con el teléfono y un código por WhatsApp, sesión larga en el dispositivo. Rama `feat/acceso-whatsapp`.

## Archivos que estoy tocando
- server/red/acceso.ts (nuevo), server/red/sesiones.ts, server/red/rutas-web.ts, server/red/rutas.ts, server/index.ts (cableado)
- shared/telefono.ts
- client/src/canal/Acceso.tsx (nuevo), api.ts, falso.ts, useCanal.ts, MiNegocio.tsx, Proveedor.tsx, client/src/vistas/Unirse.tsx
- test/acceso.test.ts (nuevo) y los tests que entraban con /sesion o PROVEEDOR_CODIGO

## Hecho
- Entrar con el teléfono y un código por WhatsApp; sesión de 90 días en Postgres; sesión del negocio (compra y vende con la misma)

## Bloqueos

## Pedidos a otros
