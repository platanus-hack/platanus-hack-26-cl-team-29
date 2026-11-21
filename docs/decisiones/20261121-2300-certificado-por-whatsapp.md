# Registro por WhatsApp: certificado digital o RUT y dirección, antes de comprar

Fecha: 2026-11-21 23:00
Autor: javier-whatsapp

## Contexto
Reemplaza la propuesta `20261121-1935-conectar-sii-por-whatsapp.md`. Desde #49 cada comprador da su RUT y su factura sale
a su nombre. Faltaba la dirección (la factura la necesita) y una forma de conectar el certificado digital sin que la clave
pase por el chat. El certificado no es necesario para comprar: sirve para emitir y revisar facturas en el SII.

## Decisión
- Un número sin registrar, antes de ver productos, elige cómo registrarse: **[Certificado digital] [RUT y dirección]**.
  - **Certificado digital**: link privado (un uso, 15 min) a una página de Bando que sube el .pfx y la clave
    (`server/certificados/`, guardado cifrado por RUT del titular). El RUT sale del certificado.
  - **RUT y dirección**: escribe su RUT.
- Con el RUT consultado en el SII: si el SII tiene su dirección, se confirma (**[Sí, es esa] [Es otra]**); si no, la escribe
  ("calle, número, comuna"). Sin RUT válido y dirección no entra a la compra.
- La dirección confirmada o escrita reemplaza la del SII en los datos privados del comprador (`direccionFactura` →
  `contribuyente`), que son los que usa la factura. La factura llega por WhatsApp como siempre.
- Al terminar: "quedaste registrado ✓" y recién ahí los productos; si el primer mensaje traía un pedido, se atiende.
- Descartados: archivo en el chat (queda en Meta y Kapso), WhatsApp Flows (endpoint propio con Kapso no documentado) y un
  "No (demo)" que dejaba comprar sin datos de factura.

## Consecuencias
- `certificados.certificadoDe(rut)` queda para el módulo del SII (aceptar o reclamar a nombre del comprador).
- Probado con el certificado real de Devlas en local: link → subida → el registro sigue con el RUT del titular.
- El RUT del certificado es el de la persona titular; si el negocio tiene otro RUT, puede elegir "RUT y dirección".
