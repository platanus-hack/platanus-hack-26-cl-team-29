# Proveedores y precios de referencia desde Mercado Público

Fecha: 2026-11-21 15:46
Autor: agente mercado-publico

## Contexto
Bando necesita datos reales desde el primer negocio: quién vende alimentos e insumos, dónde despacha y a qué precio. La postura de diseño es "mayorista y público": Mercado Público (ChileCompra) es la fuente principal, porque publica a quién se le compró, qué, a qué precio unitario y dónde se despacha. MercadoLibre queda fuera (más adelante, solo como precio techo vía su API oficial).

## Decisión
- Módulo `server/mercado-publico/`, con la misma estructura que `server/locales/`: guarda en Postgres (`mercado_publico_ordenes`, `mercado_publico_marcas`) o en memoria si no hay `DATABASE_URL`, y sigue desde donde quedó tras un reinicio.
- **Dos fuentes reales, ambas oficiales:**
  1. **Dataset OCDS anual de ChileCompra** en Open Contracting (licencia CC0, sin ticket). Un *compiled release* por línea, ~390 MB comprimido para 2026. Se lee en streaming (gunzip + readline), nunca entero en memoria. Antes de cada lectura se pide un `HEAD`: si `ETag`/`Last-Modified` no cambiaron, no se descarga. Se toman las adjudicaciones vigentes con un solo proveedor, solo los ítems UNSPSC 50 (alimentos y bebidas; los de Convenio Marco, que vienen sin clasificación, por su descripción), con precio unitario en pesos (no "Global" ni "Mes", ni montos de marcador bajo $10) y del último año.
  2. **API de Mercado Público con ticket** (`MERCADO_PUBLICO_TICKET`), la más fresca: órdenes de compra del día a día. Trae los días completos que faltan desde el último procesado (hoy no, todavía entran órdenes); la primera vez, los 3 días anteriores. El listado por día no trae ítems, así que se filtra por el nombre de la orden (alimentos, abarrotes, víveres, casino...) y se piden hasta 100 detalles por día.
- **Sin ninguna orden real guardada** (sin red, sin archivo y sin ticket) la API de Bando responde con órdenes de ejemplo, marcadas `fuente: 'ejemplo'` y con proveedores que dicen "Ejemplo" en el nombre. Nunca se guardan.
- Una pasada a los 5 s de arrancar y otra cada `MERCADO_PUBLICO_INTERVALO_HORAS` (6 por defecto). `MERCADO_PUBLICO=0` las apaga.
- **Privacidad:** no se guardan proveedores personas naturales (RUT bajo 50.000.000): el repo y la app no muestran datos personales. Los organismos compradores son públicos, pero en Bando solo salen contados (`clientes`), nunca por nombre; los precios de referencia no traen al comprador. Tampoco se guardan contactos.

## Contrato
- `GET /api/fuentes/mercado-publico/proveedores` → `{ fuente, hasta, proveedores }`; cada proveedor `{ rut, nombre, comuna, region, rubros, despacho, clientes, ordenes, ultimaOrden }`.
- `GET /api/fuentes/mercado-publico/proveedores/:rut` → `{ fuente, hasta, proveedor, precios }` (404 si no tiene ventas).
- `GET /api/fuentes/mercado-publico/precios?producto=arroz` → `{ fuente, hasta, producto, resumen, precios }`. `resumen`: por unidad, `{ unidad, cantidad, minimo, mediana, maximo }`. Cada precio: `{ orden, producto, codigoProducto, rubro, categoria, unidad, cantidad, precioUnitario, fecha, despacho, proveedor: { rut, nombre } }`. Precios netos en pesos; en pantalla, siempre con `dinero()`.
- `fuente`: `mercado_publico` o `ejemplo`. `hasta`: el día más reciente con datos.
- Socket.io: `red:evento` tipo `mercado_publico.actualizado` (ver el contrato de la red), uno por lote guardado.

## Cómo activar el ticket
1. Pedir el ticket en https://api.mercadopublico.cl (se entra con Clave Única; llega por correo).
2. Ponerlo en `MERCADO_PUBLICO_TICKET` en Render (y en `.env` local). Sin reiniciar nada más: en la siguiente pasada trae los días que faltan.
3. Límite: 10.000 consultas diarias por ticket. Con 100 detalles por día y 1,5 s entre llamadas, una pasada usa ~100 consultas por día pendiente.

## Consecuencias
- El dataset OCDS se publica con días de atraso (2026 tenía `Last-Modified` 18-nov); los últimos días solo llegan con ticket.
- Adjudicaciones de licitaciones (OCDS) y órdenes de compra (API) son cosas distintas y pueden repetir un mismo precio; para referencia basta.
- Sin `DATABASE_URL`, cada reinicio vuelve a descargar el archivo del año.
- El dataset no trae la comuna del proveedor ni la de despacho, solo la región; con ticket llega la comuna.
- Pendiente: mostrarlo en la ficha del proveedor (todavía no existe una vista de ficha para el comprador) y cruzar productos por `codigoProducto` con el catálogo de la red.
- Descartado por ahora: el endpoint OCDS en vivo (`apis.mercadopublico.cl/OCDS/...`) responde 500 hoy y no se puede ver la forma de su respuesta (ver el hallazgo).
