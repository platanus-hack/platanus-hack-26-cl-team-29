# acceso-enlace
Actualizado: 2026-11-22 03:10

## Estado
libre (PR mergeado)

## Trabajando en
- (nada)

## Archivos que estoy tocando
- server/red/acceso.ts, server/red/rutas-web.ts (`/acceso/codigo`, `/acceso/enlace`), client/src/canal/Acceso.tsx, api.ts, falso.ts
- client/src/red/derivar.ts, client/src/components/Canasta.tsx, client/src/vistas/Licitacion.tsx (solo presentación)
- test/acceso.test.ts, test/acceso-apoyo.ts, docs/decisiones

## Hecho
- El mensaje del código trae el código solo en su línea (monoespaciado) y un enlace de entrada directa `?entrar=<token>` (de un solo uso, vence con el código, solo con `PUBLIC_URL`). Pegar el mensaje entero en el campo entra solo.
- /licitacion: un producto sin precio ya no se muestra a $0 ni como "mejor precio alcanzado"; "El grupo paga hoy" en vez de "La sala paga hoy".

## Bloqueos
- (ninguno)

## Pedidos a otros
- @javier-whatsapp: cambió el texto del mensaje del código de acceso (`mensajeDeCodigo` en server/red/acceso.ts): ahora el código va en ```123456``` y trae "O entra directo: <enlace>". Si algo lee ese mensaje con el formato viejo `*123456*`, hay que actualizarlo (en el repo solo lo leía test/acceso-apoyo.ts, ya actualizado).
