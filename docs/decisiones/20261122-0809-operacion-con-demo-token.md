# Operación del equipo con DEMO_TOKEN

Fecha: 2026-11-22 08:09
Autor: operacion-acceso

## Contexto
Durante la demo el equipo necesita ver y destrabar lo que ve el proveedor (estado del SII, folios por tipo, "Traer más
folios") y actuar como cualquier negocio si un teléfono o WhatsApp falla. Hasta ahora eso exigía el código de acceso que
llega al WhatsApp de cada negocio.

## Decisión
Dos rutas nuevas en `/api/red`, solo con el encabezado `x-demo-token` igual a `DEMO_TOKEN` (sin la variable no existen):
- `/operacion/sii?proveedor=<negocioId>`: las mismas rutas de "Conectar mi SII" con la conexión de ese proveedor (por
  defecto, el de la compra conjunta de la demo). `GET` da el estado y los folios; `POST /folios/:tipo` corre la misma
  reposición automática (reobtener primero, pedir solo lo que falta, nunca anular).
- `POST /operacion/sesion { negocioId }`: una sesión web como ese negocio, para usar la API en su nombre. Queda en el log.

Comparten el límite de las demás acciones del presentador (20 por minuto).

## Consecuencias
- `DEMO_TOKEN` pasa a dar acceso total a la demo: se rota después de la hackathon, junto con las demás claves.
- No se abre ningún login nuevo en el portal del SII: la ruta usa la sesión persistida de cada certificado.
