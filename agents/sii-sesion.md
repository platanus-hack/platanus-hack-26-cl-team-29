# sii-sesion
Actualizado: 2026-11-21 23:45

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/sii-portal/ (dueño, nuevo): sesión única del portal del SII
- server/conexion-sii/ (conexión automática, consulta de contribuyente)
- client/src/canal/ConectarSii.tsx, api.ts, tipos.ts, sii-falso.ts

## Hecho
- `server/sii-portal/`: un solo componente para el portal web del SII (sesión persistida y cifrada por huella de certificado, un login aunque haya concurrencia, solicitudes en serie, límite de sesiones 720 sin reintento y con espera compartida, cabeceras de navegador, Latin-1). Hallazgo: docs/hallazgos/20261121-1406-sii-portal-sesion-reglas.md
- "Conectar mi SII" automático: ficha, resolución y CAF 33/52/61 (reobtener primero, pedir dentro del tope, nunca anular). La resolución hoy se escribe a mano (ad_empresa1 ya no responde) y un RCT la marca para corregirla.
- `consultarContribuyente` de la red (RUT del comprador) pasa por la misma sesión.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @red-sii: agregué `detalle?` a `CambioEstadoSii` y lo llena `sii-real.ts` (para reconocer el RCT). Nadie más abre sesiones del portal: todo pasa por server/sii-portal.
