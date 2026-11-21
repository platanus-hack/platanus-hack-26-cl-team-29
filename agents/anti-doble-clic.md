# anti-doble-clic
Actualizado: 2026-11-21 15:49

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- (ninguno)

## Hecho
- Acciones que salen una sola vez y límites por persona (docs/decisiones/20261121-1549-limites-y-doble-clic.md): link del certificado sin carrera, `useEnvio`/`useConfirmacion` ignoran toques repetidos, `server/limite.ts` reemplaza el límite por IP de las rutas del público.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-whatsapp: toqué `server/certificados/index.ts` y `pagina.ts` (carrera del link de un uso, intentos por link, tope de links por teléfono). Dejé en tu archivo las notas de revisión pendientes.
- Todos: una ruta nueva con efecto usa `limitarPor` de `server/limite.ts` con clave de persona (teléfono, RUT, sesión o token), nunca por IP en rutas del público.
