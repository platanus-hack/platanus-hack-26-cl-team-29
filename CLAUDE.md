# CLAUDE.md

App web multiplayer en tiempo real para Platanus Hack 26 (track Multiplayer). **Monolito**: un solo servicio en Render. El backend (`server/`) sirve la API, Socket.io y el front compilado (`client/` → `dist/`). Front y back nunca importan código uno del otro; se hablan solo por HTTP y Socket.io. Lo que ambos necesitan (funciones puras) vive en `shared/`.

Contexto del proyecto (prioridades, flujo, documentación, repo público): @AGENTS.md

## Stack (no cambiar sin preguntar)
- **TypeScript en todo** (`strict`). No se agrega código en JS plano.
- Backend: Node ≥ 24 (ejecuta `.ts` directo, sin compilar) + Express 5 + Socket.io + `pg`.
- Frontend: Vite + React 19, compilado a `dist/` y servido por el mismo Express.
- BD: Postgres de Render, vía `DATABASE_URL`.
- Deploy: `render.yaml` (Blueprint). Cada push a `main` vuelve a deployar. Producción: https://app-a2hn.onrender.com

## Estructura
```
server/            # BACKEND: index.ts = Express + Socket.io + pg; sirve dist/
server/whatsapp/   # módulo de WhatsApp (Kapso), con dueño: se usa vía index.ts, no se edita (ver su README)
client/            # FRONTEND: index.html + src/ (React; componentes en client/src/components/; marca en client/src/marca/ y client/public/marca/)
DESIGN.md          # marca y diseño: logo, color, tipografía, íconos, ilustración, voz
shared/            # funciones puras y tipos que usan front y back (dinero, RUT, teléfonos, tramos): sin dependencias ni E/S
test/              # tests con node:test (*.test.ts)
agents/            # estado de cada agente (ver agents/README.md)
docs/              # decisiones y hallazgos, un archivo por entrada (ver docs/README.md)
vite.config.ts     # root: client/, compila a dist/; proxy de /api y /socket.io a :3000 en dev
render.yaml        # Blueprint de Render: servicio web (starter) + Postgres
README.md, platanus-hack-project.jsonc, project-description.md, project-logo.png  # exigidos por la hackathon, no mover
```
Si el backend crece, dividir `server/` por responsabilidad (`routes.ts`, `sockets.ts`, `db.ts`). No crear carpetas antes de necesitarlas.

## Comandos
- `npm start` + `npm run dev` → desarrollo (front en :5173, backend en :3000).
- `npm run build` → typecheck (`tsc`) + build de Vite. Tiene que pasar antes de cada commit.
- `npm test` → tests.
- `npm run duplicados` → busca código copiado (jscpd, config en `.jscpd.json`). Tiene que pasar antes de cada commit.
- `npm run marca` → revisa las reglas de la marca (`DESIGN.md`, "Reglas") con trinquete: ningún archivo puede sumar colores escritos a mano, letra bajo 12 px, emojis ni la tipografía anterior. Tiene que pasar antes de cada commit.

## Cómo escribir código
Código prolijo, limpio y elegante, pensado para iterar rápido sin romper: que mañana otro agente lo entienda y lo cambie en un solo lugar.

- **Una sola fuente de verdad.** Ninguna lógica, formato, tabla ni texto se copia en dos lugares. Antes de escribir un helper, búscalo (`grep`); si existe, úsalo; si está casi, generalízalo. Una copia "por mientras" es una deuda que nadie paga: no se mergea.
- **`shared/` para lo que usan front y back:** funciones puras y tipos (formatos de dinero y fecha, RUT, teléfonos, tramos de precio, cálculo de notas, textos compartidos). Sin dependencias, sin E/S, sin estado; se importa desde `client/` y `server/`. Si algo tiene que vivir en los dos lados, va ahí.
- **Helpers chicos y con nombre que dice qué hacen**, en el módulo dueño del tema (formatos en `shared/formato.ts`, RUT en `shared/rut.ts`, etc.). Nada de `utils.ts` genéricos.
- **Sigue el código que ya existe**: mismos patrones, nombres y estilo.
- **SOLID con criterio**: una responsabilidad por módulo/función, depender de interfaces solo donde hay más de una implementación real. Nada de abstracciones especulativas.
- Funciones chicas, nombres claros, sin código muerto ni scaffolding "para después".
- Las erasable-only features de TS (no `enum`, no `namespace`, no parameter properties): Node solo quita tipos.
- El puerto siempre desde `process.env.PORT`. Secretos solo por variables de entorno, nunca en el repo.
- UI y textos para el usuario en español, con la marca y la voz de `DESIGN.md`.
- **Todo monto de dinero va con separador de miles**, en formato chileno: `$1.234.567`, sin decimales. Siempre por el único formateador común (`dinero()` de `shared/formato.ts`); nunca un número crudo ni un `toLocaleString` suelto. Aplica a la web, las pantallas proyectadas, WhatsApp, los PDF y los logs que lee una persona. Folios, años y RUT no son montos: el folio va sin separador y el RUT con su formato (12.345.678-5).

## Tiempo real (regla fija)
- **Todo lo que se ve en pantalla se actualiza solo, en vivo.** Ninguna vista depende de recargar la página ni de un botón "actualizar".
- El canal es Socket.io: el backend emite `red:evento` en cada cambio y el front lo escucha (`client/src/red/useRed.ts`). Una vista nueva usa ese hook; no crea su propio polling ni otro canal.
- Toda acción que cambia datos en el backend emite su evento en el mismo paso. Un cambio que no emite evento es un bug.
- El polling solo vale como respaldo cuando el socket se cae (reintento), nunca como mecanismo principal.
- Antes de dar por terminada una pantalla, pruébala con dos ventanas abiertas: lo que haces en una tiene que verse en la otra sin tocar nada.

## Tests
- `npm run duplicados` (código copiado) y `npm run marca` (reglas de la marca) tienen que pasar antes de cada commit, igual que `build` y `test`.
- **Chicos y enfocados**: un test por comportamiento importante (lógica de negocio, sync en tiempo real, manejo de conflictos). Sin frameworks extra: `node:test` + `node:assert`.
- No testear trivialidades ni mockear todo. Un test que se cae si la lógica se rompe vale más que diez de cobertura.
- Ejemplo de referencia: `test/server.test.ts`.

## Git
- ⚠️ **Siempre `git pull` antes de hacer cualquier cosa**: al empezar una tarea, antes de crear una rama, antes de commitear y antes de abrir o mergear un PR. Son 3 personas con varios agentes empujando a `main` todo el tiempo. En una rama propia: `git pull --rebase origin main`. Si hay conflicto, resolverlo antes de seguir, nunca descartar cambios ajenos.
- **Commits en inglés**, en imperativo y cortos (`Add realtime cursor sync`, `Fix reconnect on socket drop`).
- Commits chicos y atómicos. No commitear `.env`, `node_modules` ni `dist`.
- Se trabaja solo en el repo de la org. Cada push a `main` se empuja solo al espejo (Action `Espejo al push`) y Render lo despliega en un par de minutos: lo que se mergea a `main` sale a producción.

## Coordinación entre agentes
Varios agentes trabajan en paralelo. **Antes de empezar cualquier tarea, lee `agents/*.md`** y sigue el protocolo de `agents/README.md`: un archivo de estado por agente, actualizado al tomar, terminar o quedar bloqueado en una tarea.
