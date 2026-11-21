# sala-pantalla
Actualizado: 2026-11-21 18:30

## Estado
libre (PR #27 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/vistas/, client/src/red/derivar.ts, test/pantalla-derivar.test.ts

## Hecho
- `/sala`: el aviso "Bajó el precio" a pantalla completa solo al cruzar un tramo (máximo uno cada 6 s, con un solo temporizador que lo cierra a los 2,4 s); las bajadas por ofertas se animan en el lugar con un destello verde. Franja de proveedores en una línea (la ganadora siempre visible), escalera más baja y muro con 4 a 5 filas a 1440 px. Marca "Bando".
- `/sala`: la sala compra junta. Fases `abierta` (QR a WhatsApp o a `/unirse` sin número, alternativa web `/app`, muro de negocios, precio gigante, escalera de tramos con "faltan N"), momento "bajó el precio" con `licitacion.precio_bajo`, `cerrada` (esperando el sí del proveedor), `facturando` (muro de facturas con sello del SII y estado) y `lista` (total y "la sala ahorró"). Cabe sin scroll en 1920x1080, 1440x810 y 1024x768. Respeta `prefers-reduced-motion`.
- `/sala` con proveedores compitiendo: franja "Proveedores compitiendo" (ofertas en vivo, la ganadora en amarillo y el proveedor del escenario marcado "en la sala"), los tres pasos de la historia en la cabecera (compran juntos, proveedores compiten, factura automática en el SII) y "Nadie entró al sitio del SII" al facturar. La red falsa simula cuatro proveedores ofertando.
- Panel oculto del presentador en `/sala` (tecla "d"): reiniciar, cerrar ahora y confirmar facturas, con el token de la demo solo en sessionStorage.
- `/licitacion`: la lista de compradores ya no deja filas cortadas; la curva baja un escalón por cada tramo cruzado (según `en` de los participantes); escalera de precios cuando no hay ofertas.
- Red falsa: sala simulada con ~40 negocios en ~60 s, cierre, facturas una por una, aceptación del SII y reinicio.
- Probado de punta a punta contra el backend en memoria (unirse, precio_bajo, cerrar, confirmar con token, recarga en fase final).

## Bloqueos
- (ninguno)

## Pedidos a otros
- @agente de proveedores: la pantalla lee `licitacion.oferta` como `{ licitacionId, oferta: { proveedorId, proveedorNombre, precioUnitario, nota, en }, mejor }` y las ofertas desde `licitacion.ofertas` de la foto. Si la licitación trae `ganadora`, esa manda; si no, gana la más barata. "Esperando el sí de" usa `ganadora` y, si no hay, `proveedorId`.
- @red-dominio: con el SII simulado el estado queda en `simulado`; la pantalla muestra "aceptada por el SII" solo con `aceptado` o `reparo`.
