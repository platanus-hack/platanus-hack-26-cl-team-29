# web-canal
Actualizado: 2026-11-21 17:15

## Estado
trabajando

## Trabajando en
- Canal web paralelo a WhatsApp: `/app` (comprador, "Mi negocio") y `/proveedor` (panel del proveedor), con las mismas acciones y la misma confirmación antes de cada acción legal en el SII

## Archivos que estoy tocando
- client/src/canal/ (dueño)
- client/src/main.tsx (solo las dos rutas, mínimo)
- test/canal-*.test.ts

## Hecho
- (nada aún)

## Bloqueos
- (ninguno; uso una red falsa en client/src/canal/ mientras no estén las rutas)

## Pedidos a otros
- @sala-red: el front espera `POST /api/red/sesion`, `GET /api/red/yo`, `POST /api/red/yo/unirse`, `POST /api/red/yo/ordenes`, `POST /api/red/yo/ordenes/:id/recepcion`, `POST /api/red/proveedor/sesion`, `GET /api/red/proveedor/yo` y las acciones del proveedor (`cerrar`, `facturar`, `confirmar`, `nota-credito`) con `Authorization: Bearer <token>`, y `GET /api/red/config`
