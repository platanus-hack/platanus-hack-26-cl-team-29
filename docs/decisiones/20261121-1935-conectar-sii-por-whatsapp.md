# Conectar el SII por WhatsApp: archivo en el chat, clave en un Flow con endpoint propio (propuesta)

Fecha: 2026-11-21 19:35
Autor: javier-whatsapp

## Contexto
Los dos usuarios necesitan su certificado digital (.pfx y clave) en Bando: el proveedor para emitir factura, guía y nota de crédito; el comprador para aceptar o reclamar facturas (`server/sii/reclamo.ts` autentica con un certificado autorizado para la empresa receptora). Sin certificado, el comprador igual recibe su factura, pero se acepta sola a los 8 días y el reclamo se hace en el sitio del SII.

Hoy el certificado se sube desde el panel del proveedor (`server/conexion-sii/`, ver `20261121-1830-conectar-sii-desde-el-panel.md`). Siguiendo `20261121-1930-whatsapp-primero.md`, también tiene que poder hacerse por WhatsApp, sin que el archivo ni la clave queden en `whatsapp_messages`, en logs ni en Claude.

## Decisión (propuesta, pendiente de la prueba de abajo)
- **El .pfx va como documento en el chat.** El chat acepta cualquier tipo de archivo y se puede mandar desde WhatsApp Web, donde suele estar el certificado. El archivo viene cifrado con su clave: solo no sirve.
- **La clave se escribe en un WhatsApp Flow** (campo `password`) cuyo endpoint de datos es nuestro servidor, con nuestro par de llaves. Con el endpoint administrado por Kapso, Kapso descifra y vería la clave (ver hallazgo `20261121-1940-kapso-flows-y-archivos.md`). La acción final del Flow (`complete`) no lleva nada sensible.
- **Cada módulo hace lo suyo:**
  - `server/whatsapp/`: transporte. Recibe el documento, descifra el payload del Flow y permite marcar un mensaje entrante como sensible para guardarlo sin contenido.
  - `server/agente/`: la conversación. Pide el certificado en el momento justo y manda el Flow.
  - `server/conexion-sii/`: abre el .pfx, valida clave y vigencia, y lo guarda cifrado. No se crea un segundo almacén de secretos.
- **Cuándo se pide:** al proveedor, al registrarse. Al comprador, después de su primera factura ("Para reclamar o aceptar facturas desde aquí, conecta tu SII una vez"), no al sumarse a una compra; y de nuevo si reporta un faltante sin haberlo conectado.

## Por confirmar antes de implementar
1. Que un número conectado por Kapso pueda usar un endpoint de Flow externo con nuestra llave pública (no el administrado por Kapso).
2. Que el sandbox de Kapso admita Flows, o si hace falta un número verificado.
3. Si los Flows se abren en WhatsApp Web; si no, la clave se escribe en el teléfono.

## Consecuencias
- `server/conexion-sii/` hoy guarda una sola conexión (la del proveedor) y se usa por HTTP con sesión del panel. Para esto necesita una conexión por negocio (comprador y proveedor) y una función que el agente pueda llamar con negocio, archivo y clave.
- El .pfx queda en los servidores de Meta y en la copia que guarda Kapso, protegido solo por su clave. Una clave débil es el riesgo residual.
- Descartado: el .pfx dentro del Flow (el selector no acepta `.pfx`, habría que pedir un `.zip`); la clave por chat (quedaría en Meta, Kapso y el historial del teléfono); que Bando firme con su propio certificado como usuario autorizado (no cubre lo que el comprador y el proveedor necesitan hacer en su propio nombre).
