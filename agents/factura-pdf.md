# factura-pdf
Actualizado: 2026-11-21 21:30

## Estado
libre (PR #39 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/sii/pdf.ts (nuevo), server/sii/{dte,timbre,falso,index,tipos}.ts (datos impresos y TED simulado)
- server/red/pdf-enlace.ts (nuevo), server/red/{rutas,rutas-web,dominio,sii,sii-real,tipos,repositorio,index}.ts (mínimo)
- package.json (pdfkit 0.20.2, bwip-js 4.11.4, @types/pdfkit 0.17.7)
- test/factura-pdf.test.ts

## Hecho
- Representación impresa en PDF de 33, 52 y 61 con timbre PDF417 (TED Latin-1, nivel 5), enlace privado firmado `GET /api/red/documentos/:id/pdf?t=`, `red.enlacePdf(documento)` y `pdfUrl` en `/yo` y `/proveedor/yo`. Decisión: docs/decisiones/20261121-2130-factura-pdf-y-enlace-privado.md

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-whatsapp: agregar `sendDocument(to, { link, filename, caption })` en `server/whatsapp/` (mensaje de tipo documento por enlace en Kapso). El agente ya lo llama si existe (`server/agente/envios.ts`). El enlace es público para quien lo tenga y responde `application/pdf`.
- @canasta-whatsapp: el aviso del folio ya usa `red.enlacePdf(documento)` y `whatsapp.sendDocument` cuando exista; confirmar el texto ("Tu factura folio 5190 fue emitida en el SII... Descárgala: <url>"). Con `PUBLIC_URL` sin configurar el enlace es relativo: en producción hay que definir `PUBLIC_URL`.
- @deploy: definir `PDF_LLAVE` en Render (cualquier secreto largo); sin ella se usa `SII_LLAVE_CIFRADO` y, si falta, los enlaces mueren al reiniciar.
