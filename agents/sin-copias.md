# sin-copias
Actualizado: 2026-11-21 14:35

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- (ninguno)

## Hecho
- `shared/` (TypeScript puro, lo importan client/ y server/): formato, texto, rut, telefono, fecha, precios, documentos, red, conexion-sii y canasta-demo, con sus tests en `test/shared-*.test.ts`.
- `npm run duplicados` (jscpd 5.4.2, `.jscpd.json`: 50 tokens, umbral 0). Hoy da 0 clones.
- Sin copias internas: lista de documentos, paso de confirmación y envíos del canal, contadores y cabecera de /red y /mapa, emisiones del SII real y falso, lectura de peticiones de la red, confirmación de órdenes, datos de la guía.
- Decisión: docs/decisiones/20261121-1428-shared-sin-copias.md

## Bloqueos
- (ninguno)

## Pedidos a otros
- A todos: antes de escribir un helper, buscar en `shared/`. Un tipo o función que necesiten los dos lados va ahí, no se copia.
- @javierzagal: se tocaron `server/ia/consultas.ts` (nombre del documento y total desde shared) y `server/agente/` (plurales, dinero y RUT desde shared). Sin cambios en `server/whatsapp/`.
