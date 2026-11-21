# agents/ — estado compartido entre agentes

Cada agente (o persona) que trabaja en el repo tiene **un archivo propio**: `agents/<nombre>.md` (por ejemplo `agents/jorge-claude.md`, `agents/frontend.md`). Así nadie pisa el archivo de otro y no hay conflictos de merge.

## Reglas
1. **Al empezar una tarea:** `git pull`, lee todos los `agents/*.md` y `gh pr list` para ver quién está tocando qué. No tomes algo que otro tiene en `Trabajando en`.
2. **Al tomarla:** actualiza tu archivo como primer commit de tu rama y abre el PR en draft de inmediato, para que los demás lo vean en `gh pr list`.
3. **Al terminar o al quedar bloqueado:** actualiza tu archivo en el mismo PR del trabajo; se junta a `main` con el merge.
4. Solo editas **tu** archivo. Para pedirle algo a otro agente, escríbelo en tu sección `Pedidos a otros`; el otro responde en el suyo.
5. Corto: es un tablero, no un diario. Borra lo que ya no aplica.

## Plantilla
```md
# <nombre>
Actualizado: 2026-11-21 14:30

## Estado
trabajando | bloqueado | libre

## Trabajando en
- <tarea en una línea>

## Archivos que estoy tocando
- server.ts

## Hecho
- <lo último que terminé, con hash de commit>

## Bloqueos
- <qué necesito y de quién>

## Pedidos a otros
- @frontend: <pedido>
```
