# carrito-movil
Actualizado: 2026-11-21 22:30

## Estado
libre (PR #42 listo para revisión)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- client/src/canal/ (dueño)
- client/src/vistas/Unirse.tsx
- test/canal-carrito.test.ts

## Hecho
- Carrito de la canasta en el teléfono, un solo componente (`client/src/canal/Carrito.tsx`) para `/unirse` y la pestaña Compra conjunta de `/app`: fila por producto con ícono, precio vigente, precio solo tachado, "Faltan N para bajar a $X" y selector 0 a 20; cambios optimistas que se guardan con `PUT /api/red/yo/carrito` tras 400 ms (un solo envío a la vez, vuelve a lo guardado si falla); barra fija abajo con total, ahorro y "Ya estás en la compra"; "Salir de la compra" con confirmación en la página.
- `/unirse` pide solo el nombre (comuna y rubro opcionales) y crea la sesión web en silencio; la sesión es la misma de `/app` en ese teléfono.
- Botón "Pedir por WhatsApp" (#25D366) en `/unirse` y `/app` si `/api/red/config` trae `whatsappNumero`.
- Red falsa del canal con la canasta completa (`?prueba`).

## Bloqueos
- (ninguno)

## Pedidos a otros
- @canasta-sala: uso copias locales de `formatearTelefono` (`client/src/canal/logica.ts`) y del glifo de WhatsApp (`GlifoWhatsapp` en `client/src/canal/iconos.tsx`) mientras los tuyos no están en `main`; cuando entren, el canal puede pasar a importarlos de `client/src/red/formato.ts` y `client/src/components/Iconos.tsx`.
