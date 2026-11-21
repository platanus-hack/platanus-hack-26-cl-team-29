# red-dominio
Actualizado: 2026-11-21 11:40

## Estado
libre (PR listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/red/ (dueño; fuera de la carpeta se importa solo `server/red/index.ts`)
- test/red-*.test.ts
- server/index.ts (monta `/api/red` y reenvía `red:evento` por Socket.io)

## Hecho
- Dominio de la red según el contrato: órdenes, documentos SII (falso por defecto), reclamo, nota de crédito, nota del proveedor, licitación, `/api/red`, `red:evento`, Postgres o memoria, datos de demo (49dddda, 2a3fd60)
- Contrato actualizado con la forma de `datos` de cada evento, la ruta `POST /api/red/licitaciones/:id/cerrar` y los campos agregados

## Bloqueos
- (ninguno)

## Pedidos a otros
- @agente-whatsapp: `server/index.ts` exporta `red` (tipo `Red` de `server/red/index.ts`). Para evitar import circular, recíbela por parámetro desde `server/index.ts` (por ejemplo `conectarAgente({ whatsapp, red })`). Funciones:
  - `red.negocioPorTelefono(message.from): Negocio | undefined` (compara los últimos 9 dígitos)
  - `red.crearOrden({ compradorId, proveedorId, items: [{ producto, cantidad, precioUnitario }] }): Promise<OrdenCompra>`
  - `red.confirmarOrden(ordenId)`, `red.registrarRecepcion(ordenId, { conforme: true } | { faltante, producto? })`, `red.emitirNotaCredito(ordenId)`: solo después de que la persona confirme por WhatsApp (efecto legal en el SII)
  - `red.notaDeProveedor(proveedorId): number`, `red.estadoDeLaRed(): EstadoRed`, `red.unirseALicitacion(id, { negocioId, cantidad })`, `red.ofertar(id, { proveedorId, precioUnitario, plazoDias })`
  - `red.escuchar(evento => ...)` para avisar al otro negocio (p. ej. al proveedor en `orden.creada`)
  - Errores: lanzan `ErrorRed` con `codigo` (`no_encontrado`, `transicion_invalida`, `datos_invalidos`, `ocupado`) y un `message` en español apto para responder al usuario.
  - Demo: `DEMO_TELEFONO_COMPRADOR` se asigna a La Picá de Ñuñoa (`n-pica-nunoa`) y `DEMO_TELEFONO_PROVEEDOR` a Panificadora Ñuble (`n-panificadora-nuble`) al arrancar.
- @pantalla: `GET /api/red/estado` al conectar y luego `red:evento` (`{ tipo, datos, en }`); la forma de `datos` está en el contrato. Las órdenes se llaman `OC-1001`, `OC-1002`... La licitación de demo es `L-1`; cerrarla con `POST /api/red/licitaciones/L-1/cerrar`. Notas iniciales: Harinas Andes 4.8, Panificadora Ñuble 4.7, Distribuidora Sur 4.6, Molinos del Sur 3.9. `estadoSii` es `simulado` mientras no esté conectado el SII real.
- @sii: el puerto que necesito está en `server/red/sii.ts` (`PuertoSii`: `emitirFactura`, `emitirGuia`, `emitirNotaCredito`, `registrarReclamo`). Cuando `server/sii/` esté en main, el adaptador se pasa como segundo argumento de `iniciarRed(db, sii)`; lo escribo yo o tú, avisa.
