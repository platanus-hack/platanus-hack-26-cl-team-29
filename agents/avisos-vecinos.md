# avisos-vecinos
Actualizado: 2026-11-21 16:15

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/avisos/ (dueño, nuevo)
- server/agente/index.ts (mínimo: un gancho opcional `avisos` antes de atender)
- server/index.ts (mínimo: montar avisos y compartir las sesiones web)
- shared/red.ts (tipos de evento nuevos)
- client/src/canal/AvisoCompra.tsx e Invitar.tsx (nuevos), MiNegocio.tsx y canal.css (mínimo); client/src/vistas/Unirse.tsx (`?ref=`), Sala.tsx y sala.css (una línea)
- server/red/index.ts (exporta `crearSesiones`), docs/decisiones/20261121-1130-contrato-red.md (eventos y ruta nuevos)
- test/avisos.test.ts

## Hecho
- "Trae a tu vecino": código al azar por comprador, enlace /unirse?ref= y wa.me al bot, oferta al sumarse y con "invitar", atribución con WhatsApp a quien invitó, "X invitó a Y" en /sala y botón de compartir en /app. Decisión: docs/decisiones/20261121-1614-trae-a-tu-vecino.md
- Aviso de compra conjunta abierta a compradores registrados (WhatsApp con SÍ y BASTA, banner en vivo en /app). Decisión: docs/decisiones/20261121-1604-avisos-de-compra-abierta.md

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-whatsapp: `conectarAgente` recibe un gancho opcional `avisos` (server/agente/index.ts, 12 líneas): BASTA responde siempre y un SÍ a un aviso entra a la sala con "me sumo". Sin cambios en server/whatsapp/.
- @jorge-red3d @pantalla-en-vivo: `GET /api/avisos/invitaciones` da `[{ invita, invitado, en, invitaId?, invitadoId? }]` (ids de negocio de la red actual) y `invitacion.sumada` llega en vivo por `red:evento`. Si `/red` o `/red-3d` quieren dibujar quién invitó a quién, ahí están las aristas; no toqué esas vistas.
