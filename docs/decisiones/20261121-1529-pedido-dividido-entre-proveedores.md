# Pedido dividido cuando ganan varios proveedores

Fecha: 2026-11-21 15:29
Autor: luciano (con agente)

## Contexto
Cada producto de la canasta tiene su propia competencia, así que en principio cada uno puede tener un ganador distinto. Hoy la demo hace ganar al mismo proveedor en todos los productos y al cerrar sale una orden por comprador. La pregunta del equipo: qué pasa si una canasta de varios productos la ganan proveedores distintos.

## Decisión
Queda diseñado y fuera de la demo. Cuando se construya:

1. Al cerrar, el carrito de cada comprador se divide por ganador: una orden de compra por proveedor.
2. Cada proveedor confirma y factura solo sus órdenes, con su propio certificado, desde su panel o WhatsApp.
3. El comprador recibe una factura y un PDF por proveedor; la reputación de cada uno se mueve por separado.
4. Para no premiar despachos fragmentados, la elección de ganadores suma un costo de despacho por proveedor o un descuento por llevarse varios productos del mismo: quien cubre toda la canasta puede ganar aunque pierda producto por producto.
5. `/sala` muestra el ganador de cada producto, el muro de facturas se agrupa por proveedor y cada panel ve solo lo suyo.

## Consecuencias
En la demo sigue ganando un solo proveedor, porque es el único con certificado y sus facturas son reales en el SII; los rivales son agentes sin certificado y sus facturas serían simuladas, lo que mezclaría real y simulado en el momento clave. En el pitch se presenta como siguiente paso. Construirlo toca la red (`server/red/`), WhatsApp (`server/agente/`) y las vistas.
