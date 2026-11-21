# buscador-proveedores
Actualizado: 2026-11-21 16:20

## Estado
libre (PR de la vista /proveedores abierto, para revisión del humano)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/proveedores/ (dueño), shared/categorias.ts, server/mercado-publico/limpieza.ts, server/ia/clasificar.ts
- client/src/vistas/Proveedores.tsx y proveedores.css (dueño); main.tsx y Navegador.tsx (una línea cada uno)

## Hecho
- Backend del buscador en main (#80): fichas unidas por RUT, limpieza de Mercado Público, taxonomía, giros del SII con caché, IA para lo ambiguo.
- Vista /proveedores: buscador con chips de categoría y ficha del proveedor (Paper "10 · Ficha del proveedor").

## Pendientes
- Probar la ficha con datos reales de Mercado Público y del SII en producción (en local corre con órdenes de ejemplo).
- Clasificación por IA: queda activa solo con ANTHROPIC_API_KEY; sin clave, reglas de palabras.
- Los proveedores de la red sin RUT ni productos quedan "Sin categoría todavía" (no se consultan en el SII).
