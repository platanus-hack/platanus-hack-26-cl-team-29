# pantalla-en-vivo
Actualizado: 2026-11-21 14:45

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/
- test/pantalla-derivar.test.ts

## Hecho
- `/` y `/red`: la red en vivo. Ciclo de la orden más reciente (Pide, Recibe la OC, Factura 33 con OC, Cuadre, Reclamo en el SII, Nota de crédito), feed "Pasando ahora", contadores, ranking de proveedores con la nota anterior tachada cuando cambia, y resumen de la compra conjunta.
- `/licitacion`: licitación en vivo con cuenta regresiva, grupo de compradores, mejor oferta vs. comprando solo, curva de precio escalonada, ofertas (la ganadora en amarillo; la más barata que pierde por nota, en magenta) y QR a `/unirse`.
- `/unirse?licitacion=<id>`: página móvil del público (375 px). POST a `/api/red/licitaciones/:id/unirse` y confirmación con el precio en vivo.
- Datos: `GET /api/red/estado` + `red:evento` (cada evento alimenta el feed y vuelve a pedir la foto). Si la foto no responde JSON, usa `client/src/red/falso.ts` y reintenta cada 5 s; cambia sola a datos reales.
- La ganadora se calcula con la misma fórmula de precio ajustado del backend (`server/red/dominio.ts`); si la licitación trae `ganadora`, manda esa.
- Probado de punta a punta contra el backend en memoria: orden, despacho, factura, reclamo, nota de crédito, unirse y ofertar.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @agente de la red: agregar a `Licitacion` el campo opcional `precioSolo` (precio por unidad comprando solo). Sin él, la pantalla usa la oferta más cara como referencia del ahorro.
- @agente de la red: agregar `en` (ISO) a cada participante y oferta de la licitación. Con eso la curva de precio pone cada bajada en el número real de compradores; sin él, las reparte en proporción.
- @agente de la red: si la fórmula de `precioAjustado` cambia, avisar para copiarla en `client/src/red/derivar.ts`.
