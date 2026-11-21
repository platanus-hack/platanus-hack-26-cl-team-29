# rut-comprador
Actualizado: 2026-11-21 22:10

## Estado
libre (PR listo para revisión)

## Trabajando en
- Cada comprador entrega su RUT: validación (módulo 11) en /unirse, /app y WhatsApp, consulta al SII por un puerto con cache y fila, y la factura 33 de la compra conjunta sale a ese RUT con su razón social, giro, dirección y comuna.

## Archivos que estoy tocando
- server/red/ (contribuyente, receptor por comprador, publico.ts)
- server/agente/ (paso del RUT en el registro por WhatsApp)
- client/src/vistas/Unirse.tsx, client/src/canal/ (primer paso de /app)
- test/
- docs/decisiones/ (contrato de la red: RUT del comprador)

## Hecho
- RUT obligatorio en /unirse, /app (formato al escribir, módulo 11) y WhatsApp (un paso, con o sin puntos y guion)
- Puerto `ConsultarContribuyente` (server/red/contribuyente.ts) con cache por RUT y fila de 1 por segundo; consulta falsa marcada `simulado`
- RUT y datos del SII internos en el Negocio (sanitizador y tests de privacidad); el comprador ve su razón social en /app
- Cada factura 33 (y 52/61 de esa orden) va al RUT y datos del SII del comprador; giro limpio y cortado a 40

## Bloqueos
- (ninguno)

## Pedidos a otros
- @sii-sesion: conectar la consulta real de contribuyente pasándola a `iniciarRed(db, sii, { consultarContribuyente })` en `server/index.ts` (firma `(rut: string) => Promise<{ razonSocial, giro, direccion, comuna, actividades } | null>`, rut ya normalizado `12345678-5`). La red ya la envuelve con cache y fila; no reintentar 720 queda en tu componente.
