# Catálogo del proveedor desde sus facturas

Fecha: 2026-11-21 19:41
Autor: Luciano (con Claude)

## Contexto
Para sumar un producto a una compra conjunta, el proveedor tenía que escribirlo a mano y sus tramos salían de una
regla fija (5, 10 y 15 % desde 10, 25 y 50 unidades). Pero el proveedor ya tiene todo eso en sus facturas: qué vende,
en qué unidad, a qué precio y cuánto descuenta por volumen. El Registro de Compras y Ventas del SII no trae el detalle
de productos; las líneas solo están en el XML de cada factura.

## Decisión
- **El catálogo se arma solo, y conseguir los XML es tarea del equipo, no del proveedor.** En `/proveedor` no hay botón
  para subir archivos: el proveedor ve "Mi catálogo" ya armado ("Desde tus facturas", cuántas facturas y entre qué
  fechas). Se arma la primera vez que entra a su panel o cuando se registra como proveedor, con un estado "Armando tu
  catálogo..." que se actualiza en vivo (`red:evento` `catalogo.actualizado`, solo `{ proveedorId, estado }`).
- **De dónde salen los XML** (`server/catalogo/origenes.ts`):
  1. Si emitía con el sistema gratuito del SII, sus documentos están ahí.
  2. Si usa nuestra casilla de intercambio, los recibimos nosotros.
  3. Si usa un facturador externo, se los pedimos: el facturador está obligado a entregarle al contribuyente sus
     documentos en XML, también los históricos por período.
  Los casos 2 y 3 entran por una ruta de operación del equipo, `POST /api/red/operacion/catalogo/:proveedorId/xml`
  (detrás de `DEMO_TOKEN`, el cuerpo es el XML tal cual), y se suman a lo ya cargado sin contar dos veces una factura.
  Leer la casilla directamente queda para después. En la demo, sin variables, el origen es un historial de ejemplo
  simulado (seis meses, 180 facturas con receptores ficticios) que pasa por el mismo lector de XML.
- **Qué se lee:** solo facturas de venta (33 y 34) del mismo emisor que el proveedor. Las guías (52) y las notas
  (56, 61) se omiten para no contar dos veces la misma venta. De cada línea: código, nombre, unidad, cantidad, precio
  neto por unidad (monto de la línea dividido por la cantidad, con su descuento) y fecha. **Nunca** el receptor: ni su
  RUT, ni su razón social, ni su dirección. El XML no se guarda; queda solo eso, en `catalogo_proveedores`.
- **Tramos sugeridos** (`tramosSugeridos` en `shared/precios.ts`): la mediana del precio para cada cantidad vendida y,
  de menor a mayor cantidad, un tramo nuevo cada vez que esa mediana baja al menos un 3 % del anterior (máximo cinco), con precios a la centena.
  Si el historial no muestra bajas, se usan los automáticos. "Sumar a la compra" crea el producto en la compra abierta
  con esos tramos (`crearProducto` acepta `tramos`, validados con `errorDeTramos`, la misma regla que usa el proveedor al fijar sus tramos).

## Consecuencias
- El proveedor suma a la compra conjunta productos con precios reales y tramos que ya da, con un toque.
- Pendiente: leer la casilla de intercambio y el sistema gratuito directamente; con eso el catálogo se mantiene al día
  solo. El mismo cruce sirve, del lado del comprador, para avisarle de compras que de verdad le interesan.
