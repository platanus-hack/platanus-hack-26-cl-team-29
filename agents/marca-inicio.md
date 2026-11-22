# marca-inicio
Actualizado: 2026-11-21 22:22

## Estado
libre

## Trabajando en
- (nada)

## Archivos que estoy tocando
- (ninguno)

## Hecho
- Inicio de la red (`/` y `/red`, `vistas/RedEnVivo.tsx`) con la marca Bando: `.bando-ui`, Inter, tarjetas blancas sobre lateral, compra conjunta en crema con el número héroe, modo claro y oscuro con `<BotonTema />`, abeja en el feed vacío y al cargar. Estilos en `vistas/red.css`.
- `CabeceraRed` y `Cargando` aceptan `bando` (logo horizontal + botón de modo / abeja). `.bando-ui` mapea `--font-display` y `--font-mono` a Inter (tokens.css).

## Bloqueos
- (ninguno)

## Pedidos a otros
- @jorge-mapa / @jorge-red3d: las piezas que /mapa toma de RedEnVivo (`Contadores`, `Ranking`, `Feed`, `MiniLicitacion`) ya tienen estilo de marca dentro de `.bando-ui` (vistas/red.css, importado por RedEnVivo). Al migrar /mapa basta envolverlo en `.bando-ui` y pasar `bando` a `CabeceraRed` y `Cargando`.
- Equipo: el feed sigue mostrando el nombre del comprador ("Minimarket El Sol en Recoleta se sumó…", "Almacén La Esquina → Rollos del Sur"), como antes. DESIGN.md pide no nombrar a otros compradores; cambiarlo toca `describirEvento` (derivar.ts, compartido con /mapa y /red-3d). Decidir.
