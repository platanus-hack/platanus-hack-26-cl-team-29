# Buscador de proveedores: red y Mercado Público en una sola lista

Fecha: 2026-11-21 16:18
Autor: agente buscador-proveedores

## Contexto
Los proveedores vivían en dos lados: los registrados en la red (`server/red/`) y los que salen de Mercado Público (`server/mercado-publico/`). Los datos de Mercado Público traían precios unitarios que eran totales de contrato, vales de alimentación colados como "alimentos", unidades sucias y dos tercios de los proveedores sin rubro.

## Decisión
- `server/proveedores/` arma una ficha por RUT (si está en los dos lados, una sola ficha con las dos fuentes y su fecha) y busca en el servidor: `GET /api/proveedores?q=&categoria=&pagina=` y `GET /api/proveedores/:clave` (RUT o id de la red). Búsqueda por nombre, RUT, categoría, giro o producto, sin tildes, todas las palabras; 20 por página. El índice se rearma solo cuando cambia la red, Mercado Público o el enriquecimiento.
- Taxonomía fija en `shared/categorias.ts` (abarrotes, lácteos y huevos, carnes y cecinas, ... otros), con tres mapeos: UNSPSC por prefijo, código de actividad del SII por prefijo (con respaldo en las palabras de la descripción) y palabras del producto. Categoría principal: lo que vende; si no, sus giros del SII; si no, la IA; si no, su nombre. Cada categoría dice de dónde salió.
- Limpieza de Mercado Público al leer (`server/mercado-publico/limpieza.ts`), así también limpia lo ya guardado: un ítem queda solo si cae en la taxonomía (por UNSPSC o, en Convenio Marco que viene sin código, por las palabras del producto; los vales dicen solo "ALIMENTACIÓN" y salen); unidades a unidad, kg, litro, caja, paquete; fuera los precios sobre $2.000.000 por unidad y, por producto y unidad con 4 o más precios, los que caen fuera de las cercas de Tukey (1,5 rango intercuartil) en escala logarítmica.
- Enriquecimiento en segundo plano (`enriquecer.ts`): giros e inicio de actividades por la consulta pública STC del SII, de a un RUT cada 1,5 s, los que más venden primero; tras 5 fallas seguidas se detiene hasta el próximo arranque. Los que siguen sin categoría van a la IA (`server/ia/clasificar.ts`, herramienta con la taxonomía como enum; sin `ANTHROPIC_API_KEY`, reglas de palabras). Todo se guarda por RUT en `proveedores_enriquecidos` (o memoria) y no se repite. `PROVEEDORES_SII=0` apaga las consultas. Los RUT ficticios de las órdenes de ejemplo no se consultan.
- Avisa con `red:evento` `proveedores.actualizado` (a lo más uno cada 10 s).

## Consecuencias
- Nunca sale un comprador de la red ni un organismo por nombre: solo "N organismos le compran".
- Descartado: excluir proveedores por nombre a mano. Descartado: comuna inferida (el dataset OCDS trae solo región).
