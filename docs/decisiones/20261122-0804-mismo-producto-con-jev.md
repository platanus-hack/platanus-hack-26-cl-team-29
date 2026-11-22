# Mismo producto escrito distinto, con Jev

Fecha: 2026-11-22 08:04
Autor: jorge-jev

## Contexto
La lista de precios de un proveedor oferta sola en una compra en grupo solo si el producto se llama igual
(`mismoProducto`: mismo nombre sin tildes, signos ni espacios, y misma unidad). "Harina saco 25kg" y
"Harina sin polvos 25 kg" no calzaban, y esa oferta más barata nunca llegaba al comprador.

## Decisión
- `server/catalogo/equivalencias.ts`: primero la regla exacta; si no calza, Jev (TypeSafe, `jev-1.14.0`)
  responde una pregunta `noul` (¿es verdad?) por cada candidato de la **misma unidad** que comparte una palabra
  de 4+ letras, todas en una llamada. Sí desde 0,7.
- Se usa `noul` por par y no `choice`: `choice` siempre elige una opción aunque ninguna sirva
  ("Papel higiénico" → "Toalla de papel" con confianza 0,90).
- Medido con pares reales: iguales 0,87–0,96 (Coca-Cola, gauda/gouda, aceite de maravilla); distintos < 0,1
  (Zero, Fanta, mantecoso); dudosos 0,3–0,4, que quedan fuera: juntar dos productos distintos es peor que no ofertar.
  270–690 ms por llamada.
- Cada par se pregunta una vez (memoria del proceso); un error no se guarda y se reintenta en la próxima pasada.

## Consecuencias
- Sin `TYPESAFE_API_KEY` todo sigue igual que antes (solo regla exacta). Va en Render como variable de entorno.
- Por ahora solo en las ofertas automáticas de las listas (`server/catalogo/ofertas.ts`). Pendientes, mismo
  `Equivalencias.mismo`: compra repetida al abrir (`server/red/dominio.ts`) y precio de referencia
  (`server/catalogo/index.ts`).
- No compara unidades distintas (caja de 12 contra unidad): eso es conversión de unidades, aparte.
