# El proveedor ve y cambia sus tramos por volumen desde su panel

Fecha: 2026-11-21 19:30
Autor: proveedor-tramos

## Contexto
En el feedback de la demo se pidió que el proveedor tenga a la vista su escalera de precios ("desde 10 unidades a X,
desde 100 a Y"). Hasta ahora los tramos venían de la canasta de la demo o de `tramosAutomaticos` al crear un producto
por WhatsApp, y el panel `/proveedor` no los mostraba.

## Decisión
- `/proveedor` muestra "Precios por volumen": cada producto de la compra con su escalera (`Escalera`), el tramo
  alcanzado y cuánto falta para el siguiente.
- Solo el dueño de un producto cambia sus tramos, y solo con la compra abierta. Dueño (`duenoDeTramos`): quien creó el
  producto o, en la canasta de la demo, el proveedor fijo de la compra. Los demás proveedores compiten ofertando.
- Reglas (`errorDeTramos` en `shared/precios.ts`, las mismas en el backend y en el front): de 1 a 8 tramos, el primero
  desde 1 unidad (el precio de comprar solo), "desde" sin repetir y precios enteros que no suben con el volumen.
  **El precio que ya alcanzó el grupo no puede subir**: quien ya se sumó nunca paga más por un cambio de tramos.
- Ruta `PUT /api/red/proveedor/licitacion/:id/productos/:productoId/tramos` con sesión de proveedor. El dominio
  (`fijarTramos`) emite `licitacion.producto` con `cambio: 'tramos'` y, si el precio vigente bajó,
  `licitacion.precio_bajo` (que ya avisa por WhatsApp y anima la sala). La competencia escucha `licitacion.producto`:
  si el tramo bajó, los rivales responden como al sumarse un negocio.

## Alternativas descartadas
- Permitir subir el tramo vigente: cambiaría el precio a quien ya se comprometió.
- Editar tramos por WhatsApp: queda para después; el panel web es más claro para una tabla.
