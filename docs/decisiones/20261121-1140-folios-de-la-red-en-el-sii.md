# Folios de la red en el SII: se reservan antes de armar y nunca se reusan

Fecha: 2026-11-21 11:40
Autor: Luciano Saavedra Reyes

## Contexto
La red emite la factura 33, la guía 52 y la nota de crédito 61 a través de `server/sii/`, que recibe el folio de quien llama. `DTEUpload` en maullin corta parte de las subidas sin decir si el sobre llegó (`incierto`). Un folio repetido o un reenvío ciego puede duplicar un documento o dejar el rango en un estado que solo se arregla a mano.

## Decisión
El adaptador `server/red/sii-real.ts` lleva los folios en `server/red/folios.ts`:
- Rango por tipo leído del CAF (`SII_CAF_<tipo>_BASE64`, solo `TD` y `RNG`).
- El siguiente folio es el mayor ya tomado + 1, nunca menor que el inicio del CAF. Se guarda `reservado` antes de armar el documento y queda usado pase lo que pase. Tabla `sii_folios` (llave tipo y folio) si hay `DATABASE_URL`; memoria si no.
- Falla antes de subir (armado o autenticación): `fallido`, se lanza el error y el próximo intento toma otro folio.
- Sobre rechazado al subir: `rechazado`, se lanza el error con la respuesta del SII completa en el log.
- `incierto`: el documento se guarda en la red con `estadoSii: incierto`, no se reenvía ni se toma otro folio para esa orden y tipo. Se revisa con `scripts/sii-folio.ts` (QueryEstDte): DOK pasa a `recibido`, FAU a `no_recibido`, DNK a `no_coincide`. Nunca se anula nada.
- Si una orden ya tiene un folio vivo de ese tipo (incluido uno `reservado` tras un reinicio), se devuelve ese y no se sube nada.
- Tras una subida recibida, se consulta el veredicto (`estadoEnvio`) en segundo plano, cada 10 s hasta 30 veces, y queda en `sii_folios` y en el log. La red no tiene un evento para cambiar el estado de un documento ya emitido, así que la pantalla sigue mostrando `recibido`.

Demo: el proveedor es la empresa `SII_RUT_EMISOR` y el comprador `SII_RUT_RECEPTOR` (con `SII_RECEPTOR_*`). Los nombres de fantasía de la red no viajan al SII.

## Consecuencias
- Sin `DATABASE_URL` los folios viven en memoria: tras un reinicio vuelven al inicio del CAF y el SII rechaza los repetidos. Para operar contra maullin, usar Postgres.
- Se salta un folio por cada falla antes de subir; en certificación eso no tiene costo y evita cualquier reuso.
- `server/index.ts` usa el adaptador solo con `SII_PFX_BASE64`; sin él la red sigue con su SII falso.
