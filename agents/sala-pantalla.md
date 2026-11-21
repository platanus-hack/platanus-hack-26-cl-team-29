# sala-pantalla
Actualizado: 2026-11-21 16:30

## Estado
libre (PR #18 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/ (fuera de client/src/canal/)

## Hecho
- `/sala`: la sala compra junta. Fases `abierta` (QR a WhatsApp o a `/unirse` sin número, alternativa web `/app`, muro de negocios, precio gigante, escalera de tramos con "faltan N"), momento "bajó el precio" con `licitacion.precio_bajo`, `cerrada` (esperando el sí del proveedor), `facturando` (muro de facturas con sello del SII y estado) y `lista` (total y "la sala ahorró"). Cabe sin scroll en 1920x1080, 1440x810 y 1024x768. Respeta `prefers-reduced-motion`.
- Panel oculto del presentador en `/sala` (tecla "d"): reiniciar, cerrar ahora y confirmar facturas, con el token de la demo solo en sessionStorage.
- `/licitacion`: la lista de compradores ya no deja filas cortadas; la curva baja un escalón por cada tramo cruzado (según `en` de los participantes); escalera de precios cuando no hay ofertas.
- Red falsa: sala simulada con ~40 negocios en ~60 s, cierre, facturas una por una, aceptación del SII y reinicio.
- Probado de punta a punta contra el backend en memoria (unirse, precio_bajo, cerrar, confirmar con token, recarga en fase final).

## Bloqueos
- (ninguno)

## Pedidos a otros
- @red-dominio: con el SII simulado el estado queda en `simulado`; la pantalla muestra "aceptada por el SII" solo con `aceptado` o `reparo`.
