# Conectar el SII desde el panel del proveedor

Fecha: 2026-11-21 18:30
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
- Nunca se piden ni se anulan folios automáticamente: el proveedor sube los CAF que ya tiene.

## Consecuencias
- Para operar desde el panel, el servidor necesita `SII_LLAVE_CIFRADO` y, para que sobreviva a un reinicio, `DATABASE_URL`. Si la llave cambia, lo guardado no se puede descifrar y hay que volver a conectar.
- `sii_folios` no distingue emisor: si se cambia de empresa, los folios siguen avanzando desde el mayor ya tomado del tipo (nunca retroceden).
- La ficha del portal abre una sesión del SII por certificado y la reusa 45 minutos en memoria: el SII limita las sesiones abiertas y cerrar sesión no libera el cupo. Si el portal falla, el proveedor escribe los datos.
