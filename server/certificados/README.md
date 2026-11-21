# server/certificados — certificado digital por link privado

Dueño: @javierzagal. Se usa vía `server/certificados/index.ts`.

## Qué hace
Cada negocio conecta su certificado digital (.pfx + clave) desde WhatsApp sin que el archivo ni la clave pasen por
el chat: el agente le manda un **link privado** (un uso, 15 minutos) a una página servida por Express. Al subirlo:
1. se abre con `abrirCertificado` (`server/sii`): clave correcta y vigente;
2. se guarda **cifrado** con `SII_LLAVE_CIFRADO` (tabla `certificados_negocio`, por RUT del titular);
3. se avisa al agente (`alConectar`), que sigue el registro **con el RUT del titular** como si la persona lo hubiera
   escrito: la factura sale a su nombre en el SII (ambiente de certificación).

Es uno de los dos caminos del registro por WhatsApp (el otro es escribir RUT y dirección): el certificado no es
necesario para comprar, pero permite emitir y revisar facturas en el SII. "conectar certificado" funciona en cualquier
momento. Ver `docs/decisiones/20261121-2300-certificado-por-whatsapp.md`.

## API
```ts
const certificados = await crearCertificados({ db });
app.use(certificados.rutas);                      // GET /certificado/:token, POST /api/certificado/:token
certificados.enlace(telefono);                    // link privado
certificados.alConectar((telefono, rut) => …);
await certificados.certificadoDe(rut);            // { pfx, clave, rut, venceEl } | null: para aceptar o reclamar a su nombre
```
Ninguna respuesta ni log lleva el certificado, la clave ni un teléfono completo.

## Probar
`node --env-file=.env scripts/whatsapp-chat.ts --puerto 4000` → "Almacén X, 2 cajas de rollos" → "1" → abre el link en
el navegador y sube un .pfx.
