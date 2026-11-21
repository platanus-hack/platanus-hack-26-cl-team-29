# Ficha de la empresa de certificación desde la app nueva del SII (www2c)

Fecha: 2026-11-21 14:13
Autor: ficha-www2c

## Contexto
La resolución de certificación (fecha y número, van en la carátula) se leía de `ad_empresa1` y `ad_empresa2` en maullin, que ahora responden 302 a la página 404 del SII. El SII publica la misma ficha en la app "Actualizar datos de empresa y usuarios (Nuevo)", `https://www2c.sii.cl/sii-muyd-inter/`, con una API JSON en `/app/sii-muyd/ct/<rut>-<DV>/...`. Un hallazgo anterior (`20261121-1406-sii-portal-sesion-reglas.md`) vio un 401 en esa API y concluyó que no aceptaba la sesión del certificado. Una persona que entra desde el navegador pasa por `www2c.sii.cl/bifurcacion`, elige "Certificado Digital", vuelve a la SPA y al pulsar "Ingresar" ve un modal de verificación en dos pasos (código por correo o app autenticadora). La pregunta era si un login con certificado sirve para leer la ficha sin ese segundo factor.

## Hallazgo
Medido hoy en vivo, solo lectura, con un único login con certificado (el mismo del portal, destino `misiir`) y todo por `server/sii-portal`:

- La secuencia de la SPA funciona con la sesión del certificado, sin segundo factor:
  1. `GET /sii-muyd-inter/` como navegación: 200 (HTML de la SPA).
  2. `GET /app/session/status` como XHR: 200 en ~1,1 s, `{"seconds":5999,"userId":...,"userProfiles":["00000"],"userAuthType":"CT","authTime":...,"userRte":...}`. La sesión de la app dura unos 100 minutos.
  3. `GET /app/sii-muyd/ct/<rut>-<DV>/esUsuarioAdministrador`: 200, cuerpo `true`.
  4. `GET .../obtenerEmpresa`: 200 con `rut`, `dv`, `tipoFacturacion`, `fechaResolucion` (`AAAA-MM-DD`), `resolucion` (texto, `"0"` en certificación), `fechaAutorizacion`, `nombreSw`, `entidadCertificadora`, `url`, los tres correos de contacto, `codigo`, `fechaDesautorizacion`, `mailRepresentante` y `telefonoContacto`.
  5. `GET .../obtenerContribuyente`: 200 con `razonSocial` (y `nombres`/apellidos en null para una persona jurídica), `fechaConstitucion` y datos de contacto.
- Cabeceras de la API: las de una llamada XHR (`accept: application/json, text/plain, */*`, `sec-fetch-mode: cors`, `sec-fetch-site: same-origin`, `sec-fetch-dest: empty`, `referer` de la SPA), más `X-SII-SESSION-USER-AUTH-TYPE: CT` y `X-SII-SESSION-USER-ID` con el RUT del titular. La cookie es la de la sesión del login (todas, incluidas `NETSCAPE_LIVEWIRE.*`).
- En certificación la ficha entregó resolución número 0 y la fecha de la postulación, igual en `fechaResolucion` y `fechaAutorizacion`, como se esperaba.
- No hubo 428 (verificación en dos pasos) ni 403 en ningún paso. El modal que ve una persona sale en el flujo de "Ingresar" de la SPA, que llama `existEmpresa`; esa llamada no hace falta para leer y nunca se hace.

## Consecuencias
- "Conectar mi SII" lee la resolución sola desde `www2c` (`consultarResolucion` en `server/sii-portal/mantenedor.ts`), en la misma sesión del certificado: no cuesta otro login.
- Rechazos de la API (`server/sii-portal/rechazo.ts`): 401, o una redirección fuera de `/app/`, es sesión vencida (un solo login nuevo y solo si la sesión era guardada); 428 es `VERIFICACION_DOS_PASOS` y 403 un rechazo, ambos con el cuerpo literal del SII y sin otro login. Si el SII empieza a pedir el segundo factor, el paso de la resolución queda para escribirla a mano con ese texto; no se intenta saltar.
- Nunca se llama `existEmpresa` ni `actualizarEmpresa` (escribe).
