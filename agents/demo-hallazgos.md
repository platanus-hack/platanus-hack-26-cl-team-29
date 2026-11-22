# demo-hallazgos
Actualizado: 2026-11-22

## Estado
trabajando

## Trabajando en
- Hallazgos de la simulación de la demo en local (QR, recepción por WhatsApp, textos, proyector, /red, notas).

## Archivos que estoy tocando
- server/agente/ (canasta.ts, sala.ts, index.ts, mensajes.ts, red-sala-falsa.ts), server/pagos/avisos.ts
- client/src/vistas/Licitacion.tsx, licitacion.css, client/src/red/useRed.ts, client/src/proveedor/, client/src/marca/componentes.css
- server/index.ts (buffer de eventos), server/red/dominio.ts (notas), server/mercado-publico/ocds.ts
- test/agente-sala.test.ts, test/agente-proveedores.test.ts

## Hecho
- "Hola Bando, quiero sumarme a la compra L-1" ya no deja al negocio llamado "Bando"; el QR dice "Quiero sumarme a la compra L-n".
- Tras el aviso del folio por WhatsApp, el comprador recibe la pregunta de recepción (una por orden): puede reclamar un faltante aunque el proveedor facture desde la web.
- WhatsApp dice los totales con IVA y el neto al lado, como la web; "al tiro" pasó a español neutro.

- Proyector /licitacion: al cerrar dice "Cerrada" o "Facturada en el SII" y muestra cada factura del lote con folio y estado del SII, en vivo; el texto junto al QR va a 18 px o más.
- Una sola nota por proveedor en todas las vistas (estadoDeLaRed publica la de todos los que venden, también el proveedor de la compra y sus rivales): el ranking de /red incluye al proveedor de la demo.
- /red no parte vacía: GET /api/red/eventos entrega los últimos 30 eventos (los mismos del socket) y el feed se siembra al abrir.
- /proveedor "Hoy vendiste" descuenta las notas de crédito de esos pedidos.
- Mercado Público: un corte de red al bajar el OCDS botaba el servidor entero (error sin oyente en el stream); ahora rechaza la lectura y se reintenta en la próxima pasada.

## Bloqueos

## Pedidos a otros
- @javier-whatsapp: toqué server/agente (relleno "bando" en extraerNombre, `preguntarRecepcion` de la sala al avisar el folio, `mensaje` opcional en avisarFacturaDe, `preguntaRecepcion` y `conIva` en mensajes.ts). La red falsa de la sala ahora expone sus órdenes y compradores en `estadoDeLaRed`/`negocioPorTelefono` tras el cierre.
