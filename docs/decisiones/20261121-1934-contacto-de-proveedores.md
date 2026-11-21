# Solo se publican proveedores con canal de contacto

Fecha: 2026-11-21 19:34
Autor: agente buscador-proveedores

## Contexto
El buscador (`/proveedores`) y los mapas mostraban todos los proveedores de Mercado Público, aunque no hubiera forma de escribirles. Ninguna fuente oficial entrega su teléfono o correo (ver el hallazgo del mismo día).

## Decisión
- Para cada proveedor de Mercado Público, Claude busca en la web por razón social y RUT (herramienta `web_search`, máximo 2 búsquedas) y devuelve teléfono, correo, sitio y la URL donde los encontró (`server/ia/contacto.ts`).
- Se valida antes de guardar: sin URL de fuente, o sin un teléfono chileno (56 + 9 dígitos) o un correo con forma válida, no hay contacto. Nada se completa ni se adivina.
- Corre en el enriquecedor de `server/proveedores/`, después de los giros del SII, de a uno y en orden de organismos que le compran. Queda en caché por RUT (`contacto: null` = se buscó y no hay); un error no se guarda y se reintenta en el próximo arranque.
- **Se publica** (buscador, `/api/proveedores/mapa`, ficha) solo lo que tiene contacto o está en la red de Bando. El resto sigue usándose como precio de referencia.
- La ficha muestra WhatsApp (si es celular), teléfono, correo y sitio, con "Encontrado en <dominio>".

## Consecuencias
- Necesita `ANTHROPIC_API_KEY`. Sin clave no se busca y solo se publican los proveedores de la red.
- Costo de la primera pasada: unos 670 proveedores, 2 búsquedas cada uno a lo más (búsquedas más tokens; del orden de decenas de dólares). Después, solo los RUT nuevos.
- Descartado: Google Places (pide otra clave y cobro aparte) y raspar directorios de empresas (frágil y de términos dudosos).
