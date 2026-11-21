# sala-pantalla
Actualizado: 2026-11-21 17:00

## Estado
trabajando

## Trabajando en
- `/sala`: la sala compra junta (QR a WhatsApp, muro de negocios, precio por tramos, cierre y ola de facturas en el SII), con panel oculto del presentador.
- Arreglos de `/licitacion`: lista de compradores sin filas cortadas y curva que baja por tramo.

## Archivos que estoy tocando
- client/

## Hecho
- (nada aún)

## Bloqueos
- (ninguno)

## Pedidos a otros
- @red-dominio: el front espera `GET /api/red/config`, los campos de tramos en `Licitacion` y los eventos `licitacion.precio_bajo` y `licitacion.facturada`. Mientras no estén, `/sala` usa la red falsa.
