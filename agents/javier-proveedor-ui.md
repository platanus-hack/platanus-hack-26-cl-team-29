# javier-proveedor-ui
Actualizado: 2026-11-21

## Estado
libre (PR del panel del proveedor)

## Trabajando en
- Rediseño del panel /proveedor con la marca Bando (Paper "2 · Proveedor"): marco, Inicio, Pedidos y Precios.

## Archivos que estoy tocando
- server/red/dominio.ts y rutas-web.ts (abrirCompra), server/agente/proveedor.ts, mensajes.ts, claude.ts y puerto.ts, server/avisos/index.ts (una línea)
- client/src/canal/Proveedor.tsx, client/src/proveedor/ (nuevo)
- client/src/comprador/Marco.tsx y comprador.css (mínimo, para compartir el marco)

## Bloqueos
- (ninguno)

## Hecho
- Portada común de /app y /proveedor (¿Qué vas a hacer hoy? con Comprar y Vender); el inicio del proveedor pasa a Ventas.
- Abrir una compra en grupo nueva desde la web y por WhatsApp ("vendo ..." sin compra abierta), y sumar productos a la abierta desde Precios.
- /proveedor con el marco de marca: Inicio (lo vendido hoy, por confirmar, reclamos), Pedidos (estados) y Precios (tramos). Reparto y Facturas siguen por el puente.

## Pendientes
- Rediseñar Reparto y Facturas (Paper P5 y P2d) y el paso de confirmación con la marca.
