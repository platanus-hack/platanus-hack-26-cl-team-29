# conectar-sii
Actualizado: 2026-11-21 19:00

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/conexion-sii/ (dueño, nuevo)
- server/red/index.ts, server/red/rutas.ts (mínimo: rutas /api/red/proveedor/sii y conexión del SII real)
- server/index.ts (mínimo)
- client/src/canal/ (sección "Conectar mi SII" del panel del proveedor)
- .env.example

## Hecho
- "Conectar mi SII" en el panel del proveedor: certificado cifrado (AES-256-GCM, SII_LLAVE_CIFRADO), ficha de la empresa desde ce_consulta_muestra_e, resolución, CAF 33/52/61 con búsqueda del primer folio libre (QueryEstDte, racha de 3 FAU). La red elige en cada emisión: conexión del panel, variables SII_* o falso. Decisión: docs/decisiones/20261121-1830-conectar-sii-desde-el-panel.md

## Bloqueos
- Falta una verificación en vivo del login con certificado y de la lectura de la ficha en maullin (necesita el certificado de una persona).

## Pedidos a otros
- @red-sii: agregué `ultimo(tipo)` a AlmacenFolios y `crearAlmacenFolios(db)` en server/red/index.ts; `iniciarRed` acepta una función que envuelve el SII falso.
- @luciano-sii: server/sii/index.ts ahora exporta abrirCertificado, leerCaf, primerDiaVencido, normalizarRut y crearConsultaDocumentos (solo QueryEstDte).
