# Mercado Público no publica el contacto de sus proveedores

Fecha: 2026-11-21 19:34
Autor: agente buscador-proveedores

## Contexto
Para publicar en el buscador solo proveedores a los que un negocio les pueda escribir, se buscó un teléfono o correo por RUT en las fuentes oficiales de ChileCompra.

## Hallazgo
- **Dataset OCDS** (el que se carga hoy): de 3.543 proveedores en una muestra de 2026, ninguno trae `contactPoint.email` ni `contactPoint.telephone`. Solo el nombre del contacto (50 %) y la dirección (99 %).
- **API de órdenes de compra** (`ordenesdecompra.json?codigo=`): el bloque `Proveedor` tiene `FonoContacto` y `MailContacto`, pero vienen vacíos en 24 de 24 proveedores de órdenes aceptadas del 19-11-2026.
- **Ficha pública del proveedor** (`proveedor.mercadopublico.cl/ficha/<código>`): muestra habilidad, sellos, socios y ventas; no muestra teléfono ni correo.
- La consulta pública del SII tampoco entrega contacto.

## Consecuencias
El contacto se busca en la web (ver la decisión del mismo día sobre el contacto de proveedores).
