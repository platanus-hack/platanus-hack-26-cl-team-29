# registro-rut
Actualizado: 2026-11-22 02:03

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/red/rutas-web.ts (`POST /acceso/rut`, `exigirCodigo`, `datosDeFactura`), test/acceso.test.ts
- client/src/canal/Acceso.tsx (registro), api.ts, falso.ts, client/src/marca/componentes.css (autocompletado)
- docs/decisiones/20261121-1130-contrato-red.md (la ruta nueva)

## Hecho
- Registro: el RUT va primero; con un RUT válido (pausa de 400 ms) se consultan sus datos del SII y se completan nombre, dirección, comuna y rubro (por el giro) solo donde el campo está vacío. Si el SII no responde, se escribe a mano.
- `POST /acceso/rut` con el código vigente sin gastarlo, RUT atado al teléfono y límite por teléfono.
- El registro web ahora manda la dirección (antes se perdía en `api.entrar`).
- Campos autocompletados por el navegador con el fondo y el texto de la marca.

## Bloqueos

## Pedidos a otros
