# Kapso: archivos entrantes y WhatsApp Flows

Fecha: 2026-11-21 19:40
Autor: javier-whatsapp

## Contexto
Para conectar el SII por WhatsApp había que saber cómo llegan los archivos a nuestro backend y si un WhatsApp Flow puede recibir una clave sin que la vea un tercero.

## Hallazgo
- **Archivos en el chat.** Kapso no reenvía el archivo: manda un enlace. El webhook trae `message.kapso.media_url`, una copia que guarda Kapso (ya lo lee `server/whatsapp/kapso/payload.ts`). Con el id de Meta, Kapso entrega un `download_url` que vence en 4 a 5 minutos ([get media URL](https://docs.kapso.ai/api/meta/whatsapp/media/get-media-url)). Meta deja descargar ese id hasta 7 días ([media de Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)).
- **Endpoint de Flow administrado por Kapso.** "Kapso decrypts and forwards to your function" y "Kapso handles the key exchange" ([data endpoint](https://docs.kapso.ai/docs/whatsapp/flows/data-endpoint)): Kapso ve los datos en claro.
- **Endpoint propio.** El SDK de Kapso trae `receiveFlowEvent({ rawBody, headers, phoneNumberId, appSecret, getPrivateKey, verifyToken })` para un servidor Express propio con nuestra llave privada ([SDK, flows](https://raw.githubusercontent.com/gokapso/whatsapp-cloud-api-js/HEAD/docs/flows.md)). La documentación no dice cómo apuntar un Flow de un número de Kapso a un endpoint externo ni cómo registrar nuestra llave pública. Tiempo de respuesta: 10 s según el SDK (Meta), 15 s según Kapso.
- **Campo de clave.** El `TextInput` de Flows acepta `input-type: password` ([componentes](https://developers.facebook.com/docs/whatsapp/flows/reference/components)).
- **Archivos en un Flow** ([media upload](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/media_upload)):
  - Por `data_exchange`, el endpoint recibe `cdn_url` y `encryption_metadata` (llaves y hashes); el archivo queda cifrado (AES-256-CBC + HMAC-SHA256) en el CDN hasta 20 días.
  - Por la acción `complete`, el archivo llega en el webhook normal (`nfm_reply`) como un media cualquiera.
  - El `DocumentPicker` acepta 24 tipos (pdf, Office, imágenes, zip, 7z, gzip, texto, video). **No acepta `.pfx`** (`application/x-pkcs12`). Máximo 25 MiB por archivo.

## Consecuencias
- Para que nadie más vea la clave, el endpoint del Flow tiene que ser nuestro, con nuestra llave.
- Un .pfx mandado por el chat queda en Meta y en Kapso; mandarlo dentro de un Flow obliga a comprimirlo en `.zip`.
