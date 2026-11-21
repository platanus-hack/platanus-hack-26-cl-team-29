# Reglas del portal web del SII: sesiones, orden de solicitudes y folios

Fecha: 2026-11-21 23:30
Autor: sii-sesion

## Contexto
Para conectar el SII de un proveedor sin pasos manuales (ficha de la empresa, resolución y CAF) la app tiene que usar el portal web del SII de certificación (`maullin.sii.cl/cvc_cgi/dte/*`) con el certificado digital del proveedor. El portal no tiene documentación técnica oficial: casi todo lo que sigue sale de observación (capturas de respuestas reales y mediciones de equipos que ya integran con el SII) y de una lectura propia, de solo lectura y con un solo login, hecha hoy con el componente nuevo.

## Hallazgo

**Sesiones (lo que más daña si se hace mal).**
- Cada login con certificado cuenta contra un cupo de sesiones por RUT. Al pasarlo, el login responde en un `alert()` "Usted ha superado el máximo de sesiones autenticadas..." con un código `01.01.215.500.720.NN` (con clave el tramo es `206`; se reconoce por el `720`). El cupo no es una cifra fija (se han visto bloqueos con 1 sesión abierta y 8 sesiones aceptadas) y el bloqueo dura de 5 a más de 60 minutos. Reintentar abre otra sesión y lo alarga. Regla: ante el `720` no se reintenta y se espera al menos 35 minutos (la app espera 45, y lo anota en el almacén compartido para que ninguna instancia intente antes).
- Cerrar sesión (`autLogout.cgi`, responde 302) no libera el cupo. No sirve como remedio.
- Por eso la sesión se reutiliza: se guarda en un almacén compartido (Postgres, cifrada como las credenciales, porque sus cookies permiten actuar a nombre del contribuyente), sobrevive a reinicios y despliegues, y se indexa por la huella SHA-256 del certificado. Antes de reutilizarla se comparan la huella y el RUT del titular: una sesión de otro titular dio en el pasado "no está autorizado por la empresa".
- Un solo login por certificado aunque lleguen llamadas a la vez: un candado por certificado (advisory lock de Postgres sobre una conexión dedicada, con reintento de 250 ms y espera máxima de 30 minutos; sin base, un candado en memoria). Sin candado, tres procesos con la sesión vacía hicieron tres logins.
- Sesión vencida: el portal responde 302 hacia `zeusr.sii.cl/.../autInicioDTE` o `InicioAutenticacion`. Se descarta y se hace UN login nuevo; si una sesión recién creada ya no sirve, se informa en vez de insistir. Un trabajo que escribe (reobtener o pedir folios) no se repite solo.
- Solo se reintenta lo que nunca llegó al SII (DNS, conexión rechazada, handshake). Un 200 con error del SII no se reintenta como si fuera red. Topes: 10 s de conexión y 60 s de respuesta.

**Orden y forma de las solicitudes.**
- Las solicitudes de una misma sesión van en serie: las cookies del balanceador (`TS0...`) se rompen con solicitudes concurrentes.
- Cada flujo parte con un GET y cada POST sale del formulario de la página anterior (su `action` y sus ocultos): el balanceador rechaza un POST "ciego".
- Cabeceras de un navegador real, en su orden (`Origin` y `Cache-Control` solo en POST), con un solo User-Agent.
- Formularios en ISO-8859-1 con percent-encoding de bytes Latin-1, nunca `encodeURIComponent`. Las páginas de `cvc_cgi` no declaran charset y son Latin-1; la respuesta del login (`herculesr`) es UTF-8 sin declararlo.
- Casi todo error llega con HTTP 200 y en un lugar fijo: `alert()` con código, plantilla "No ha sido posible completar su solicitud", título "Solicitud Bloqueada" del cortafuegos. Se entrega el texto literal del SII.
- Ritmo: como máximo unas 1 solicitud por segundo entre flujos y un tope global de flujos simultáneos; en los flujos de folios, ~1 s entre pasos.
- El login (`herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi`) pide el certificado de cliente en el handshake; `maullin` no.

**Ficha y resolución (medido hoy, una sesión, solo lectura).**
- `ce_consulta_muestra_e` entrega razón social, dirección, comuna y actividades. Su HTML trae tablas anidadas y una fila sin `<tr>` de apertura: se lee fila por fila cortando en cada `</tr>`.
- `ad_empresa1` responde **302 a `https://www.sii.cl/custom_pages/Error404.html`** dentro de una sesión válida (en la misma sesión `ce_consulta_muestra_e` y la reobtención respondieron 200), también con cabeceras de navegador. No es la sesión ni las cabeceras: la página ya no está disponible en maullin para este acceso. El SII publica la misma ficha en una aplicación nueva, "Actualizar datos de empresa y usuarios (Nuevo)" (`www2c.sii.cl/sii-muyd-inter/`, API `/app/sii-muyd/<rut>-<dv>/obtenerEmpresa` con `fechaResolucion` y `resolucion`), pero `www2c` no acepta la sesión iniciada en el login con certificado (responde 401 y pide autenticarse de nuevo), lo que costaría otro login del cupo.
- La resolución va en la carátula y es por ambiente: en certificación el número es 0 y la fecha es la de la postulación de la empresa. Una fecha equivocada da `RCT` ("Error en Carátula", código `CRT-3-19`). Los folios de un envío `RCT` quedan libres en el SII (`QueryEstDte` responde `FAU`).
- Cuando el titular representa a otros contribuyentes, el login muestra "ESCOJA COMO DESEA INGRESAR". Elegir "representar" cambia el estado de la sesión compartida, así que no se usa para descubrir el RUT de la empresa.

**Folios.**
- Orden de remedios: reobtener rangos ya autorizados (`rf_reobtencion*`, no gasta cupo) y, solo si no hay, pedir pocos folios dentro de `MAX_AUTOR`. Pedir de más agrava el racionamiento: cada folio timbrado y sin usar empeora el cupo.
- Anular folios es irreversible y pesa seis meses contra el cupo: es el último recurso y lo decide una persona, nunca la app.
- El listado de reobtención va del folio más alto al más bajo y mezcla rangos con folios ya usados: antes de usar un folio se le pregunta al SII con `QueryEstDte`. Hoy se leyó la primera página (15 rangos) de 33, 52 y 61 sin problemas.
- El CAF de 33 y 61 vence a los seis meses de su fecha de autorización; uno reobtenido conserva esa fecha.
- El bloqueo del timbraje llega en `of_solicita_folios_dcto` ("NO SE AUTORIZA TIMBRAJE", "tiene disponible una cantidad de folios suficiente", "situaciones pendientes"): se muestra literal y no se insiste.

## Consecuencias
- Todo lo que toca el portal pasa por `server/sii-portal/` (ver la decisión del SII actualizada). Nadie abre sesiones con scripts sueltos: el único script es `scripts/sii-portal-lectura.ts`, de solo lectura y un login.
- La resolución no se obtiene sola hoy: el proveedor la escribe (con la indicación de dónde verla en el SII) y, si el SII devuelve `RCT`, la app deja de emitir con ella hasta que se corrija. No se mandan sobres de prueba para adivinarla: aunque sus folios quedan libres, cada sobre es una escritura en el SII y un intento a ciegas.
- Pendiente: leer `obtenerEmpresa` en `www2c` exige medir cómo entra el certificado a esa aplicación sin gastar el cupo de la sesión principal.
