# CLAUDE.md

App web multiplayer en tiempo real para Platanus Hack 26 (track Multiplayer). Un solo servicio en Render: Express sirve la API, Socket.io y el front compilado.

## Stack (no cambiar sin preguntar)
- **TypeScript en todo** (`strict`). No se agrega código en JS plano.
- Backend: Node ≥ 24 (ejecuta `.ts` directo, sin compilar) + Express 5 + Socket.io + `pg`.
- Frontend: Vite + React 19, compilado a `dist/` y servido por el mismo Express.
- BD: Postgres de Render, vía `DATABASE_URL`.
- Deploy: `render.yaml` (Blueprint). Cada push a `main` vuelve a deployar.

## Estructura
```
render.yaml        # Blueprint: servicio web (starter) + Postgres
server.ts          # Express + Socket.io + pg; sirve dist/
index.html         # entrada de Vite
vite.config.ts     # proxy de /api y /socket.io a :3000 en dev
src/               # React (main.tsx y componentes)
test/              # tests con node:test (*.test.ts)
```
Si el código crece, separar el backend en `server/` (rutas, sockets, db) y el front en `src/components/`. No crear carpetas antes de necesitarlas.

## Comandos
- `node server.ts` + `npm run dev` → desarrollo (front en :5173, backend en :3000).
- `npm run build` → typecheck (`tsc`) + build de Vite. Tiene que pasar antes de cada commit.
- `npm test` → tests.

## Cómo escribir código
- **Sigue el código que ya existe**: mismos patrones, nombres y estilo. Antes de crear un helper, busca si ya hay uno.
- **SOLID con criterio**: una responsabilidad por módulo/función, depender de interfaces solo donde hay más de una implementación real. Nada de abstracciones especulativas.
- Funciones chicas, nombres claros, sin código muerto ni scaffolding "para después".
- Las erasable-only features de TS (no `enum`, no `namespace`, no parameter properties): Node solo quita tipos.
- El puerto siempre desde `process.env.PORT`. Secretos solo por variables de entorno, nunca en el repo.
- UI y textos para el usuario en español.

## Tests
- **Chicos y enfocados**: un test por comportamiento importante (lógica de negocio, sync en tiempo real, manejo de conflictos). Sin frameworks extra: `node:test` + `node:assert`.
- No testear trivialidades ni mockear todo. Un test que se cae si la lógica se rompe vale más que diez de cobertura.
- Ejemplo de referencia: `test/server.test.ts`.

## Git
- **Commits en inglés**, en imperativo y cortos (`Add realtime cursor sync`, `Fix reconnect on socket drop`).
- Commits chicos y atómicos. No commitear `.env`, `node_modules` ni `dist`.
- `origin` empuja a dos repos: el de la org (para el jurado) y el espejo personal (desde el que deploya Render). Un `git push` actualiza ambos.
