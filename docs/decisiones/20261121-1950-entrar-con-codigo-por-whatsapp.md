# Entrar a la web con el teléfono y un código por WhatsApp

Fecha: 2026-11-21 19:50
Autor: javier-acceso

## Contexto
La web no tenía usuarios: un comprador entraba escribiendo un nombre y un RUT (cualquiera podía entrar con el RUT de
otro desde otro navegador) y el panel del proveedor tenía un solo código compartido (`PROVEEDOR_CODIGO`). Las sesiones
vivían en memoria y se perdían en cada reinicio. Cada negocio de la red ya tiene su WhatsApp, y un mismo negocio puede
comprar y vender.

## Decisión
- **Entrar:** el teléfono → un código de 6 dígitos por WhatsApp → entra el negocio de ese teléfono. Si el número es
  nuevo, pide nombre y RUT y lo registra como comprador. Sin contraseñas. Rutas `/api/red/acceso/{codigo,entrar,salir}`
  (contrato en `20261121-1130-contrato-red.md`).
- **Código** (`server/red/acceso.ts`): al azar (`crypto.randomInt`), guardado como hash, vence a los 10 minutos, sirve
  una vez y se anula tras 5 intentos fallidos. Cada teléfono pide a lo más 5 por hora. Se manda a cualquier teléfono
  válido, así que la respuesta no dice si el número es de la red.
- **Sesión** (`server/red/sesiones.ts`): token opaco al azar (24 bytes), no un JWT. Se guarda solo su hash SHA-256 en
  Postgres (`sesiones_web`), con copia en memoria. Dura 90 días desde el último uso, así que en un dispositivo propio no
  se vuelve a pedir código. "Salir" la revoca al instante. Va por `Authorization: Bearer`, no en una cookie, así que no
  hay CSRF.
- **Sin roles en la sesión:** es del negocio. `/yo/*` exige `puedeComprar` y `/proveedor/*` exige `puedeVender`
  (403 si no puede). El mismo negocio compra y vende con una sola sesión.

## Consecuencias
- Para la demo, el público se suma por WhatsApp; la web la usa el equipo. El proveedor de la sala entra al panel con
  `DEMO_TELEFONO_PROVEEDOR`.
- Ventana de 24 h: si el teléfono no ha escrito al número en 24 h, el código queda `held` y llega apenas la persona
  escriba (la pantalla lo explica y enlaza al chat). En producción hace falta una plantilla de autenticación aprobada
  por Meta.
- Se descartó el JWT: no hace falta verificar sin base de datos (un solo servidor) y no se puede revocar sin una lista
  negra. También se descartaron las contraseñas: más fricción y algo más que filtrar.
- Fuera de este cambio: `POST /licitaciones/:id/unirse` (sumarse con nombre y RUT, sin sesión) y las rutas de operación
  sin token (`/ordenes/*`) siguen abiertas.
