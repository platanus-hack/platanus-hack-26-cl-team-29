# Conectar el SII desde el panel del proveedor

Fecha: 2026-11-21 14:06
Autor: Luciano Saavedra Reyes

## Contexto
El SII real solo se configuraba con variables de entorno (`SII_PFX_BASE64`, `SII_CAF_<tipo>_BASE64`, `SII_FOLIO_DESDE_<tipo>`, datos del emisor). Un producto real no puede pedirle eso a un proveedor: tiene que conectarse una vez desde la web.

## Decisión
`server/conexion-sii/` guarda la conexión del proveedor y la red la usa en cada emisión, sin reiniciar el servidor.

- **Rutas** (sesión del proveedor, `Authorization: Bearer`), bajo `/api/red/proveedor/sii`:
  - `GET /`: estado sin secretos (`conectado`, `titular` solo el RUT, `venceEl`, `empresa`, `resolucion`, `cafs` con `desde`, `hasta`, `primerLibre`, `libres`, `escaneando`, `progreso`, `error`).
  - `POST /certificado` `{ pfxBase64, clave }`: abre el .pfx, rechaza clave mala o certificado vencido.
  - `POST /empresa/consultar` `{ rutEmisor }`: lee la ficha del portal del SII de certificación (`ce_consulta_muestra_e`, sesión con el certificado de cliente en herculesr). No guarda.
  - `PUT /empresa` `{ rutEmisor, razonSocial, giro, acteco, direccion, comuna, ciudad?, fchResol, nroResol? }`: guarda lo que el proveedor confirmó o escribió.
  - `POST /caf` `{ xmlBase64 }`: valida tipo (33, 52, 61), emisor (`RE`), rango, llave y vigencia, y busca el primer folio libre en segundo plano.
  - `POST /caf/:tipo/folio` `{ folio }`: fija el primer folio a mano (nunca uno menor).
  - `DELETE /`: borra la conexión.
- **Secretos**: el .pfx con su clave y el XML del CAF (trae la llave del rango) se guardan cifrados con AES-256-GCM. La llave es `SII_LLAVE_CIFRADO` (32 bytes en base64); sin ella no se guarda nada. Tabla `sii_conexion` (una fila) si hay `DATABASE_URL`; memoria si no. Ninguna respuesta, evento ni línea de log lleva un secreto.
- **Primer folio libre**: QueryEstDte folio por folio desde `D` (o desde el último que la red ya tomó), a 1 solicitud por segundo (la cola del módulo SII). `FAU` es libre; `DOK`, `DNK`, anulado o modificado es usado; cualquier otra respuesta detiene la búsqueda con el texto del SII. El primer folio de la primera racha de 3 `FAU` seguidos queda como inicio del CAF (equivale a `SII_FOLIO_DESDE_<tipo>`) y no baja nunca para ese rango.
- **Precedencia**: la conexión del panel se usa cuando tiene certificado, empresa, resolución y CAF de factura con su primer folio conocido. Entonces reemplaza todas las variables del emisor (no mezcla CAF de dos empresas). Si está incompleta, se usan las variables `SII_*`; sin ellas, el SII falso. Un CAF cuyo primer folio aún se está buscando no se usa.
- **Receptor**: si no hay `SII_RUT_RECEPTOR`, los documentos se emiten a la misma empresa conectada.
- (Reemplazado, ver la actualización) Los CAF solo se subían a mano. Sigue en pie: nunca se anulan folios.

## Consecuencias
- Para operar desde el panel, el servidor necesita `SII_LLAVE_CIFRADO` y, para que sobreviva a un reinicio, `DATABASE_URL`. Si la llave cambia, lo guardado no se puede descifrar y hay que volver a conectar.
- `sii_folios` no distingue emisor: si se cambia de empresa, los folios siguen avanzando desde el mayor ya tomado del tipo (nunca retroceden).
- (Reemplazado, ver la actualización) La ficha del portal abría una sesión por certificado y la reusaba 45 minutos en memoria.

## Actualización (2026-11-21 23:30): conexión automática y sesión única del portal
- **Un solo componente para el portal del SII**: `server/sii-portal/` (`PortalSii.conSesion`). Lo usan la ficha de la empresa, la resolución, los CAF y la consulta del RUT de un comprador (`consultarContribuyente` de la red). Reemplaza la sesión en memoria de 45 minutos. Reglas aplicadas y mediciones: `docs/hallazgos/20261121-1406-sii-portal-sesion-reglas.md`.
- **Sesión persistida**: tabla `sii_portal_sesion` (cookies cifradas con `SII_LLAVE_CIFRADO`, clave = huella SHA-256 del certificado), candado por advisory lock de Postgres, espera compartida tras el límite de sesiones (`720`, 45 minutos sin intentar). Sin `DATABASE_URL` o sin llave, todo queda en memoria con un aviso en el log.
- **"Conectar mi SII" automático**: `POST /certificado` acepta `rutEmisor` (vacío: el RUT del titular) y parte en segundo plano: ficha (`ce_consulta_muestra_e`), resolución (app nueva de `www2c`, `obtenerEmpresa`) y un CAF de 33, 52 y 61. `POST /automatico` lo vuelve a correr. `GET /` trae `automatico.pasos` con el texto literal del SII cuando algo falta.
- **CAF**: primero reobtener (los 5 rangos vigentes más recientes cuyo último folio el SII da por libre, `FAU`); si no hay, pedir 5 folios o menos según `MAX_AUTOR`. Nunca se anula. Un tipo bloqueado queda con el mensaje del SII. El primer folio libre se sigue buscando con QueryEstDte como antes.
- **Resolución**: `ad_empresa1` responde 302 a la página 404 del SII; la resolución se lee de la app nueva de `www2c` con la misma sesión del certificado (`docs/hallazgos/20261121-1413-sii-www2c-ficha-certificacion.md`). Si la app no la entrega (por ejemplo, si pide la verificación en dos pasos), el paso queda "Falta" con la respuesta del SII y el proveedor la escribe en "Tu empresa". Si un envío vuelve `RCT`, la resolución queda marcada (`resolucion.rechazada`) y la conexión deja de emitir hasta corregirla.
- **Variables `SII_*`**: siguen siendo un respaldo opcional, solo mientras la conexión de la app está incompleta.
- La red pasa `detalle` (respuesta del SII) en `CambioEstadoSii` para reconocer el `RCT`.
