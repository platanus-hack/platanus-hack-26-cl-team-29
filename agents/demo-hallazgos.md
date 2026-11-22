# demo-hallazgos
Actualizado: 2026-11-22

## Estado
trabajando

## Trabajando en
- Hallazgos de la simulación de la demo en local (QR, recepción por WhatsApp, textos, proyector, /red, notas).

## Archivos que estoy tocando
- server/agente/ (canasta.ts, sala.ts, index.ts, mensajes.ts, red-sala-falsa.ts), server/pagos/avisos.ts
- client/src/vistas/Licitacion.tsx, licitacion.css, RedEnVivo.tsx, client/src/red/derivar.ts, client/src/proveedor/
- test/agente-sala.test.ts, test/agente-proveedores.test.ts

## Hecho
- "Hola Bando, quiero sumarme a la compra L-1" ya no deja al negocio llamado "Bando"; el QR dice "Quiero sumarme a la compra L-n".
- Tras el aviso del folio por WhatsApp, el comprador recibe la pregunta de recepción (una por orden): puede reclamar un faltante aunque el proveedor facture desde la web.
- WhatsApp dice los totales con IVA y el neto al lado, como la web; "al tiro" pasó a español neutro.

## Bloqueos

## Pedidos a otros
- @javier-whatsapp: toqué server/agente (relleno "bando" en extraerNombre, `preguntarRecepcion` de la sala al avisar el folio, `mensaje` opcional en avisarFacturaDe, `preguntaRecepcion` y `conIva` en mensajes.ts). La red falsa de la sala ahora expone sus órdenes y compradores en `estadoDeLaRed`/`negocioPorTelefono` tras el cierre.
