# Límites por persona y acciones que salen una sola vez

Fecha: 2026-11-21 15:49
Autor: anti-doble-clic

## Contexto
En la demo en vivo un doble clic, un clic de más o un toque repetido no puede duplicar una acción (dos facturas, dos certificados guardados, dos avisos por WhatsApp). Además, toda la sala sale a internet por la misma IP del wifi del evento, así que un límite por IP en las rutas del público frena a todos a la vez.

## Decisión
- **Web:** toda acción con efecto pasa por `useEnvio` o `useConfirmacion` (`client/src/canal/piezas.tsx`): el botón queda deshabilitado con el texto de la acción en curso y un segundo toque mientras viaja el primero se ignora. Los selectores de cantidad del carrito no se bloquean: el envío ya junta los toques seguidos en uno cada 400 ms.
- **Link del certificado:** la subida toma el link en el mismo paso en que lo valida; una segunda subida simultánea recibe 409. Si la subida falla por la clave o el archivo, el link vuelve con un intento menos; al quinto fallo muere. Cada teléfono recibe como mucho 5 links nuevos cada 10 minutos; pasado eso se repite el último que sigue vivo.
- **Servidor:** un solo helper, `server/limite.ts` (`crearLimitador` y el middleware `limitarPor`), ventana fija en memoria. La clave es siempre de una persona, nunca la IP en rutas del público ni en el webhook de WhatsApp:

| Ruta | Clave | Tope |
|---|---|---|
| `POST /sesion`, `POST /licitaciones/:id/unirse` | RUT | 20 por minuto |
| `/yo/unirse`, `/yo/carrito`, `/yo/ordenes` | negocio de la sesión | 300 por minuto |
| Acciones del proveedor (cerrar, facturar, confirmar, nota de crédito) | negocio de la sesión | 30 por minuto |
| `/proveedor/sii` (todo salvo `GET`) | negocio de la sesión | 30 por minuto |
| `/demo/reiniciar`, `/licitaciones/:id/confirmar` | token de la demo | 20 por minuto |
| `POST /proveedor/sesion` | IP (no la usa el público; frena que se adivine el código) | 20 por minuto |

Al pasar el tope se responde 429 con `{ error: 'demasiados_pedidos', mensaje }`; el mensaje es `MENSAJE_LIMITE` de `shared/texto.ts`.

## Consecuencias
- La idempotencia que ya existía no cambia: facturar solo emite lo que falta y la cola de la red sigue igual.
- Una ruta nueva con efecto usa `limitarPor` con una clave de persona; nunca un límite por IP en rutas del público.
