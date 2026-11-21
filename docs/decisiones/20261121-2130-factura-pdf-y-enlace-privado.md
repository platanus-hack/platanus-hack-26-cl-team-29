# Representación impresa en PDF y enlace privado por documento

Fecha: 2026-11-21 21:30
Autor: Luciano Saavedra Reyes

## Contexto
El comprador recibía solo el folio de su factura. Para que la factura sea un resultado que se pueda guardar, imprimir o reenviar, cada documento (33, 52 y 61) necesita su representación impresa y una forma de llegar a ella por WhatsApp y por la web sin exponerla a todos.

## Decisión
- `server/sii/pdf.ts` dibuja el PDF en memoria con pdfkit (0.20.2, MIT) y bwip-js (4.11.4, MIT), siguiendo las convenciones de la representación impresa del SII: emisor (razón social, giro, dirección, comuna), recuadro rojo con RUT, tipo y folio, "S.I.I. - <unidad>" bajo el recuadro (`SII_OFICINA`, por defecto SANTIAGO), receptor, referencias (orden de compra 801, factura corregida en la 61), detalle, totales y el timbre: PDF417 de los bytes Latin-1 exactos del `<TED>`, nivel de seguridad 5, con "Timbre Electrónico SII", "Res. 0 de <año de FchResol>" y "Verifique documento: www.sii.cl". Siempre lleva la leyenda de ambiente de certificación. Sin logo del SII: no es parte de la representación oficial.
- Al emitir, `server/sii` devuelve en cada `DocumentoEmitido.impreso` los datos para dibujarlo (JSON con el TED). La red los guarda en la colección interna `impresos` (tabla `red_impresos`), aparte de `Documento`: llevan RUT y datos tributarios, así que nunca entran en la foto pública ni en eventos. El SII falso arma un TED con la misma forma, firmado como `SIMULADO`, y el PDF dice "Timbre simulado (modo demo)".
- Enlace privado: `GET /api/red/documentos/:id/pdf?t=<token>`, token = HMAC-SHA256(id) con una llave derivada de `PDF_LLAVE` (si falta, de `SII_LLAVE_CIFRADO`; si tampoco, aleatoria por proceso y los enlaces mueren al reiniciar). Token malo o documento sin PDF: 404. Responde `application/pdf`, `inline; filename="factura-<folio>.pdf"` (`guia-despacho-`, `nota-credito-`), `Cache-Control: private, no-store`.
- `red.enlacePdf(documento)` da la URL (absoluta con `PUBLIC_URL`, relativa si no está) o `null`. `GET /api/red/yo` y `GET /api/red/proveedor/yo` agregan `pdfUrl` a sus documentos; nada público lo lleva.

## Consecuencias
- El agente de WhatsApp ya manda el enlace en el aviso del folio. Adjuntar el PDF como documento depende de `whatsapp.sendDocument`, que falta en `server/whatsapp/` (pedido a su dueño).
- Quien tiene el enlace ve el PDF sin sesión: es la forma de compartirlo por WhatsApp. No se puede revocar un enlace sin cambiar la llave (lo que invalida todos).
- Los documentos emitidos antes de este cambio no tienen PDF (404, `pdfUrl` ausente).
