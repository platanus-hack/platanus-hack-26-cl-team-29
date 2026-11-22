# Bando

La red de compras de las pymes: los negocios compran juntos por WhatsApp o por la web, los proveedores compiten en vivo y todo queda en el SII sin un solo trámite.

<img src="./project-logo.png" alt="Logo de Bando" width="160" />

**Platanus Hack 26: Santiago ft. Buk** · Track Multiplayer · team-29

- Luciano Saavedra Reyes ([@lucianosr98](https://github.com/lucianosr98))
- Javier Zagal ([@javierzagal](https://github.com/javierzagal))
- Jorge Oehrens ([@JorgeOehrens](https://github.com/JorgeOehrens))

**Demo:** https://app-a2hn.onrender.com

## Qué hace

1. **La sala compra junta.** Cada negocio se suma a una canasta escribiendo por WhatsApp o desde `/app`, con su RUT. Cada uno que entra baja el precio para todos, por tramos de volumen.
2. **Los proveedores compiten.** Personas y agentes de IA ofertan en vivo por cada producto; gana el mejor precio ajustado por reputación.
3. **Todo nativo del SII.** Con un "sí" del proveedor salen todas las facturas en un solo envío al SII, con la orden de compra como referencia. Cada comprador recibe su factura en PDF por WhatsApp.
4. **Reclamos que valen.** Un faltante se reclama en el SII con una palabra, el proveedor responde con una nota de crédito y su reputación cambia para toda la red.

## Vistas

| Ruta | Para qué |
|---|---|
| `/sala` | Pantalla de la demo: QR, canasta, competencia y facturas en vivo |
| `/app` | Comprador por la web (equivalente a WhatsApp) |
| `/proveedor` | Panel del proveedor y "Conectar mi SII" |
| `/red`, `/mapa`, `/licitacion` | La red en vivo |
| `/unirse` | Sumarse desde el celular |

## Cómo correrlo

```bash
npm install
npm start      # backend en :3000
npm run dev    # front en :5173
npm test && npm run build && npm run duplicados
```

Sin variables de entorno todo funciona en modo simulado (SII, WhatsApp y Claude falsos). Las variables están en `.env.example`. El SII real se conecta desde el panel del proveedor y opera solo contra el ambiente de certificación (maullin).

## Arquitectura

Monolito en TypeScript: Node 24 con Express y Socket.io, React 19 con Vite y Postgres. Lo que usan front y back vive en `shared/`. El módulo SII es propio, escrito desde cero por el equipo (firma, timbre, factura, guía, nota de crédito, envío, estado y reclamos), con una sesión del portal compartida y persistida. Detalle y decisiones en `docs/` y reglas de trabajo en `AGENTS.md` y `CLAUDE.md`.
