# web-canal
Actualizado: 2026-11-21 18:30

## Estado
libre (PR #21 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/canal/ (dueño)
- client/src/main.tsx (solo las rutas `/app` y `/proveedor`)
- test/canal-*.test.ts

## Hecho
- Canal web paralelo a WhatsApp, sobre las rutas con sesión de `server/red/rutas-web.ts`:
  - `/app` ("Mi negocio", comprador): nombre y comuna (sin RUT), token en localStorage. Compra conjunta con precio por tramos en vivo, precio solo tachado y "faltan N para bajar a $X"; Pedir (catálogo, proveedores por nota); Mis pedidos con el ciclo de 6 pasos, "¿Recibiste todo?" y reclamo en el SII con paso de confirmación; Mis facturas con estado en el SII; enlace a WhatsApp si hay `whatsappNumero`.
  - `/proveedor`: código de acceso, token solo en sessionStorage. Cerrar compra, "Facturar todo en el SII" (N facturas y total), "Confirmar y facturar", "Emitir nota de crédito por $X", mi nota con el último cambio y mis documentos.
  - Toda acción legal manda `confirmado: true` solo después del paso de confirmación en la página.
  - Red falsa en memoria (`client/src/canal/falso.ts`) si `GET /api/red/config` no responde JSON, o con `?prueba`.
- Probado de punta a punta contra el backend en memoria y con la red falsa, a 375x812 y 1440x900.

## Bloqueos
- (ninguno)

## Pedidos a otros
- @sala-red: `/proveedor/yo` no trae la nota anterior; el panel la toma de lo que ve la pestaña. Si se agrega `notaAnterior`, el panel la usa sin cambios.
- @sala-red: `POST /yo/ordenes` no acepta el producto de la compra conjunta (no está en `catalogo.ts`); por eso "Pedir" ofrece solo el catálogo.
