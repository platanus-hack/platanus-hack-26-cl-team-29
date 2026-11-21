# Certificado digital por WhatsApp: link privado, RUT del titular y salida "No (demo)"

Fecha: 2026-11-21 23:00
Autor: javier-whatsapp

## Contexto
Reemplaza la propuesta `20261121-1935-conectar-sii-por-whatsapp.md`. Desde #49 cada comprador da su RUT y su factura sale
a su nombre. Queríamos que pudiera conectar su certificado digital desde WhatsApp (para que el RUT salga de él y quede
guardado para aceptar o reclamar después), sin que la clave pase por el chat, y que en la demo muchas personas pudieran
saltarlo sabiendo que es por la demo.

## Decisión
- **Link privado** (un uso, 15 min) a una página de Bando que sube el .pfx y la clave. Descartados: archivo en el chat
  (queda en Meta y Kapso) y WhatsApp Flows (endpoint propio con Kapso no documentado).
- Módulo `server/certificados/`: valida con `abrirCertificado`, guarda cifrado por RUT del titular y avisa al agente,
  que sigue el registro con ese RUT por el mismo camino que un RUT escrito.
- La pregunta del RUT ofrece **[Conectar certificado] [No (demo)]** y dice que saltarlo es por la demo. "No (demo)" suma
  sin RUT; la factura va al receptor de prueba.
- `certificadoDe(rut)` queda para el módulo del SII: usar el certificado del comprador para aceptar o reclamar es el
  siguiente paso de su dueño.

## Consecuencias
- Probado con el certificado real de Devlas en local: link → subida → "Certificado conectado ✓" → se suma con el RUT del
  titular.
- El RUT del certificado es el de la **persona titular**; para un negocio con RUT de empresa distinto, la persona puede
  seguir escribiendo el RUT de la empresa.
