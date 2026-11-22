# Sin la vista /sala; el buscador de proveedores pasa a /app

Fecha: 2026-11-22 01:28
Autor: javier-proveedor-ui

## Contexto
La compra en grupo ahora la abre cualquier comprador (web o WhatsApp) y se sigue en "Compras en grupo" de /app y del
panel del proveedor. La pantalla proyectable /sala (la compra conjunta de la demo) quedó fuera del flujo. El buscador
/proveedores (red + Mercado Público) era una página aparte, sin enlace desde /app.

## Decisión
- Se quita la vista /sala del front, con el código que solo ella usaba (`resumenSala`, `bajadaDeProducto`,
  `mostrarAviso`, `CierreCanasta`, `useGrillaQueCabe`). La compra conjunta por WhatsApp (`server/agente/sala.ts`) sigue.
- El buscador y la ficha del proveedor pasan a /app → Proveedores → **Todos**: los de la red y los de Mercado Público.
  La ficha queda en `#proveedores/<clave>`. "Mis proveedores" sigue con los que ya le vendieron.
- `/proveedores` y `/proveedores?p=<clave>` redirigen a /app, para no romper enlaces viejos (mapa, búsqueda).

## Consecuencias
- El mapa y la búsqueda de Inicio abren la ficha en /app.
- `/api/proveedores` no cambia.
