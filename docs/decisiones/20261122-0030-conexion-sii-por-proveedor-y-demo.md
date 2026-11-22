# "Conectar mi SII" muestra la conexión de cada proveedor; opción demo de usar la del panel

Fecha: 2026-11-22 00:30
Autor: javier-proveedor-ui

## Contexto
La pantalla "Conectar mi SII" del panel mostraba la conexión del servidor (la del panel, con el certificado de la
empresa de la demo) a cualquier proveedor: todos veían "SII conectado · DEVLAS SPA" aunque nunca hubieran subido un
certificado. Al emitir, en cambio, un proveedor registrado por WhatsApp ya usaba la conexión de su propio RUT.

## Decisión
- Las rutas `/proveedor/sii` trabajan con la conexión del proveedor de la sesión (`res.locals.proveedor`): la de su
  RUT. Los proveedores que no se registraron por WhatsApp siguen con la del panel.
- Solo para la demo: si el panel está conectado y el proveedor no es esa empresa, ve "o usar <empresa> (Demo)". Al
  elegirlo, se guarda su RUT en `sii_demo_proveedores` y sus documentos salen con la conexión del panel: emitidos por
  esa empresa en el SII de certificación. Puede dejar de usarla.

## Consecuencias
- `EstadoConexionSii.demo` (`{ empresa, usando }`) y `POST /api/red/proveedor/sii/demo` (`{ usar }`).
- `crearRutasConexionSii` acepta una conexión fija (tests) o un resolutor por sesión.
- En uso real esto se apaga: cada proveedor emite con su propio certificado.
