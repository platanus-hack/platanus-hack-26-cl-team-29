# Proveedores de Mercado Público en los mapas

Fecha: 2026-11-21 16:51
Autor: agente mapa-proveedores

## Contexto
`/mapa` y `/red-3d` dibujaban solo los proveedores registrados en la red. El buscador (`server/proveedores/`) ya une la red y Mercado Público por RUT, con categoría, región, comuna y organismos que le compran, pero Mercado Público casi nunca trae comuna: solo región. No hay direcciones.

## Decisión
- `GET /api/proveedores/mapa` → `{ proveedores: ProveedorMapa[], total, mercadoPublico }`: todos los ubicables, sin paginar, con lo mínimo (clave, nombre, categoría, región, comuna, organismos, `enBando`, nota, `punto`, `ubicacion`). Tope `MAX_MAPA` = 2.000 (los con más organismos primero); en producción hay ~670.
- Ubicación en `shared/ubicacion.ts` (la tabla de comunas salió de `client/src/mapa/geo.ts`, sin copia):
  - comuna conocida → centro de la comuna con dispersión estable por clave (`ubicacion: 'comuna'`);
  - solo región Metropolitana → una comuna de la tabla elegida por hash de la clave, con ~2 km de dispersión: queda siempre dentro del área urbana (`'region'`);
  - otra región → capital regional aproximada, dispersión estable de hasta ~10 km hacia el este (las capitales están en la costa) (`'region'`);
  - sin comuna ni región → no se dibuja. Nunca se inventa una dirección.
- Los mapas dibujan solo los que no están en Bando (los de Bando ya salen con la red, en volt y con nota): volt atenuado con contorno, radio según organismos. Clic → tarjeta con nombre, categoría, organismos, "ubicación aproximada" si es por región y enlace a `/proveedores?p=<clave>`. Leyenda: "proveedor en Bando" / "proveedor de Mercado Público". El modo `#video` de `/red-3d` no cambia.
- Tiempo real: `useJson` (movido de `Proveedores.tsx` a `client/src/red/useJson.ts`) vuelve a pedir la lista con cada `red:evento` de `useRed` (incluye `mercado_publico.actualizado` y `proveedores.actualizado`). Sin polling.

## Consecuencias
- Con ~670 puntos no hace falta agrupar; si se acercan al tope, agrupar (`cluster` de MapLibre) o filtrar por zona visible.
- Cuando Mercado Público o el SII traigan comuna o dirección, `ubicarProveedor` la usa sin tocar los mapas.
