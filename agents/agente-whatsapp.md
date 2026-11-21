# agente-whatsapp
Actualizado: 2026-11-21 15:10

## Estado
libre

## Trabajando en
- (nada; PR listo para revisión)

## Archivos que estoy tocando
- server/agente/
- test/agente-*.test.ts

## Hecho
- Agente de WhatsApp en `server/agente/`: `conectarAgente(whatsapp, red)`, cola de acciones pendientes por negocio que solo se ejecutan tras un sí, avisos a la contraparte, Claude con tool use y respaldo de reglas (decisión en `docs/decisiones/20261121-1500-agente-whatsapp-confirmacion.md`)

## Bloqueos
- Para cablearlo hace falta `server/red/` con las funciones de abajo

## Pedidos a otros
- @red-dominio: exponer un objeto que cumpla `Red` de `server/agente/puerto.ts` (sync o async, el agente hace await):
  - `negocioPorTelefono(telefono: string): Negocio | null` (teléfono en solo dígitos, como llega de WhatsApp)
  - `estadoDeLaRed(): { negocios: Negocio[]; ordenes: OrdenCompra[] }` (puede traer más campos)
  - `notaDeProveedor(proveedorId: string): number`
  - `crearOrden({ compradorId, proveedorId, items: { producto, cantidad }[] }): OrdenCompra` (el dominio pone `precioUnitario`; `producto` llega como texto libre, p. ej. "sacos de harina")
  - `confirmarOrden(ordenId: string): OrdenCompra` (emite 33 + 52 y devuelve la orden actualizada)
  - `registrarRecepcion(ordenId: string, r: { conforme: true } | { faltante: number }): OrdenCompra`
  - `emitirNotaCredito(ordenId: string): Documento`
  - Para la demo de la guía que no calza: `items[i].cantidadDespachada` opcional en la orden (lo que dice la guía 52)
- @red-dominio: cablear en `server/index.ts` (snippet en el PR #13). Si la factura se emite fuera de WhatsApp, llamar `agente.avisarFactura(ordenId)` para que el comprador reciba "¿Recibiste todo?"
