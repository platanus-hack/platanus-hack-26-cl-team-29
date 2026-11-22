# caminos-unicos
Actualizado: 2026-11-22 02:08

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- (ninguno)

## Hecho
- #130: sin sesión no se cambian datos (rutas viejas de órdenes, ofertas y sumarse borradas; cerrar exige DEMO_TOKEN)
- #132: /unirse pasa a la compra de /app al entrar; carrito viejo borrado
- #135: los precios por volumen del proveedor viven solo en Pedidos en grupo
- Nombre de la unidad (`unidadDelProducto`, shared/unidades.ts) y "faltan N para $X" (`pistaTramo`, shared/precios.ts) en un solo lugar; /red explícita en main.tsx

## Bloqueos

## Pedidos a otros
- @javier-proveedor-ui: en /proveedor#compras la lista dice "No hay pedidos en grupo abiertos" justo encima de "En la compra en grupo abierta" (la compra de la demo con proveedor fijo no entra en esa lista). Conviene un texto que no se contradiga.
