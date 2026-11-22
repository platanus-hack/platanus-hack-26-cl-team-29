# proveedor-marca
Actualizado: 2026-11-22 01:50

## Estado
libre (PR listo)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/canal/ (Proveedor.tsx, RutaReparto.tsx, MapaRuta.tsx, ConectarSii.tsx, BandoTePago y su formulario en MiCredito.tsx, canal.css solo para borrar reglas muertas)
- client/src/proveedor/proveedor.css, client/src/mapa/base.ts (se borró `AMARILLO`, sin uso)

## Hecho
- Panel del proveedor sin `.puente-legado` en Reparto, Pagos de Bando y Conexión con el SII: primitivas de `marca/componentes.tsx` (Boton, BotonEnlace, Estado, EstadoVacio), tokens y modo oscuro.
- Mapa de la ruta con la paleta de la marca (miel sobre el estilo claro u oscuro) y retinte al cambiar el modo.
- `canal.css`: borradas las reglas que ya no usa ningún componente. Línea base de `npm run marca` bajó de 93 a 76.

## Bloqueos

## Pedidos a otros
- Quien migre `canal/piezas.tsx`: `Confirmar` (y `EstadoSii`) siguen con la interfaz anterior; el proveedor los usa dentro de `.puente-legado` en Ventas y Reparto.
- @jorge-mapa: `MapaRuta.tsx` ya no usa `AMARILLO` de `mapa/base.ts`; se borró por estar sin uso.
